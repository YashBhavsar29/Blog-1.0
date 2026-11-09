#!/usr/bin/env node
/* One-time HTML -> JSON migration. Existing JSON files are never overwritten
 * unless --overwrite is supplied. */
const fs = require("node:fs");
const path = require("node:path");
const { createDocument } = require("./lib/html-document");

const ROOT = path.resolve(__dirname, "..");
const POSTS_DIR = path.join(ROOT, "posts");
const DATA_DIR = path.join(ROOT, "data", "posts");
const REPORT_FILE = path.join(ROOT, "data", "migration-report.json");
const overwrite = process.argv.includes("--overwrite");

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const fileSlug = (file) => path.basename(file, ".html");
const textOf = (document, node) => clean(document.text(node));
const parseNumber = (value) => {
    const match = String(value || "").match(/(?:page|blog)\s*#?\s*(\d+)/i);
    return match ? Number(match[1]) : null;
};
const pagePrefixFromLabel = (label) => {
    const words = String(label || "Category").replace(/&/g, " and ").match(/[A-Za-z0-9]+/g) || ["Category"];
    return `${words.map((word) => word[0].toUpperCase()).join(".")}.`;
};
const articlePathFor = (file, href) => path.resolve(POSTS_DIR, path.dirname(file), href);

const tagRecords = (document, post) => document.findAll(".post-kicker", post)[0]
    ? document.findAll(".post-kicker", post)[0].children
        .filter((node) => node.type === "element")
        .map((node) => textOf(document, node))
        .filter((value) => value && !/page\s*\d+/i.test(value) && value !== "·" && !/min read|part \d|\b\d{4}\b/i.test(value))
    : [];

const files = fs.readdirSync(POSTS_DIR).filter((file) => file.endsWith(".html")).sort();
const usedIds = new Set();
const posts = [];
const warnings = [];

for (const file of files) {
    const slug = fileSlug(file);
    const source = fs.readFileSync(path.join(POSTS_DIR, file), "utf8");
    const document = createDocument(source);
    const post = document.findAll("article.post")[0] || document.findAll("article")[0];
    const titleNode = document.findAll("title")[0];
    const descriptionNode = document.findAll('meta[name="description"]')[0];
    const h1 = document.findAll("h1", post)[0];
    const dek = document.findAll("p.dek", post)[0];
    const kicker = document.findAll(".post-kicker", post)[0];
    const pageNumber = parseNumber(kicker ? textOf(document, kicker) : "") || parseNumber(document.findAll(".page-no")[0] ? textOf(document, document.findAll(".page-no")[0]) : "");
    const seriesValues = tagRecords(document, post);
    const seriesText = seriesValues[0] || "journal";
    const series = /thought|mindset/i.test(seriesText) ? "thoughts" : /dev|postmortem/i.test(seriesText) ? "postmortem" : "journal";
    const title = textOf(document, h1) || slug;
    const metaDescription = descriptionNode ? document.attr(descriptionNode, "content") : "";
    const month = (kicker ? textOf(document, kicker) : "").match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
    const date = month ? `${month[2]}-${String(new Date(`${month[1]} 1, ${month[2]}`).getMonth() + 1).padStart(2, "0")}-01` : "2026-10-01";
    const outputPath = path.join(DATA_DIR, `${slug}.json`);
    for (const link of document.findAll("a", post)) {
        const href = document.attr(link, "href");
        if (!href || href.startsWith("#") || /^(?:[a-z]+:)?\/\//i.test(href) || !href.toLowerCase().endsWith(".html")) continue;
        if (!fs.existsSync(articlePathFor(file, href.split(/[?#]/)[0]))) {
            warnings.push({ file, field: "links", message: `Broken article link: ${href}` });
        }
    }
    if (usedIds.has(slug)) warnings.push({ file, field: "id", message: "Duplicate identifier" });
    usedIds.add(slug);
    const metadata = {
        id: slug,
        slug,
        status: "published",
        seo: {
            webpageTitle: textOf(document, titleNode) || `${title} — The Dev Notebook`,
            metaDescription: metaDescription || ""
        },
        content: {
            title,
            dek: textOf(document, dek),
            kicker: seriesText || "A JOURNAL ENTRY"
        },
        classification: {
            series,
            pagePrefix: pagePrefixFromLabel(seriesText),
            tags: seriesValues.slice(1).map((label) => ({ label, type: "normal" }))
        },
        publication: {
            date,
            updatedAt: date,
            order: pageNumber || files.indexOf(file) + 1,
            pageNumber: pageNumber || null
        },
        listing: {
            excerpt: metaDescription || textOf(document, dek),
            cover: null,
            featured: false
        },
        navigation: {
            previousPost: null,
            nextPost: null
        },
        source: {
            file: `posts/${file}`,
            migratedFrom: file
        }
    };
    if (!metadata.seo.metaDescription) warnings.push({ file, field: "seo.metaDescription", message: "Missing meta description" });
    if (!metadata.content.dek) warnings.push({ file, field: "content.dek", message: "Missing visible dek" });
    if (!metadata.publication.pageNumber) warnings.push({ file, field: "publication.pageNumber", message: "Missing page number" });
    posts.push(metadata);
    if (!fs.existsSync(outputPath) || overwrite) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);
    } else {
        warnings.push({ file, field: "json", message: "Existing JSON preserved; use --overwrite only for an intentional migration rerun" });
    }
}

const report = {
    generatedAt: new Date().toISOString(),
    overwrite,
    discovered: files.length,
    migrated: posts.filter((post) => fs.existsSync(path.join(DATA_DIR, `${post.slug}.json`))).length,
    articles: posts.map((post) => ({ id: post.id, file: post.source.file })),
    warnings,
    errors: []
};
fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Migration completed. Articles discovered: ${files.length}. Warnings: ${warnings.length}. Report: ${path.relative(ROOT, REPORT_FILE)}`);
