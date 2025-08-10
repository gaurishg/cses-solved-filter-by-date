// ==UserScript==
// @name         CSES Solved Filter by Date
// @namespace    https://cses.fi/
// @version      0.1.0
// @description  Hide solved check marks for problems whose last submission is before a selected date.
// @author       (you)
// @match        https://cses.fi/problemset/list
// @match        https://cses.fi/problemset/list/
// @match        https://cses.fi/problemset/list/*
// @icon         https://cses.fi/favicon.ico
// @run-at       document-end
// @grant        none
// ==/UserScript==

/**
 * CSES Solved Filter by Date
 *
 * Adds a date picker to the top-left corner of the CSES problem list. For each solved problem
 * (identified by a span with class "task-score icon full"), the script fetches (or loads from cache)
 * the timestamp of the most recent submission. If that timestamp is strictly before the selected
 * date (interpreted at local midnight), the check mark is hidden by removing the 'full' class.
 *
 * Caching: Last submission timestamps are cached in localStorage under key pattern
 *   'cses:lastSubmission:<problemId>' as an ISO string. A small version key is used for future
 *   invalidation if the parsing logic changes.
 *
 * Network usage: Fetches the submission page at /problemset/submit/<id>/ for each solved problem
 * lacking a cached timestamp. Requests are rate-limited (simple concurrency queue) to avoid
 * overwhelming the site. You can click the refresh button to clear cache for a specific problem
 * (Alt+Click on a solved icon) or clear all cached timestamps.
 */
(function () {
  'use strict';

  /** Configuration constants */
  const CACHE_PREFIX = 'cses:lastSubmission:';
  const CACHE_VERSION_KEY = 'cses:lastSubmission:__version';
  const CACHE_VERSION = 'v1';
  const THRESHOLD_DATE_KEY = 'cses:thresholdDate';

  // Ensure cache version
  if (localStorage.getItem(CACHE_VERSION_KEY) !== CACHE_VERSION) {
    // Purge old keys
    Object.keys(localStorage).forEach(k => { if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k); });
    localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
  }

  /** Utility: parse first timestamp found in submission page HTML.
   * Format on CSES appears like '2024-05-17 19:23:01'. We'll regex search.
   * Returns Date or null.
   */
  function extractLatestSubmissionDate(htmlText) {
    const re = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/;
    const match = re.exec(htmlText);
    if (!match) return null;
    // Treat as local time (CSES timestamps are in EET/EEST usually). We'll parse as local.
    // Construct ISO string by assuming local timezone.
    const dateTimeStr = match[1] + 'T' + match[2];
    const date = new Date(dateTimeStr);
    if (isNaN(date.getTime())) return null;
    return date;
  }

  /** Format Date to ISO date (yyyy-mm-dd) */
  function toISODate(d) {
    return d.toISOString().split('T')[0];
  }

  /** Load or create container UI */
  function createUI() {
    let panel = document.getElementById('cses-filter-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'cses-filter-panel';
    panel.innerHTML = `
      <label style="display:flex;align-items:center;gap:4px;font:12px system-ui;"> 
        <span style="font-weight:600;">Solved after:</span>
        <input type="date" id="cses-threshold-date" style="padding:2px;font-size:12px;" />
        <button type="button" id="cses-clear-cache" title="Clear cached submission timestamps" style="font-size:11px;padding:2px 6px;">Clear Cache</button>
      </label>
      <div id="cses-filter-status" style="margin-top:4px;font:11px system-ui;color:#444;max-width:260px;line-height:1.3;"></div>
    `;
    Object.assign(panel.style, {
      position: 'fixed',
      top: '6px',
      left: '6px',
      background: 'rgba(255,255,255,0.9)',
      border: '1px solid #ccc',
      padding: '6px 8px',
      borderRadius: '6px',
      zIndex: 10000,
      boxShadow: '0 2px 5px rgba(0,0,0,0.15)'
    });
    document.body.appendChild(panel);
    return panel;
  }

  /** Get selected threshold date (Date at local midnight) */
  function getThresholdDate() {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById('cses-threshold-date'));
    if (!input || !input.value) return null;
    const d = new Date(input.value + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }

  function setStatus(msg) {
    const el = document.getElementById('cses-filter-status');
    if (el) el.textContent = msg;
  }

  /** Fetch last submission date for a problem id (string). Respects cache. */
  async function getLastSubmissionDate(problemId) {
    const cacheKey = CACHE_PREFIX + problemId;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const d = new Date(cached);
      if (!isNaN(d.getTime())) return d;
    }
    try {
      const url = `https://cses.fi/problemset/submit/${problemId}/`;
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      const date = extractLatestSubmissionDate(text);
      if (date) {
        localStorage.setItem(cacheKey, date.toISOString());
        return date;
      }
      // If we cannot parse, set a sentinel far past to avoid hiding incorrectly.
      const sentinel = new Date();
      localStorage.setItem(cacheKey, sentinel.toISOString());
      return sentinel;
    } catch (e) {
      console.error('Failed to fetch submissions for', problemId, e);
      return null;
    }
  }

  /** Queue with limited concurrency */
  class TaskQueue {
    constructor(concurrency = 3) { this.c = concurrency; this.running = 0; this.q = []; }
    push(task) { this.q.push(task); this.run(); }
    run() {
      while (this.running < this.c && this.q.length) {
        const t = this.q.shift();
        this.running++;
        Promise.resolve().then(t).catch(()=>{}).finally(()=>{ this.running--; this.run(); });
      }
    }
  }

  /** Main logic */
  async function init() {
    // Only run on problem list page path
    if (!/\/problemset\/list\/?/.test(location.pathname)) return;
    const panel = createUI();
    const dateInput = /** @type {HTMLInputElement} */ (panel.querySelector('#cses-threshold-date'));
    // Load saved threshold date or default to today
    const saved = localStorage.getItem(THRESHOLD_DATE_KEY);
    const today = toISODate(new Date());
    dateInput.value = saved || today;

    dateInput.addEventListener('change', () => {
      localStorage.setItem(THRESHOLD_DATE_KEY, dateInput.value);
      applyFilter();
    });

    panel.querySelector('#cses-clear-cache').addEventListener('click', () => {
      if (!confirm('Clear cached submission timestamps?')) return;
      let cleared = 0;
      Object.keys(localStorage).forEach(k => { if (k.startsWith(CACHE_PREFIX)) { localStorage.removeItem(k); cleared++; } });
      setStatus(`Cleared ${cleared} cached entries.`);
      applyFilter(true); // force refetch
    });

    // Alt+Click on a solved icon to refresh just that problem
    document.addEventListener('click', (e) => {
      if (!e.altKey) return;
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.classList.contains('task-score')) {
        const problemId = target.getAttribute('data-problem-id');
        if (problemId) {
          localStorage.removeItem(CACHE_PREFIX + problemId);
          setStatus(`Cleared cache for problem ${problemId}`);
          applyFilter(true);
        }
      }
    });

    applyFilter();
  }

  /** Collect solved icons (including ones we previously hid).
   * We mark initially solved icons with data-original-solved="1" so they stay in subsequent passes
   * even after removing the 'full' class.
   */
  function collectSolved() {
    const nodes = Array.from(document.querySelectorAll('span.task-score.icon'));
    // Mark any currently solved icons as originally solved.
    nodes.forEach(n => { if (n.classList.contains('full')) n.dataset.originalSolved = '1'; });
    return nodes.filter(n => n.dataset.originalSolved === '1');
  }

  /** Extract problem id from surrounding list item (li.task) */
  function extractProblemId(el) {
    const li = el.closest('li.task');
    if (!li) return null;
    const link = li.querySelector('a[href*="/problemset/task/"]');
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const m = /\/problemset\/task\/(\d+)/.exec(href);
    return m ? m[1] : null;
  }

  function extractProblemTitle(icon) {
    const row = icon.closest('tr');
    if (!row) return 'Unknown';
    const link = row.querySelector('a[href*="/problemset/task/"]');
    return (link && link.textContent && link.textContent.trim()) || 'Unknown';
  }

  /** Apply filter logic; if forceRefetch true we ignore cache presence (by deleting entries first) */
  function applyFilter(forceRefetch = false) {
    const threshold = getThresholdDate();
    if (!threshold) return;
  const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);

    const solvedIcons = collectSolved();
    if (!solvedIcons.length) {
      setStatus('No solved problems detected.');
      return;
    }

  // Reset all icons to visible solved state before re-applying filter.
  solvedIcons.forEach(icon => { if (!icon.classList.contains('full')) icon.classList.add('full'); });

  const queue = new TaskQueue(3);
  let processed = 0, total = solvedIcons.length, fetched = 0;
  const thresholdIso = threshold.toISOString();
  console.log('[CSES Filter] Threshold:', thresholdIso, 'Solved icons:', total);
    // Log initial discovered icons with their current classes and HTML for diagnosis.
    solvedIcons.forEach((icon,i)=>{
      console.log(`[CSES Filter][DISCOVER] #${i} classes=`, icon.className, 'outerHTML=', icon.outerHTML);
    });

    solvedIcons.forEach(icon => {
      const problemId = extractProblemId(icon);
      if (!problemId) {
        console.warn('[CSES Filter][NO-ID] Could not find problem id for icon', icon);
        return;
      }
      const title = extractProblemTitle(icon);
      icon.setAttribute('data-problem-id', problemId);
      icon.setAttribute('data-problem-title', title);
      if (forceRefetch) localStorage.removeItem(CACHE_PREFIX + problemId);
      queue.push(async () => {
        const fetchStart = performance.now();
        console.log(`[CSES Filter][FETCH START] ${title} id=${problemId}`);
        const date = await getLastSubmissionDate(problemId);
        const fetchDur = (performance.now() - fetchStart).toFixed(0);
        if (date) {
          fetched++;
          if (threshold.getTime() === todayMidnight.getTime()) {
            if (!icon.classList.contains('full')) icon.classList.add('full');
            icon.title = `Last submission ${date.toLocaleString()}`;
            console.log(`[CSES Filter][DECISION] ${title} (id ${problemId}) last=${date.toISOString()} -> keep (threshold is today) fetch=${fetchDur}ms`);
          } else if (date < threshold) {
            if (icon.classList.contains('full')) icon.classList.remove('full');
            icon.title = `Hidden: last submission ${date.toLocaleString()}`;
            console.log(`[CSES Filter][DECISION] ${title} (id ${problemId}) last=${date.toISOString()} threshold=${thresholdIso} -> HIDE fetch=${fetchDur}ms`);
          } else {
            if (!icon.classList.contains('full')) icon.classList.add('full');
            icon.title = `Last submission ${date.toLocaleString()}`;
            console.log(`[CSES Filter][DECISION] ${title} (id ${problemId}) last=${date.toISOString()} threshold=${thresholdIso} -> keep fetch=${fetchDur}ms`);
          }
        } else {
          console.warn(`[CSES Filter][ERROR] ${title} (id ${problemId}) failed to fetch/parse date.`);
        }
        processed++;
        if (processed % 5 === 0 || processed === total) {
          setStatus(`Processed ${processed}/${total} solved problems (fetched ${fetched}). Threshold ${toISODate(threshold)}.`);
        }
      });
    });

    setStatus(`Queued ${solvedIcons.length} solved problems...`);
  console.log('[CSES Filter] Queue filled. Beginning async fetches.');
  }

  // Kick off after DOM ready (document-end should already suffice)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
