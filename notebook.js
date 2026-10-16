/* The Dev Notebook: tiny bits of behaviour (no dependencies) */
(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---- day / night desk ---- */
    const toggle = document.querySelector("[data-theme-toggle]");
    const label = () => {
        if (toggle) {
            toggle.textContent =
                root.getAttribute("data-theme") === "dark" ? "☀ day desk" : "☾ night desk";
        }
    };
    label();
    if (toggle) {
        toggle.addEventListener("click", () => {
            const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
            root.setAttribute("data-theme", next);
            try {
                localStorage.setItem("notebook-theme", next);
            } catch (e) {}
            label();
        });
    }

    /* ---- series tabs: dim the notebooks that are not in the series ---- */
    const tabs = document.querySelectorAll("[data-series-tab]");
    const entries = document.querySelectorAll("[data-series]");
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const wanted = tab.dataset.seriesTab;
            tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
            entries.forEach((entry) => {
                const match = wanted === "all" || entry.dataset.series === wanted;
                entry.classList.toggle("is-dim", !match);
            });
        });
    });

    /* ---- click a notebook: the page slides all the way out, then we go there ---- */
    document.querySelectorAll("a[data-entry]").forEach((card) => {
        card.addEventListener("click", (e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            if (reduced) return; // plain navigation
            e.preventDefault();
            card.classList.add("is-opening");
            document.body.classList.add("is-leaving");
            setTimeout(() => {
                window.location.href = card.href;
            }, 950);
        });
    });

    /* ---- origami CTAs: unfold fully on click, then redirect ---- */
    document.querySelectorAll("a[data-origami]").forEach((link) => {
        link.addEventListener("click", (e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            if (reduced) return; // plain navigation
            e.preventDefault();
            if (link.classList.contains("is-unfolded") && link.dataset.going) return;
            link.classList.add("is-unfolded");
            link.dataset.going = "1";
            // wait for the staggered flaps (0.8s + 0.21s delay) to finish
            setTimeout(() => {
                window.location.href = link.href;
            }, 1050);
        });
    });

    // coming back with the Back button: reset the animation state
    window.addEventListener("pageshow", () => {
        document.body.classList.remove("is-leaving");
        document.querySelectorAll(".is-opening").forEach((el) => el.classList.remove("is-opening"));
        document.querySelectorAll(".is-unfolded").forEach((el) => {
            el.classList.remove("is-unfolded");
            delete el.dataset.going;
        });
    });

    /* ---- reading progress: the pencil line ---- */
    const bar = document.querySelector(".pencil-bar");
    if (bar) {
        const update = () => {
            const h = document.documentElement;
            const max = h.scrollHeight - h.clientHeight;
            const pct = max > 0 ? Math.min(100, Math.max(0, (h.scrollTop / max) * 100)) : 0;
            bar.style.width = pct + "%";
        };
        window.addEventListener("scroll", update, { passive: true });
        window.addEventListener("resize", update);
        update();
    }
})();