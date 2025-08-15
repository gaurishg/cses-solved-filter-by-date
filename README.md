This repository contains a userscript (TypeScript source compiled to plain JavaScript; no external deps, no GM_* grants) for Tampermonkey (https://www.tampermonkey.net/) that enhances the CSES Problemset pages (list + individual task pages) (https://cses.fi/problemset/...).

Core purpose:
Provide a date-based view of progress: hide solved check marks for problems whose last submission is before a chosen cutoff date so you can focus on (re)solving more recent material.

Additionally it augments each section heading with compact progress statistics (overall and date‑filtered) and distinguishes solved, wrong-attempted, and unattended problems.

Data sources:
- Problem statement: `https://cses.fi/problemset/task/<id>/`
- Submission list (scraped for timestamps): `https://cses.fi/problemset/submit/<id>/`

The script parses the first `YYYY-MM-DD HH:MM:SS` timestamp it encounters on the submission page (typically the latest submission) and caches it.

## Installation
1. Install Tampermonkey (or another compatible userscript manager) in your browser.
2. Open the `cses-filter.user.js` file in this repository (raw view) and create a new userscript in Tampermonkey by pasting the contents.
3. Save the script. It will automatically run on `https://cses.fi/problemset/*`.

## Usage
1. Visit the CSES problem list page.
2. A compact fixed panel (auto dark/light theme) appears top-left with:
	- Date picker (defaults to today, persisted in `localStorage`)
	- Clear Cache button
	- Status line with progress (fetching, filtered counts)
3. Pick a cutoff date. Any solved icon (`<span class="task-score icon full"></span>`) whose last submission time is strictly earlier than the start (midnight) of that date is hidden (its `full` class is removed).
4. Changing the date re-evaluates all problems; moving the date earlier reveals previously hidden solves.
5. Alt+Click a solved icon to invalidate just that problem's cache and refetch its latest submission time.
6. Section Headings: Each heading shows two bracketed badge groups:
	- Left (Overall): `total / solved / wrong / unattended`
	- Right (Filtered): Same metrics after applying the current date filter (older solved problems treated as if unsolved for the filtered view). An aggregate "General" heading gives totals across all sections.
	- Per-section toggle: Every section (except the first "General") has a visibility toggle (👁/🙈). Clicking hides its problem list and removes its counts from the "General" totals; clicking again includes it back. Your choice is persisted in `localStorage` across reloads.

## Development (TypeScript)

The source lives in `src/cses-filter.user.ts` and compiles to `cses-filter.user.js` in the repo root.

Build:

```bash
npm install
npx tsc
```

Watch mode:

```bash
npm run watch
```

### Badge Color Legend
Colors (may depend on your theme, implemented via inline styles):
- Solved: green
- Wrong (at least one wrong submission, not yet solved): orange
- Unattended: gray

Tooltips on badges clarify whether you are looking at overall or filtered stats. The control panel adapts automatically when CSES dark mode is toggled.

## Caching
Per-problem metadata is stored in `localStorage`:
- Key: `cses:lastSubmission:<id>` => ISO timestamp string of most recent submission, or the sentinel `NONE` (meaning we looked and found no submissions yet).
- Version key: `cses:lastSubmission:__version` for transparent invalidation if parsing logic changes.

The date picker value is also persisted so your context remains between visits.

Clear Cache button removes all `cses:lastSubmission:*` entries (except internal version management) prompting refetch on next evaluation.

## Concurrency and Performance
Network fetches for submission pages are processed through a tiny queue limited to 3 concurrent requests for courtesy to CSES. Section stat resolution that needs to discover whether a problem was attempted also reuses cached metadata to avoid duplicate fetches.

DOM updates are minimized: the script only toggles the `full` class, updates titles/tooltips, and injects small badge spans into section headers.

## Future Ideas
- Option to gray out instead of fully hiding historic solves.
- Separate category for "hidden historic solved" in filtered stats (currently they move into the filtered unattended count for simplicity).
- Smarter timestamp parsing (ensure absolute latest submission if multiple matches appear).
- Batch API usage if CSES offers an endpoint (would reduce request volume).
- Optional legend / settings toggle panel (show/hide stats, choose styling).

## Disclaimer
This script is a convenience tool. Use responsibly—avoid unnecessary repeated cache clears that cause extra network load. Not affiliated with CSES.

## License
Released under the MIT License (see `LICENSE`).