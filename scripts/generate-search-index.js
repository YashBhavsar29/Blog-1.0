#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createDocument } = require("./lib/html-document");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "posts");
const SEARCH_DIR = path.join(ROOT, "search");

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const metadataFiles = () => fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter((file) => file.endsWith(".json")).sort()
    : [];
const loadPublished = () => metadataFiles().map((file) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")))
    .filter((post) => post.status === "published");

function meaningfulText(document, node, parts) {
    if (!node || node.type !== "element") return;
    const className = document.attr(node, "class") || "";
    if (["script", "style", "noscript", "template", "nav"].includes(node.tag)) return;
    if (/post-nav|topbar|colophon|pencil-bar|page-no|entry-hint/i.test(className)) return;
    const aria = document.attr(node, "aria-label");
    if (aria && ["img", "svg"].includes(node.tag)) parts.push(aria);
    if (["img"].includes(node.tag)) {
        const alt = document.attr(node, "alt");
        if (alt) parts.push(alt);
    }
    if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "figcaption", "dt", "dd", "strong", "em", "text"].includes(node.tag)) {
        const text = clean(document.text(node));
        if (text) parts.push(text);
        return;
    }
    for (const child of node.children || []) meaningfulText(document, child, parts);
}

function extractArticleText(source) {
    const document = createDocument(source);
    const article = document.findAll("article.post")[0] || document.findAll("article")[0];
    const parts = [];
    meaningfulText(document, article, parts);
    return clean(parts.join(" "));
}

function generateSearchIndex({ write = true } = {}) {
    const records = [];
    for (const post of loadPublished()) {
        const articleFile = post.source?.file || `posts/${post.slug}.html`;
        const articlePath = path.join(ROOT, articleFile);
        if (!fs.existsSync(articlePath)) throw new Error(`${post.id}: missing ${articleFile}`);
        const source = fs.readFileSync(articlePath, "utf8");
        const tags = (post.classification?.tags || []).map((tag) => typeof tag === "string" ? tag : tag.label).filter(Boolean);
        records.push({
            id: post.id,
            slug: post.slug,
            title: post.content.title,
            webpageTitle: post.seo.webpageTitle,
            dek: post.content.dek || "",
            excerpt: post.listing?.excerpt || "",
            series: post.classification.series,
            tags,
            date: post.publication.date,
            url: articleFile.replaceAll(path.sep, "/"),
            text: extractArticleText(source)
        });
    }
    records.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    if (write) {
        fs.mkdirSync(SEARCH_DIR, { recursive: true });
        fs.writeFileSync(path.join(SEARCH_DIR, "search-index.json"), `${JSON.stringify(records, null, 2)}\n`);
    }
    return records;
}

if (require.main === module) {
    const records = generateSearchIndex();
    console.log(`Search index generated: ${records.length} published article(s).`);
}

module.exports = { generateSearchIndex, extractArticleText };
