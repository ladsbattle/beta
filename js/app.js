
// Parse data
const PANEL_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTfNvGSQbmwwXodVzmhuZfOAGIIE634hWTA6V1CTaQlF272v3VRJ5t_F7OfSKPH0qbBQbUSvLlQnw3x/pub?output=csv';
const ENDLESS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTfNvGSQbmwwXodVzmhuZfOAGIIE634hWTA6V1CTaQlF272v3VRJ5t_F7OfSKPH0qbBQbUSvLlQnw3x/pub?gid=1577067344&single=true&output=csv';
const CHANGELOG_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTfNvGSQbmwwXodVzmhuZfOAGIIE634hWTA6V1CTaQlF272v3VRJ5t_F7OfSKPH0qbBQbUSvLlQnw3x/pub?gid=1820828638&single=true&output=csv';
const CONTRIBUTORS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTfNvGSQbmwwXodVzmhuZfOAGIIE634hWTA6V1CTaQlF272v3VRJ5t_F7OfSKPH0qbBQbUSvLlQnw3x/pub?gid=1484906078&single=true&output=csv';
const CONTRIBUTOR_CATEGORIES = ['網站維護', '面板分享'];
const contributorEnglishSort = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const contributorStrokeSort = new Intl.Collator('zh-Hant-u-co-stroke', { numeric: true });
const contributors = { status: 'idle', groups: null };
const CSV_REQUEST_TIMEOUT_MS = 10000;
const IMAGE_PRELOAD_TIMEOUT_MS = 8000;
const MAIN_DATA_RETRIES = 1;
let DATA = [];
let ENDLESS_DATA = [];
let ENDLESS_ALL = [];
const DYNAMIC_FILTER_CATEGORIES = FILTER_CATEGORY_ORDER;

function createPanelFilterState() {
  return {
    orbit: null,
    results: [],
    layerFilters: { upper: [], lower: [] },
    dynamicBaseData: [],
    dynamicFilterOrder: 0,
    rangeKey: null,
    manualEntryOpen: false,
    manualLayerValue: '',
    advancedFilterOpen: false,
    videoOnly: false,
    committedOrbit: null,
    committedLayer: null
  };
}

function createEndlessFilterState() {
  return {
    character: null,
    partner: null,
    card: null,
    advancedFilterOpen: false,
    videoOnly: false
  };
}

const state = {
  panel: createPanelFilterState(),
  endless: createEndlessFilterState(),
  preview: {
    items: { panel: [], endless: [] },
    autoFrame: null,
    lastTime: 0,
    modalPaused: false
  }
};
const PANEL_PREVIEW_SPEED = 0.075;
const CONTENT_FADE_MS = 150;
const fadeVersions = {};
let tabFadeTimer = null;
let activeFolderTab = 'favorites';
let localFolder = { favorites: [], history: [] };
let CHANGELOG_DATA = [];
let changelogLoaded = false;
let changelogLoadError = false;
let appLoading = true;
let bootLoadFailed = false;
const BOOT_CSV_TOTAL = 2;
const bootProgress = {
  csvDone: 0,
  csvTotal: BOOT_CSV_TOTAL,
  imageDone: 0,
  imageTotal: null,
  stage: '資料載入中'
};
const LOCAL_FOLDER_KEY = 'ladsbattle_local_folder_v1';

// Search links store only committed filters, never private folder data or UI state.
const SEARCH_FILTER_FIELDS = { dir: 'stella', card: 'card', partner: 'companion' };
const SEARCH_FILTER_SIDES = { upper: 't1_', lower: 't2_' };
const SEARCH_PARAM_KEYS = [
  'orbit', 'level', 'companion', 'card', 'video',
  ...Object.values(SEARCH_FILTER_SIDES).flatMap(prefix =>
    Object.values(SEARCH_FILTER_FIELDS).map(field => prefix + field)
  )
];
let restoringSearchUrl = true;

// Run only at startup: reload resets filters; shared links and history still restore.
function clearSearchOnReload() {
  if (window.performance.getEntriesByType('navigation')[0]?.type !== 'reload') return;
  const url = new URL(window.location.href);
  SEARCH_PARAM_KEYS.forEach(key => url.searchParams.delete(key));
  if (url.href === window.location.href) return;
  try {
    window.history.replaceState(window.history.state, '', url.href);
  } catch (error) {
    console.warn('Search URL could not be cleared on reload:', error);
  }
}

function searchParamsForTab(tab) {
  const params = new URLSearchParams();
  if (tab === 'endless') {
    if (state.endless.partner) params.set('companion', state.endless.partner);
    if (state.endless.card) params.set('card', state.endless.card);
    if (state.endless.videoOnly) params.set('video', '1');
  } else if (state.panel.orbit) {
    params.set('orbit', ORBIT_LABEL[state.panel.orbit]);
    const layer = getExactLayerValue();
    if (layer !== null) params.set('level', String(layer));
    for (const side of ['upper', 'lower']) {
      for (const filter of state.panel.layerFilters[side]) {
        params.set(SEARCH_FILTER_SIDES[side] + SEARCH_FILTER_FIELDS[filter.type], filter.type === 'dir' ? dirLabel(filter.value) : filter.value);
      }
    }
    if (state.panel.videoOnly) params.set('video', '1');
  }
  return params;
}

function syncSearchUrl(tab, keepNotice = false) {
  if (appLoading || restoringSearchUrl) return;
  const activeTab = document.querySelector('.tab-nav')?.dataset.active || 'panel';
  if (tab !== activeTab) return;
  if (!keepNotice) showSearchLinkNotice('');
  const url = new URL(window.location.href);
  SEARCH_PARAM_KEYS.forEach(key => url.searchParams.delete(key));
  searchParamsForTab(tab).forEach((value, key) => url.searchParams.set(key, value));
  // Preserve the deployment path, unrelated query parameters, hash and history entry.
  if (url.href !== window.location.href) {
    try {
      window.history.replaceState(window.history.state, '', url.href);
    } catch (error) {
      console.warn('Search URL could not be updated:', error);
    }
  }
}

function showSearchLinkNotice(message) {
  const notice = document.getElementById('searchLinkStatus');
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = !message;
}

// Validate the current URL schema before applying it. Unknown parameters are ignored.
function parseSearchLink(params) {
  const read = key => {
    const value = params.get(key) || '';
    if (params.getAll(key).length > 1 || value.length > 150) throw new Error('Invalid search parameter');
    return value;
  };
  SEARCH_PARAM_KEYS.forEach(read);
  if (read('video') && !['0', '1'].includes(read('video'))) throw new Error('Invalid video filter');
  const companion = read('companion');
  const level = read('level');
  const hasOrbitFilters = Boolean(
    read('orbit') || level
    || Object.values(SEARCH_FILTER_SIDES).some(prefix =>
      Object.values(SEARCH_FILTER_FIELDS).some(field => read(prefix + field)))
  );
  const hasEndlessFilters = Boolean(companion || read('card'));
  if (hasOrbitFilters && hasEndlessFilters) throw new Error('Mixed search modes');
  const mode = hasEndlessFilters ? 'endless' : 'orbit';
  if (mode === 'endless') {
    const next = createEndlessFilterState();
    const character = ENDLESS_CHARACTER_CATALOG.find(item => item.visible && item.partners.includes(companion));
    if (companion && !character) throw new Error('Unknown companion');
    if ((read('card') || read('video') === '1') && !companion) throw new Error('Missing companion');
    next.character = character?.name || null;
    next.partner = companion || null;
    next.card = read('card') || null;
    next.videoOnly = read('video') === '1';
    next.advancedFilterOpen = Boolean(next.card || next.videoOnly);
    return { tab: 'endless', filters: next };
  }
  const next = createPanelFilterState();
  const orbit = read('orbit');
  next.orbit = Object.keys(ORBIT_LABEL).find(key => ORBIT_LABEL[key] === orbit || key === orbit) || null;
  if (orbit && !next.orbit) throw new Error('Unknown orbit');
  if (level) {
    const layer = Number(level);
    if (!next.orbit || !/^\d+$/.test(level) || !Number.isInteger(layer) || layer < 1 || layer > LIMITS[next.orbit]) {
      throw new Error('Invalid layer');
    }
    next.committedOrbit = next.orbit;
    next.committedLayer = layer;
  }
  for (const side of ['upper', 'lower']) {
    for (const [type, field] of Object.entries(SEARCH_FILTER_FIELDS)) {
      const value = read(SEARCH_FILTER_SIDES[side] + field);
      if (!value) continue;
      if (next.committedLayer === null || (type === 'dir' && !['順譜', '逆譜'].includes(value))) {
        throw new Error('Invalid advanced filter');
      }
      next.layerFilters[side].push({ type, value: type === 'dir' ? value.slice(0, 1) : value, order: ++next.dynamicFilterOrder });
    }
  }
  next.videoOnly = read('video') === '1';
  if (next.videoOnly && next.committedLayer === null) throw new Error('Missing exact layer');
  next.advancedFilterOpen = next.videoOnly || next.dynamicFilterOrder > 0;
  return { tab: 'panel', filters: next };
}

function restoreSearchFromUrl() {
  if (appLoading) return;
  restoringSearchUrl = true;
  let tab = 'panel';
  showSearchLinkNotice('');
  try {
    const restored = parseSearchLink(new URLSearchParams(window.location.search));
    tab = restored.tab;
    Object.assign(state[tab], restored.filters);
    if (tab === 'panel' && state.panel.committedLayer !== null) {
      const range = getLayerRanges().find(item => item.layers.includes(state.panel.committedLayer));
      state.panel.rangeKey = range?.key || null;
      state.panel.manualEntryOpen = !range;
      state.panel.manualLayerValue = range ? '' : String(state.panel.committedLayer);
    }
  } catch (error) {
    resetPanelFilterState();
    showSearchLinkNotice('連結中的搜尋條件無法辨識，請重新選擇。');
  }
  // Restore the visible tab immediately, without a transition from the wrong tab.
  if (tabFadeTimer) window.clearTimeout(tabFadeTimer);
  tabFadeTimer = null;
  document.querySelector('.tab-nav')?.setAttribute('data-active', tab);
  document.querySelectorAll('.tab-btn').forEach(button => button.classList.toggle('active', button.dataset.searchTab === tab));
  document.querySelectorAll('.section').forEach(section => {
    section.classList.toggle('active', section.id === `section-${tab}`);
    section.classList.remove('is-fading');
  });
  updatePrimaryTabSlider();
  syncVideoFilterControls();
  syncOrbitPillState();
  updatePanelFilterUI();
  renderEndlessSelector();
  applyFilters();
  applyEndlessFilters();
  restoringSearchUrl = false;
  syncSearchUrl(tab, true);
}

function loadingMarkup(message = '資料載入中…') {
  return `<span class="loading-inline"><span class="loading-spinner"></span><span class="loading-text">${escapeHtml(message)}</span></span>`;
}

function getBootProgressPercent() {
  const csvTotal = Math.max(bootProgress.csvTotal, 1);
  const csvRatio = Math.min(bootProgress.csvDone / csvTotal, 1);
  const csvWeight = 45;
  const imageWeight = 55;

  if (bootProgress.imageTotal === null) {
    return Math.round(csvRatio * csvWeight);
  }

  const imageRatio = bootProgress.imageTotal === 0
    ? 1
    : Math.min(bootProgress.imageDone / bootProgress.imageTotal, 1);
  return Math.min(100, Math.round((csvRatio * csvWeight) + (imageRatio * imageWeight)));
}

function loadProgressMarkup() {
  const percent = getBootProgressPercent();
  return `
    <span class="loading-inline boot-progress-inline">
      <span class="loading-spinner"></span>
      <span class="loading-text">資料載入中…</span>
      <span class="load-progress" role="status" aria-label="資料載入進度"><strong>${percent}%</strong></span>
    </span>`;
}

function updateBootProgressElement(element) {
  if (!element) return;
  const percentText = `${getBootProgressPercent()}%`;
  const progressText = element.querySelector('.load-progress strong');
  if (progressText) {
    progressText.textContent = percentText;
    return;
  }
  element.innerHTML = loadProgressMarkup();
}

function renderBootProgress() {
  if (!appLoading || bootLoadFailed) return;
  updateBootProgressElement(document.getElementById('resultsInfo'));
  updateBootProgressElement(document.getElementById('endlessInfo'));
}

function setSearchControlsDisabled(disabled) {
  document.body.classList.toggle('is-app-loading', disabled);
  document.querySelectorAll(`
    .tab-nav .tab-btn,
    .primary-filter-block button,
    .primary-filter-block input,
    .primary-filter-block select
  `).forEach(el => { el.disabled = disabled; });
  const advancedToggle = document.getElementById('advancedFilterToggle');
  if (advancedToggle) advancedToggle.disabled = disabled;
  if (!disabled) updatePanelFilterUI();
}

function markCsvLoaded() {
  bootProgress.csvDone += 1;
  bootProgress.stage = '資料載入中';
  renderBootProgress();
}

async function fetchWithTimeout(url, timeoutMs = CSV_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function retryAsync(task, retries = 0) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function fetchCsvResource(url, parser, onSuccess, options = {}) {
  const timeoutMs = options.timeoutMs ?? CSV_REQUEST_TIMEOUT_MS;
  const retries = options.retries ?? 0;
  const rows = await retryAsync(async () => {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) throw new Error(`CSV request failed: ${res.status}`);
    return parser(await res.text());
  }, retries);
  if (typeof onSuccess === 'function') onSuccess(rows);
  return rows;
}

function rankImageSrcFromCard(card) {
  const text = String(card || '').trim();
  if (text === '無套裝') return '';
  const match = text.match(/^([0-3])階/);
  return match ? `assets/ranks/R${match[1]}.png` : '';
}

function addCompanionImage(urls, partner) {
  const text = String(partner || '').trim();
  if (!text || text === 'N/A') return;
  urls.add(companionImagePath(text));
}

function addRankImage(urls, card) {
  const src = rankImageSrcFromCard(card);
  if (src) urls.add(src);
}

function collectInitialImageUrls() {
  const urls = new Set();
  DATA.forEach(row => {
    addRankImage(urls, row.upperCard);
    addRankImage(urls, row.lowerCard);
    addCompanionImage(urls, row.upperPartner);
    addCompanionImage(urls, row.lowerPartner);
  });
  ENDLESS_ALL.forEach(row => {
    addRankImage(urls, row.card);
    addCompanionImage(urls, row.partner);
  });
  return [...urls];
}

function preloadImage(url, timeoutMs = IMAGE_PRELOAD_TIMEOUT_MS) {
  return new Promise(resolve => {
    const image = new Image();
    let settled = false;
    const finish = (ok, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      resolve({ url, ok, timedOut });
    };
    const timeoutId = setTimeout(() => finish(false, true), timeoutMs);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

async function preloadInitialImages() {
  const urls = collectInitialImageUrls();
  bootProgress.stage = '資料載入中';
  bootProgress.imageTotal = urls.length;
  bootProgress.imageDone = 0;
  renderBootProgress();
  const results = await Promise.all(urls.map(async url => {
    const result = await preloadImage(url);
    bootProgress.imageDone += 1;
    renderBootProgress();
    return result;
  }));
  const failed = results.filter(result => !result.ok);
  if (failed.length > 0) {
    console.warn('Some preload images failed:', failed.map(result => result.url));
  }
}

function showBootLoadError() {
  bootLoadFailed = true;
  appLoading = true;
  setSearchControlsDisabled(true);
  stopPreviewAutoScroll();
  const message = `
    <span class="boot-load-error" role="alert">
      <span>⚠ 資料載入失敗</span>
      <button class="ui-control ui-control--compact ui-control--utility" type="button" onclick="retryBootDataLoad()">重新載入資料</button>
    </span>`;
  document.getElementById('resultsInfo').innerHTML = message;
  document.getElementById('endlessInfo').innerHTML = message;
  document.getElementById('cardsGrid').replaceChildren();
  document.getElementById('endlessGrid').replaceChildren();
}

function formatTaipeiDateTime(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(value)).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    return {
      orbit: cols[0]?.trim(), layer: parseInt(cols[1]),
      upperCard: cols[2]?.trim(), upperPartner: cols[3]?.trim(), upperDir: cols[4]?.trim(),
      lowerCard: cols[5]?.trim(), lowerPartner: cols[6]?.trim(), lowerDir: cols[7]?.trim(),
      hasVideo: cols[8]?.trim() === 'TRUE', link: cols[9]?.trim()
    };
  }).filter(d => !isNaN(d.layer));
}

function parseEndlessCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    return {
      partner: cols[0]?.trim(),
      card:    cols[1]?.trim(),
      combo:   cols[2]?.trim(),
      score:   cols[3]?.trim(),
      hasVideo: cols[4]?.trim() === 'TRUE',
      link:    cols[5]?.trim()
    };
  }).filter(d => d.partner);
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map(value => value.trim());
}

function parseChangelogCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  const headers = parseCsvLine(lines[0]).map(header => header.toLowerCase());
  const dateIndex = headers.indexOf('date');
  const noteIndex = headers.indexOf('note');
  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    return {
      date: cols[dateIndex]?.trim(),
      note: cols[noteIndex]?.trim()
    };
  }).filter(item => item.date && item.note);
}

// Published Sheets CSV may contain quoted commas, line breaks and escaped quotes.
function parseContributorCSV(text) {
  const records = [];
  let record = '';
  let quoted = false;
  for (const char of text.replace(/^\uFEFF/, '')) {
    if (char === '"') quoted = !quoted;
    if ((char === '\n' || char === '\r') && !quoted) {
      if (record.trim()) records.push(parseCsvLine(record));
      record = '';
    } else record += char;
  }
  if (record.trim()) records.push(parseCsvLine(record));
  if (quoted) throw new Error('Unclosed CSV quotation');
  const headers = records.shift() || [];
  const nameIndex = headers.indexOf('名稱');
  const categoryIndex = headers.findIndex(header => header === '貢獻別' || header === '分類');
  if (nameIndex < 0 || categoryIndex < 0) throw new Error('Missing contributor CSV headers');
  const names = Object.fromEntries(CONTRIBUTOR_CATEGORIES.map(category => [category, new Set()]));
  records.forEach(row => {
    const name = (row[nameIndex] || '').trim().normalize('NFC');
    if (!name) return;
    (row[categoryIndex] || '').split(/[、,，;；|／/\r\n]+/).forEach(tag => names[tag.trim()]?.add(name));
  });
  return Object.fromEntries(CONTRIBUTOR_CATEGORIES.map(category => [category, [...names[category]].sort(compareContributorNames)]));
}

function compareContributorNames(a, b) {
  // Ignore leading punctuation when grouping; keep the displayed name intact.
  const group = name => {
    const firstLetter = name.match(/[A-Za-z\p{Script=Han}]/u)?.[0] || '';
    return /^[A-Za-z]$/.test(firstLetter) ? 0 : firstLetter ? 1 : 2;
  };
  const difference = group(a) - group(b);
  if (difference) return difference;
  const compared = (group(a) === 0 ? contributorEnglishSort : contributorStrokeSort).compare(a, b);
  return compared || (a < b ? -1 : a > b ? 1 : 0);
}

function renderContributors() {
  const content = document.getElementById('contributorsContent');
  if (!content) return;
  content.setAttribute('aria-busy', String(contributors.status === 'loading'));
  if (contributors.status === 'loading') {
    content.innerHTML = loadingMarkup('名單載入中…');
  } else if (contributors.status === 'error') {
    content.innerHTML = '<p class="contributors-message">名單暫時無法載入，不影響資料庫搜尋。</p><button class="ui-control ui-control--compact ui-control--utility" type="button" data-contributors-action="retry">重新載入名單</button>';
  } else if (contributors.status === 'loaded') {
    content.innerHTML = CONTRIBUTOR_CATEGORIES.map(category => {
      const names = contributors.groups[category];
      return `<section class="contributors-group"><h3>${category}</h3>${names.length
        ? `<ul class="contributors-names">${names.map(name => `<li><span>${escapeHtml(name).replace(/[\p{Script=Han}\p{Script=Bopomofo}\u02C7\u02CA\u02CB\u02D9]+/gu, '<span class="contributor-local-name">$&</span>')}</span></li>`).join('')}</ul>`
        : '<p class="contributors-message">名單整理中</p>'}</section>`;
    }).join('');
    requestAnimationFrame(fitContributorNames);
  }
}

// Fit the actual rendered name, including after fonts load or columns resize.
function fitContributorNames() {
  if (!document.getElementById('contributorsDialog')?.open) return;
  document.querySelectorAll('.contributors-names li > span').forEach(name => {
    name.style.fontSize = '';
    const available = name.parentElement.clientWidth;
    const width = name.getBoundingClientRect().width;
    if (available > 0 && width > available) {
      const size = parseFloat(getComputedStyle(name).fontSize);
      name.style.fontSize = `${Math.floor(size * (available - 1) / width * 100) / 100}px`;
    }
  });
}

async function loadContributors() {
  if (contributors.status === 'loading' || contributors.status === 'loaded') return;
  contributors.status = 'loading';
  renderContributors();
  try {
    contributors.groups = await fetchCsvResource(CONTRIBUTORS_CSV_URL, parseContributorCSV, null, { retries: 1 });
    contributors.status = 'loaded';
  } catch (error) {
    contributors.status = 'error';
    console.warn('Contributor list unavailable:', error);
  }
  renderContributors();
}

function openContributors() {
  const dialog = document.getElementById('contributorsDialog');
  if (!dialog || dialog.open) return;
  dialog.showModal();
  renderContributors();
  document.querySelector('.contributors-scroll').scrollTop = 0;
  loadContributors(); // Optional data: never part of the main startup progress.
}

function resetBootProgress() {
  bootProgress.csvDone = 0;
  bootProgress.csvTotal = BOOT_CSV_TOTAL;
  bootProgress.imageDone = 0;
  bootProgress.imageTotal = null;
  bootProgress.stage = '資料載入中';
}

async function loadChangelogData() {
  changelogLoaded = false;
  changelogLoadError = false;
  try {
    CHANGELOG_DATA = await fetchCsvResource(CHANGELOG_CSV_URL, parseChangelogCSV, null, {
      timeoutMs: CSV_REQUEST_TIMEOUT_MS
    });
    changelogLoaded = true;
  } catch (error) {
    changelogLoadError = true;
    console.error('Maintenance history fetch failed:', error);
  }
  renderVersionHistory();
}

async function loadPrimaryApplicationData() {
  appLoading = true;
  bootLoadFailed = false;
  resetBootProgress();
  setSearchControlsDisabled(true);
  renderLayerSuggestions();
  renderBootProgress();

  try {
    const loadPrimaryCsv = (url, parser) => (
      fetchCsvResource(url, parser, null, {
        timeoutMs: CSV_REQUEST_TIMEOUT_MS,
        retries: MAIN_DATA_RETRIES
      }).then(rows => {
        markCsvLoaded();
        return rows;
      })
    );

    const [panelRows, endlessRows] = await Promise.all([
      loadPrimaryCsv(PANEL_CSV_URL, parseCSV),
      loadPrimaryCsv(ENDLESS_CSV_URL, parseEndlessCSV)
    ]);
    DATA = stableCatalogSort(panelRows, comparePanelRows);
    ENDLESS_ALL = stableCatalogSort(endlessRows, compareEndlessRows);
    ENDLESS_DATA = [...ENDLESS_ALL];
    previewModule.prime('panel');
    previewModule.prime('endless');
    await preloadInitialImages();

    appLoading = false;
    setSearchControlsDisabled(false);
    resetEndlessFilterState();
    restoreSearchFromUrl();
  } catch (err) {
    showBootLoadError();
    console.error(err);
  }
}

function retryBootDataLoad() {
  if (!bootLoadFailed) return;
  loadPrimaryApplicationData();
}

async function init() {
  clearSearchOnReload();
  renderOrbitSelector();
  loadLocalFolder();
  renderFolderPanel();
  updatePrimaryTabSlider();
  const SHEET_FILE_ID = '19RqMAlpyi1g9pXyJ1azm45pxfjvxRqxJOUCdsQpHKDo';
  const DRIVE_API_KEY = 'AIzaSyAzbzHaKnhio4gomMkPm-lppgkDpBj6TIw';

  const updateLastUpdated = async () => {
    const metaUrl = `https://www.googleapis.com/drive/v3/files/${SHEET_FILE_ID}?fields=modifiedTime&key=${DRIVE_API_KEY}`;
    const metaRes = await fetchWithTimeout(metaUrl, CSV_REQUEST_TIMEOUT_MS);
    const meta = await metaRes.json();
    const lastUpdatedEl = document.getElementById('lastUpdated');
    if (meta.modifiedTime && lastUpdatedEl) {
      const formatted = formatTaipeiDateTime(meta.modifiedTime);
      lastUpdatedEl.textContent = `Last Updated: ${formatted} (UTC+8)`;
    }
  };

  updateLastUpdated().catch(err => console.error('Last Updated fetch failed:', err));
  loadChangelogData();
  await loadPrimaryApplicationData();
}

function getExactLayerValue() {
  const value = state.panel.committedOrbit === state.panel.orbit
    ? state.panel.committedLayer
    : null;
  const limit = state.panel.orbit ? (LIMITS[state.panel.orbit] || Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
  return Number.isInteger(value) && value >= 1 && value <= limit ? value : null;
}

function commitExactQuery(layer) {
  if (state.panel.committedOrbit !== state.panel.orbit || state.panel.committedLayer !== layer) {
    state.panel.layerFilters = { upper: [], lower: [] };
  }
  state.panel.committedOrbit = state.panel.orbit;
  state.panel.committedLayer = layer;
}

function syncVideoFilterControls() {
  const panelToggle = document.getElementById('videoOnly');
  const endlessToggle = document.getElementById('endlessVideoOnly');
  if (panelToggle) panelToggle.checked = state.panel.videoOnly;
  if (endlessToggle) endlessToggle.checked = state.endless.videoOnly;
}

function clearPanelAdvancedState({ collapse = true } = {}) {
  state.panel.layerFilters = { upper: [], lower: [] };
  state.panel.dynamicBaseData = [];
  state.panel.dynamicFilterOrder = 0;
  state.panel.videoOnly = false;
  if (collapse) state.panel.advancedFilterOpen = false;
  syncVideoFilterControls();
}

function clearPanelLayerSelectionState() {
  state.panel.committedOrbit = null;
  state.panel.committedLayer = null;
  state.panel.rangeKey = null;
  state.panel.manualEntryOpen = false;
  state.panel.manualLayerValue = '';
  clearPanelAdvancedState();
}

function resetPanelFilterState() {
  Object.assign(state.panel, createPanelFilterState());
  syncVideoFilterControls();
}

function clearEndlessAdvancedState({ collapse = true } = {}) {
  state.endless.card = null;
  state.endless.videoOnly = false;
  if (collapse) state.endless.advancedFilterOpen = false;
  syncVideoFilterControls();
}

function resetEndlessFilterState() {
  Object.assign(state.endless, createEndlessFilterState());
  syncVideoFilterControls();
}

function setPanelVideoOnly(checked) {
  if (appLoading) return;
  state.panel.videoOnly = Boolean(checked);
  applyFilters();
}

function setEndlessVideoOnly(checked) {
  if (appLoading) return;
  state.endless.videoOnly = Boolean(checked);
  applyEndlessFilters();
}

function syncOrbitPillState() {
  document.querySelectorAll('#orbitChips [data-orbit]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.orbit === state.panel.orbit));
  });
}

function renderOrbitSelector() {
  const openRow = document.querySelector('#orbitChips .orbit-row-open');
  const directionalGrid = document.querySelector('#orbitChips .orbit-grid-directional');
  if (!openRow || !directionalGrid) return;
  const buttonMarkup = orbit => `
    <button class="chip ui-pill ui-pill--primary"
      data-orbit="${escapeHtml(orbit.key)}"
      aria-pressed="${state.panel.orbit === orbit.key}"
      onclick="selectOrbit(this)">${escapeHtml(orbit.label)}</button>`;
  const visibleOrbits = ORBIT_CATALOG
    .filter(orbit => orbit.visible)
    .sort((a, b) => a.order - b.order);
  openRow.innerHTML = visibleOrbits.filter(orbit => orbit.group === 'open').map(buttonMarkup).join('');
  directionalGrid.innerHTML = visibleOrbits.filter(orbit => orbit.group === 'directional').map(buttonMarkup).join('');
}

function selectOrbit(btn) {
  if (appLoading) return;
  const orbit = btn.dataset.orbit;
  const nextOrbit = state.panel.orbit === orbit ? null : orbit;
  clearPanelLayerSelectionState();
  state.panel.orbit = nextOrbit;
  syncOrbitPillState();
  updatePanelFilterUI();
  applyFilters();
}

function updatePanelFilterUI() {
  const panelSection = document.getElementById('section-panel');

  if (panelSection) {
    if (state.panel.orbit) panelSection.dataset.orbitTheme = state.panel.orbit;
    else delete panelSection.dataset.orbitTheme;
  }
  renderLayerSuggestions();
}

function getLayerRanges() {
  if (!state.panel.orbit || !Array.isArray(DATA) || DATA.length === 0) return [];
  const orbitLimit = Number.isFinite(LIMITS[state.panel.orbit]) ? LIMITS[state.panel.orbit] : Infinity;
  const layers = [...new Set(DATA
    .filter(row => row.orbit === state.panel.orbit && Number.isFinite(row.layer) && row.layer >= 1 && row.layer <= orbitLimit)
    .map(row => row.layer))]
    .sort((a, b) => a - b);
  const ranges = new Map();

  layers.forEach(layer => {
    const start = layer <= 60 ? 1 : 61 + Math.floor((layer - 61) / 60) * 60;
    const end = Math.min(start === 1 ? 60 : start + 59, orbitLimit);
    const key = `${start}-${end}`;
    if (!ranges.has(key)) ranges.set(key, { key, start, end, layers: [] });
    ranges.get(key).layers.push(layer);
  });

  return [...ranges.values()].sort((a, b) => a.start - b.start);
}

function layerSuggestionPlaceholderMarkup(message, isEmpty = false) {
  return `
    <div class="layer-suggestion-toolbar">
      <span class="orbit-label">快速選層</span>
      <span class="layer-suggestion-back is-placeholder ui-control ui-control--navigation" aria-hidden="true">返回區間</span>
    </div>
    <div class="layer-suggestion-placeholder${isEmpty ? ' is-empty' : ''}">
      <span class="layer-suggestion-placeholder-text primary-filter-placeholder">${escapeHtml(message)}</span>
    </div>
  `;
}

function renderLayerSuggestions() {
  const panel = document.getElementById('layerSuggestionPanel');
  if (!panel) return;
  if (appLoading) {
    panel.innerHTML = layerSuggestionPlaceholderMarkup('請先選擇軌道類型', true);
    panel.classList.add('show', 'is-loading');
    return;
  }
  panel.classList.remove('is-loading');
  const ranges = getLayerRanges();
  const activeRange = ranges.find(range => range.key === state.panel.rangeKey) || null;
  const selectedLayer = getExactLayerValue();
  const visibleItems = activeRange ? activeRange.layers : ranges;
  const suggestionItems = !activeRange && state.panel.manualEntryOpen ? [] : visibleItems;

  if (!state.panel.orbit || visibleItems.length === 0) {
    panel.innerHTML = layerSuggestionPlaceholderMarkup(
      state.panel.orbit ? '此軌道暫無可選層數' : '請先選擇軌道類型',
      !state.panel.orbit
    );
    panel.classList.add('show');
    return;
  }
  const manualControl = activeRange ? '' : (state.panel.manualEntryOpen ? `
    <div class="layer-manual-controls">
      <div class="layer-manual-entry">
        <input class="layer-manual-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(state.panel.manualLayerValue)}" placeholder="輸入層數" aria-label="手動輸入層數">
        <button class="layer-manual-submit ui-control ui-control--inline" type="button" data-layer-action="manual-submit">查看</button>
      </div>
      <button class="layer-manual-return ui-control ui-control--navigation" type="button" data-layer-action="manual-close">返回快速選層</button>
    </div>
  ` : `
    <button class="layer-suggestion-chip layer-manual-trigger ui-pill ui-pill--secondary" type="button" data-layer-action="manual-open">
      <span>＋ 手動輸入</span>
    </button>
  `);
  panel.innerHTML = `
    <div class="layer-suggestion-toolbar">
      <span class="orbit-label">快速選層</span>
      ${activeRange ? `
        <button class="layer-suggestion-back ui-control ui-control--navigation" type="button" data-layer-action="back" aria-label="返回層數區間">
          返回區間
        </button>
      ` : '<span class="layer-suggestion-back is-placeholder ui-control ui-control--navigation" aria-hidden="true">返回區間</span>'}
    </div>
    <div class="layer-suggestion-track" aria-label="${activeRange ? '選擇層數' : '選擇層數區間'}">
      ${suggestionItems.map(item => activeRange ? `
        <button class="layer-suggestion-chip ui-pill ui-pill--secondary" type="button" data-layer="${item}" aria-pressed="${selectedLayer === item}">
          <span>${item}</span>
        </button>
      ` : `
        <button class="layer-suggestion-chip ui-pill ui-pill--secondary" type="button" data-layer-range="${item.key}">
          <span>${item.start}–${item.end}</span>
        </button>
      `).join('')}
      ${manualControl}
    </div>
  `;
  panel.classList.add('show');
}

function blurLayerSuggestionFocus() {
  const panel = document.getElementById('layerSuggestionPanel');
  panel?.classList.add('suppress-hover');
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && panel?.contains(focused)) {
    focused.blur();
  }
}

function selectLayerRange(rangeKey) {
  if (appLoading || !state.panel.orbit) return;
  const range = getLayerRanges().find(item => item.key === rangeKey);
  if (!range) return;
  blurLayerSuggestionFocus();
  clearPanelLayerSelectionState();
  state.panel.rangeKey = range.key;
  renderLayerSuggestions();
  applyFilters();
}

function backToLayerRanges() {
  blurLayerSuggestionFocus();
  clearPanelLayerSelectionState();
  renderLayerSuggestions();
  applyFilters();
}

function selectSuggestedLayer(layer) {
  if (appLoading || !state.panel.orbit) return;
  blurLayerSuggestionFocus();
  state.panel.manualEntryOpen = false;
  state.panel.manualLayerValue = '';
  clearPanelAdvancedState();
  commitExactQuery(layer);
  applyFilters();
  renderLayerSuggestions();
}

function openManualLayerEntry() {
  if (appLoading || !state.panel.orbit) return;
  state.panel.manualEntryOpen = true;
  renderLayerSuggestions();
  window.requestAnimationFrame(() => {
    document.querySelector('#layerSuggestionPanel .layer-manual-input')?.focus();
  });
}

function closeManualLayerEntry() {
  backToLayerRanges();
  window.requestAnimationFrame(() => {
    document.querySelector('#layerSuggestionPanel .layer-manual-trigger')?.focus();
  });
}

function clearManualLayerError(input) {
  if (!input) return;
  input.removeAttribute('aria-invalid');
  input.placeholder = '輸入層數';
  input.closest('.layer-manual-entry')?.classList.remove('has-error');
}

function showManualLayerError(input) {
  const limit = LIMITS[state.panel.orbit] || 300;
  input.value = '';
  state.panel.manualLayerValue = '';
  input.placeholder = `此軌道範圍為1–${limit}`;
  input.setAttribute('aria-invalid', 'true');
  input.closest('.layer-manual-entry')?.classList.add('has-error');
  input.focus();
}

function submitManualLayerEntry() {
  if (appLoading || !state.panel.orbit) return;
  const input = document.querySelector('#layerSuggestionPanel .layer-manual-input');
  if (!input) return;
  const rawValue = input.value.trim();
  const layer = Number(rawValue);
  const limit = LIMITS[state.panel.orbit] || Number.POSITIVE_INFINITY;
  if (!rawValue || !Number.isInteger(layer) || layer < 1 || layer > limit) {
    showManualLayerError(input);
    return;
  }

  blurLayerSuggestionFocus();
  clearPanelAdvancedState();
  state.panel.rangeKey = null;
  state.panel.manualEntryOpen = true;
  state.panel.manualLayerValue = String(layer);
  commitExactQuery(layer);
  applyFilters();
  renderLayerSuggestions();
  window.requestAnimationFrame(() => {
    document.querySelector('#layerSuggestionPanel .layer-manual-input')?.focus();
  });
}

function dirLabel(dir) {
  if (dir === '順') return '順譜';
  if (dir === '逆') return '逆譜';
  return dir;
}

function getBasePanelData(layerNum, videoOnly, layerRange = null) {
  return DATA.filter(d => {
    if (state.panel.orbit && d.orbit !== state.panel.orbit) return false;
    if (layerNum !== null && d.layer !== layerNum) return false;
    if (layerNum === null && layerRange && (d.layer < layerRange.start || d.layer > layerRange.end)) return false;
    if (videoOnly && !d.hasVideo) return false;
    return true;
  });
}

function addOption(map, type, value, label = value) {
  if (!value || value === 'N/A') return;
  const key = `${type}:${value}`;
  if (!map.has(key)) map.set(key, { type, value, label });
}

function sortCardsBySetAndRank(cards) {
  return cards.sort((a, b) => compareCards(a.value, b.value));
}

function collectLayerOptions(data, side) {
  const dirMap = new Map();
  const cardMap = new Map();
  const partnerMap = new Map();
  const prefix = side === 'upper' ? 'upper' : 'lower';
  data.forEach(d => {
    addOption(dirMap, 'dir', d[`${prefix}Dir`], dirLabel(d[`${prefix}Dir`]));
    addOption(cardMap, 'card', d[`${prefix}Card`]);
    addOption(partnerMap, 'partner', d[`${prefix}Partner`]);
  });
  const dirs = STELLA_ORDER
    .map(dir => dirMap.get(`dir:${dir}`))
    .filter(Boolean);
  const cards = sortCardsBySetAndRank([...cardMap.values()]);
  const partners = [...partnerMap.values()].sort((a, b) => compareCompanionNames(a.value, b.value));
  return { card: cards, partner: partners, dir: dirs };
}

function isDynamicFilterActive(side, option) {
  return state.panel.layerFilters[side].some(f => f.type === option.type && f.value === option.value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ''), location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
  } catch (err) {
    return '#';
  }
}

function loadLocalFolder() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_FOLDER_KEY) || '{}');
    localFolder = {
      favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
      history: Array.isArray(saved.history) ? saved.history : []
    };
  } catch (err) {
    localFolder = { favorites: [], history: [] };
  }
}

function saveLocalFolder() {
  localStorage.setItem(LOCAL_FOLDER_KEY, JSON.stringify(localFolder));
}

function itemKey(item) {
  return `${item.type}:${item.link}`;
}

function panelFolderItem(d) {
  return {
    type: 'panel',
    link: d.link,
    title: `${ORBIT_LABEL[d.orbit] || d.orbit} ${d.layer} 層`,
    meta: `上層 ${d.upperCard}｜下層 ${d.lowerCard}`,
    badge: d.hasVideo ? '附影片' : '',
    savedAt: Date.now()
  };
}

function endlessFolderItem(d) {
  return {
    type: 'endless',
    link: d.link,
    partner: d.partner,
    card: d.card,
    score: fmtScore(d.score),
    combo: d.combo,
    title: `無盡挑戰｜${d.partner}`,
    meta: `${d.card}｜${fmtScore(d.score)} 分｜${d.combo} 譜`,
    badge: d.hasVideo ? '附影片' : '',
    savedAt: Date.now()
  };
}

function displayFolderItem(item) {
  if (item.type !== 'endless') return item;
  let partner = item.partner || '';
  let card = item.card || '';
  let score = item.score || '';
  let combo = item.combo || '';

  if ((!partner || !card) && item.title) {
    const parts = item.title.split('｜');
    if (parts[0] === '無盡挑戰') {
      partner = partner || parts[1] || '';
    } else {
      partner = partner || parts[0] || '';
      card = card || parts[1] || '';
    }
  }

  if ((!score || !combo || !card) && item.meta) {
    const parts = item.meta.split('｜');
    if (parts[0]?.startsWith('無盡挑戰')) {
      score = score || parts[0].replace('無盡挑戰', '').replace('分', '').trim();
      combo = combo || parts[1]?.replace('譜', '').trim() || '';
    } else {
      card = card || parts[0] || '';
      score = score || parts[1]?.replace('分', '').trim() || '';
      combo = combo || parts[2]?.replace('譜', '').trim() || '';
    }
  }

  return {
    ...item,
    title: `無盡挑戰｜${partner || '未指定搭檔'}`,
    meta: `${card || '未指定日卡'}｜${score || '—'} 分｜${combo || '—'} 譜`
  };
}

function isFavorite(item) {
  const key = itemKey(item);
  return localFolder.favorites.some(saved => itemKey(saved) === key);
}

function isViewed(item) {
  const key = itemKey(item);
  return localFolder.history.some(saved => itemKey(saved) === key);
}

function encodedItemKey(item) {
  return encodeURIComponent(itemKey(item));
}

function viewedCornerMarkup() {
  return '<div class="viewed-corner" aria-hidden="true"><span>已看過</span></div>';
}

function viewedCardMarkup(item) {
  return isViewed(item) ? viewedCornerMarkup() : '';
}

function viewedCardClass(item) {
  return isViewed(item) ? ' viewed-card' : '';
}

function markViewedCards(item) {
  const key = encodedItemKey(item);
  document.querySelectorAll(`[data-view-key="${key}"]`).forEach(card => {
    card.classList.add('viewed-card');
    if (!card.querySelector('.viewed-corner')) {
      card.insertAdjacentHTML('afterbegin', viewedCornerMarkup());
    }
  });
}

function setModalViewed(isViewedNow = true) {
  document.getElementById('modal')?.classList.toggle('viewed-detail', isViewedNow);
}

function toggleFavorite(item, event) {
  if (event) event.stopPropagation();
  const key = itemKey(item);
  const idx = localFolder.favorites.findIndex(saved => itemKey(saved) === key);
  if (idx >= 0) {
    localFolder.favorites.splice(idx, 1);
  } else {
    localFolder.favorites.unshift({ ...item, savedAt: Date.now() });
  }
  saveLocalFolder();
  renderCards();
  renderEndless();
  renderFolderPanel();
}

function toggleFavoriteFromButton(btn, event) {
  const item = JSON.parse(decodeURIComponent(btn.dataset.item));
  toggleFavorite(item, event);
  updateFavoriteButtonState(btn, item);
}

function updateFavoriteButtonState(btn, item) {
  const saved = isFavorite(item);
  btn.classList.toggle('saved', saved);
  const icon = btn.querySelector('svg');
  const label = btn.querySelector('.save-card-label');
  if (icon) icon.setAttribute('fill', saved ? 'currentColor' : 'none');
  if (label) label.textContent = saved ? '已收藏' : '收藏';
}

function addHistoryItem(item) {
  const key = itemKey(item);
  localFolder.history = localFolder.history.filter(saved => itemKey(saved) !== key);
  localFolder.history.unshift({ ...item, savedAt: Date.now() });
  localFolder.history = localFolder.history.slice(0, 50);
  saveLocalFolder();
  markViewedCards(item);
  renderFolderPanel();
}

function favoriteButton(item) {
  const saved = isFavorite(item);
  const encodedItem = encodeURIComponent(JSON.stringify(item));
  return `
    <button class="save-card-btn ${saved ? 'saved' : ''}" data-item="${encodedItem}" onclick="toggleFavoriteFromButton(this, event)">
      <svg viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
        <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/>
        <path d="M3 9h18"/>
      </svg>
      <span class="save-card-label">${saved ? '已收藏' : '收藏'}</span>
    </button>`;
}

function reportButton(reportUrl) {
  return `
    <a href="${escapeHtml(safeExternalUrl(reportUrl))}" target="_blank" rel="noopener" class="btn-report">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 3 22 20H2L12 3z"/>
        <path d="M12 9v5"/>
        <path d="M12 17h.01"/>
      </svg>
      回報
    </a>`;
}

function modalFooterActions(link, folderItem, reportUrl, hasVideo = false) {
  const videoText = hasVideo
    ? '<span class="btn-video-inline"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="7 4 19 12 7 20 7 4"/></svg>附影片</span>'
    : '';
  return `
    <div class="modal-footer-actions">
      <a href="${escapeHtml(safeExternalUrl(link))}" target="_blank" rel="noopener" class="btn-fb">
        <span>查看面板詳情</span>${videoText}
      </a>
      <div class="modal-secondary-actions">
        ${favoriteButton(folderItem)}
        ${reportButton(reportUrl)}
      </div>
    </div>`;
}

function groupChangelogByDate(items) {
  const sortedItems = items
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index);
  const groups = new Map();
  sortedItems.forEach(item => {
    if (!groups.has(item.date)) groups.set(item.date, []);
    groups.get(item.date).push(item.note);
  });
  return [...groups.entries()].map(([date, notes]) => ({ date, notes }));
}

function formatChangelogDate(date) {
  return String(date || '').replace(/-/g, '.');
}

function formatChangelogDateParts(date) {
  const [year = '', month = '', day = ''] = String(date || '').split('-');
  return {
    year,
    day: month && day ? `${month}.${day}` : formatChangelogDate(date)
  };
}

function renderVersionHistory() {
  const list = document.getElementById('versionHistoryList');
  if (!list) return;
  if (changelogLoadError) {
    list.innerHTML = '<div class="version-history-empty">版本紀錄載入失敗，請稍後再試。</div>';
    return;
  }
  if (!changelogLoaded) {
    list.innerHTML = `<div class="version-history-empty">${loadingMarkup()}</div>`;
    return;
  }
  if (CHANGELOG_DATA.length === 0) {
    list.innerHTML = '<div class="version-history-empty">目前尚無版本紀錄。</div>';
    return;
  }
  list.innerHTML = groupChangelogByDate(CHANGELOG_DATA).map(group => {
    const dateParts = formatChangelogDateParts(group.date);
    return `
    <div class="version-history-group">
      <div class="version-history-date" aria-label="${escapeHtml(formatChangelogDate(group.date))}">
        <span class="version-history-year">${escapeHtml(dateParts.year)}</span>
        <span class="version-history-day">${escapeHtml(dateParts.day)}</span>
      </div>
      <ul class="version-history-items">
        ${group.notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}
      </ul>
    </div>
  `;
  }).join('');
}

function switchInfoTab(tab) {
  const activeTab = ['guide', 'intro', 'version'].includes(tab) ? tab : 'guide';
  document.querySelector('#infoOverlay .info-tabs')?.setAttribute('data-active', activeTab);
  document.querySelectorAll('#infoOverlay .info-tab').forEach(btn => {
    const isActive = btn.dataset.tab === activeTab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.info-panel').forEach(panel => {
    const isActive = panel.dataset.panel === activeTab;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });
  const infoContent = document.querySelector('#infoOverlay .info-content');
  if (infoContent) infoContent.scrollTop = 0;
  if (activeTab === 'version') renderVersionHistory();
}

function openInfoModal() {
  switchInfoTab('guide');
  renderVersionHistory();
  document.getElementById('infoOverlay')?.classList.add('show');
}

function closeInfoModal(e) {
  if (e.target === document.getElementById('infoOverlay')) closeInfoModalDirect();
}

function closeInfoModalDirect() {
  document.getElementById('infoOverlay')?.classList.remove('show');
}

function toggleFolderPanel() {
  const panel = document.getElementById('localFolderPanel');
  if (!panel) return;
  panel.classList.toggle('show');
  renderFolderPanel();
}

function closeFolderPanel() {
  document.getElementById('localFolderPanel')?.classList.remove('show');
}

function switchFolderTab(tab) {
  activeFolderTab = tab;
  renderFolderPanel();
}

function clearFolderTab() {
  const message = activeFolderTab === 'favorites'
    ? '以下操作無法復原，是否確認刪除【收藏】？'
    : '以下操作無法復原，是否確認刪除【瀏覽記錄】及【已看過】標籤？';
  if (!confirm(message)) return;
  localFolder[activeFolderTab] = [];
  saveLocalFolder();
  renderCards();
  renderEndless();
  renderFolderPanel();
}

function openFolderItemFromButton(btn) {
  const item = JSON.parse(decodeURIComponent(btn.dataset.item));
  if (item.type === 'panel') {
    const d = DATA.find(row => row.link === item.link);
    if (d) {
      openPanelDetail(d, false);
      return;
    }
  }
  if (item.type === 'endless') {
    const d = ENDLESS_ALL.find(row => row.link === item.link);
    if (d) {
      openEndlessDetail(d, false);
      return;
    }
  }
  closeFolderPanel();
  window.open(safeExternalUrl(item.link), '_blank', 'noopener');
}

function renderFolderPanel() {
  const panel = document.getElementById('localFolderPanel');
  const list = document.getElementById('folderList');
  const clearBtn = document.getElementById('folderClearBtn');
  if (!panel || !list || !clearBtn) return;
  document.querySelector('.folder-tabs')?.setAttribute('data-active', activeFolderTab);
  document.querySelectorAll('.folder-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === activeFolderTab);
  });
  const items = localFolder[activeFolderTab] || [];
  clearBtn.disabled = items.length === 0;
  if (items.length === 0) {
    list.innerHTML = `<div class="folder-empty">${activeFolderTab === 'favorites' ? '尚未收藏任何資料' : '尚無瀏覽記錄'}</div>`;
    return;
  }
  list.innerHTML = items.map(item => {
    const displayItem = displayFolderItem(item);
    const encodedItem = encodeURIComponent(JSON.stringify(item));
    return `
    <div class="folder-item">
      <div>
        <div class="folder-item-title">${escapeHtml(displayItem.title)}</div>
        <div class="folder-item-meta">${escapeHtml(displayItem.meta || '')}${displayItem.badge ? `｜${escapeHtml(displayItem.badge)}` : ''}</div>
      </div>
      <button class="folder-item-link" data-item="${encodedItem}" onclick="openFolderItemFromButton(this)">查看</button>
    </div>
  `;
  }).join('');
}

function rowMatchesDynamicFilter(row, side, filter) {
  const prefix = side === 'upper' ? 'upper' : 'lower';
  if (filter.type === 'dir') return row[`${prefix}Dir`] === filter.value;
  if (filter.type === 'card') return row[`${prefix}Card`] === filter.value;
  if (filter.type === 'partner') return row[`${prefix}Partner`] === filter.value;
  return true;
}

function rowMatchesDynamicFilterState(row, state) {
  return ['upper', 'lower'].every(side =>
    state[side].every(filter => rowMatchesDynamicFilter(row, side, filter))
  );
}

function dynamicStateHasMatches(baseData, state) {
  return baseData.some(row => rowMatchesDynamicFilterState(row, state));
}

function cloneDynamicFilterState() {
  return {
    upper: state.panel.layerFilters.upper.map(filter => ({ ...filter })),
    lower: state.panel.layerFilters.lower.map(filter => ({ ...filter }))
  };
}

function isDynamicOptionCompatible(side, option) {
  const next = cloneDynamicFilterState();
  next[side] = next[side].filter(filter => filter.type !== option.type);
  next[side].push({ type: option.type, value: option.value });
  return dynamicStateHasMatches(state.panel.dynamicBaseData, next);
}

function toggleDynamicFilter(side, type, value) {
  if (appLoading) return;
  const selected = state.panel.layerFilters[side].find(
    filter => filter.type === type && filter.value === value
  );

  if (selected) {
    state.panel.layerFilters[side] = state.panel.layerFilters[side].filter(
      filter => filter.type !== type
    );
    applyFilters();
    return;
  }

  const next = { upper: [], lower: [] };
  next[side].push({ type, value, order: ++state.panel.dynamicFilterOrder });

  const candidates = ['upper', 'lower']
    .flatMap(candidateSide =>
      state.panel.layerFilters[candidateSide]
        .filter(filter => !(candidateSide === side && filter.type === type))
        .map(filter => ({ side: candidateSide, filter }))
    )
    .sort((a, b) => (b.filter.order || 0) - (a.filter.order || 0));

  candidates.forEach(({ side: candidateSide, filter }) => {
    const trial = {
      upper: next.upper.map(item => ({ ...item })),
      lower: next.lower.map(item => ({ ...item }))
    };
    trial[candidateSide] = trial[candidateSide]
      .filter(item => item.type !== filter.type);
    trial[candidateSide].push({ ...filter });
    if (dynamicStateHasMatches(state.panel.dynamicBaseData, trial)) {
      next.upper = trial.upper;
      next.lower = trial.lower;
    }
  });

  state.panel.layerFilters = next;
  applyFilters();
}

function renderDynamicFilterSide(side, optionsByType) {
  const el = document.getElementById(side === 'upper' ? 'upperDynamicChips' : 'lowerDynamicChips');
  if (!el) return;
  state.panel.layerFilters[side].forEach(filter => {
    const options = optionsByType[filter.type] || (optionsByType[filter.type] = []);
    if (!options.some(option => option.value === filter.value)) {
      options.push({ ...filter, label: filter.type === 'dir' ? dirLabel(filter.value) : filter.value });
    }
  });
  const hasOptions = DYNAMIC_FILTER_CATEGORIES.some(
    type => optionsByType[type]?.length
  );
  if (!hasOptions) {
    el.innerHTML = '<span class="dynamic-empty">無此層配置</span>';
    return;
  }
  el.innerHTML = DYNAMIC_FILTER_CATEGORIES.flatMap(type => {
    const options = optionsByType[type] || [];
    if (options.length === 0) return '';
    return options.map(option => {
      const active = isDynamicFilterActive(side, option);
      const hasActiveSibling = state.panel.layerFilters[side].some(
        filter => filter.type === option.type && filter.value !== option.value
      );
      const compatible = active || (!hasActiveSibling && isDynamicOptionCompatible(side, option));
      return `
        <button class="dynamic-chip ui-pill ui-pill--filter ${compatible ? '' : 'is-unavailable'}"
          data-side="${side}"
          data-type="${option.type}"
          data-value="${escapeHtml(option.value)}"
          aria-pressed="${active}">
          ${escapeHtml(option.label)}
        </button>
      `;
    });
  }).join('');
}

function renderDynamicFilters(baseData, layerNum) {
  const panel = document.getElementById('dynamicFilterPanel');
  const noMatch = document.getElementById('dynamicNoMatch');
  if (!panel) return;
  const shouldShow = state.panel.orbit && layerNum !== null;
  panel.classList.toggle('show', shouldShow);
  if (!shouldShow) {
    if (noMatch) noMatch.classList.remove('show');
    return;
  }
  state.panel.dynamicBaseData = baseData;
  renderDynamicFilterSide('upper', collectLayerOptions(baseData, 'upper'));
  renderDynamicFilterSide('lower', collectLayerOptions(baseData, 'lower'));
}

function getPanelAdvancedBaseData() {
  const layerNum = getExactLayerValue();
  return layerNum === null ? [] : getBasePanelData(layerNum, false);
}

function canUsePanelAdvancedFilters(baseData = getPanelAdvancedBaseData()) {
  return getExactLayerValue() !== null && (baseData.length > 1 || state.panel.videoOnly
    || state.panel.layerFilters.upper.length > 0 || state.panel.layerFilters.lower.length > 0);
}

function hasPanelAdvancedState() {
  return state.panel.advancedFilterOpen
    || state.panel.videoOnly
    || state.panel.layerFilters.upper.length > 0
    || state.panel.layerFilters.lower.length > 0;
}

function updateAdvancedFilterControl(shouldShowAdvanced = canUsePanelAdvancedFilters()) {
  const panel = document.getElementById('advancedFilterPanel');
  const controls = document.getElementById('panelResultsControls');
  const toggle = document.getElementById('advancedFilterToggle');
  const chevron = document.getElementById('advancedFilterChevron');

  if (controls) {
    controls.hidden = false;
    controls.classList.toggle('is-placeholder', !shouldShowAdvanced);
    controls.setAttribute('aria-hidden', String(!shouldShowAdvanced));
  }
  if (panel) panel.hidden = !shouldShowAdvanced || !state.panel.advancedFilterOpen;
  if (toggle) {
    toggle.hidden = false;
    toggle.disabled = !shouldShowAdvanced;
    toggle.setAttribute('aria-expanded', String(shouldShowAdvanced && state.panel.advancedFilterOpen));
  }
  if (chevron) chevron.textContent = shouldShowAdvanced && state.panel.advancedFilterOpen ? '⌃' : '⌄';
}

function toggleAdvancedFilters() {
  if (appLoading || !canUsePanelAdvancedFilters()) return;
  state.panel.advancedFilterOpen = !state.panel.advancedFilterOpen;
  updateAdvancedFilterControl();
}

function resetAdvancedFilters() {
  if (appLoading || !canUsePanelAdvancedFilters()) return;
  clearPanelAdvancedState({ collapse: false });
  applyFilters();
}

function matchesLayerFilters(d, side) {
  const filters = state.panel.layerFilters[side];
  if (filters.length === 0) return true;
  return filters.every(filter => rowMatchesDynamicFilter(d, side, filter));
}

function applyFilters() {
  if (appLoading) return;
  const layerNum = getExactLayerValue();
  const advancedBaseData = layerNum === null ? [] : getBasePanelData(layerNum, false);
  const shouldShowAdvanced = canUsePanelAdvancedFilters(advancedBaseData);
  if (!shouldShowAdvanced && hasPanelAdvancedState()) clearPanelAdvancedState();
  const activeRange = layerNum === null && state.panel.rangeKey
    ? { start: Number(state.panel.rangeKey.split('-')[0]), end: Number(state.panel.rangeKey.split('-')[1]) }
    : null;
  const videoOnly = state.panel.videoOnly;
  const shouldSearch = Boolean(state.panel.orbit || state.panel.rangeKey || videoOnly);
  if (!shouldSearch) {
    state.panel.results = [...DATA];
    const noMatch = document.getElementById('dynamicNoMatch');
    if (noMatch) noMatch.classList.remove('show');
    renderDynamicFilters([], null);
    updateAdvancedFilterControl(shouldShowAdvanced);
    renderCards();
    return;
  }
  const baseData = getBasePanelData(layerNum, videoOnly, activeRange);
  renderDynamicFilters(baseData, layerNum);
  state.panel.results = baseData.filter(d => matchesLayerFilters(d, 'upper') && matchesLayerFilters(d, 'lower'));
  const noMatch = document.getElementById('dynamicNoMatch');
  const hasSelectedDynamicFilters = state.panel.layerFilters.upper.length > 0 || state.panel.layerFilters.lower.length > 0;
  if (noMatch) noMatch.classList.toggle('show', hasSelectedDynamicFilters && state.panel.results.length === 0);
  updateAdvancedFilterControl(shouldShowAdvanced);
  renderCards();
}

function resetFilters() {
  if (appLoading) return;
  resetPanelFilterState();
  syncOrbitPillState();
  updatePanelFilterUI();
  applyFilters();
}

const PREVIEW_ADAPTERS = {
  panel: {
    source: () => DATA,
    gridId: 'cardsGrid',
    emptyText: '目前尚無軌道資料',
    sectionSelector: '#section-panel.active .panel-preview-viewport',
    renderCard: (item, index) => panelCardMarkup(item, { previewType: 'panel', previewIndex: index }),
    openDetail: openPanelDetail
  },
  endless: {
    source: () => ENDLESS_ALL,
    gridId: 'endlessGrid',
    emptyText: '目前尚無無盡挑戰資料',
    sectionSelector: '#section-endless.active .panel-preview-viewport',
    renderCard: (item, index) => endlessCardMarkup(item, { previewType: 'endless', previewIndex: index }),
    openDetail: openEndlessDetail
  }
};

const previewModule = {
  sample(source, count = 10) {
    const pool = [...source];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(count, pool.length));
  },

  prime(type, count = 10) {
    const adapter = PREVIEW_ADAPTERS[type];
    if (!adapter) return [];
    state.preview.items[type] = this.sample(adapter.source(), count);
    return state.preview.items[type];
  },

  get(type) {
    const adapter = PREVIEW_ADAPTERS[type];
    if (!adapter) return [];
    if (state.preview.items[type].length === 0 && adapter.source().length > 0) {
      this.prime(type);
    }
    return state.preview.items[type];
  },

  render(type, targetGrid = null) {
    const adapter = PREVIEW_ADAPTERS[type];
    if (!adapter) return;
    const grid = targetGrid || document.getElementById(adapter.gridId);
    if (!grid) return;
    const previewData = this.get(type);
    if (previewData.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>${adapter.emptyText}</p></div>`;
      updateScrollButtons();
      return;
    }
    const loopData = previewData.length > 1 ? [...previewData, ...previewData, ...previewData] : previewData;
    grid.innerHTML = `
      <div class="panel-preview">
        <div class="panel-preview-viewport">
          <div class="panel-preview-track">
            ${loopData.map((item, index) => adapter.renderCard(item, index % previewData.length)).join('')}
          </div>
        </div>
      </div>`;
    setupPreviewScroll(adapter.sectionSelector, previewData.length);
    updateScrollButtons();
  },

  open(type, index) {
    const adapter = PREVIEW_ADAPTERS[type];
    const item = this.get(type)[index];
    if (!adapter || !item) return;
    state.preview.modalPaused = true;
    adapter.openDetail(item);
  }
};

function openResultCard(type, index) {
  const adapter = PREVIEW_ADAPTERS[type];
  const items = type === 'panel' ? state.panel.results : ENDLESS_DATA;
  const item = items[index];
  if (adapter && item) adapter.openDetail(item);
}

function bindDelegatedInteractions() {
  // Delegation also covers the footer, which is parsed after this script.
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-contributors-action]')?.dataset.contributorsAction;
    if (action === 'open') openContributors();
    if (action === 'close') document.getElementById('contributorsDialog')?.close();
    if (action === 'retry') loadContributors();
  });
  const contributorsDialog = document.getElementById('contributorsDialog');
  if (contributorsDialog) {
    let previousWidth = 0;
    new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === previousWidth) return;
      previousWidth = entry.contentRect.width;
      fitContributorNames();
    }).observe(contributorsDialog);
    document.fonts.ready.then(fitContributorNames);
    document.fonts.addEventListener('loadingdone', fitContributorNames);
  }
  contributorsDialog?.addEventListener('click', event => {
    const bounds = contributorsDialog.getBoundingClientRect();
    if (event.target === contributorsDialog && (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom)) contributorsDialog.close();
  });
  window.addEventListener('popstate', restoreSearchFromUrl);
  const layerSuggestionPanel = document.getElementById('layerSuggestionPanel');
  layerSuggestionPanel?.addEventListener('click', event => {
    const actionButton = event.target.closest('[data-layer-action]');
    const action = actionButton?.dataset.layerAction;
    if (action === 'back') return backToLayerRanges();
    if (action === 'manual-open') return openManualLayerEntry();
    if (action === 'manual-close') return closeManualLayerEntry();
    if (action === 'manual-submit') return submitManualLayerEntry();

    const layerButton = event.target.closest('[data-layer]');
    if (layerButton) selectSuggestedLayer(Number(layerButton.dataset.layer));

    const rangeButton = event.target.closest('[data-layer-range]');
    if (rangeButton) selectLayerRange(rangeButton.dataset.layerRange);
  });
  layerSuggestionPanel?.addEventListener('keydown', event => {
    if (!event.target.matches('.layer-manual-input')) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      submitManualLayerEntry();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeManualLayerEntry();
    }
  });
  layerSuggestionPanel?.addEventListener('input', event => {
    if (!event.target.matches('.layer-manual-input')) return;
    state.panel.manualLayerValue = event.target.value;
    clearManualLayerError(event.target);
  });
  layerSuggestionPanel?.addEventListener('pointermove', () => {
    layerSuggestionPanel.classList.remove('suppress-hover');
  });
  layerSuggestionPanel?.addEventListener('pointerleave', () => {
    layerSuggestionPanel.classList.remove('suppress-hover');
  });

  document.getElementById('dynamicFilterPanel')?.addEventListener('click', event => {
    const button = event.target.closest('.dynamic-chip[data-side][data-type][data-value]');
    if (button) toggleDynamicFilter(button.dataset.side, button.dataset.type, button.dataset.value);
  });

  document.getElementById('endlessAdvancedFilterPanel')?.addEventListener('click', event => {
    const button = event.target.closest('.dynamic-chip[data-endless-card]');
    if (button) toggleEndlessCardFilter(button.dataset.endlessCard);
  });

  document.getElementById('endlessSelector')?.addEventListener('click', event => {
    const characterButton = event.target.closest('[data-endless-character]');
    if (characterButton) return selectEndlessCharacter(characterButton.dataset.endlessCharacter);

    const partnerButton = event.target.closest('[data-endless-partner]');
    if (partnerButton) selectEndlessPartner(partnerButton.dataset.endlessPartner);
  });

  const handleResultActivation = event => {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('a, button')) return;
    const card = event.target.closest('[data-result-type][data-result-index]');
    if (!card || !event.currentTarget.contains(card)) return;
    if (event.type === 'keydown') event.preventDefault();
    openResultCard(card.dataset.resultType, Number(card.dataset.resultIndex));
  };

  ['panelResultsView', 'endlessResultsView'].forEach(id => {
    const view = document.getElementById(id);
    view?.addEventListener('click', handleResultActivation);
    view?.addEventListener('keydown', handleResultActivation);
  });
}

function hasPanelFilters() {
  return Boolean(
    state.panel.orbit ||
    state.panel.rangeKey ||
    state.panel.videoOnly ||
    state.panel.layerFilters.upper.length > 0 ||
    state.panel.layerFilters.lower.length > 0
  );
}

function panelCardMarkup(d, { resultIndex = null, previewType = '', previewIndex = null } = {}) {
  const folderItem = panelFolderItem(d);
  const orbit = escapeHtml(d.orbit);
  const orbitLabel = escapeHtml(ORBIT_LABEL[d.orbit] || d.orbit);
  const previewAttrs = previewType ? ` data-preview-type="${previewType}" data-preview-index="${previewIndex}"` : '';
  const resultAttrs = Number.isInteger(resultIndex)
    ? ` data-result-type="panel" data-result-index="${resultIndex}" role="button" tabindex="0"`
    : '';
  return `
    <div class="panel-card${viewedCardClass(folderItem)}" data-view-key="${escapeHtml(encodedItemKey(folderItem))}" data-orbit="${orbit}"${previewAttrs}${resultAttrs}>
      ${viewedCardMarkup(folderItem)}
      <div class="card-orbit-bar">
        <div class="card-labels panel-card-title">
          <span class="orbit-badge" data-orbit="${orbit}">${orbitLabel}</span>
          <span class="layer-num">${escapeHtml(String(d.layer))} 層</span>
        </div>
      </div>
      <div class="layer-section">
        ${cardLayerBlock(d.upperCard, d.upperPartner, d.upperDir, '▲ 上層')}
        ${cardLayerBlock(d.lowerCard, d.lowerPartner, d.lowerDir, '▼ 下層')}
      </div>
      <div class="card-footer">
        ${d.hasVideo ? videoBadgeMarkup() : '<span></span>'}
        <span class="link-hint">點擊查看紀錄 →</span>
      </div>
    </div>`;
}

function stopPreviewAutoScroll() {
  if (!state.preview.autoFrame) return;
  window.cancelAnimationFrame(state.preview.autoFrame);
  state.preview.autoFrame = null;
}

function setupPreviewScroll(selector, itemCount) {
  const viewport = document.querySelector(selector);
  if (!viewport) return;
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;
  let isMouseDragging = false;
  let isAutoPaused = false;
  let resumeAutoTimer = null;
  let moved = false;
  let pressedPreviewCard = null;
  let wrapping = false;

  stopPreviewAutoScroll();

  const pauseAutoScroll = () => {
    isAutoPaused = true;
    window.clearTimeout(resumeAutoTimer);
  };

  const resumeAutoScroll = (delay = 700) => {
    window.clearTimeout(resumeAutoTimer);
    resumeAutoTimer = window.setTimeout(() => {
      isAutoPaused = false;
      state.preview.lastTime = performance.now();
    }, delay);
  };

  const getLoopWidth = () => viewport.scrollWidth / 3;

  const wrapScrollPosition = () => {
    if (wrapping || itemCount <= 1) return;
    const loopWidth = getLoopWidth();
    if (!loopWidth) return;
    wrapping = true;
    if (viewport.scrollLeft < loopWidth * 0.5) {
      viewport.scrollLeft += loopWidth;
    } else if (viewport.scrollLeft > loopWidth * 1.5) {
      viewport.scrollLeft -= loopWidth;
    }
    wrapping = false;
  };

  viewport.addEventListener('pointerdown', event => {
    pauseAutoScroll();
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    pressedPreviewCard = event.target.closest('[data-preview-type][data-preview-index]');
    if (event.pointerType !== 'mouse') return;
    isMouseDragging = true;
    startScrollLeft = viewport.scrollLeft;
    viewport.setPointerCapture(event.pointerId);
  });

  viewport.addEventListener('pointermove', event => {
    if (!isMouseDragging || event.pointerType !== 'mouse' || !viewport.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientX - startX;
    if (Math.abs(delta) > 4) moved = true;
    viewport.scrollLeft = startScrollLeft - delta;
    wrapScrollPosition();
  });

  viewport.addEventListener('pointerup', event => {
    const deltaX = Math.abs(event.clientX - startX);
    const deltaY = Math.abs(event.clientY - startY);
    if (!moved && deltaX < 8 && deltaY < 8 && pressedPreviewCard) {
      event.preventDefault();
      const idx = Number(pressedPreviewCard.dataset.previewIndex);
      previewModule.open(pressedPreviewCard.dataset.previewType, idx);
    }
    pressedPreviewCard = null;
    resumeAutoScroll();
    if (event.pointerType !== 'mouse') return;
    isMouseDragging = false;
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  });

  viewport.addEventListener('pointercancel', event => {
    pressedPreviewCard = null;
    resumeAutoScroll();
    if (event.pointerType !== 'mouse') return;
    isMouseDragging = false;
  });
  viewport.addEventListener('mouseenter', pauseAutoScroll);
  viewport.addEventListener('mouseleave', () => resumeAutoScroll());
  viewport.addEventListener('focusin', pauseAutoScroll);
  viewport.addEventListener('focusout', () => resumeAutoScroll());
  viewport.addEventListener('scroll', wrapScrollPosition, { passive: true });
  viewport.addEventListener('click', event => {
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
    moved = false;
  }, true);

  requestAnimationFrame(() => {
    if (itemCount <= 1) return;
    viewport.scrollLeft = getLoopWidth();
    state.preview.lastTime = performance.now();
    const autoScroll = time => {
      const elapsed = Math.min(time - state.preview.lastTime, 80);
      state.preview.lastTime = time;
      if (!document.hidden && !isAutoPaused && !state.preview.modalPaused) {
        viewport.scrollLeft += elapsed * PANEL_PREVIEW_SPEED;
        wrapScrollPosition();
      }
      state.preview.autoFrame = window.requestAnimationFrame(autoScroll);
    };
    state.preview.autoFrame = window.requestAnimationFrame(autoScroll);
  });
}

function cardLayerBlock(card, partner, dir, label) {
  if (card === 'N/A') return `<div class="layer-block layer-block-empty">
    <div class="layer-head">
      <div class="layer-label">${escapeHtml(label)}</div>
      <span class="dir-tag dir-placeholder" aria-hidden="true">順譜</span>
    </div>
    <div class="layer-data-grid layer-data-grid-empty">
      <div class="layer-data-cell layer-data-empty"><div class="na-text">單層面板</div></div>
    </div>
  </div>`;
  const safeDir = dir === '順' || dir === '逆' ? dir : '';
  const dirHtml = safeDir
    ? `<span class="dir-tag dir-${safeDir}">${safeDir}譜</span>`
    : '';
  return `<div class="layer-block">
    <div class="layer-head">
      <div class="layer-label">${escapeHtml(label)}</div>
      ${dirHtml}
    </div>
    <div class="layer-data-grid">
      <div class="layer-data-cell"><div class="card-name">${escapeHtml(card)}${rankIconMarkup(card)}</div></div>
      <div class="layer-data-cell"><div class="partner-name">${escapeHtml(partner)}</div></div>
    </div>
  </div>`;
}

function swapResultsGrid(view, infoId, gridId, gridClass, infoText, key, renderGrid) {
  if (!view) return;

  let info = view.querySelector(`#${infoId}`);
  if (!info) {
    info = document.createElement('div');
    info.className = 'results-info';
    info.id = infoId;
    view.prepend(info);
  }
  info.classList.remove('content-transition', 'is-fading');
  info.innerHTML = infoText;

  stopPreviewAutoScroll();
  fadeVersions[key] = (fadeVersions[key] || 0) + 1;
  const version = fadeVersions[key];

  // Replace the old result layer immediately so rapid range changes cannot
  // leave an old grid or count visible underneath the new one.
  const nextGrid = document.createElement('div');
  nextGrid.className = `${gridClass} content-transition is-fading`;
  nextGrid.id = gridId;
  const oldGrid = view.querySelector(`#${gridId}`);
  if (oldGrid) oldGrid.replaceWith(nextGrid);
  else view.append(nextGrid);

  renderGrid(nextGrid);
  window.requestAnimationFrame(() => {
    if (version === fadeVersions[key]) nextGrid.classList.remove('is-fading');
  });
  updateScrollButtons();
}

function renderCards() {
  syncSearchUrl('panel');
  const resultsView = document.getElementById('panelResultsView');
  const hasFilters = hasPanelFilters();
  const dataSnapshot = [...state.panel.results];
  const infoText = hasFilters
    ? `共找到 <span>${dataSnapshot.length}</span> 筆結果`
    : `目前收錄軌道資料 <span>${DATA.length}</span> 筆`;
  swapResultsGrid(resultsView, 'resultsInfo', 'cardsGrid', 'cards-grid', infoText, 'panel-results', grid => {
    if (!hasFilters) {
      previewModule.render('panel', grid);
      return;
    }
    stopPreviewAutoScroll();
    if (dataSnapshot.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div style="font-size:2rem;margin-bottom:0.5rem;opacity:0.3">✦</div><p>找不到符合條件的結果，期待您成為第一位分享者</p></div>`;
      return;
    }
    grid.innerHTML = dataSnapshot.map((d, i) => panelCardMarkup(d, { resultIndex: i })).join('');
  });
}

function videoBadgeMarkup() {
  return '<span class="video-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>附影片</span>';
}

function rankIconMarkup(card) {
  const text = String(card || '').trim();
  if (text === '無套裝') return '';
  const match = text.match(/^([0-3])階/);
  if (!match) return '';
  const rank = match[1];
  return `<img class="rank-icon" src="assets/ranks/R${rank}.png" alt="${rank}階" loading="lazy">`;
}

function companionIconMarkup(partner) {
  const text = String(partner || '').trim();
  if (!text) return '';
  const src = companionImagePath(text);
  return `<img class="companion-avatar" src="${src}" alt="" aria-hidden="true" loading="lazy" onerror="this.remove()">`;
}

function companionInlineMarkup(partner) {
  const text = String(partner || '').trim();
  if (!text) return '';
  return `<span class="companion-inline">${companionIconMarkup(text)}<span class="companion-name">${escapeHtml(text)}</span></span>`;
}

function modalLayerTitleMarkup(label) {
  return `<span class="modal-config-layer">${escapeHtml(label)}</span>`;
}

function modalDirBadgeMarkup(dir, hidden = false) {
  const hiddenAttr = hidden ? ' aria-hidden="true"' : '';
  const hiddenClass = hidden ? ' dir-placeholder' : '';
  if (dir === '順' || dir === '逆') {
    return `<span class="modal-config-dir dir-${dir}${hiddenClass}"${hiddenAttr}>${dir}譜</span>`;
  }
  return `<span class="modal-config-dir dir-na${hiddenClass}"${hiddenAttr}>—</span>`;
}

function modalConfigRow(label, card, partner, dir) {
  if (card === 'N/A') {
    const markerClass = label === '上層' ? 'is-upper' : 'is-lower';
    return `<div class="modal-config-section modal-config-section-empty">
      <span class="modal-config-marker ${markerClass}" aria-hidden="true"></span>
      <div class="modal-config-layer-row">
        ${modalLayerTitleMarkup(label)}
        ${modalDirBadgeMarkup('順', true)}
      </div>
      <div class="modal-config-fields modal-config-fields-empty">
        <div class="modal-config-field modal-config-field-empty">
          <div class="modal-config-main modal-config-muted">無此層配置</div>
        </div>
      </div>
    </div>`;
  }
  const markerClass = label === '上層' ? 'is-upper' : 'is-lower';
  return `<div class="modal-config-section">
    <span class="modal-config-marker ${markerClass}" aria-hidden="true"></span>
    <div class="modal-config-layer-row">
      ${modalLayerTitleMarkup(label)}
      ${modalDirBadgeMarkup(dir)}
    </div>
    <div class="modal-config-fields">
      <div class="modal-config-field">
        <div class="modal-config-label">日卡及階數</div>
        <div class="modal-config-main card-value"><span class="card-rank-text">${escapeHtml(card)}</span>${rankIconMarkup(card)}</div>
      </div>
      <div class="modal-config-field partner-field">
        <div class="modal-config-label">搭檔</div>
        <div class="modal-config-main partner-value">${companionInlineMarkup(partner)}</div>
      </div>
    </div>
  </div>`;
}

function modalConfigTable(d) {
  return `<div class="modal-config-detail">
    ${modalConfigRow('上層', d.upperCard, d.upperPartner, d.upperDir)}
    ${modalConfigRow('下層', d.lowerCard, d.lowerPartner, d.lowerDir)}
  </div>`;
}

function openPanelDetail(d, recordHistory = true) {
  const folderItem = panelFolderItem(d);
  const wasViewedBeforeOpen = isViewed(folderItem);
  if (recordHistory) addHistoryItem(folderItem);
  setModalViewed(wasViewedBeforeOpen);
  const modalEl = document.getElementById('modal');
  const upperBlock = document.getElementById('mUpperBlock');
  const lowerBlock = document.getElementById('mLowerBlock');
  modalEl.classList.add('panel-detail');
  modalEl.classList.remove('endless-detail');
  modalEl.dataset.orbit = d.orbit;

  document.getElementById('mOrbit').innerHTML = `<span class="orbit-badge" data-orbit="${escapeHtml(d.orbit)}">${escapeHtml(ORBIT_LABEL[d.orbit] || d.orbit)}</span>`;
  document.getElementById('mLayer').innerHTML = `<span class="modal-layer-num">${escapeHtml(String(d.layer))}</span><span class="modal-layer-unit">層</span>`;
  const orbitColors = {
    開放: 'var(--col-open)', 光: 'var(--col-light)', 冰: 'var(--col-ice)',
    火: 'var(--col-fire)', 能量: 'var(--col-energy)', 引力: 'var(--col-gravity)',
    波動: 'var(--col-wave)', 金屬: 'var(--col-metal)'
  };
  const orbitButtonColors = {
    開放: ['var(--col-open-bg)', 'var(--col-open-border)'],
    光: ['var(--col-light-bg)', 'var(--col-light-border)'],
    冰: ['var(--col-ice-bg)', 'var(--col-ice-border)'],
    火: ['var(--col-fire-bg)', 'var(--col-fire-border)'],
    能量: ['var(--col-energy-bg)', 'var(--col-energy-border)'],
    引力: ['var(--col-gravity-bg)', 'var(--col-gravity-border)'],
    波動: ['var(--col-wave-bg)', 'var(--col-wave-border)'],
    金屬: ['var(--col-metal-bg)', 'var(--col-metal-border)']
  };
  modalEl.style.setProperty('--modal-orbit-color', orbitColors[d.orbit] || 'var(--text)');
  const [orbitBg, orbitBorder] = orbitButtonColors[d.orbit] || ['rgba(89,132,164,0.68)', 'rgba(147,199,231,0.68)'];
  modalEl.style.setProperty('--modal-orbit-bg', orbitBg);
  modalEl.style.setProperty('--modal-orbit-bg-strong', orbitBg);
  modalEl.style.setProperty('--modal-orbit-border', orbitBorder);
  document.getElementById('mLayer').style.color = '';
  upperBlock.classList.add('modal-config-table-wrap');
  upperBlock.querySelector('.modal-block-title')?.remove();
  lowerBlock.querySelector('.modal-block-title')?.remove();
  lowerBlock.style.display = 'none';
  document.getElementById('mUpperContent').innerHTML = modalConfigTable(d);
  document.getElementById('mLowerContent').innerHTML = '';

  const orbitLabel = ORBIT_LABEL[d.orbit] || d.orbit;
  const reportUrl = `https://docs.google.com/forms/d/e/1FAIpQLSdu-eI87wlkR2LnTlwc3kzHD4pz_PL1-gydhwCr7W-7HKOxyg/viewform?usp=pp_url&entry.1527588954=${encodeURIComponent(orbitLabel)}&entry.1863774587=${encodeURIComponent(d.layer)}&entry.1242930374=${encodeURIComponent(d.link)}`;

  document.getElementById('mFooter').innerHTML = modalFooterActions(d.link, folderItem, reportUrl, d.hasVideo);

  document.getElementById('modalOverlay').classList.add('show');
}

function restartActivePreview(tab) {
  if (tab === 'panel' && !hasPanelFilters()) {
    setupPreviewScroll(PREVIEW_ADAPTERS.panel.sectionSelector, previewModule.get('panel').length);
  } else if (tab === 'endless' && !state.endless.character && !state.endless.partner) {
    setupPreviewScroll(PREVIEW_ADAPTERS.endless.sectionSelector, previewModule.get('endless').length);
  } else {
    stopPreviewAutoScroll();
  }
}

function updatePrimaryTabSlider() {
  const nav = document.querySelector('.tab-nav');
  const activeBtn = nav?.querySelector('.tab-btn.active');
  if (!nav || !activeBtn) return;

  const navRect = nav.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();
  const left = btnRect.left - navRect.left;
  const width = btnRect.width;

  nav.style.setProperty('--tab-slider-x', `${left}px`);
  nav.style.setProperty('--tab-slider-w', `${width}px`);
}

function switchTab(tab, btn) {
  if (appLoading) return;
  const nextSection = document.getElementById('section-' + tab);
  const currentSection = document.querySelector('.section.active');
  if (!nextSection || currentSection === nextSection) return;
  if (tabFadeTimer) window.clearTimeout(tabFadeTimer);

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelector('.tab-nav')?.setAttribute('data-active', tab);
  syncSearchUrl(tab);
  updatePrimaryTabSlider();

  if (currentSection) {
    currentSection.classList.add('content-transition', 'is-fading');
  }
  tabFadeTimer = window.setTimeout(() => {
    document.querySelectorAll('.section').forEach(s => {
      s.classList.remove('active', 'is-fading');
    });
    nextSection.classList.add('active', 'content-transition', 'is-fading');
    window.requestAnimationFrame(() => {
      nextSection.classList.remove('is-fading');
      restartActivePreview(tab);
      updateScrollButtons();
    });
    tabFadeTimer = null;
  }, CONTENT_FADE_MS);
}

function getEndlessCharacter(name = state.endless.character) {
  return ENDLESS_CHARACTER_CATALOG.find(character => character.visible && character.name === name) || null;
}

function renderEndlessSelector() {
  const characterGrid = document.getElementById('endlessCharacterGrid');
  const partnerGrid = document.getElementById('endlessPartnerGrid');
  const placeholder = document.getElementById('endlessPartnerPlaceholder');
  if (!characterGrid || !partnerGrid || !placeholder) return;

  characterGrid.innerHTML = ENDLESS_CHARACTER_CATALOG
    .filter(character => character.visible)
    .sort((a, b) => a.order - b.order)
    .map(character => `
      <button class="endless-character-button ui-pill ui-pill--primary"
        data-endless-character="${escapeHtml(character.name)}"
        data-theme="${escapeHtml(character.theme)}"
        aria-pressed="${state.endless.character === character.name}">
        ${escapeHtml(character.name)}
      </button>
    `).join('');

  const selectedCharacter = getEndlessCharacter();
  placeholder.hidden = Boolean(selectedCharacter);
  partnerGrid.classList.toggle('show', Boolean(selectedCharacter));
  partnerGrid.innerHTML = selectedCharacter
    ? selectedCharacter.partners.map(partner => `
        <button class="endless-partner-button"
          data-endless-partner="${escapeHtml(partner)}"
          data-theme="${escapeHtml(selectedCharacter.theme)}"
          aria-pressed="${state.endless.partner === partner}">
          <img src="${companionImagePath(partner)}" alt="" loading="lazy">
          <span>${escapeHtml(partner)}</span>
        </button>
      `).join('')
    : '';
}

function selectEndlessCharacter(characterName) {
  if (appLoading) return;
  const character = getEndlessCharacter(characterName);
  if (!character) return;
  state.endless.character = character.name;
  state.endless.partner = null;
  clearEndlessAdvancedState();
  renderEndlessSelector();
  applyEndlessFilters();
}

function selectEndlessPartner(partner) {
  if (appLoading) return;
  const character = getEndlessCharacter();
  if (!character?.partners.includes(partner)) return;
  state.endless.partner = state.endless.partner === partner ? null : partner;
  clearEndlessAdvancedState();
  renderEndlessSelector();
  applyEndlessFilters();
}

function collectEndlessCardOptions(data) {
  const cardMap = new Map();
  data.forEach(d => addOption(cardMap, 'card', d.card));
  return sortCardsBySetAndRank([...cardMap.values()]);
}

function getEndlessAdvancedBaseData() {
  const selectedCharacter = getEndlessCharacter();
  return ENDLESS_ALL.filter(d => {
    if (selectedCharacter && !selectedCharacter.partners.includes(d.partner)) return false;
    if (state.endless.partner && d.partner !== state.endless.partner) return false;
    return true;
  });
}

function canUseEndlessAdvancedFilters(baseData = getEndlessAdvancedBaseData()) {
  return Boolean(state.endless.partner) && (baseData.length > 1 || state.endless.videoOnly || Boolean(state.endless.card));
}

function hasEndlessAdvancedState() {
  return state.endless.advancedFilterOpen || state.endless.videoOnly || Boolean(state.endless.card);
}

function renderEndlessDynamicFilters(baseData, shouldShow = canUseEndlessAdvancedFilters()) {
  const panel = document.getElementById('endlessAdvancedFilterPanel');
  const controls = document.getElementById('endlessResultsControls');
  const toggle = document.getElementById('endlessAdvancedFilterToggle');
  const chevron = document.getElementById('endlessAdvancedFilterChevron');
  const chips = document.getElementById('endlessCardChips');
  const noMatch = document.getElementById('endlessDynamicNoMatch');
  if (!panel || !toggle || !chips) return;
  if (controls) {
    controls.hidden = false;
    controls.classList.toggle('is-placeholder', !shouldShow);
    controls.setAttribute('aria-hidden', String(!shouldShow));
  }
  toggle.hidden = false;
  toggle.disabled = !shouldShow;
  toggle.setAttribute('aria-expanded', String(shouldShow && state.endless.advancedFilterOpen));
  panel.hidden = !shouldShow || !state.endless.advancedFilterOpen;
  if (chevron) chevron.textContent = state.endless.advancedFilterOpen ? '⌃' : '⌄';
  if (!shouldShow) {
    if (noMatch) noMatch.classList.remove('show');
    return;
  }

  const options = collectEndlessCardOptions(baseData);
  if (state.endless.card && !options.some(option => option.value === state.endless.card)) {
    options.push({ value: state.endless.card, label: state.endless.card });
  }
  if (options.length === 0) {
    chips.innerHTML = '<span class="dynamic-empty">目前無可用日卡</span>';
    return;
  }
  chips.innerHTML = options.map(option => `
    <button class="dynamic-chip ui-pill ui-pill--filter"
      data-value="${escapeHtml(option.value)}"
      data-endless-card="${escapeHtml(option.value)}"
      aria-pressed="${state.endless.card === option.value}">
      ${escapeHtml(option.label)}
    </button>
  `).join('');
}

function toggleEndlessAdvancedFilters() {
  if (appLoading || !canUseEndlessAdvancedFilters()) return;
  state.endless.advancedFilterOpen = !state.endless.advancedFilterOpen;
  applyEndlessFilters();
}

function toggleEndlessCardFilter(value) {
  if (appLoading) return;
  state.endless.card = state.endless.card === value ? null : value;
  applyEndlessFilters();
}

function resetEndlessAdvancedFilters() {
  if (appLoading) return;
  clearEndlessAdvancedState({ collapse: false });
  applyEndlessFilters();
}

function applyEndlessFilters() {
  if (appLoading) return;
  const advancedBaseData = getEndlessAdvancedBaseData();
  const shouldShowAdvanced = canUseEndlessAdvancedFilters(advancedBaseData);
  if (!shouldShowAdvanced && hasEndlessAdvancedState()) clearEndlessAdvancedState();
  const baseData = state.endless.videoOnly
    ? advancedBaseData.filter(d => d.hasVideo)
    : advancedBaseData;
  renderEndlessDynamicFilters(baseData, shouldShowAdvanced);
  ENDLESS_DATA = baseData.filter(d => !state.endless.card || d.card === state.endless.card);
  const noMatch = document.getElementById('endlessDynamicNoMatch');
  if (noMatch) noMatch.classList.toggle('show', Boolean(state.endless.card) && ENDLESS_DATA.length === 0);
  renderEndless();
}

function resetEndlessFilters() {
  if (appLoading) return;
  resetEndlessFilterState();
  renderEndlessSelector();
  applyEndlessFilters();
}

function fmtScore(s) {
  const n = parseInt(String(s).replace(/,/g, ''), 10);
  if (isNaN(n)) return s;
  return n.toLocaleString();
}

function endlessCardMarkup(d, { resultIndex = null, previewType = '', previewIndex = null } = {}) {
  const folderItem = endlessFolderItem(d);
  const partner = escapeHtml(d.partner);
  const theme = escapeHtml(companionTheme(d.partner));
  const card = `${escapeHtml(d.card)}${rankIconMarkup(d.card)}`;
  const combo = escapeHtml(d.combo);
  const previewAttrs = previewType ? ` data-preview-type="${previewType}" data-preview-index="${previewIndex}"` : '';
  const resultAttrs = Number.isInteger(resultIndex)
    ? ` data-result-type="endless" data-result-index="${resultIndex}" role="button" tabindex="0"`
    : '';
  return `
    <div class="endless-card${viewedCardClass(folderItem)}" data-view-key="${escapeHtml(encodedItemKey(folderItem))}" data-partner="${partner}" data-theme="${theme}"${previewAttrs}${resultAttrs}>
      ${viewedCardMarkup(folderItem)}
      <div class="endless-card-header">
        <div class="card-labels">
          <span class="partner-badge" data-partner="${partner}" data-theme="${theme}">${partner}</span>
        </div>
        <div class="card-meta-right">
          <span class="endless-score">${escapeHtml(fmtScore(d.score))} 分</span>
        </div>
      </div>
      <div class="endless-info-row">
        <span class="endless-info-label">日卡</span>
        <span class="endless-info-val">${card}</span>
      </div>
      <div class="endless-info-row">
        <span class="endless-info-label">對譜數</span>
        <span class="combo-tag">${combo} 譜</span>
      </div>
      <div class="endless-footer">
        ${d.hasVideo ? videoBadgeMarkup() : '<span></span>'}
        <span class="link-hint">點擊查看紀錄 →</span>
      </div>
    </div>`;
}

function renderEndless() {
  syncSearchUrl('endless');
  const resultsView = document.getElementById('endlessResultsView');
  const hasFixedResults = Boolean(state.endless.character || state.endless.partner);
  const dataSnapshot = [...ENDLESS_DATA];
  const infoText = hasFixedResults
    ? `共找到 <span>${dataSnapshot.length}</span> 筆結果`
    : `目前收錄無盡挑戰資料 <span>${ENDLESS_ALL.length}</span> 筆`;
  swapResultsGrid(resultsView, 'endlessInfo', 'endlessGrid', 'endless-grid', infoText, 'endless-results', grid => {
    if (!hasFixedResults) {
      previewModule.render('endless', grid);
      return;
    }
    stopPreviewAutoScroll();
    if (dataSnapshot.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div style="font-size:2rem;margin-bottom:0.5rem;opacity:0.3">✦</div><p>找不到符合條件的結果，期待您成為第一位分享者</p></div>`;
      return;
    }
    grid.innerHTML = dataSnapshot.map((d, i) => endlessCardMarkup(d, { resultIndex: i })).join('');
  });
}

function openEndlessDetail(d, recordHistory = true) {
  const folderItem = endlessFolderItem(d);
  const wasViewedBeforeOpen = isViewed(folderItem);
  if (recordHistory) addHistoryItem(folderItem);
  setModalViewed(wasViewedBeforeOpen);
  const modalEl = document.getElementById('modal');
  modalEl.classList.remove('panel-detail');
  modalEl.classList.add('endless-detail');
  modalEl.removeAttribute('data-orbit');
  modalEl.style.removeProperty('--modal-orbit-color');
  modalEl.style.removeProperty('--modal-orbit-bg');
  modalEl.style.removeProperty('--modal-orbit-bg-strong');
  modalEl.style.removeProperty('--modal-orbit-border');
  modalEl.style.removeProperty('--modal-orbit-button-text');
  document.getElementById('mUpperBlock').classList.remove('modal-config-table-wrap');
  // remove block titles for endless (no upper/lower layers)
  document.getElementById('mUpperBlock').querySelector('.modal-block-title') && document.getElementById('mUpperBlock').querySelector('.modal-block-title').remove();
  document.getElementById('mLowerBlock').querySelector('.modal-block-title') && document.getElementById('mLowerBlock').querySelector('.modal-block-title').remove();

  document.getElementById('mOrbit').innerHTML = `<span class="partner-badge" data-partner="${escapeHtml(d.partner)}" data-theme="${escapeHtml(companionTheme(d.partner))}">${companionInlineMarkup(d.partner)}</span>`;
  document.getElementById('mLayer').textContent = fmtScore(d.score) + ' 分';
  document.getElementById('mLayer').style.color = 'var(--text)';
  document.getElementById('mUpperContent').innerHTML = `
    <div class="modal-row"><span class="modal-label">日卡</span><span class="modal-val">${escapeHtml(d.card)}${rankIconMarkup(d.card)}</span></div>
    <div class="modal-row"><span class="modal-label">對譜數</span><span class="modal-val">${escapeHtml(d.combo)} 譜</span></div>`;
  document.getElementById('mLowerBlock').style.display = 'none';

  const reportUrl = `https://docs.google.com/forms/d/e/1FAIpQLSdP6bWGJ6GFkyOZ7dWsqDbiup7KzTyJGxw9Feta-EqCS3pG6w/viewform?usp=pp_url&entry.1527588954=${encodeURIComponent(d.partner)}&entry.1242930374=${encodeURIComponent(d.link)}`;

  document.getElementById('mFooter').innerHTML = modalFooterActions(d.link, folderItem, reportUrl, d.hasVideo);
  document.getElementById('modalOverlay').classList.add('show');
}

function closeModal(e) { if (e.target === document.getElementById('modalOverlay')) closeModalDirect(); }
function closeModalDirect() {
  document.getElementById('modalOverlay').classList.remove('show');
  const modalEl = document.getElementById('modal');
  modalEl.classList.remove('panel-detail', 'endless-detail');
  modalEl.removeAttribute('data-orbit');
  modalEl.style.removeProperty('--modal-orbit-color');
  modalEl.style.removeProperty('--modal-orbit-bg');
  modalEl.style.removeProperty('--modal-orbit-bg-strong');
  modalEl.style.removeProperty('--modal-orbit-border');
  modalEl.style.removeProperty('--modal-orbit-button-text');
  state.preview.modalPaused = false;
  state.preview.lastTime = performance.now();
  setModalViewed(false);
  document.getElementById('mUpperBlock').classList.remove('modal-config-table-wrap');
  document.getElementById('mLowerBlock').style.display = '';
}
document.addEventListener('keydown', e => {
  if (document.getElementById('contributorsDialog')?.open) return; // Native dialog handles Escape and focus.
  if (e.key === 'Escape') {
    closeModalDirect();
    closeInfoModalDirect();
  }
});

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function scrollToBottom() {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
}

function updateScrollButtons() {
  const topBtn = document.getElementById('backToTopBtn');
  const bottomBtn = document.getElementById('backToBottomBtn');
  if (!topBtn || !bottomBtn) return;
  const viewportH = window.innerHeight;
  const fullH = document.documentElement.scrollHeight;
  const maxScroll = fullH - viewportH;

  // top botton and bottom botton setting
  if (maxScroll <= 0) {
    topBtn.classList.remove('show');
    bottomBtn.classList.remove('show');
    return;
  }

  const scrollY = window.scrollY;
  const showTopBtnAfter = 500;
  topBtn.classList.toggle('show', scrollY > showTopBtnAfter);
  bottomBtn.classList.toggle('show', (maxScroll - scrollY) > 10);
}

window.addEventListener('scroll', updateScrollButtons);
window.addEventListener('resize', () => {
  updateScrollButtons();
  updatePrimaryTabSlider();
});
if (document.fonts?.ready) {
  document.fonts.ready.then(updatePrimaryTabSlider).catch(() => {});
}

bindDelegatedInteractions();
init();
updateScrollButtons();
