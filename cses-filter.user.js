// ==UserScript==
// @name         CSES Solved Filter by Date
// @namespace    https://cses.fi/
// @version      0.1.7
// @description  Hide solved check marks (list & task pages) for problems whose last submission is before a selected date.
// @author       Gaurish Gangwar
// @match        https://cses.fi/problemset/list
// @match        https://cses.fi/problemset/list/
// @match        https://cses.fi/problemset/list/*
// @match        https://cses.fi/problemset/task/*
// @match        https://cses.fi/problemset/*
// @icon         https://cses.fi/favicon.ico
// @run-at       document-end
// @grant        none
// @license      MIT
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
  const EXCLUDED_SECTIONS_KEY = 'cses:excludedSections';

  function loadExcludedSections() {
    try {
      const raw = localStorage.getItem(EXCLUDED_SECTIONS_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }
  function saveExcludedSections(set) {
    try { localStorage.setItem(EXCLUDED_SECTIONS_KEY, JSON.stringify(Array.from(set))); } catch {}
  }

  /** Detect CSES dark mode */
  function isDarkTheme() {
    const dm = document.getElementById('darkmode-enabled');
    if (dm && dm.textContent && dm.textContent.trim() === 'true') return true;
    const themeMeta = document.getElementById('theme-color');
    const c = themeMeta && themeMeta.getAttribute('content');
    return !!(c && c.toLowerCase() === '#292929');
  }

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
    function applyTheme() {
      const dark = isDarkTheme();
      if (dark) {
        Object.assign(panel.style, {
          position: 'fixed', top: '6px', left: '6px', background: 'rgba(32,32,32,0.92)',
          border: '1px solid #444', padding: '6px 8px', borderRadius: '6px', zIndex: 10000,
          boxShadow: '0 2px 6px rgba(0,0,0,0.5)', color: '#eee'
        });
        const status = panel.querySelector('#cses-filter-status'); if (status) status.style.color = '#bbb';
        const input = panel.querySelector('#cses-threshold-date'); if (input) Object.assign(input.style, { background:'#1e1e1e', color:'#eee', border:'1px solid #555' });
        const btn = panel.querySelector('#cses-clear-cache'); if (btn) Object.assign(btn.style, { background:'#2a2a2a', color:'#ddd', border:'1px solid #555', cursor:'pointer' });
      } else {
        Object.assign(panel.style, {
          position: 'fixed', top: '6px', left: '6px', background: 'rgba(255,255,255,0.9)',
          border: '1px solid #ccc', padding: '6px 8px', borderRadius: '6px', zIndex: 10000,
          boxShadow: '0 2px 5px rgba(0,0,0,0.15)', color: '#222'
        });
        const status = panel.querySelector('#cses-filter-status'); if (status) status.style.color = '#444';
        const input = panel.querySelector('#cses-threshold-date'); if (input) Object.assign(input.style, { background:'#fff', color:'#111', border:'1px solid #bbb' });
        const btn = panel.querySelector('#cses-clear-cache'); if (btn) Object.assign(btn.style, { background:'#f5f5f5', color:'#222', border:'1px solid #bbb', cursor:'pointer' });
      }
    }
    applyTheme();
    // Observe theme color meta changes (CSES toggles dark mode by replacing theme-color meta)
    const themeMeta = document.getElementById('theme-color');
    if (themeMeta) {
      const observer = new MutationObserver(()=>applyTheme());
      observer.observe(themeMeta, { attributes:true, attributeFilter:['content'] });
    }
    document.body.appendChild(panel);
    return panel;
  }

  /************* Result page: add Copy buttons for test data (input/correct/user) *************/
  async function fetchViewContent(url) {
    const resp = await fetch(url, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    // View endpoints typically return raw text/plain with no HTML wrappers.
    if (ct.startsWith('text/') || ct.includes('json') || ct.includes('xml') || ct.includes('csv') || ct.includes('charset=')) {
      return await resp.text();
    }
    // For save endpoints (octet-stream), decode as UTF-8 text for clipboard use.
    try {
      const blob = await resp.blob();
      if (blob && blob.text) {
        return await blob.text();
      }
    } catch {}
    try {
      const buf = await resp.arrayBuffer();
      return new TextDecoder('utf-8').decode(buf);
    } catch {
      // Fallback to text(); may still work in some browsers
      return await resp.text();
    }
  }

  function styleCopyButton(btn) {
    const dark = isDarkTheme();
    Object.assign(btn.style, {
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      border: '1px solid ' + (dark ? '#555' : '#bbb'),
      background: dark ? '#2a2a2a' : '#f5f5f5',
      color: dark ? '#ddd' : '#222',
      padding: '1px 6px', fontSize: '11px', borderRadius: '4px', cursor: 'pointer'
    });
  }

  function enhanceResultCopyButtons() {
    const actions = Array.from(document.querySelectorAll('div.samp-actions'));
    if (!actions.length) return;
    actions.forEach(act => {
      if (act.getAttribute('data-copy-enhanced') === '1') return;
      const view = act.querySelector('a.view');
      const save = act.querySelector('a.save');
      const href = view ? view.getAttribute('href') : (save ? save.getAttribute('href') : null);
      if (!href) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cses-copy-btn';
      btn.textContent = 'Copy';
      btn.title = 'Copy full data to clipboard';
      styleCopyButton(btn);
      const url = new URL(href, location.origin).toString();
      let resetTimer = null;
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        const prev = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Copying';
        try {
          const content = await fetchViewContent(url);
          await navigator.clipboard.writeText(content);
          btn.innerHTML = '<i class="fas fa-check"></i> Copied';
          btn.style.borderColor = '#3c9b3c';
          btn.style.color = isDarkTheme() ? '#bde5bd' : '#2a6f2a';
        } catch (e) {
          console.error('[CSES Copy] Failed to copy', e);
          btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed';
          btn.style.borderColor = '#b55';
          btn.style.color = isDarkTheme() ? '#ffbdbd' : '#7a1f1f';
        } finally {
          if (resetTimer) clearTimeout(resetTimer);
          resetTimer = setTimeout(() => { btn.disabled = false; btn.innerHTML = prev; styleCopyButton(btn); }, 1400);
        }
      });
      act.appendChild(document.createTextNode(' '));
      act.appendChild(btn);
      act.setAttribute('data-copy-enhanced', '1');
    });
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

  /** Fetch submission metadata for a problem id. Caches:
   *  - ISO timestamp (assumes first timestamp is latest) if any submission exists
   *  - 'NONE' if no submissions
   * Returns { date: Date|null, attempted: boolean }
   */
  async function getSubmissionMeta(problemId) {
    const cacheKey = CACHE_PREFIX + problemId;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      if (cached === 'NONE') return { date: null, attempted: false };
      const d = new Date(cached);
      if (!isNaN(d.getTime())) return { date: d, attempted: true };
    }
    try {
      const url = `https://cses.fi/problemset/submit/${problemId}/`;
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      const date = extractLatestSubmissionDate(text);
      if (date) {
        localStorage.setItem(cacheKey, date.toISOString());
        return { date, attempted: true };
      } else {
        localStorage.setItem(cacheKey, 'NONE');
        return { date: null, attempted: false };
      }
    } catch (e) {
      console.error('Failed to fetch submissions for', problemId, e);
      return { date: null, attempted: false };
    }
  }

  async function getLastSubmissionDate(problemId) {
    const meta = await getSubmissionMeta(problemId);
    return meta.date;
  }

  /** Refresh only one problem's cached metadata and visibility.
   * @param {string} problemId
   * @param {HTMLElement} icon span.task-score.icon element (solved or not) if available
   * @param {boolean} forceRefetch remove cached value first
   */
  async function refreshProblem(problemId, icon, forceRefetch=false) {
    if (forceRefetch) localStorage.removeItem(CACHE_PREFIX + problemId);
    // fetch metadata (populates cache)
    const date = await getLastSubmissionDate(problemId);
    // Decide visibility relative to threshold
    const threshold = getThresholdDate();
    if (icon) {
      // Ensure originalSolved marker if it has ever been solved
      if (icon.classList.contains('full')) icon.dataset.originalSolved = '1';
      if (date && threshold && date < threshold) {
        // hide historical solved
        if (icon.classList.contains('full')) icon.classList.remove('full');
        icon.title = `Hidden (old solve): last submission ${date.toLocaleString()}`;
      } else if (date) {
        if (!icon.classList.contains('full')) icon.classList.add('full');
        icon.title = `Last submission ${date.toLocaleString()}`;
      }
    }
    // Update filtered stats if on list page
    if (/\/problemset\/list\/?/.test(location.pathname)) updateFilteredSectionStats();
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
  // Run on CSES problemset pages
  const path = location.pathname;
  if (!/\/problemset\//.test(path)) return; // any problemset page
  const panel = createUI();
    const dateInput = /** @type {HTMLInputElement} */ (panel.querySelector('#cses-threshold-date'));
    // Load saved threshold date or default to today
    const saved = localStorage.getItem(THRESHOLD_DATE_KEY);
    const today = toISODate(new Date());
    dateInput.value = saved || today;

    dateInput.addEventListener('change', () => {
      localStorage.setItem(THRESHOLD_DATE_KEY, dateInput.value);
      applyFilter();
      buildSectionStats();
    });

  panel.querySelector('#cses-clear-cache').addEventListener('click', () => {
      if (!confirm('Clear cached submission timestamps?')) return;
      let cleared = 0;
      Object.keys(localStorage).forEach(k => { if (k.startsWith(CACHE_PREFIX)) { localStorage.removeItem(k); cleared++; } });
  setStatus(`Cleared ${cleared} cached entries.`);
  applyFilter(true); // force refetch
  buildSectionStats();
    });

    // Alt+Click on a solved icon to refresh just that problem
    document.addEventListener('click', (e) => {
      if (!e.altKey) return;
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.classList.contains('task-score')) {
        // Determine problem id (may not yet be cached on task pages until initial pass)
        const problemId = target.getAttribute('data-problem-id') || extractProblemId(target);
        if (problemId) {
          setStatus(`Refreshing problem ${problemId}...`);
          refreshProblem(problemId, target, true).then(()=> setStatus(`Refreshed problem ${problemId}.`));
        }
        e.preventDefault();
        e.stopPropagation();
      }
    });

    // MutationObserver: detect newly solved icons (class 'full' added) and refresh only that problem's metadata.
    const mo = new MutationObserver(muts => {
      muts.forEach(m => {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          const el = m.target;
          if (el instanceof HTMLElement && el.classList.contains('task-score') && el.classList.contains('full')) {
            // newly solved: refresh its cache
            const pid = el.getAttribute('data-problem-id') || extractProblemId(el);
            if (pid) {
              el.dataset.originalSolved = '1';
              refreshProblem(pid, el, true);
            }
          }
        } else if (m.addedNodes && m.addedNodes.length) {
          m.addedNodes.forEach(n => {
            if (n instanceof HTMLElement) {
              const icons = n.matches && n.matches('span.task-score.icon.full') ? [n] : Array.from(n.querySelectorAll ? n.querySelectorAll('span.task-score.icon.full') : []);
              icons.forEach(ic => {
                const pid = ic.getAttribute('data-problem-id') || extractProblemId(ic);
                if (pid) {
                  ic.dataset.originalSolved = '1';
                  refreshProblem(pid, ic, true);
                }
              });
            }
          });
        }
      });
    });
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

    applyFilter();
    buildSectionStats();

    // Enhance result page copy buttons
    if (/\/problemset\/result\//.test(path) || /\/problemset\/view\//.test(path)) {
      enhanceResultCopyButtons();
      const mo2 = new MutationObserver(() => enhanceResultCopyButtons());
      mo2.observe(document.body, { childList: true, subtree: true });
    }
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
    // Primary structure (list page): span inside li.task containing an <a>
    let link = null;
    const li = el.closest('li.task');
    if (li) {
      link = li.querySelector('a[href*="/problemset/task/"]');
    }
    // Task page sidebar: span directly inside <a href="/problemset/task/<id>">
    if (!link) {
      link = el.closest('a[href*="/problemset/task/"]');
    }
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const m = /\/problemset\/task\/(\d+)/.exec(href);
    return m ? m[1] : null;
  }

  function extractProblemTitle(icon) {
    let link = null;
    const li = icon.closest('li.task');
    if (li) link = li.querySelector('a[href*="/problemset/task/"]');
    if (!link) link = icon.closest('a[href*="/problemset/task/"]');
    return (link && link.childNodes && Array.from(link.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()) || 'Unknown';
  }

  /**************** Section statistics: [total / correct / wrong / unattended] ***************/
  const sectionQueue = new TaskQueue(2);

  function findSections() {
    return Array.from(document.querySelectorAll('h2')).map(h => ({
      heading: h,
      list: h.nextElementSibling && h.nextElementSibling.matches('ul.task-list') ? h.nextElementSibling : null
  }));
  }

  function classifyTask(li) {
    const icon = li.querySelector('span.task-score.icon');
    const solved = icon && icon.classList.contains('full');
    const wrongImmediate = icon && icon.classList.contains('zero'); // known wrong submission indicator
    const link = li.querySelector('a[href*="/problemset/task/"]');
    const problemId = link ? (link.getAttribute('href') || '').match(/(\d+)/)?.[1] : null;
    if (!problemId) return { solved: false, attempted: false, unattended: true, pending: false };
    if (solved) return { solved: true, attempted: true, unattended: false, pending: false, problemId };
    if (wrongImmediate) return { solved: false, attempted: true, unattended: false, pending: false, problemId };
    const cacheVal = localStorage.getItem(CACHE_PREFIX + problemId);
    if (cacheVal) {
      if (cacheVal === 'NONE') return { solved: false, attempted: false, unattended: true, pending: false, problemId };
      const d = new Date(cacheVal);
      if (!isNaN(d.getTime())) return { solved: false, attempted: true, unattended: false, pending: false, problemId };
    }
    return { solved: false, attempted: false, unattended: true, pending: true, problemId };
  }

  function updateSectionHeading(section) {
    const { heading, list } = section;
  if (!list) return; // skip headings without a task list (e.g., General)
  const tasks = Array.from(list.querySelectorAll('li.task'));
    let total = tasks.length, correct = 0, wrong = 0, unattended = 0;
    tasks.forEach(li => {
      const c = classifyTask(li);
      if (c.solved) correct++; else if (c.attempted) wrong++; else unattended++;
    });
    const base = heading.getAttribute('data-base-text') || heading.textContent.trim();
    heading.setAttribute('data-base-text', base);
    let badge = heading.querySelector(':scope > .cses-section-stats');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'cses-section-stats';
      badge.style.cssText = 'margin-right:6px;font-weight:normal;font-size:0.75em;color:#888;';
      heading.prepend(badge);
    }
  badge.innerHTML = `[<span style="color:#ccc;">${total}</span> / <span style="color:#3c9b3c;">${correct}</span> / <span style="color:#d28b26;">${wrong}</span> / <span style="color:#777;">${unattended}</span>] `;
  badge.title = 'Overall: total / solved / wrong (attempted unsolved) / unattended';
    heading.dataset.sectionOverall = JSON.stringify({ total, correct, wrong, unattended });
  }

  function buildSectionStats() {
  // Skip section stats on task pages (sidebar mini list has no h2 structure)
  if (!/\/problemset\/list\/?/.test(location.pathname)) return; // only list page has sections
    const sections = findSections();
    sections.forEach(section => {
  updateSectionHeading(section); // initial (fast)
  // add include/exclude toggle (skip General)
  if (section.list) addSectionToggle(section);
      // queue fetches for pending unsolved tasks
  if (!section.list) return;
  const tasks = Array.from(section.list.querySelectorAll('li.task'));
      tasks.forEach(li => {
        const c = classifyTask(li);
        if (c.pending && c.problemId) {
          sectionQueue.push(async () => {
            await getSubmissionMeta(c.problemId);
            updateSectionHeading(section);
            updateFilteredSectionStats();
          });
        }
      });
    });
    updateFilteredSectionStats();
  }

  /** Compute filtered stats (post date filter) and display to right of heading */
  function updateFilteredSectionStats() {
  if (!/\/problemset\/list\/?/.test(location.pathname)) return; // no section headings except on list page
    const threshold = getThresholdDate();
    const sections = findSections();
    let aggTotal=0, aggSolved=0, aggWrong=0, aggUnatt=0, aggFilteredSolved=0, aggFilteredWrong=0, aggFilteredUnatt=0;
    sections.forEach(section => {
      const { heading, list } = section;
      if (!list) return; // skip headers without lists for per-section badges
      const tasks = Array.from(list.querySelectorAll('li.task'));
      let filteredSolved=0, filteredWrong=0, filteredUnatt=0;
      const included = heading.dataset.excluded !== '1';
      tasks.forEach(li => {
        const icon = li.querySelector('span.task-score.icon');
        if (!icon) return;
        const originallySolved = icon.dataset.originalSolved === '1' || icon.classList.contains('full');
        const isSolvedNow = icon.classList.contains('full');
        const wrongImmediate = icon.classList.contains('zero');
        const link = li.querySelector('a[href*="/problemset/task/"]');
        const problemId = link ? (link.getAttribute('href')||'').match(/(\d+)/)?.[1] : null;
        let attempted = false;
        if (wrongImmediate) attempted = true; else if (problemId) {
          const cacheVal = localStorage.getItem(CACHE_PREFIX + problemId);
            if (cacheVal && cacheVal !== 'NONE') attempted = true;
        }
        // Per-section filtered
        // Filtered logic: treat hidden previously-solved tasks (originallySolved && !isSolvedNow) as unattended for the filtered period.
        if (isSolvedNow && originallySolved) {
          filteredSolved++; if (included) aggFilteredSolved++;
        } else if (attempted && !originallySolved) {
          filteredWrong++; if (included) aggFilteredWrong++;
        } else if (originallySolved && !isSolvedNow) {
          filteredUnatt++; if (included) aggFilteredUnatt++;
        } else if (!originallySolved && !attempted) {
          filteredUnatt++; if (included) aggFilteredUnatt++;
        } else {
          // fallback
          filteredUnatt++; if (included) aggFilteredUnatt++;
        }
        // Overall aggregate: only include if section is not excluded
        if (included) {
          aggTotal++;
          if (originallySolved) aggSolved++; else if (attempted) aggWrong++; else aggUnatt++;
        }
      });
      // Skip headings with zero tasks (handled later as General aggregate)
      if (!tasks.length) return;
      let filteredBadge = heading.querySelector(':scope > .cses-section-stats-filter');
      if (!filteredBadge) {
        filteredBadge = document.createElement('span');
        filteredBadge.className = 'cses-section-stats-filter';
        filteredBadge.style.cssText = 'margin-left:8px;font-weight:normal;font-size:0.7em;color:#5aa;';
        heading.appendChild(filteredBadge);
      }
  filteredBadge.innerHTML = `[filtered <span style="color:#3c9b3c;">${filteredSolved}</span> / <span style="color:#d28b26;">${filteredWrong}</span> / <span style="color:#777;">${filteredUnatt}</span>]`;
  filteredBadge.title = 'Filtered (date threshold): solved-after-threshold / wrong (attempted unsolved) / old-or-unattended';
    });
    // Aggregate into explicit 'General' heading if present
    const general = sections.find(s => (s.heading.textContent || '').trim().toLowerCase().startsWith('general'));
    if (general) {
      const h = general.heading;
      // Left badge already shows [0/0/0/0] -> replace with aggregate overall
      let overallBadge = h.querySelector(':scope > .cses-section-stats');
      if (!overallBadge) {
        overallBadge = document.createElement('span');
        overallBadge.className = 'cses-section-stats';
        overallBadge.style.cssText = 'margin-right:6px;font-weight:normal;font-size:0.75em;color:#888;';
        h.prepend(overallBadge);
      }
      overallBadge.innerHTML = `[<span style="color:#ccc;">${aggTotal}</span> / <span style="color:#3c9b3c;">${aggSolved}</span> / <span style="color:#d28b26;">${aggWrong}</span> / <span style="color:#777;">${aggUnatt}</span>] `;
      overallBadge.title = 'Overall totals across all included sections: total / solved / wrong / unattended';
      let filteredBadge = h.querySelector(':scope > .cses-section-stats-filter');
      if (!filteredBadge) {
        filteredBadge = document.createElement('span');
        filteredBadge.className = 'cses-section-stats-filter';
        filteredBadge.style.cssText = 'margin-left:8px;font-weight:normal;font-size:0.7em;color:#5aa;';
        h.appendChild(filteredBadge);
      }
  filteredBadge.innerHTML = `[filtered <span style="color:#3c9b3c;">${aggFilteredSolved}</span> / <span style="color:#d28b26;">${aggFilteredWrong}</span> / <span style="color:#777;">${aggFilteredUnatt}</span>]`;
  filteredBadge.title = 'Aggregate filtered counts (date threshold) across included sections';
    }
  }

  /** Add include/exclude toggle to a section heading (except General). */
  function addSectionToggle(section) {
    const { heading, list } = section;
    if (!list) return;
    const title = (heading.textContent || '').trim().toLowerCase();
    if (title.startsWith('general')) return;
  const excludedSet = loadExcludedSections();
    let btn = heading.querySelector(':scope > .cses-section-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'cses-section-toggle';
      btn.type = 'button';
      btn.style.marginLeft = '8px';
      btn.style.fontSize = '11px';
      btn.style.padding = '1px 6px';
      btn.style.borderRadius = '4px';
      btn.style.cursor = 'pointer';
      // theme-aware
      const dark = isDarkTheme();
      btn.style.border = '1px solid ' + (dark ? '#555' : '#bbb');
      btn.style.background = dark ? '#2a2a2a' : '#f5f5f5';
      btn.style.color = dark ? '#ddd' : '#222';
      heading.appendChild(btn);
    }
    // Apply persisted state on first render
    const key = title; // use lowercased section title as key
    if (excludedSet.has(key)) {
      heading.dataset.excluded = '1';
      if (list) list.style.display = 'none';
    }
    const updateBtnUI = () => {
      const excluded = heading.dataset.excluded === '1';
      // Use emoji icons for simplicity (no external deps): 👁 visible, 🙈 hidden
      btn.textContent = excluded ? '🙈' : '👁';
      btn.title = excluded ? 'Include Section' : 'Exclude Section';
      btn.setAttribute('aria-label', btn.title);
    };
    updateBtnUI();
    btn.onclick = () => {
      const excluded = heading.dataset.excluded === '1';
      if (excluded) {
        delete heading.dataset.excluded;
        if (list) list.style.display = '';
        excludedSet.delete(key);
      } else {
        heading.dataset.excluded = '1';
        if (list) list.style.display = 'none';
        excludedSet.add(key);
      }
      saveExcludedSections(excludedSet);
      updateBtnUI();
      // recompute aggregates to reflect inclusion/exclusion
      updateFilteredSectionStats();
    };
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
          updateFilteredSectionStats();
        }
      });
    });

    setStatus(`Queued ${solvedIcons.length} solved problems...`);
  console.log('[CSES Filter] Queue filled. Beginning async fetches.');
    // initial filtered stats update after resetting icons
    updateFilteredSectionStats();
  }

  // Kick off after DOM ready (document-end should already suffice)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
