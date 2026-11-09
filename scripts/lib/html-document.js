/*
 * Small source-preserving HTML document helper.
 *
 * It is intentionally limited to the operations the publishing pipeline needs:
 * finding elements, reading text/attributes, and applying range-based edits.
 * The original source is kept intact; publishing never serializes the article
 * body back through a generic template.
 */
const VOID_ELEMENTS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr"
]);

const decodeEntities = (value) => value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const escapeHtml = (value) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function readTagEnd(source, start) {
    let quote = null;
    for (let i = start; i < source.length; i += 1) {
        const ch = source[i];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === ">") {
            return i;
        }
    }
    return source.length - 1;
}

function parseAttributes(source, start, end) {
    const attrs = [];
    let i = start;
    while (i < end) {
        while (i < end && /\s/.test(source[i])) i += 1;
        if (i >= end || source[i] === "/") break;
        const nameStart = i;
        while (i < end && !/[\s=/>]/.test(source[i])) i += 1;
        const name = source.slice(nameStart, i).toLowerCase();
        if (!name) { i += 1; continue; }
        while (i < end && /\s/.test(source[i])) i += 1;
        let value = "";
        let valueStart = null;
        let valueEnd = null;
        if (source[i] === "=") {
            i += 1;
            while (i < end && /\s/.test(source[i])) i += 1;
            if (source[i] === '"' || source[i] === "'") {
                const quote = source[i];
                i += 1;
                valueStart = i;
                while (i < end && source[i] !== quote) i += 1;
                valueEnd = i;
                value = decodeEntities(source.slice(valueStart, valueEnd));
                if (i < end) i += 1;
            } else {
                valueStart = i;
                while (i < end && !/[\s>]/.test(source[i])) i += 1;
                valueEnd = i;
                value = decodeEntities(source.slice(valueStart, valueEnd));
            }
        }
        attrs.push({ name, value, nameStart, valueStart, valueEnd });
    }
    return attrs;
}

function parseHtml(source) {
    const root = { type: "root", children: [], parent: null, start: 0, end: source.length };
    const stack = [root];
    let cursor = 0;

    const addText = (start, end) => {
        if (end > start) stack[stack.length - 1].children.push({ type: "text", start, end, parent: stack[stack.length - 1] });
    };

    while (cursor < source.length) {
        const open = source.indexOf("<", cursor);
        if (open < 0) { addText(cursor, source.length); break; }
        addText(cursor, open);

        if (source.startsWith("<!--", open)) {
            const end = source.indexOf("-->", open + 4);
            cursor = end < 0 ? source.length : end + 3;
            continue;
        }
        if (/^<!doctype/i.test(source.slice(open, open + 10)) || source[open + 1] === "!") {
            const end = readTagEnd(source, open + 2);
            cursor = end + 1;
            continue;
        }
        if (source[open + 1] === "/") {
            const end = readTagEnd(source, open + 2);
            const name = source.slice(open + 2, end).trim().split(/\s/)[0].toLowerCase();
            let index = stack.length - 1;
            while (index > 0 && stack[index].tag !== name) index -= 1;
            if (index > 0) {
                const node = stack[index];
                node.closeStart = open;
                node.closeEnd = end + 1;
                node.end = end + 1;
                node.innerEnd = open;
                stack.length = index;
            }
            cursor = end + 1;
            continue;
        }

        const end = readTagEnd(source, open + 1);
        const raw = source.slice(open + 1, end);
        const match = raw.match(/^\s*([^\s/>]+)/);
        if (!match) { cursor = end + 1; continue; }
        const tag = match[1].toLowerCase();
        const nameEnd = open + 1 + raw.indexOf(match[1]) + match[1].length;
        const attrs = parseAttributes(source, nameEnd, end);
        const parent = stack[stack.length - 1];
        const node = {
            type: "element", tag, attrs, parent, children: [],
            start: open, openEnd: end + 1, innerStart: end + 1,
            innerEnd: end + 1, end: end + 1,
            closeStart: null, closeEnd: null
        };
        parent.children.push(node);
        const selfClosing = /\/\s*$/.test(raw) || VOID_ELEMENTS.has(tag);
        if (!selfClosing) {
            stack.push(node);
            if (tag === "script" || tag === "style") {
                const close = source.toLowerCase().indexOf(`</${tag}`, cursor = end + 1);
                if (close < 0) { addText(end + 1, source.length); cursor = source.length; break; }
                addText(end + 1, close);
                cursor = close;
            } else {
                cursor = end + 1;
            }
        } else {
            cursor = end + 1;
        }
    }
    return { source, root };
}

function elementText(document, node) {
    if (!node) return "";
    if (node.type === "text") return decodeEntities(document.source.slice(node.start, node.end));
    return (node.children || []).map((child) => elementText(document, child)).join("");
}

function descendants(node) {
    const result = [];
    for (const child of node.children || []) {
        if (child.type === "element") {
            result.push(child);
            result.push(...descendants(child));
        }
    }
    return result;
}

function matches(node, selector) {
    if (!node || node.type !== "element") return false;
    const attr = selector.match(/^([\w-]+)?\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]$/);
    if (attr) {
        if (attr[1] && node.tag !== attr[1].toLowerCase()) return false;
        const found = node.attrs.find((item) => item.name === attr[2].toLowerCase());
        return Boolean(found && (attr[3] === undefined || found.value === attr[3]));
    }
    const classMatch = selector.match(/^([\w-]+)?\.([\w-]+)$/);
    if (classMatch) {
        if (classMatch[1] && node.tag !== classMatch[1].toLowerCase()) return false;
        const cls = node.attrs.find((item) => item.name === "class");
        return Boolean(cls && cls.value.split(/\s+/).includes(classMatch[2]));
    }
    return node.tag === selector.toLowerCase();
}

function findAll(document, selector, within = document.root) {
    const parts = selector.trim().split(/\s+/);
    let current = [within];
    for (const part of parts) {
        const next = [];
        for (const node of current) {
            for (const candidate of descendants(node)) if (matches(candidate, part)) next.push(candidate);
        }
        current = next;
    }
    return current;
}

function getAttr(node, name) {
    return node?.attrs.find((item) => item.name === name.toLowerCase())?.value ?? null;
}

function edit(document, start, end, value) {
    document.edits.push({ start, end, value });
}

function setText(document, node, value) {
    edit(document, node.innerStart, node.innerEnd, escapeHtml(value));
}

function setInnerHtml(document, node, value) {
    edit(document, node.innerStart, node.innerEnd, value);
}

function setAttr(document, node, name, value) {
    const attr = node.attrs.find((item) => item.name === name.toLowerCase());
    if (attr && attr.valueStart !== null) {
        const quote = document.source[attr.valueStart - 1];
        edit(document, attr.valueStart, attr.valueEnd, escapeHtml(value));
        if (quote !== '"' && quote !== "'") edit(document, attr.valueEnd, attr.valueEnd, "");
        return;
    }
    const insertAt = node.openEnd - 1 - (/\/\s*$/.test(document.source.slice(node.start, node.openEnd - 1)) ? 1 : 0);
    edit(document, insertAt, insertAt, ` ${name}="${escapeHtml(value)}"`);
}

function applyEdits(document) {
    const edits = [...document.edits].sort((a, b) => b.start - a.start || b.end - a.end);
    let result = document.source;
    for (const item of edits) result = result.slice(0, item.start) + item.value + result.slice(item.end);
    return result;
}

function createDocument(source) {
    const document = parseHtml(source);
    document.edits = [];
    document.findAll = (selector, within) => findAll(document, selector, within);
    document.text = (node) => elementText(document, node);
    document.attr = getAttr;
    document.setText = (node, value) => setText(document, node, value);
    document.setInnerHtml = (node, value) => setInnerHtml(document, node, value);
    document.setAttr = (node, name, value) => setAttr(document, node, name, value);
    document.apply = () => applyEdits(document);
    return document;
}

module.exports = { createDocument, escapeHtml, decodeEntities };
