/* The Dev Notebook: shared interactions plus the generated blog discovery UI. */
(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const page = document.body.dataset.blogPage || "home";
    const state = { listing: [], searchIndex: null, series: "all", query: "", sort: "newest" };

    const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const normalise = (value) => String(value ?? "").toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
    const seriesName = (series) => ({ journal: "Life Journal", thoughts: "My Thoughts", postmortem: "Dev Learnings" }[series] || series);
    const shortDate = (value) => {
        const match = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
        return match ? `${match[2]}/${match[1]}` : "";
    };
    const volumeForDate = (value) => {
        const year = Number(String(value || "").slice(0, 4));
        return Number.isInteger(year) && year >= 2026 ? year - 2025 : 1;
    };
    const debounce = (fn, delay) => {
        let timer;
        return (...args) => { window.clearTimeout(timer); timer = window.setTimeout(() => fn(...args), delay); };
    };
    const loadIncludes = async () => {
        await Promise.all([...document.querySelectorAll("[data-include]")].map(async (target) => {
            try {
                const response = await fetch(target.dataset.include);
                if (!response.ok) throw new Error(`Could not load ${target.dataset.include}`);
                target.outerHTML = await response.text();
            } catch (error) { console.error(error); }
        }));
    };
    const loadJson = async (url) => {
        const response = await fetch(url, { cache: "no-cache" });
        if (!response.ok) throw new Error(`Could not load ${url}`);
        return response.json();
    };

    const cardMarkup = (post, result = null) => {
        const pageNumber = post.pageLabel || (post.pageNumber == null ? "" : `PAGE ${String(post.pageNumber).padStart(3, "0")}`);
        const cardDate = shortDate(post.date);
        const navy = post.series === "thoughts" ? " entry--navy" : "";
        const tags = (post.tags || []).slice(0, 2).join(" · ");
        const snippet = result?.snippet || post.excerpt || post.dek || "";
        return `<a class="entry${navy}" href="${escapeHtml(post.url)}" data-entry data-series="${escapeHtml(post.series)}" aria-label="${escapeHtml(post.title)}">
            <div class="entry-stage">
                <div class="entry-sheet">
                    <span class="sheet-no">${escapeHtml(pageNumber)}${cardDate ? ` · ${escapeHtml(cardDate)}` : ""}</span>
                    <h3 class="sheet-title">${result ? result.highlightedTitle : escapeHtml(post.title)}</h3>
                    <p class="sheet-meta">${escapeHtml(seriesName(post.series))}${tags ? ` · ${escapeHtml(tags)}` : ""}</p>
                    ${result ? `<p class="search-snippet">${result.highlightedSnippet}</p>` : ""}
                </div>
                <div class="entry-book">
                    <span class="book-label"><b>${escapeHtml(seriesName(post.series).toUpperCase())}</b>vol. ${volumeForDate(post.date)} · ${escapeHtml(String(post.date || "").slice(0, 4))}</span>
                    <svg class="book-doodle" viewBox="0 0 40 40" fill="none" stroke="#f4ecd8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 4 L24.5 15 L36 16 L27 24 L30 36 L20 29.5 L10 36 L13 24 L4 16 L15.5 15 Z" /></svg>
                </div>
                <span class="entry-hint">pull the page out →</span>
            </div>
        </a>`;
    };
    const queryTerms = () => normalise(state.query).split(" ").filter(Boolean);
    const highlight = (value, terms) => {
        let html = escapeHtml(value);
        for (const term of [...terms].sort((a, b) => b.length - a.length)) {
            const safe = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            html = html.replace(new RegExp(`(${safe})`, "gi"), "<mark>$1</mark>");
        }
        return html;
    };
    const makeSnippet = (record, terms) => {
        const text = String(record.text || record.dek || record.excerpt || "").replace(/\s+/g, " ").trim();
        if (!text) return "";
        const haystack = normalise(text);
        const positions = terms.map((term) => haystack.indexOf(term)).filter((index) => index >= 0);
        const start = positions.length ? Math.max(0, Math.min(...positions) - 70) : 0;
        const end = Math.min(text.length, start + 190);
        return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
    };
    const searchResults = () => {
        const terms = queryTerms();
        if (!terms.length || !state.searchIndex) return null;
        return state.searchIndex.map((record) => {
            if (state.series !== "all" && record.series !== state.series) return null;
            const fields = [record.title, record.webpageTitle, record.dek, record.excerpt, record.series, ...(record.tags || []), record.text].map(normalise);
            if (!terms.every((term) => fields.some((field) => field.includes(term)))) return null;
            const title = normalise(record.title); const labels = normalise(`${record.series} ${(record.tags || []).join(" ")}`);
            const description = normalise(`${record.dek} ${record.excerpt}`); const body = normalise(record.text);
            let score = 0;
            for (const term of terms) {
                if (title === term) score += 100;
                if (title.includes(term)) score += 40;
                if (labels.includes(term)) score += 28;
                if (description.includes(term)) score += 18;
                if (body.includes(term)) score += 8;
            }
            const snippet = makeSnippet(record, terms);
            return { ...record, score, snippet, highlightedTitle: highlight(record.title, terms), highlightedSnippet: highlight(snippet, terms) };
        }).filter(Boolean).sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
    };
    const sortListing = (posts) => [...posts].sort((a, b) => {
        if (state.sort === "oldest") return String(a.date).localeCompare(String(b.date)) || Number(a.order || 0) - Number(b.order || 0);
        if (state.sort === "newest") return String(b.date).localeCompare(String(a.date)) || Number(b.order || 0) - Number(a.order || 0);
        return Number(a.order || 0) - Number(b.order || 0);
    });
    const render = () => {
        const grid = document.querySelector("[data-blog-grid]");
        if (!grid) return;
        const terms = queryTerms(); const ranked = terms.length ? searchResults() : null;
        let posts;
        if (ranked) {
            const byId = new Map(state.listing.map((post) => [post.id, post]));
            posts = ranked.map((result) => ({ post: byId.get(result.id) || result, result })).filter((item) => item.post);
        } else {
            posts = sortListing(state.listing.filter((post) => state.series === "all" || post.series === state.series)).map((post) => ({ post, result: null }));
            if (page === "home") posts = posts.slice(0, 6);
        }
        grid.innerHTML = posts.length ? posts.map(({ post, result }) => cardMarkup(post, result)).join("") : `<p class="blog-status">No pages matched that search. Try another phrase.</p>`;
        const count = document.querySelector("[data-result-count]");
        if (count) count.textContent = `${posts.length} ${posts.length === 1 ? "entry" : "entries"}${terms.length ? " found" : ""}`;
        const clear = document.querySelector("[data-clear-search]");
        if (clear) clear.hidden = !state.query;
    };
    const ensureSearchIndex = async () => { if (!state.searchIndex) state.searchIndex = await loadJson("search/search-index.json"); return state.searchIndex; };
    const initialiseBlogDiscovery = async () => {
        const grid = document.querySelector("[data-blog-grid]");
        if (!grid) return;
        try { state.listing = await loadJson("data/posts-index.json"); render(); }
        catch (error) { grid.innerHTML = `<p class="blog-status">The notebook index could not be loaded right now.</p>`; console.error(error); return; }
        const search = document.querySelector("[data-blog-search]");
        search?.addEventListener("input", debounce(async () => {
            state.query = search.value;
            if (state.query.trim()) { try { await ensureSearchIndex(); } catch (error) { console.error(error); } }
            render();
        }, 160));
        document.querySelector("[data-clear-search]")?.addEventListener("click", () => {
            if (search) search.value = "";
            state.query = "";
            if (page === "home") {
                state.series = "all";
                document.querySelectorAll("[data-series-tab]").forEach((item) => item.classList.toggle("is-active", item.dataset.seriesTab === "all"));
            }
            render();
            search?.focus();
        });
        document.querySelector("[data-blog-sort]")?.addEventListener("change", (event) => { state.sort = event.target.value; render(); });
        document.querySelectorAll("[data-series-tab]").forEach((tab) => tab.addEventListener("click", () => {
            state.series = tab.dataset.seriesTab;
            document.querySelectorAll("[data-series-tab]").forEach((item) => item.classList.toggle("is-active", item === tab));
            render();
        }));
    };

    const initialiseShared = () => {
        const toggle = document.querySelector("[data-theme-toggle]");
        const label = () => { if (toggle) toggle.textContent = root.getAttribute("data-theme") === "dark" ? "☀ day desk" : "☾ night desk"; };
        label();
        toggle?.addEventListener("click", () => {
            const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
            root.setAttribute("data-theme", next); try { localStorage.setItem("notebook-theme", next); } catch (error) { /* optional */ } label();
        });
        document.addEventListener("click", (event) => {
            const card = event.target.closest("a[data-entry]");
            if (!card || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0 || reduced) return;
            event.preventDefault(); card.classList.add("is-opening"); document.body.classList.add("is-leaving"); window.setTimeout(() => { window.location.href = card.href; }, 950);
        });
        document.querySelectorAll("a[data-origami]").forEach((link) => link.addEventListener("click", (event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0 || reduced) return;
            event.preventDefault(); if (link.classList.contains("is-unfolded") && link.dataset.going) return;
            link.classList.add("is-unfolded"); link.dataset.going = "1"; window.setTimeout(() => { window.location.href = link.href; }, 1050);
        }));
        window.addEventListener("pageshow", () => {
            document.body.classList.remove("is-leaving"); document.querySelectorAll(".is-opening").forEach((el) => el.classList.remove("is-opening"));
            document.querySelectorAll(".is-unfolded").forEach((el) => { el.classList.remove("is-unfolded"); delete el.dataset.going; });
        });
        const bar = document.querySelector(".pencil-bar");
        if (bar) {
            const update = () => { const height = document.documentElement; const max = height.scrollHeight - height.clientHeight; bar.style.width = `${max > 0 ? Math.min(100, Math.max(0, (height.scrollTop / max) * 100)) : 0}%`; };
            window.addEventListener("scroll", update, { passive: true }); window.addEventListener("resize", update); update();
        }
    };
    loadIncludes().then(() => { initialiseShared(); initialiseBlogDiscovery(); });
})();
