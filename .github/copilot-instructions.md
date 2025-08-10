instructions

# Project: CSES Tampermonkey Script

Goal: Userscript that adds a date picker to CSES problem list and hides solved check marks (class `full`) for problems whose last submission is before the chosen date. Fetch last submission time from `https://cses.fi/problemset/submit/<problemId>/` and parse first `YYYY-MM-DD HH:MM:SS` timestamp.

Key points:
1. Runs only on `https://cses.fi/problemset/list` pages.
2. UI: Fixed small panel top-left containing a date `<input>` (defaults to today, persists in localStorage) + Clear Cache button + status line.
3. Logic: For each solved icon (`span.task-score.icon.full`):
	- Derive problem id from the task link in same table row (`/problemset/task/<id>`)
	- Cache latest submission timestamp in `localStorage` under key prefix `cses:lastSubmission:<id>` (ISO string)
	- If timestamp < selected date midnight (strictly earlier), remove `full` class to hide solved check.
4. Concurrency: Limit simultaneous fetches (simple queue, concurrency ~3) to be polite.
5. Cache invalidation: Version key `cses:lastSubmission:__version`.
6. Alt+Click a solved icon to clear its cache entry and reprocess.
7. Clear Cache button purges all cached submission timestamps.

Non-goals / avoid:
- Do not modify other page elements.
- No external dependencies.
- No GM_* APIs (keep `@grant none`).

Extensibility suggestions:
- Add option to gray out (instead of hide) older solves.
- Provide tooltip with submission date.
- Batch fetch optimization if CSES exposes an API (currently not assumed).

Testing hints:
- Mock fetch in a local HTML copy.
- Verify behavior when no date selected (script should skip filtering).
- Ensure icons revert when date is moved earlier.

Security / performance:
- Minimal DOM writes; only toggles class and title.
- Rate-limited requests.

Style: Keep script self-contained; annotate core functions with concise JSDoc.
