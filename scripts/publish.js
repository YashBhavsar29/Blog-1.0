#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createDocument, escapeHtml } = require("./lib/html-document");
const { generateSearchIndex } = require("./generate-search-index");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "posts");
const POSTS_DIR = path.join(ROOT, "posts");
const dryRun = process.argv.includes("--dry-run");

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const loadMetadata = () => fs.readdirSync(DATA_DIR).filter((file) => file.endsWith(".json")).sort()
    .map((file) => ({ file, value: JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")) }));
const publishedDate = (post) => post.publication?.date || "9999-12-31";
const sortPosts = (a, b) => (Number(a.publication?.order ?? 999999) - Number(b.publication?.order ?? 999999))
    || publishedDate(a).localeCompare(publishedDate(b)) || a.slug.localeCompare(b.slug);
const formatDate = (value) => {
    const match = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (!match) return value;
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${match[2]} ${months[Number(match[1]) - 1] || match[1]} ${String(value).slice(0, 4)}`;
};
const validPublicationDate = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match || Number(match[1]) < 2026) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1])
        && date.getUTCMonth() === Number(match[2]) - 1
        && date.getUTCDate() === Number(match[3]);
};
const tagLabel = (tag) => typeof tag === "string" ? tag : tag?.label;
const displaySeries = (series) => ({ journal: "Life Journal", thoughts: "My Thoughts", postmortem: "Dev Learnings" }[series] || series);
const pagePrefixFromLabel = (label) => {
    const words = String(label || "Category").replace(/&/g, " and ").match(/[A-Za-z0-9]+/g) || ["Category"];
    return `${words.map((word) => word[0].toUpperCase()).join(".")}.`;
};
const categoryLabel = (post) => post.classification?.label || post.classification?.name || displaySeries(post.classification?.series);
const categoryPrefix = (post) => {
    const configured = post.classification?.pagePrefix || post.classification?.prefix;
    return String(configured || pagePrefixFromLabel(categoryLabel(post))).replace(/\.+$/, "") + ".";
};
const marker = (document, selector, name, fallback) => document.findAll(`[data-blog-meta="${name}"]`)[0] || document.findAll(selector, fallback)[0];

function validateMetadata(records) {
    const errors = [];
    const ids = new Set();
    const slugs = new Set();
    for (const { file, value: post } of records) {
        for (const field of ["id", "slug", "status", "seo", "content", "classification", "publication", "listing", "navigation"]) if (!(field in post)) errors.push(`${file}: missing ${field}`);
        if (ids.has(post.id)) errors.push(`${file}: duplicate id ${post.id}`); else ids.add(post.id);
        if (slugs.has(post.slug)) errors.push(`${file}: duplicate slug ${post.slug}`); else slugs.add(post.slug);
        if (!/^(draft|published|archived)$/.test(post.status || "")) errors.push(`${file}: invalid status`);
        if (!validPublicationDate(post.publication?.date)) errors.push(`${file}: publication.date must be a valid YYYY-MM-DD date in 2026 or later`);
        if (post.publication?.updatedAt && !validPublicationDate(post.publication.updatedAt)) errors.push(`${file}: publication.updatedAt must be a valid YYYY-MM-DD date in 2026 or later`);
        if (post.status === "published") {
            const articleFile = post.source?.file || `posts/${post.slug}.html`;
            const normalizedArticle = path.normalize(articleFile);
            if (path.isAbsolute(articleFile) || normalizedArticle.startsWith(`..${path.sep}`) || !normalizedArticle.startsWith(`posts${path.sep}`)) errors.push(`${file}: article path must stay inside posts/`);
            const article = path.join(ROOT, articleFile);
            if (!fs.existsSync(article)) errors.push(`${file}: missing article ${path.relative(ROOT, article)}`);
        }
    }
    const published = records.map(({ value }) => value).filter((post) => post.status === "published");
    const publishedIds = new Set(published.map((post) => post.id));
    for (const post of published) for (const field of ["previousPost", "nextPost"]) {
        const ref = post.navigation?.[field];
        if (ref && !publishedIds.has(ref)) errors.push(`${post.id}: ${field} points to unknown article ${ref}`);
    }
    return errors;
}

function resolveNavigation(posts) {
    posts.forEach((post, index) => {
        const previous = posts[index - 1]?.id || null;
        const next = posts[index + 1]?.id || null;
        post._previous = post.navigation?.previousPost || previous;
        post._next = post.navigation?.nextPost || next;
        if (post._previous && !posts.some((candidate) => candidate.id === post._previous)) throw new Error(`${post.id}: invalid previousPost ${post._previous}`);
        if (post._next && !posts.some((candidate) => candidate.id === post._next)) throw new Error(`${post.id}: invalid nextPost ${post._next}`);
        if (post._previous === post.id || post._next === post.id) throw new Error(`${post.id}: circular self-navigation`);
    });
}

function resolvePageNumbers(posts) {
    const counters = new Map();
    const prefixes = new Map();
    for (const post of posts) {
        const label = categoryLabel(post);
        const prefix = categoryPrefix(post);
        const categoryKey = String(post.classification?.series || label).toLowerCase();
        if (prefixes.has(categoryKey) && prefixes.get(categoryKey) !== prefix) {
            throw new Error(`${post.id}: category ${categoryKey} has inconsistent page prefixes`);
        }
        prefixes.set(categoryKey, prefix);
        const pageNumber = (counters.get(categoryKey) || 0) + 1;
        counters.set(categoryKey, pageNumber);
        post._categoryLabel = label;
        post._categoryPrefix = prefix;
        post._pageNumber = pageNumber;
        post._pageLabel = `${prefix} Page ${String(pageNumber).padStart(3, "0")}`;
    }
}

function resolveMissingPublicationFields(posts) {
    const numericOrders = posts
        .map((post) => Number(post.publication?.order))
        .filter((order) => Number.isFinite(order));
    let nextOrder = numericOrders.length ? Math.max(...numericOrders) + 1 : 1;
    const missingOrder = posts
        .filter((post) => !Number.isFinite(Number(post.publication?.order)))
        .sort((a, b) => publishedDate(a).localeCompare(publishedDate(b)) || a.slug.localeCompare(b.slug));
    for (const post of missingOrder) {
        post.publication.order = nextOrder;
        nextOrder += 1;
    }
    for (const post of posts) {
        if (!post.publication.updatedAt) post.publication.updatedAt = post.publication.date;
    }
}

function navLink(id, label, posts) {
    const post = posts.find((candidate) => candidate.id === id);
    return post ? `<a href="${escapeHtml(path.basename(post.source?.file || `posts/${post.slug}.html`))}">${escapeHtml(label)}</a>` : "";
}

function updateHtml(post, posts) {
    const articleFile = post.source?.file || `posts/${post.slug}.html`;
    const articlePath = path.join(ROOT, articleFile);
    const source = fs.readFileSync(articlePath, "utf8");
    const document = createDocument(source);
    const article = document.findAll("article.post")[0] || document.findAll("article")[0];
    if (!article) throw new Error(`${post.id}: no article element found in ${articleFile}`);
    const title = marker(document, "title", "webpage-title");
    const description = marker(document, 'meta[name="description"]', "meta-description");
    const heading = marker(document, "h1", "blog-title", article);
    const dek = marker(document, "p.dek", "blog-dek", article);
    const kicker = marker(document, ".post-kicker", "kicker", article);
    if (title) { document.setText(title, post.seo.webpageTitle); document.setAttr(title, "data-blog-meta", "webpage-title"); }
    if (description) { document.setAttr(description, "content", post.seo.metaDescription || ""); document.setAttr(description, "data-blog-meta", "meta-description"); }
    if (heading) { document.setText(heading, post.content.title); document.setAttr(heading, "data-blog-meta", "blog-title"); }
    if (dek && post.content.dek) { document.setText(dek, post.content.dek); document.setAttr(dek, "data-blog-meta", "blog-dek"); }

    const existingKicker = kicker ? clean(document.text(kicker)) : "";
    const readTime = existingKicker.match(/\d+\s+min read/i)?.[0] || "";
    if (kicker) {
        const page = post._pageLabel || "";
        const pieces = [
            page ? `<span class="chip" data-blog-meta="page-number">${escapeHtml(page)}</span>` : "",
            `<span data-blog-meta="series">${escapeHtml(displaySeries(post.classification.series))}</span>`,
            readTime ? `<span>·</span><span>${escapeHtml(readTime)}</span>` : "",
            `<span>·</span><span data-blog-meta="date">${escapeHtml(formatDate(post.publication.date))}</span>`
        ].filter(Boolean).join("\n                ");
        document.setInnerHtml(kicker, pieces);
        document.setAttr(kicker, "data-blog-meta", "kicker");
    }

    const tags = marker(document, '[data-blog-meta="tags"]', "tags", article) || document.findAll(".post-tags", article)[0];
    if (tags) {
        const markup = (post.classification.tags || []).map((tag) => {
            const label = tagLabel(tag); const type = typeof tag === "string" ? "normal" : (tag.type || "normal");
            return `<span class="${type === "chip" ? "chip" : "tag"}">${escapeHtml(label || "")}</span>`;
        }).join(" ");
        document.setInnerHtml(tags, markup); document.setAttr(tags, "data-blog-meta", "tags");
    }
    const pageNo = marker(document, ".page-no", "page-number-label");
    if (pageNo && post._pageLabel) {
        document.setText(pageNo, post._pageLabel);
        document.setAttr(pageNo, "data-blog-meta", "page-number-label");
    }
    const nav = marker(document, ".post-nav", "navigation", article);
    if (nav) {
        const previous = post._previous ? posts.find((candidate) => candidate.id === post._previous) : null;
        const next = post._next ? posts.find((candidate) => candidate.id === post._next) : null;
        const links = [`<a href="../index.html">← back to the notebook</a>`];
        if (previous) links.push(navLink(previous.id, `previous: ${previous.content.title}`, posts));
        if (next) links.push(navLink(next.id, `next: ${next.content.title}`, posts));
        document.setInnerHtml(nav, links.filter(Boolean).join("\n                "));
        document.setAttr(nav, "data-blog-meta", "navigation");
    }
    return document.apply();
}

function listingIndex(posts) {
    return posts.map((post) => ({
        id: post.id,
        slug: post.slug,
        status: post.status,
        title: post.content.title,
        dek: post.content.dek || "",
        kicker: post.content.kicker || "",
        series: post.classification.series,
        tags: (post.classification.tags || []).map(tagLabel).filter(Boolean),
        date: post.publication.date,
        updatedAt: post.publication.updatedAt || post.publication.date,
        order: post.publication.order,
        pageNumber: post._pageNumber,
        pageLabel: post._pageLabel,
        categoryLabel: post._categoryLabel,
        categoryPrefix: post._categoryPrefix,
        excerpt: post.listing?.excerpt || post.content.dek || "",
        cover: post.listing?.cover || null,
        featured: Boolean(post.listing?.featured),
        url: (post.source?.file || `posts/${post.slug}.html`).replaceAll(path.sep, "/")
    }));
}

function metadataForWrite(post) {
    const copy = JSON.parse(JSON.stringify(post));
    for (const key of Object.keys(copy)) if (key.startsWith("_")) delete copy[key];
    copy.publication = {
        ...copy.publication,
        pageNumber: post._pageNumber,
        pageLabel: post._pageLabel
    };
    return copy;
}

function writeAtomic(file, content) {
    const temp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temp, content);
    try {
        fs.renameSync(temp, file);
    } catch (error) {
        // Windows cannot replace a file that another editor has open.
        // The temporary file still protects generation from interrupted writes;
        // fall back to copying its complete contents when replacement is locked.
        if (!['EPERM', 'EEXIST', 'EBUSY'].includes(error.code)) throw error;
        fs.copyFileSync(temp, file);
        fs.unlinkSync(temp);
    }
}

function publish() {
    if (!fs.existsSync(DATA_DIR)) throw new Error("data/posts does not exist; run migrate-metadata.js first");
    const records = loadMetadata();
    const errors = validateMetadata(records);
    if (errors.length) throw new Error(`Metadata validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    const posts = records.map(({ value }) => value).filter((post) => post.status === "published").sort(sortPosts);
    resolveMissingPublicationFields(posts);
    posts.sort(sortPosts);
    resolvePageNumbers(posts);
    resolveNavigation(posts);
    const htmlUpdates = posts.map((post) => ({ post, file: path.join(ROOT, post.source?.file || `posts/${post.slug}.html`), content: updateHtml(post, posts) }));
    const listing = listingIndex(posts);
    const search = generateSearchIndex({ write: false });
    if (search.length !== posts.length) throw new Error(`Search index would contain ${search.length} records for ${posts.length} published posts`);
    if (dryRun) {
        console.log(`Dry run: ${posts.length} article(s), ${htmlUpdates.length} HTML update(s), listing and search indexes would be generated.`);
        return;
    }
    for (const update of htmlUpdates) writeAtomic(update.file, update.content);
    for (const { file, value } of records) {
        if (value.status !== "published") continue;
        const publishedPost = posts.find((post) => post.id === value.id);
        if (publishedPost) writeAtomic(path.join(DATA_DIR, file), `${JSON.stringify(metadataForWrite(publishedPost), null, 2)}\n`);
    }
    fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
    writeAtomic(path.join(ROOT, "data", "posts-index.json"), `${JSON.stringify(listing, null, 2)}\n`);
    fs.mkdirSync(path.join(ROOT, "search"), { recursive: true });
    writeAtomic(path.join(ROOT, "search", "search-index.json"), `${JSON.stringify(generateSearchIndex({ write: false }), null, 2)}\n`);
    console.log(`Publishing completed.\nPublished articles: ${posts.length}\nHTML files updated: ${htmlUpdates.length}\nListing index generated: Yes\nSearch index generated: Yes\nNavigation links validated: Yes\nWarnings: 0\nErrors: 0`);
}

try { publish(); } catch (error) { console.error(`Publishing failed: ${error.message}`); process.exitCode = 1; }
