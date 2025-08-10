This repository contains a script written in Javascript with type hints which can be used with Tampermonkey extension (https://www.tampermonkey.net/) in the browser. It is supposed to be used on the CSES (https://cses.fi/problemset/list/) website.

It does:
1. Makes available a date input button (preferably using calendar selector) in the top left corner.
2. On the CSES problem list page (https://cses.fi/problemset/list/) if the problem has last submission before the selected date, it does not shows the check mark (<span class="task-score icon full"></span>) which indicates that the problem has been solved. It does that by removing the class `full` (<span class="task-score icon "></span>).

A CSES problems's description can be found at the url https://cses.fi/problemset/task/<problem id>/ 
Submissions to a problem can be found at the url https://cses.fi/problemset/submit/<problem id>/

## Installation
1. Install Tampermonkey (or another compatible userscript manager) in your browser.
2. Open the `cses-filter.user.js` file in this repository (raw view) and create a new userscript in Tampermonkey by pasting the contents.
3. Save the script. It will automatically run on `https://cses.fi/problemset/list`.

## Usage
1. Visit the CSES problem list page.
2. A small panel appears in the top-left containing a date picker, a Clear Cache button, and a status line.
3. Select the cutoff date. Any solved check mark whose latest submission is strictly before midnight of that date is hidden.
4. Move the date earlier to restore hidden check marks (they reappear because they are re-evaluated).
5. Alt+Click on an individual solved icon to clear its cached submission timestamp and refetch.

## Caching
Submission timestamps are cached in `localStorage` under keys `cses:lastSubmission:<id>` (ISO string). A version key `cses:lastSubmission:__version` allows invalidation when parsing logic changes.

Use the Clear Cache button to purge all cached timestamps.

## Concurrency and Performance
Requests for submission pages are limited to 3 concurrent fetches to avoid overloading the CSES servers. Status updates show progress as icons are processed.

## Future Ideas
- Option to gray out (instead of hide) older solves.
- Tooltip enhancements (currently shows last submission date when available).
- Potential batch API usage if CSES ever exposes an endpoint.

## Disclaimer
This script is a convenience tool. Use responsibly and avoid unnecessary repeated cache clears that cause extra network load.