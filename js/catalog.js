// Central catalog for display order, availability and data sorting.
// Keep identity and ordering here; visual styling belongs in styles.css.
// `order` is a display priority, not a level. Gaps of 10 leave room for future items (for example, 35 between 30 and 40).
// Five-star companion `order` follows release order. Four-star companions are sorted automatically by name.
// Each character and their matching directional Orbit share one release flag.
const CHARACTER_RELEASES = {
  '沈星回': true,
  '黎深': true,
  '祁煜': true,
  '秦徹': true,
  '夏以晝': true,
  '敖尹': true
};

const ORBIT_CATALOG = [
  { key: '開放', label: '開放穩定', group: 'open', order: 10, maxLevel: 300, visible: true },
  { key: '波動', label: '開放波動', group: 'open', order: 20, maxLevel: 60, visible: true },
  { key: '光', label: '光', group: 'directional', order: 30, maxLevel: 210, visible: CHARACTER_RELEASES['沈星回'] },
  { key: '冰', label: '冰', group: 'directional', order: 40, maxLevel: 210, visible: CHARACTER_RELEASES['黎深'] },
  { key: '火', label: '火', group: 'directional', order: 50, maxLevel: 240, visible: CHARACTER_RELEASES['祁煜'] },
  { key: '能量', label: '能量', group: 'directional', order: 60, maxLevel: 180, visible: CHARACTER_RELEASES['秦徹'] },
  { key: '引力', label: '引力', group: 'directional', order: 70, maxLevel: 180, visible: CHARACTER_RELEASES['夏以晝'] },
  { key: '金屬', label: '金屬', group: 'directional', order: 80, maxLevel: 120, visible: CHARACTER_RELEASES['敖尹'] }
];

const CHARACTER_CATALOG = [
  {
    name: '沈星回', theme: '光', order: 10, visible: CHARACTER_RELEASES['沈星回'],
    companions: [
      { name: '逐光騎士', rarity: 5, order: 10 },
      { name: '光獵', rarity: 5, order: 20 },
      { name: '暗蝕國王', rarity: 5, order: 30 },
      { name: 'Evol特警', rarity: 4 },
      { name: '深空獵人', rarity: 4 },
      { name: '遙遠少年', rarity: 4 }
    ]
  },
  {
    name: '黎深', theme: '冰', order: 20, visible: CHARACTER_RELEASES['黎深'],
    companions: [
      { name: '永恆先知', rarity: 5, order: 10 },
      { name: '九黎司命', rarity: 5, order: 20 },
      { name: '終末之神', rarity: 5, order: 30 },
      { name: '極地軍醫', rarity: 4 },
      { name: '黎明抹殺者', rarity: 4 },
      { name: '臨空醫生', rarity: 4 }
    ]
  },
  {
    name: '祁煜', theme: '火', order: 30, visible: CHARACTER_RELEASES['祁煜'],
    companions: [
      { name: '深海潛行者', rarity: 5, order: 10 },
      { name: '潮汐之神', rarity: 5, order: 20 },
      { name: '利莫里亞海神', rarity: 5, order: 30 },
      { name: '赤霄武神', rarity: 5, order: 40 },
      { name: '海妖魅影', rarity: 4 },
      { name: '畫壇新銳', rarity: 4 },
      { name: '藝術家', rarity: 4 }
    ]
  },
  {
    name: '秦徹', theme: '能量', order: 40, visible: CHARACTER_RELEASES['秦徹'],
    companions: [
      { name: '無盡掠奪者', rarity: 5, order: 10 },
      { name: '深淵主宰', rarity: 5, order: 20 },
      { name: '銀翼惡魔', rarity: 5, order: 30 },
      { name: '異界來客', rarity: 4 }
    ]
  },
  {
    name: '夏以晝', theme: '引力', order: 50, visible: CHARACTER_RELEASES['夏以晝'],
    companions: [
      { name: '遠空執艦官', rarity: 5, order: 10 },
      { name: '終極兵器X-02', rarity: 5, order: 20 },
      { name: '冥羅之主', rarity: 5, order: 30 },
      { name: '深空飛行員', rarity: 4 }
    ]
  },
  {
    name: '敖尹', theme: '金屬', order: 60, visible: CHARACTER_RELEASES['敖尹'],
    companions: [
      { name: '夜行狼王', rarity: 5, order: 10 },
      { name: '刃影', rarity: 4 }
    ]
  }
];

const companionStrokeSort = new Intl.Collator('zh-Hant-u-co-stroke', { numeric: true });

function sortCatalogCompanions(companions) {
  return [...companions].sort((a, b) => {
    if (a.rarity !== b.rarity) return b.rarity - a.rarity;
    if (a.rarity === 5) {
      const orderDiff = (Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER)
        - (Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER);
      if (orderDiff !== 0) return orderDiff;
    }
    const firstIsEnglish = /^[A-Za-z]/.test(a.name);
    const secondIsEnglish = /^[A-Za-z]/.test(b.name);
    if (firstIsEnglish !== secondIsEnglish) return firstIsEnglish ? -1 : 1;
    return companionStrokeSort.compare(a.name, b.name);
  });
}

const ENDLESS_CHARACTER_CATALOG = CHARACTER_CATALOG.map(character => ({
  name: character.name,
  theme: character.theme,
  order: character.order,
  visible: character.visible,
  partners: sortCatalogCompanions(character.companions)
    .filter(companion => companion.rarity === 5)
    .map(companion => companion.name)
}));

const FILTER_CATEGORY_ORDER = ['dir', 'card', 'partner'];
const STELLA_ORDER = ['順', '逆'];

const ORBIT_LABEL = Object.fromEntries(ORBIT_CATALOG.map(orbit => [orbit.key, orbit.label]));
const LIMITS = Object.fromEntries(ORBIT_CATALOG.map(orbit => [orbit.key, orbit.maxLevel]));
const ORBIT_ORDER = new Map(ORBIT_CATALOG.map(orbit => [orbit.key, orbit.order]));

const COMPANION_CATALOG = new Map();
CHARACTER_CATALOG.forEach(character => {
  sortCatalogCompanions(character.companions).forEach((companion, partnerIndex) => {
    COMPANION_CATALOG.set(companion.name, {
      ...companion,
      character: character.name,
      characterOrder: character.order,
      partnerOrder: partnerIndex,
      theme: character.theme,
      image: `assets/companions/${encodeURIComponent(companion.name)}.png`
    });
  });
});

function compareCatalogNumber(a, b, fallback = Number.MAX_SAFE_INTEGER) {
  return (Number.isFinite(a) ? a : fallback) - (Number.isFinite(b) ? b : fallback);
}

function compareOrbitKeys(a, b) {
  return compareCatalogNumber(ORBIT_ORDER.get(a), ORBIT_ORDER.get(b))
    || String(a).localeCompare(String(b), 'zh-Hant');
}

function compareCompanionNames(a, b) {
  const first = COMPANION_CATALOG.get(a);
  const second = COMPANION_CATALOG.get(b);
  return compareCatalogNumber(first?.characterOrder, second?.characterOrder)
    || compareCatalogNumber(first?.partnerOrder, second?.partnerOrder)
    || String(a).localeCompare(String(b), 'zh-Hant');
}

function companionTheme(name) {
  return COMPANION_CATALOG.get(name)?.theme || '';
}

function companionImagePath(name) {
  const text = String(name || '').trim();
  return COMPANION_CATALOG.get(text)?.image || `assets/companions/${encodeURIComponent(text)}.png`;
}

function cardRankOrder(value) {
  const text = String(value || '').trim();
  if (text === '無套裝') return -1;
  const match = text.match(/^(\d+)\s*階/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function cardSetNameForSort(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\d+\s*階\s*(.+)$/);
  return match ? match[1].trim() : text;
}

function compareCards(a, b) {
  const rankDiff = cardRankOrder(a) - cardRankOrder(b);
  if (rankDiff !== 0) return rankDiff;
  return cardSetNameForSort(a).localeCompare(cardSetNameForSort(b), 'zh-Hant')
    || String(a).localeCompare(String(b), 'zh-Hant');
}

function compareStella(a, b) {
  const first = STELLA_ORDER.indexOf(String(a || '').slice(0, 1));
  const second = STELLA_ORDER.indexOf(String(b || '').slice(0, 1));
  return compareCatalogNumber(first < 0 ? undefined : first, second < 0 ? undefined : second)
    || String(a).localeCompare(String(b), 'zh-Hant');
}

function compareBooleanPreferred(a, b) {
  return Number(Boolean(b)) - Number(Boolean(a));
}

function comparePanelRows(a, b) {
  return compareOrbitKeys(a.orbit, b.orbit)
    || compareCatalogNumber(a.layer, b.layer)
    || compareCompanionNames(a.upperPartner, b.upperPartner)
    || compareCards(a.upperCard, b.upperCard)
    || compareStella(a.upperDir, b.upperDir)
    || compareCompanionNames(a.lowerPartner, b.lowerPartner)
    || compareCards(a.lowerCard, b.lowerCard)
    || compareStella(a.lowerDir, b.lowerDir)
    || compareBooleanPreferred(a.hasVideo, b.hasVideo);
}

function compareEndlessRows(a, b) {
  const first = COMPANION_CATALOG.get(a.partner);
  const second = COMPANION_CATALOG.get(b.partner);
  const firstScore = Number(String(a.score || '').replace(/,/g, ''));
  const secondScore = Number(String(b.score || '').replace(/,/g, ''));
  return compareCatalogNumber(first?.characterOrder, second?.characterOrder)
    || compareCatalogNumber(first?.partnerOrder, second?.partnerOrder)
    || compareCatalogNumber(Number(a.combo), Number(b.combo))
    || compareCards(a.card, b.card)
    || compareCatalogNumber(firstScore, secondScore)
    || compareBooleanPreferred(a.hasVideo, b.hasVideo);
}

function stableCatalogSort(rows, compare) {
  return rows
    .map((row, sourceIndex) => ({ row, sourceIndex }))
    .sort((a, b) => compare(a.row, b.row) || a.sourceIndex - b.sourceIndex)
    .map(item => item.row);
}
