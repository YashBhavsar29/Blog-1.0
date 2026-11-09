#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "posts");
const POSTS_DIR = path.join(ROOT, "posts");
const REQUIRED = ["id", "slug", "status", "seo", "content", "classification", "publication", "listing", "navigation"];
const errors = [];
const warnings = [];
const seenIds = new Set();
const seenSlugs = new Set();
const validDate = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match || Number(match[1]) < 2026) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
};
const records = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter((file) => file.endsWith(".json")).map((file) => {
    try { return { file, value: JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")) }; }
    catch (error) { errors.push(`${file}: invalid JSON (${error.message})`); return null; }
}).filter(Boolean) : [];

for (const { file, value } of records) {
    for (const key of REQUIRED) if (!(key in value)) errors.push(`${file}: missing ${key}`);
    if (seenIds.has(value.id)) errors.push(`${file}: duplicate id ${value.id}`); else seenIds.add(value.id);
    if (seenSlugs.has(value.slug)) errors.push(`${file}: duplicate slug ${value.slug}`); else seenSlugs.add(value.slug);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug || "")) errors.push(`${file}: invalid slug`);
    if (!/^(draft|published|archived)$/.test(value.status || "")) errors.push(`${file}: invalid status`);
    if (!validDate(value.publication?.date)) errors.push(`${file}: publication.date must be a valid YYYY-MM-DD date in 2026 or later`);
    if (value.publication?.updatedAt && !validDate(value.publication.updatedAt)) errors.push(`${file}: publication.updatedAt must be a valid YYYY-MM-DD date in 2026 or later`);
    if (value.publication?.pageNumber !== undefined && (!Number.isInteger(value.publication.pageNumber) || value.publication.pageNumber < 1)) errors.push(`${file}: invalid publication.pageNumber`);
    const articleFile = value.source?.file || `posts/${value.slug}.html`;
    const normalizedArticle = path.normalize(articleFile);
    if (path.isAbsolute(articleFile) || normalizedArticle.startsWith(`..${path.sep}`) || !normalizedArticle.startsWith(`posts${path.sep}`)) errors.push(`${file}: article path must stay inside posts/`);
    if (value.status === "published" && !fs.existsSync(path.join(ROOT, articleFile))) errors.push(`${file}: missing article HTML`);
    if (value.classification?.pagePrefix && !/^[A-Z0-9](?:\.[A-Z0-9])+\.?$/.test(value.classification.pagePrefix)) errors.push(`${file}: invalid classification.pagePrefix`);
    if (!Array.isArray(value.classification?.tags)) warnings.push(`${file}: classification.tags is not an array`);
}

const published = records.filter(({ value }) => value.status === "published");
const ids = new Set(published.map(({ value }) => value.id));
for (const { file, value } of published) {
    for (const key of ["previousPost", "nextPost"]) {
        const ref = value.navigation?.[key];
        if (ref && !ids.has(ref)) errors.push(`${file}: ${key} points to unknown article ${ref}`);
    }
}
if (errors.length) {
    console.error(`Validation failed with ${errors.length} error(s).`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
} else {
    console.log(`Metadata valid: ${records.length} file(s), ${published.length} published. Warnings: ${warnings.length}.`);
}
