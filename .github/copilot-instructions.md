instructions

# Project: CSES Tampermonkey Script

Goal: Userscript that adds a date picker to CSES problem list and hides solved check marks (class `full`) for problems whose last submission is before the chosen date; also augments each section heading with overall and date-filtered progress stats (total / solved / wrong / unattended) plus an aggregate "General" total. Fetch last submission time from `https://cses.fi/problemset/submit/<problemId>/` and parse the first `YYYY-MM-DD HH:MM:SS` timestamp (assumed latest). Wrong (attempted but unsolved) detection uses the presence of `<span class="task-score icon zero"></span>` or cached metadata indicating any submission attempts without a solve.

Key points:
1. Scope: Runs on all `https://cses.fi/problemset/*` pages; section stats only on the main list page, filtering also on task page mini lists.
2. UI Panel (fixed top-left, auto adaptive dark/light): date `<input>` (defaults to today & persisted), Clear Cache button, status line (progress + filtered summary counts).
3. Solved hiding: For each original solved icon (`span.task-score.icon.full`), fetch (if not cached) the submission page and parse first timestamp; if strictly before selected date's midnight, remove `full` class (icon visually disappears). Moving date earlier re-adds class from stored original state.
4. Stats augmentation: Each section heading gains badges: left = overall `total/solved/wrong/unattended`, right = date-filtered counts (where historic solves hidden by filter are treated as unattended). A synthetic "General" heading aggregates all sections.
5. Wrong detection: Immediate if `span.task-score.icon.zero` present; otherwise inferred via cached metadata noting an attempted (non-solved) submission.
6. Caching: `localStorage` entries `cses:lastSubmission:<id>` store ISO timestamp or sentinel `NONE` (meaning no submissions). Version key `cses:lastSubmission:__version` enables invalidation. Date input value persisted separately.
7. Concurrency: Submission fetches queued with concurrency=3. Section stats reuse cached metadata; only missing data triggers fetch.
8. User interactions: Alt+Click a solved icon to wipe just that problem's cache + refetch. Clear Cache button purges all timestamp metadata (version entry retained/recreated).
9. Tooltips: Badges have explanatory titles; solved icons (when retained) may have title including last submission date.

Non-goals / avoid:
- Do not modify other page elements.
- No external dependencies.
- No GM_* APIs (keep `@grant none`).

Extensibility suggestions:
- Gray out instead of hide older solves (configurable mode).
- Separate explicit category for "historic solved (hidden)" in filtered stats.
- Smarter selection of latest timestamp (e.g., parse table rows to ensure maximum date).
- Batch API usage if CSES publishes an endpoint.
- Settings/legend popup to toggle stats or color scheme.

Testing hints:
- Mock fetch with static HTML to validate regex timestamp extraction.
- Verify: No date (or invalid date) => skip filtering (all original solved icons visible).
- Change cutoff earlier => previously hidden solved icons reappear.
- Alt+Click on an icon triggers single refetch & decision log.
- Section badges update after filter application and as fetches resolve.

Security / performance:
- Minimal DOM writes (class toggles & small badge spans).
- Concurrency-limited network usage; safe for polite scraping.
- Cached sentinel `NONE` avoids repeated fetch for untouched problems.

Style: Keep script self-contained; concise JSDoc on core functions; avoid dependencies & GM_* grants.

Notes for contributors:
- Maintain backward-compatible cache key semantics; bump version only when format changes.
- Keep regex flexible but anchored to standard timestamp pattern.
- Prefer incremental DOM updates (avoid full re-render of sections).
