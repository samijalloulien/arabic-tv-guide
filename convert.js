'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// CONFIG
// ============================================================================
const guidesDir = path.join(__dirname, 'guides');
const apiDir = path.join(__dirname, 'api');
const programsDir = path.join(apiDir, 'programs');
const cacheFile = path.join(__dirname, 'metadata_cache.json');

const SCHEMA_VERSION = 3;
const CACHE_VERSION = 6;
// Bumped whenever the shape/fetch strategy of a cache entry changes. Entries
// with an older `fv` are refreshed in place (by TMDB id, no re-search needed).
const ENTRY_FORMAT = 10;

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const PRETTY = process.env.PRETTY === '1';
const OFFLINE = process.env.OFFLINE === '1' || process.argv.includes('--offline');
const MAX_REFRESH_PER_RUN = parseInt(process.env.MAX_REFRESH || '1500', 10);

const MIN_VOTES_FOR_RATING = 10;
const MIN_VOTES_FOR_FEATURED = 30;
const HERO_COUNT = 15;
const NOW_AND_NEXT_COUNT = 4; // current + next 3
const PRIME_TIME_FIRST_HOUR = 19; // channel-local, inclusive
const PRIME_WINDOW_HOURS = 36;

const CHANNEL_CATEGORIES = ['movies', 'drama', 'sports', 'news', 'kids', 'documentary', 'general'];

// ============================================================================
// STATIC DATA
// ============================================================================
const COUNTRY_NAMES_AR = {
  AE: 'الإمارات', SA: 'السعودية', EG: 'مصر', QA: 'قطر', MA: 'المغرب',
  TN: 'تونس', DZ: 'الجزائر', LB: 'لبنان', JO: 'الأردن', KW: 'الكويت',
  BH: 'البحرين', OM: 'سلطنة عمان', IQ: 'العراق', SY: 'سوريا', PS: 'فلسطين',
  US: 'الولايات المتحدة', GB: 'المملكة المتحدة', CA: 'كندا', FR: 'فرنسا',
  DE: 'ألمانيا', IT: 'إيطاليا', ES: 'إسبانيا', IN: 'الهند', TR: 'تركيا',
  KR: 'كوريا الجنوبية', JP: 'اليابان', AU: 'أستراليا', RU: 'روسيا',
  Q79: 'مصر', Q851: 'السعودية', Q817: 'الكويت', Q878: 'الإمارات',
  Q858: 'سوريا', Q822: 'لبنان', Q810: 'الأردن', Q1028: 'المغرب',
  Q948: 'تونس', Q262: 'الجزائر', Q796: 'العراق', Q842: 'سلطنة عمان',
  Q30: 'الولايات المتحدة', Q145: 'المملكة المتحدة', Q16: 'كندا',
  Q142: 'فرنسا', Q668: 'الهند', Q43: 'تركيا', Q884: 'كوريا الجنوبية', Q17: 'اليابان'
};

const LANG_NAMES_AR = {
  ar: 'العربية', en: 'الإنجليزية', fr: 'الفرنسية', tr: 'التركية',
  hi: 'الهندية', ko: 'الكورية', ja: 'اليابانية', es: 'الإسبانية',
  de: 'الألمانية', it: 'الإيطالية', ru: 'الروسية', pt: 'البرتغالية'
};

const BLOCKED_WIKIDATA_TYPES = new Set([
  'Q5', 'Q515', 'Q6256', 'Q4167410', 'Q13442814', 'Q482994', 'Q7366'
]);

const ALLOWED_WIKIDATA_TYPES = new Set([
  'Q11424', 'Q5398426', 'Q581714', 'Q202866', 'Q15416',
  'Q1259759', 'Q24856', 'Q21191270', 'Q506240'
]);

// Static UTC offsets (hours) for "prime time" evaluation. Approximate by design.
const COUNTRY_UTC_OFFSET = {
  ae: 4, om: 4, sa: 3, qa: 3, kw: 3, bh: 3, iq: 3, jo: 3, sy: 3, ye: 3,
  eg: 2, lb: 2, ps: 2, sd: 2, ly: 2, ma: 1, dz: 1, tn: 1
};

// Tiered ordering for channels.json. `en`/`ar` become the display names unless
// `multi` is set (several feeds share the rule, e.g. beIN Sports 1..N).
const CHANNEL_RULES = [
  // Tier 1: flagship entertainment & movies
  { category: 'general', tier: 1, en: 'MBC 1', ar: 'إم بي سي 1', id: /^MBC1\./i },
  { category: 'movies', tier: 1, en: 'MBC 2', ar: 'إم بي سي 2', id: /^MBC2\./i },
  { category: 'general', tier: 1, en: 'MBC Masr', ar: 'إم بي سي مصر', id: /^MBCMasr\./i },
  { category: 'general', tier: 1, en: 'MBC Masr 2', ar: 'إم بي سي مصر 2', id: /^MBCMasr2\./i },
  { category: 'drama', tier: 1, en: 'MBC Drama', ar: 'إم بي سي دراما', id: /^MBCDrama\./i },
  { category: 'movies', tier: 1, en: 'MBC Action', ar: 'إم بي سي أكشن', id: /^MBCAction\./i },
  { category: 'movies', tier: 1, en: 'MBC Max', ar: 'إم بي سي ماكس', id: /^MBCMax\./i },
  { category: 'movies', tier: 1, en: 'Rotana Cinema', ar: 'روتانا سينما', id: /^RotanaCinema/i, multi: true },
  { category: 'general', tier: 1, en: 'Rotana Khalijiah', ar: 'روتانا خليجية', id: /^RotanaKhalij/i },
  { category: 'drama', tier: 1, en: 'Rotana Drama', ar: 'روتانا دراما', id: /^RotanaDrama\./i },
  { category: 'general', tier: 1, en: 'Dubai One', ar: 'دبي وان', id: /^DubaiOne\./i },
  { category: 'general', tier: 1, en: 'Abu Dhabi TV', ar: 'أبوظبي', id: /^AbuDhabiTV\./i },
  { category: 'general', tier: 1, en: 'Dubai TV', ar: 'دبي', id: /^DubaiTV\./i },
  { category: 'general', tier: 1, en: 'DMC', ar: 'دي إم سي', id: /^DMC\./i },
  { category: 'general', tier: 1, en: 'ON', ar: 'أون', id: /^OnE\./i },
  { category: 'general', tier: 1, en: 'CBC', ar: 'سي بي سي', id: /^CBC\./i },
  { category: 'general', tier: 1, en: 'Al Nahar', ar: 'النهار', id: /^AlNahar\./i },
  { category: 'general', tier: 1, en: 'MBC Iraq', ar: 'إم بي سي العراق', id: /^MBCIraq\./i },
  // Tier 2: sports, news & kids
  { category: 'sports', tier: 2, en: 'beIN Sports', ar: 'بي إن سبورتس', id: /^beINSports/i, multi: true },
  { category: 'sports', tier: 2, en: 'SSC', ar: 'إس إس سي', id: /^SSC/i, multi: true },
  { category: 'sports', tier: 2, en: 'Abu Dhabi Sports', ar: 'أبوظبي الرياضية', id: /^(AbuDhabiSports|ADSports)/i, multi: true },
  { category: 'sports', tier: 2, en: 'Al Kass', ar: 'الكأس', id: /^AlKass/i, multi: true },
  { category: 'news', tier: 2, en: 'Al Jazeera', ar: 'الجزيرة', id: /^AlJazeera\./i },
  { category: 'news', tier: 2, en: 'Al Arabiya', ar: 'العربية', id: /^Alarabiya\./i },
  { category: 'news', tier: 2, en: 'Al Hadath', ar: 'الحدث', id: /^AlHadath\./i },
  { category: 'news', tier: 2, en: 'Sky News Arabia', ar: 'سكاي نيوز عربية', id: /^SkyNewsArabia\./i },
  { category: 'news', tier: 2, en: 'Asharq News', ar: 'الشرق للأخبار', id: /^AsharqNews\./i },
  { category: 'kids', tier: 2, en: 'Spacetoon', ar: 'سبيستون', id: /^Spacetoon/i },
  { category: 'kids', tier: 2, en: 'MBC 3', ar: 'إم بي سي 3', id: /^MBC3\./i },
  { category: 'documentary', tier: 2, en: 'National Geographic Abu Dhabi', ar: 'ناشيونال جيوغرافيك أبوظبي', id: /^NationalGeographicAbuDhabi/i },
  // Tier 3: regional favorites
  { category: 'general', tier: 3, en: '2M', ar: '2M', id: /^2M/i },
  { category: 'general', tier: 3, en: 'Al Aoula', ar: 'الأولى', id: /^AlAoula/i },
  { category: 'general', tier: 3, en: 'El Watania 1', ar: 'الوطنية 1', id: /^(ElWatania1|Watania1|AlWatania1)/i },
  { category: 'general', tier: 3, en: 'Echorouk', ar: 'الشروق', id: /^Echorouk/i },
  { category: 'general', tier: 3, en: 'Ennahar', ar: 'النهار الجزائرية', id: /^Ennahar/i },
  { category: 'general', tier: 3, en: 'Roya', ar: 'رؤيا', id: /^RoyaTV/i },
  { category: 'general', tier: 3, en: 'LBCI', ar: 'إل بي سي آي', id: /^(LBCInternational|LBCI)/i },
  { category: 'general', tier: 3, en: 'MTV Lebanon', ar: 'إم تي في لبنان', id: /^MTV\.lb/i },
  { category: 'general', tier: 3, en: 'Al Jadeed', ar: 'الجديد', id: /^AlJadeed\./i },
  { category: 'general', tier: 3, en: 'Sama Dubai', ar: 'سما دبي', id: /^SamaDubai/i },
  { category: 'general', tier: 3, en: 'Oman TV', ar: 'تلفزيون سلطنة عمان', id: /^OmanTV/i },
  { category: 'general', tier: 3, en: 'Saudi TV', ar: 'السعودية', id: /^(SaudiTV|AlSaudiya\.)/i },
  { category: 'general', tier: 3, en: 'Iqraa', ar: 'اقرأ', id: /^Iqraa/i }
];

// Canonical genre keys (single source of truth for the app's AR/EN/FR labels).
// `alias` lists Arabic spellings found in TMDB (ar) and in EPG categories.
const GENRES = {
  action: { ar: 'حركة', en: 'Action', fr: 'Action', alias: ['حركة', 'أكشن', 'حركة ومغامرة', 'لايف أكشن', 'action', 'action & adventure'] },
  adventure: { ar: 'مغامرة', en: 'Adventure', fr: 'Aventure', alias: ['مغامرة', 'مغامرات', 'حركة ومغامرة', 'أنمي المغامرات', 'adventure'] },
  animation: { ar: 'رسوم متحركة', en: 'Animation', fr: 'Animation', alias: ['رسوم متحركة', 'الرسوم المتحركة اليابانية', 'رسوم متحركة للبالغين', 'أنمي', 'animation'] },
  comedy: { ar: 'كوميديا', en: 'Comedy', fr: 'Comédie', alias: ['كوميديا', 'كوميدي', 'comedy'] },
  crime: { ar: 'جريمة', en: 'Crime', fr: 'Crime', alias: ['جريمة', 'crime'] },
  documentary: { ar: 'وثائقي', en: 'Documentary', fr: 'Documentaire', alias: ['وثائقي', 'حقائق', 'الحياة البرية', 'documentary'] },
  drama: { ar: 'دراما', en: 'Drama', fr: 'Drame', alias: ['دراما', 'اجتماعي', 'إجتماعي', 'دراما طبية', 'drama'] },
  family: { ar: 'عائلي', en: 'Family', fr: 'Famille', alias: ['عائلي', 'family', 'children'] },
  fantasy: { ar: 'فانتازيا', en: 'Fantasy', fr: 'Fantastique', alias: ['فانتازيا', 'خيالي', 'fantasy'] },
  history: { ar: 'تاريخ', en: 'History', fr: 'Histoire', alias: ['تاريخ', 'تاريخي', 'سيرة ذاتية', 'history'] },
  horror: { ar: 'رعب', en: 'Horror', fr: 'Horreur', alias: ['رعب', 'horror'] },
  kids: { ar: 'أطفال', en: 'Kids', fr: 'Enfants', alias: ['أطفال', 'تربية وتعليم', 'kids'] },
  music: { ar: 'موسيقى', en: 'Music', fr: 'Musique', alias: ['موسيقى', 'عمل غنائي', 'music'] },
  mystery: { ar: 'غموض', en: 'Mystery', fr: 'Mystère', alias: ['غموض', 'mystery'] },
  news: { ar: 'أخبار', en: 'News', fr: 'Actualités', alias: ['أخبار', 'news'] },
  reality: { ar: 'تلفزيون الواقع', en: 'Reality', fr: 'Télé-réalité', alias: ['واقع', 'واقعي', 'تلفزيون الواقع', 'برنامج مسابقات', 'reality'] },
  romance: { ar: 'رومانسية', en: 'Romance', fr: 'Romance', alias: ['رومنسية', 'رومانسية', 'رومانسي', 'romance'] },
  scifi: { ar: 'خيال علمي', en: 'Sci-Fi', fr: 'Science-fiction', alias: ['خيال علمي', 'خيالي علمي', 'أنمي الخيال العلمي', 'خيال علمي وفانتازيا', 'sci-fi & fantasy'] },
  soap: { ar: 'أوبرا صابونية', en: 'Soap', fr: 'Feuilleton', alias: ['أوبرا صابونية', 'soap'] },
  talk: { ar: 'حوار', en: 'Talk Show', fr: 'Talk-show', alias: ['حوار', 'برنامج حواري', 'talk'] },
  thriller: { ar: 'إثارة', en: 'Thriller', fr: 'Thriller', alias: ['إثارة', 'إثارة وتشويق', 'تشويق', 'thriller'] },
  war: { ar: 'حرب', en: 'War', fr: 'Guerre', alias: ['حرب', 'حرب وسياسة', 'war'] },
  western: { ar: 'غربي', en: 'Western', fr: 'Western', alias: ['غربي', 'western'] },
  sports: { ar: 'رياضة', en: 'Sports', fr: 'Sport', alias: ['رياضة', 'كرة القدم', 'رياضة المحركات الآلية', 'sports'] },
  lifestyle: { ar: 'أسلوب حياة', en: 'Lifestyle', fr: 'Art de vivre', alias: ['أسلوب حياة', 'طبخ', 'سيارات', 'السيارات', 'lifestyle'] }
};
const GENRE_ALIAS_TO_KEY = new Map();
for (const [key, g] of Object.entries(GENRES)) {
  for (const a of g.alias) if (!GENRE_ALIAS_TO_KEY.has(a.toLowerCase())) GENRE_ALIAS_TO_KEY.set(a.toLowerCase(), key);
}
function genreKeysFor(names) {
  const out = [];
  for (const n of names) {
    const key = GENRE_ALIAS_TO_KEY.get(String(n).trim().toLowerCase());
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

const CHANNEL_CATEGORY_RULES = [
  ['sports', /sport|^ssc|kass|رياض|الكأس|الكاس/],
  ['kids', /spacetoon|^mbc3\.|mbc 3\b|cartoon|nick|baraem|moonbug|kids|toon|karameesh|cn arabia|سبيس|أطفال|اطفال|كرتون|براعم/],
  ['documentary', /documentary|discovery|national ?geographic|natgeo|animal ?planet|tlc|history|وثائق|ديسكفري|investigation/],
  ['news', /news|jazeera|arabiya|alhadath|hadath|araby|^rt(arabic)?\.|^cnn|bbc|bloomberg|france ?24|euronews|business|الأخبار|الاخبار|الحدث|العربية|الجزيرة/],
  ['movies', /movie|cinema|aflam|film|^cima|سينما|أفلام|افلام|فيلم|موفيز|^mbc(max|action)\.|bollywood|thriller|أكشن/],
  ['drama', /drama|series|مسلسل|دراما|babalhara|باب الحارة/]
];

// ============================================================================
// CACHE
// ============================================================================
let metadataCache = { _version: CACHE_VERSION };
if (fs.existsSync(cacheFile)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (parsed && parsed._version === CACHE_VERSION) metadataCache = parsed;
  } catch {
    metadataCache = { _version: CACHE_VERSION };
  }
}

function saveCache() {
  metadataCache._version = CACHE_VERSION;
  fs.writeFileSync(cacheFile, JSON.stringify(metadataCache, null, 2), 'utf8');
}

// ============================================================================
// GENERIC HELPERS
// ============================================================================
const sleep = ms => new Promise(r => setTimeout(r, ms));

// NOTE: keep identical to the version that produced existing cache keys.
function normalizeName(name) {
  const normalized = String(name || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\b(hd|sd|fhd|uhd|tv)\b/gi, '')
    .replace(/\((film|movie|tv series|series|مسلسل|فيلم|برنامج)[^)]*\)/gi, '')
    .replace(/([a-z\u0600-\u06FF])(\d)/gi, '$1 $2')
    .replace(/(\d)([a-z\u0600-\u06FF])/gi, '$1 $2')
    .replace(/[^\w\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || String(name || '').trim().toLowerCase();
}

function isTitleMatch(candidateTitle, queryTitle) {
  const a = normalizeName(candidateTitle);
  const b = normalizeName(queryTitle);
  if (!a || !b) return false;
  return a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ');
}

// Non-MENA feeds of Arab-targeted providers (beIN France / Australia / Spanish)
const EXCLUDED_CHANNEL_RE = /@(France|Australia)$|enEspanol/i;

function beinSportsNames(baseId) {
  const id = baseId.replace(/\.qa.*$/i, '');
  let m;
  if ((m = id.match(/^beINSportsMax(\d+)$/i))) return { en: `beIN Sports Max ${m[1]}`, ar: `بي إن سبورتس ماكس ${m[1]}` };
  if ((m = id.match(/^beINSportsXtra(\d+)$/i))) return { en: `beIN Sports Xtra ${m[1]}`, ar: `بي إن سبورتس إكسترا ${m[1]}` };
  if (/^beINSportsNews$/i.test(id)) return { en: 'beIN Sports News', ar: 'بي إن سبورتس نيوز' };
  if (/^beINSports4K/i.test(id)) return { en: 'beIN Sports 4K', ar: 'بي إن سبورتس 4K' };
  if ((m = id.match(/^beINSports(\d+)$/i))) return { en: `beIN Sports ${m[1]}`, ar: `بي إن سبورتس ${m[1]}` };
  if (/^beINSports$/i.test(id)) return { en: 'beIN Sports', ar: 'بي إن سبورتس' };
  return null;
}

function isJunkChannelName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return true;
  if (trimmed.includes('#')) return true;
  if (/^\d+$/.test(trimmed)) return true;
  if (/^(channel|ch|test|feed|service)\s*\d*$/i.test(trimmed)) return true;
  if (/portrait/i.test(trimmed)) return true;
  return false;
}

function decodeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

// Returns an https URL string or null. Never returns "null", "", relative or broken values.
function cleanUrl(value) {
  if (typeof value !== 'string') return null;
  let u = value.trim();
  if (!u || /^(null|undefined|n\/a|none)$/i.test(u)) return null;
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('http://')) u = 'https://' + u.slice(7); // iOS ATS blocks cleartext
  if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(u)) return null;
  if (/\s/.test(u)) u = u.replace(/ /g, '%20');
  return u;
}

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || /^(null|undefined|n\/a)$/i.test(t)) return null;
  return t;
}

function isValidPosterUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.endsWith('.svg') || lower.includes('.svg.png')) return false;
  const badPatterns = ['flag_of_', 'commons-logo', 'disambig', 'question_book', 'ambox', 'replace_this_image', 'portrait'];
  return !badPatterns.some(pattern => lower.includes(pattern));
}

function isLowResPoster(url) {
  return !!url && /_\d{2,3}x\d{2,3}_/.test(url);
}

function xmltvToMs(str) {
  const m = String(str || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4}|Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, tz] = m;
  let offsetMin = 0;
  if (tz && tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    offsetMin = sign * (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(3, 5), 10));
  }
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)) - offsetMin * 60000;
}

const tsToIso = ts => new Date(ts * 1000).toISOString().replace('.000Z', 'Z');
const tsToDay = ts => new Date(ts * 1000).toISOString().slice(0, 10);
const shortHash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

function mode(map) {
  let best = null;
  let bestN = 0;
  for (const [k, n] of map.entries()) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}
const bump = (map, key, n = 1) => { if (key) map.set(key, (map.get(key) || 0) + n); };

function baseIdOf(channelId) {
  return channelId.split('@')[0];
}
function countryOf(channelId) {
  const parts = baseIdOf(channelId).toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}
function safeFileId(channelId) {
  return channelId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

class TransientError extends Error {}

async function fetchJson(url, { headers, retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (res.status === 429 || res.status >= 500) {
        const wait = (Number(res.headers.get('retry-after')) || 1) * 1000 * (attempt + 1);
        await sleep(Math.min(wait, 10000));
        continue;
      }
      if (!res.ok) return null; // 4xx: definitive "not found / not allowed"
      return await res.json();
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }
  throw new TransientError(url);
}

// ============================================================================
// TITLE / CONTENT HELPERS
// ============================================================================
const NB = '(?<![\\p{L}\\p{N}])';
const NA = '(?![\\p{L}\\p{N}])';
const SXEX_RE = new RegExp(`${NB}S(\\d{1,2})\\s*E(\\d{1,4})${NA}`, 'iu');
const SEASON_RE = new RegExp(`${NB}(?:season|الموسم|موسم|الجزء|جزء|ج|s)\\s*\\.?\\s*(\\d{1,2})${NA}`, 'iu');
const EPISODE_RE = new RegExp(`${NB}(?:episode|ep|الحلقة|حلقة|ح|e)\\s*\\.?\\s*(\\d{1,4})${NA}`, 'iu');
const TITLE_PREFIX_RE = /^(?:مسلسل|فيلم|برنامج|سهرة|عرض|مباشر)\s*[:\-]?\s*/;

function parseProgramTitle(rawTitle) {
  let season = null;
  let episode = null;
  let work = String(rawTitle || '');

  const both = work.match(SXEX_RE);
  if (both) {
    season = parseInt(both[1], 10);
    episode = parseInt(both[2], 10);
    work = work.replace(SXEX_RE, ' ');
  }
  const sm = work.match(SEASON_RE);
  if (sm) {
    if (season === null) season = parseInt(sm[1], 10);
    work = work.replace(SEASON_RE, ' ');
  }
  const em = work.match(EPISODE_RE);
  if (em) {
    if (episode === null) episode = parseInt(em[1], 10);
    work = work.replace(EPISODE_RE, ' ');
  }

  let prefix = null;
  const pm = work.trim().match(TITLE_PREFIX_RE);
  if (pm) prefix = pm[0].trim().replace(/[:\-\s]+$/, '');

  const cleanTitle = work
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TITLE_PREFIX_RE, '')
    .replace(/^[\s\-:|،,–—]+|[\s\-:|،,–—]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    cleanTitle: cleanTitle || String(rawTitle || '').trim(),
    season,
    episode,
    prefix
  };
}

function isUnavailableProgram(title) {
  if (!title) return true;
  const t = title.trim().toLowerCase();
  return (
    t.includes('جدول البرامج غير متاح') ||
    t.includes('البرامج غير متاحة') ||
    t.includes('لا تتوفر معلومات') ||
    t.includes('غير متوفر') ||
    t === 'no program available' ||
    t === 'no information available' ||
    t === 'no data'
  );
}

// Whole-word fillers (normalizeName folds hamza / ta-marbuta, so list is in folded form)
const FILLER_TOKENS = new Set([
  'اخبار', 'الاخبار', 'نشره', 'النشره', 'موجز', 'نيوز', 'news', 'headlines', 'headline',
  'weather', 'الطقس', 'طقس', 'اعلانات', 'اعلان', 'teleshopping', 'تسوق', 'اذان', 'الاذان',
  'صلاه', 'القران', 'قران', 'تلاوه', 'فاصل', 'bulletin', 'promo', 'promos', 'ident', 'idents'
]);
const FILLER_PHRASES = ['فتره مفتوحه', 'صباح الخير', 'استوديو تحليلي', 'تغطيه خاصه', 'حصاد اليوم', 'الحدث اليوم'];
const GENERIC_EXACT_TITLES = new Set([
  'برنامج', 'فيلم', 'مسلسل', 'وثائقي', 'فيلم وثائقي', 'برنامج وثائقي', 'program', 'programme',
  'movie', 'film', 'series', 'documentary', 'untitled', 'برنامج ترفيهي', 'اغاني', 'فيديو كليب'
]);
const NEWS_TOKENS = new Set(['اخبار', 'الاخبار', 'نشره', 'النشره', 'موجز', 'نيوز', 'news', 'headlines', 'headline', 'bulletin']);

function isFillerTitle(cleanTitle, channelName) {
  if (!cleanTitle || cleanTitle.trim().length < 2) return true;
  const norm = normalizeName(cleanTitle);
  if (GENERIC_EXACT_TITLES.has(norm)) return true;
  if (channelName && norm === normalizeName(channelName)) return true; // title == channel name
  const tokens = norm.split(' ');
  if (tokens.some(t => FILLER_TOKENS.has(t))) return true;
  return FILLER_PHRASES.some(p => norm.includes(p));
}

function hasNewsToken(cleanTitle) {
  return normalizeName(cleanTitle).split(' ').some(t => NEWS_TOKENS.has(t));
}

const MUSIC_RE = /concert|musical|music|موسيق|كليب|أغاني|اغاني|غنائ|clip/i;
const NEWS_CAT_RE = /أخبار|اخبار|الأخبار|إخبار|news|الأحداث الجارية|الاحداث الجارية|مسائل راهنة|current affairs/i;
const SPORTS_CAT_RE = /رياض|sport|كرة|football|soccer/i;
const ANIMATION_CAT_RE = /رسوم متحركة|أنمي|انمي|animation|كرتون|أطفال|اطفال|anime/i;
const DOC_CAT_RE = /وثائقي|documentary|حقائق|factual/i;

const META_CATEGORIES = new Set([
  'مسلسل', 'مسلسلات', 'فيلم', 'برنامج', 'general', 'concert', 'musical', 'أجنبي', 'عربي', 'undefined', 'null'
]);

function inferContentTypeForGroup(g, enriched) {
  const catText = g.categories.join(' | ');
  const title = g.cleanTitle;

  if (MUSIC_RE.test(catText)) return 'music';
  if (g.filler) return (NEWS_CAT_RE.test(catText) || hasNewsToken(title)) ? 'news' : 'program';
  if (NEWS_CAT_RE.test(catText)) return 'news';
  if (SPORTS_CAT_RE.test(catText) || /مباراة/.test(title)) return 'sports';
  if (ANIMATION_CAT_RE.test(catText) || (enriched && enriched.content_type === 'animation')) return 'animation';
  if (DOC_CAT_RE.test(catText) || /^(فيلم|برنامج) وثائقي/.test(g.rawTitles[0] || '')) return 'documentary';
  if (enriched && (enriched.content_type === 'movie' || enriched.content_type === 'series')) return enriched.content_type;

  if (g.hasEpisodeInfo || g.prefixes.has('مسلسل') || /مسلسل/.test(catText)) return 'series';
  if (g.prefixes.has('فيلم') || /فيلم|movie/i.test(catText)) return 'movie';
  if (/دراما|تشويق|تاريخي|سيرة ذاتية/.test(catText)) return 'series';
  if (/أكشن|رعب|خيال علمي|أجنبي|رومانسي|جريمة|إثارة|اثارة/.test(catText)) return 'movie';
  return 'program';
}

// ============================================================================
// LOGOS
// ============================================================================
const LOGO_FORMAT_RANK = { PNG: 3, JPEG: 2, WebP: 1 };

async function fetchChannelLogos() {
  const logosById = new Map();
  const logosByName = new Map();
  if (OFFLINE) return { logosById, logosByName };

  try {
    console.log('⏳ Fetching official channel logos database...');
    const [logosList, channelsList] = await Promise.all([
      fetchJson('https://iptv-org.github.io/api/logos.json'),
      fetchJson('https://iptv-org.github.io/api/channels.json')
    ]);

    const best = new Map();
    for (const item of logosList || []) {
      if (!item.channel || !item.url) continue;
      const rank = LOGO_FORMAT_RANK[item.format];
      if (!rank) continue; // skip SVG / AVIF / GIF / unknown
      const url = cleanUrl(item.url);
      if (!url) continue;
      const score = rank * 1e6 + (item.in_use ? 5e5 : 0) + (item.width || 0);
      const key = item.channel.toLowerCase();
      if (!best.has(key) || best.get(key).score < score) best.set(key, { url, score });
    }
    for (const [k, v] of best) logosById.set(k, v.url);

    for (const ch of channelsList || []) {
      if (!ch.id) continue;
      const logoUrl = logosById.get(ch.id.toLowerCase());
      if (!logoUrl) continue;
      if (ch.name) {
        const norm = normalizeName(ch.name);
        if (!logosByName.has(norm)) logosByName.set(norm, logoUrl);
      }
      for (const alt of ch.alt_names || []) {
        const normAlt = normalizeName(alt);
        if (!logosByName.has(normAlt)) logosByName.set(normAlt, logoUrl);
      }
    }
    console.log(`✅ Loaded ${logosById.size} channel logos (${logosByName.size} name aliases).`);
  } catch (err) {
    console.error('⚠️ Failed to fetch channel logos:', err.message);
  }
  return { logosById, logosByName };
}

function usableChannelIcon(url) {
  const u = cleanUrl(url);
  if (!u) return null;
  if (/\.svg(\?.*)?$/i.test(u)) return null; // raw SVG: needs extra renderer on mobile
  return u;
}

// ============================================================================
// TMDB (primary), WIKIDATA, TVMAZE, ITUNES
// ============================================================================
const PREFERRED_CERT_COUNTRIES = ['AE', 'SA', 'EG', 'US', 'GB'];

function collectAltTitles(detail) {
  const alt = detail.alternative_titles || {};
  const list = alt.results || alt.titles || [];
  return list.map(t => t && t.title).filter(Boolean).slice(0, 60);
}

function titleMatchesAny(candidates, query) {
  return candidates.some(t => t && isTitleMatch(t, query));
}

function isVerifiedDetail(mapped, query) {
  return titleMatchesAny([mapped.tmdb_title, mapped.original_title, mapped.i18n.en.title, mapped.i18n.fr.title, ...mapped.alt_titles], query);
}

function mapTranslations(detail) {
  const list = (detail.translations && detail.translations.translations) || [];
  const out = {};
  for (const lang of ['en', 'fr']) {
    const cands = list.filter(t => t.iso_639_1 === lang);
    const pref = cands.find(t => t.iso_3166_1 === (lang === 'en' ? 'US' : 'FR')) || cands[0];
    const d = (pref && pref.data) || {};
    out[lang] = { title: cleanText(d.title || d.name), overview: cleanText(d.overview) || '', tagline: cleanText(d.tagline) };
  }
  if (!out.en.title && detail.original_language === 'en') {
    out.en.title = cleanText(detail.original_title || detail.original_name);
  }
  return out;
}

function mapTmdbDetail(detail, mediaType) {
  const posterPath =
    detail.poster_path ||
    (detail.images && detail.images.posters && detail.images.posters[0] && detail.images.posters[0].file_path) ||
    null;
  const backdropPath =
    detail.backdrop_path ||
    (detail.images && detail.images.backdrops && detail.images.backdrops[0] && detail.images.backdrops[0].file_path) ||
    null;

  let ageRating = null;
  if (mediaType === 'movie' && detail.release_dates && Array.isArray(detail.release_dates.results)) {
    for (const cc of PREFERRED_CERT_COUNTRIES) {
      const entry = detail.release_dates.results.find(r => r.iso_3166_1 === cc);
      const cert = entry && entry.release_dates && entry.release_dates.find(d => d.certification);
      if (cert && cert.certification) { ageRating = cert.certification; break; }
    }
  } else if (mediaType === 'tv' && detail.content_ratings && Array.isArray(detail.content_ratings.results)) {
    for (const cc of PREFERRED_CERT_COUNTRIES) {
      const entry = detail.content_ratings.results.find(r => r.iso_3166_1 === cc);
      if (entry && entry.rating) { ageRating = entry.rating; break; }
    }
  }

  let trailerUrl = null;
  if (detail.videos && Array.isArray(detail.videos.results)) {
    const yt = detail.videos.results.filter(v => v.site === 'YouTube' && v.key);
    const pick = lang => yt.find(v => v.type === 'Trailer' && v.iso_639_1 === lang) || null;
    const trailer = pick('ar') || pick('en') || yt.find(v => v.type === 'Trailer') || yt.find(v => v.type === 'Teaser') || yt[0];
    if (trailer) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
  }

  let director = null;
  if (mediaType === 'movie' && detail.credits && Array.isArray(detail.credits.crew)) {
    const dirs = detail.credits.crew.filter(c => c.job === 'Director').map(c => c.name);
    if (dirs.length) director = dirs.slice(0, 2).join(', ');
  } else if (mediaType === 'tv' && Array.isArray(detail.created_by) && detail.created_by.length) {
    director = detail.created_by.map(c => c.name).slice(0, 2).join(', ');
  }

  const cast =
    detail.credits && Array.isArray(detail.credits.cast)
      ? detail.credits.cast.filter(a => a && a.name).slice(0, 10).map(actor => ({
          name: actor.name,
          character: cleanText(actor.character),
          profile_image: actor.profile_path ? `https://image.tmdb.org/t/p/w185${actor.profile_path}` : null
        }))
      : [];

  const rawCountry =
    (Array.isArray(detail.origin_country) && detail.origin_country[0]) ||
    (Array.isArray(detail.production_countries) && detail.production_countries[0] && detail.production_countries[0].iso_3166_1) ||
    null;
  const country = rawCountry ? (COUNTRY_NAMES_AR[rawCountry] || rawCountry) : null;
  const language = detail.original_language ? (LANG_NAMES_AR[detail.original_language] || detail.original_language) : null;

  const genreIds = (detail.genres || []).map(g => g.id);
  const contentType = genreIds.includes(16) ? 'animation' : (mediaType === 'movie' ? 'movie' : 'series');
  const releaseDate = detail.release_date || detail.first_air_date || '';

  return {
    tmdb_id: detail.id,
    tmdb_media: mediaType,
    tmdb_title: cleanText(detail.title || detail.name),
    alt_titles: collectAltTitles(detail),
    i18n: mapTranslations(detail),
    tagline: cleanText(detail.tagline),
    runtime: mediaType === 'movie' ? (detail.runtime || null) : ((Array.isArray(detail.episode_run_time) && detail.episode_run_time[0]) || null),
    original_title: cleanText(detail.original_title || detail.original_name),
    poster: posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null,
    backdrop: backdropPath ? `https://image.tmdb.org/t/p/w780${backdropPath}` : null,
    description: cleanText(detail.overview) || '',
    rating: detail.vote_average ? Number(detail.vote_average.toFixed(1)) : null,
    vote_count: detail.vote_count || null,
    age_rating: cleanText(ageRating),
    year: releaseDate ? releaseDate.slice(0, 4) : null,
    release_date: releaseDate || null,
    genres: Array.isArray(detail.genres) ? detail.genres.map(g => g.name).filter(Boolean) : [],
    country,
    language,
    director: cleanText(director),
    cast,
    trailer_url: trailerUrl,
    seasons_count: mediaType === 'tv' ? (detail.number_of_seasons || null) : null,
    episodes_count: mediaType === 'tv' ? (detail.number_of_episodes || null) : null,
    status: cleanText(detail.status),
    content_type: contentType
  };
}

async function fetchTmdbDetail(mediaType, id) {
  const url = `https://api.themoviedb.org/3/${mediaType}/${id}?api_key=${TMDB_API_KEY}&language=ar` +
    '&append_to_response=credits,videos,content_ratings,release_dates,images,alternative_titles,translations' +
    '&include_image_language=ar,en,null&include_video_language=ar,en';
  const detail = await fetchJson(url);
  return detail ? mapTmdbDetail(detail, mediaType) : null;
}

// Throws TransientError on network/API failure (so nothing gets cached as "no match").
async function searchTmdbFull(queryTitle, expectedYear, category) {
  if (!TMDB_API_KEY) return null;

  const isMovieHint = /فيلم|movie/i.test(category || '');
  const isSeriesHint = /مسلسل|series/i.test(category || '');

  const data = await fetchJson(
    `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=ar&query=${encodeURIComponent(queryTitle)}`
  );
  if (!data) return null;

  const validResults = (data.results || []).filter(r => {
    if (r.media_type !== 'movie' && r.media_type !== 'tv') return false;
    const rel = r.release_date || r.first_air_date || '';
    if (expectedYear && rel && Math.abs(parseInt(rel.slice(0, 4), 10) - parseInt(expectedYear, 10)) > 1) return false;
    return true;
  });
  if (validResults.length === 0) return null;

  const direct = r => titleMatchesAny([r.title, r.name, r.original_title, r.original_name], queryTitle);
  validResults.sort((a, b) => {
    if (direct(a) !== direct(b)) return direct(a) ? -1 : 1;
    if (isMovieHint && a.media_type !== b.media_type) return a.media_type === 'movie' ? -1 : 1;
    if (isSeriesHint && a.media_type !== b.media_type) return a.media_type === 'tv' ? -1 : 1;
    return (b.popularity || 0) - (a.popularity || 0);
  });

  // Only accept a hit whose localized / original / alternative titles really match the query.
  for (const hit of validResults.slice(0, 3)) {
    if (!direct(hit) && (hit.vote_count || 0) < 20) continue; // skip junk without fetching details
    const mapped = await fetchTmdbDetail(hit.media_type, hit.id);
    if (mapped && isVerifiedDetail(mapped, queryTitle)) return mapped;
  }
  return null;
}

async function searchWikidata(cleanTitle, expectedYear) {
  const isLatin = /^[a-zA-Z0-9\s\-:&'.,!?]+$/.test(cleanTitle);
  const searchLang = isLatin ? 'en' : 'ar';
  const headers = { 'User-Agent': 'ArabicTVGuideBot/1.0' };

  try {
    const searchData = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(cleanTitle)}&language=${searchLang}&uselang=${searchLang}&format=json&limit=5`,
      { headers, retries: 1 }
    );
    if (!searchData) return null;

    const candidates = (searchData.search || []).filter(item => {
      const labelMatch = isTitleMatch(item.label || '', cleanTitle);
      const aliasMatch = Array.isArray(item.aliases) && item.aliases.some(a => isTitleMatch(a, cleanTitle));
      return labelMatch || aliasMatch;
    });
    if (candidates.length === 0) return null;

    const ids = candidates.map(c => c.id).join('|');
    const entityData = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels|descriptions|claims&languages=ar|en&format=json`,
      { headers, retries: 1 }
    );
    if (!entityData) return null;
    const entities = entityData.entities || {};

    for (const cand of candidates) {
      const ent = entities[cand.id];
      if (!ent || !ent.claims) continue;

      const typeIds = (ent.claims.P31 || [])
        .map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id)
        .filter(Boolean);
      if (typeIds.some(id => BLOCKED_WIKIDATA_TYPES.has(id))) continue;

      const isMedia = typeIds.some(id => ALLOWED_WIKIDATA_TYPES.has(id));
      const descAr = (ent.descriptions && ent.descriptions.ar && ent.descriptions.ar.value) || '';
      const descEn = (ent.descriptions && ent.descriptions.en && ent.descriptions.en.value) || '';
      const descHint = /فيلم|مسلسل|برنامج|رسوم متحركة|film|television|series|animated|sitcom/i.test(`${descAr} ${descEn}`);
      if (!isMedia && !descHint) continue;

      let year = null;
      const p577 = ent.claims.P577 && ent.claims.P577[0];
      const timeVal = p577 && p577.mainsnak && p577.mainsnak.datavalue && p577.mainsnak.datavalue.value && p577.mainsnak.datavalue.value.time;
      if (timeVal) {
        const ym = timeVal.match(/\+?(\d{4})/);
        if (ym) year = ym[1];
      }
      if (expectedYear && year && Math.abs(parseInt(expectedYear, 10) - parseInt(year, 10)) > 1) continue;

      // Only P3383 (film poster). P18 is a generic "image" (buildings, logos, people) and not a poster.
      let poster = null;
      const posterClaim = ent.claims.P3383 && ent.claims.P3383[0];
      const fileName = posterClaim && posterClaim.mainsnak && posterClaim.mainsnak.datavalue && posterClaim.mainsnak.datavalue.value;
      if (fileName && isValidPosterUrl(fileName)) {
        poster = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=500`;
      }

      let country = null;
      const p495 = ent.claims.P495 && ent.claims.P495[0];
      const countryId = p495 && p495.mainsnak && p495.mainsnak.datavalue && p495.mainsnak.datavalue.value && p495.mainsnak.datavalue.value.id;
      if (countryId && COUNTRY_NAMES_AR[countryId]) country = COUNTRY_NAMES_AR[countryId];

      const enLabel = ent.labels && ent.labels.en ? ent.labels.en.value : null;
      const contentType = typeIds.includes('Q581714') || typeIds.includes('Q202866')
        ? 'animation'
        : (typeIds.includes('Q11424') || typeIds.includes('Q506240') ? 'movie' : 'series');

      return { original_title: enLabel && !isLatin ? enLabel : null, poster, year, country, content_type: contentType };
    }
  } catch {}
  return null;
}

async function searchTvMaze(queryTitle, expectedYear) {
  try {
    const list = await fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(queryTitle)}`, { retries: 1 });
    const hit = (list || []).find(item => {
      if (!item.show || !isTitleMatch(item.show.name, queryTitle)) return false;
      if (expectedYear && item.show.premiered) {
        const showYear = parseInt(item.show.premiered.slice(0, 4), 10);
        if (Math.abs(showYear - parseInt(expectedYear, 10)) > 1) return false;
      }
      return true;
    });
    if (!hit || !hit.show) return null;

    const s = hit.show;
    const poster = s.image ? (s.image.original || s.image.medium) : null;
    let cast = [];
    try {
      const castList = await fetchJson(`https://api.tvmaze.com/shows/${s.id}/cast`, { retries: 1 });
      cast = (castList || [])
        .filter(c => c.person && c.person.name)
        .slice(0, 6)
        .map(c => ({
          name: c.person.name,
          character: (c.character && c.character.name) || null,
          profile_image: (c.person.image && c.person.image.medium) || null
        }));
    } catch {}

    return {
      original_title: s.name || null,
      poster,
      rating: s.rating && s.rating.average ? s.rating.average : null,
      year: s.premiered ? s.premiered.slice(0, 4) : null,
      genres: Array.isArray(s.genres) ? s.genres : [],
      country: s.network && s.network.country ? s.network.country.name : null,
      cast,
      content_type: s.type === 'Animation' ? 'animation' : 'series'
    };
  } catch {}
  return null;
}

async function searchItunes(queryTitle, expectedYear) {
  const queries = [
    { country: 'ae', media: 'movie' },
    { country: 'us', media: 'movie' },
    { country: 'us', media: 'tvShow' }
  ];
  for (const { country, media } of queries) {
    try {
      const data = await fetchJson(
        `https://itunes.apple.com/search?term=${encodeURIComponent(queryTitle)}&country=${country}&media=${media}&limit=5`,
        { retries: 1 }
      );
      const hit = ((data && data.results) || []).find(r => {
        const title = r.trackName || r.collectionName;
        if (!title || !isTitleMatch(title, queryTitle)) return false;
        if (expectedYear && r.releaseDate) {
          if (Math.abs(parseInt(r.releaseDate.slice(0, 4), 10) - parseInt(expectedYear, 10)) > 1) return false;
        }
        return true;
      });
      if (hit && hit.artworkUrl100) {
        return {
          original_title: hit.trackName || hit.collectionName || null,
          poster: hit.artworkUrl100.replace('100x100bb', '600x600bb'),
          description: hit.longDescription || hit.shortDescription || '',
          director: media === 'movie' && hit.artistName ? hit.artistName : null,
          age_rating: hit.contentAdvisoryRating || null,
          year: hit.releaseDate ? hit.releaseDate.slice(0, 4) : null,
          genres: hit.primaryGenreName ? [hit.primaryGenreName] : [],
          content_type: media === 'movie' ? 'movie' : 'series'
        };
      }
    } catch {}
  }
  return null;
}

async function enrichProgramMetadata(cleanTitle, expectedYear, category) {
  const cacheKey = `${normalizeName(cleanTitle)}_${expectedYear || ''}`;
  if (metadataCache[cacheKey] !== undefined) return metadataCache[cacheKey];

  // Both search paths only return title-matched hits, so any match here is "verified".
  let tmdb = await searchTmdbFull(cleanTitle, expectedYear, category); // may throw TransientError
  const wiki = await searchWikidata(cleanTitle, expectedYear);
  if (!tmdb && wiki && wiki.original_title) {
    tmdb = await searchTmdbFull(wiki.original_title, wiki.year || expectedYear, category);
  }

  const enriched = {
    fv: ENTRY_FORMAT,
    tmdb_id: (tmdb && tmdb.tmdb_id) || null,
    tmdb_media: (tmdb && tmdb.tmdb_media) || null,
    tmdb_title: (tmdb && tmdb.tmdb_title) || null,
    verified: !!tmdb, // searchTmdbFull only returns title-verified hits
    i18n: (tmdb && tmdb.i18n) || null,
    tagline: (tmdb && tmdb.tagline) || null,
    runtime: (tmdb && tmdb.runtime) || null,
    original_title: (tmdb && tmdb.original_title) || (wiki && wiki.original_title) || null,
    poster: (tmdb && tmdb.poster) || (wiki && wiki.poster) || null,
    backdrop: (tmdb && tmdb.backdrop) || null,
    description: (tmdb && tmdb.description) || '',
    rating: (tmdb && tmdb.rating) || null,
    vote_count: (tmdb && tmdb.vote_count) || null,
    age_rating: (tmdb && tmdb.age_rating) || null,
    year: (tmdb && tmdb.year) || (wiki && wiki.year) || expectedYear || null,
    release_date: (tmdb && tmdb.release_date) || null,
    genres: (tmdb && tmdb.genres) || [],
    country: (tmdb && tmdb.country) || (wiki && wiki.country) || null,
    language: (tmdb && tmdb.language) || null,
    director: (tmdb && tmdb.director) || null,
    cast: (tmdb && tmdb.cast) || [],
    trailer_url: (tmdb && tmdb.trailer_url) || null,
    seasons_count: (tmdb && tmdb.seasons_count) || null,
    episodes_count: (tmdb && tmdb.episodes_count) || null,
    status: (tmdb && tmdb.status) || null,
    content_type: (tmdb && tmdb.content_type) || (wiki && wiki.content_type) || null
  };

  const searchTitles = [];
  if (enriched.original_title && enriched.original_title.toLowerCase() !== cleanTitle.toLowerCase()) {
    searchTitles.push(enriched.original_title);
  }
  searchTitles.push(cleanTitle);

  if (!enriched.poster || !enriched.rating || enriched.cast.length === 0) {
    for (const q of searchTitles) {
      const tvmaze = await searchTvMaze(q, enriched.year);
      if (tvmaze) {
        enriched.original_title = enriched.original_title || tvmaze.original_title;
        enriched.poster = enriched.poster || tvmaze.poster;
        enriched.rating = enriched.rating || tvmaze.rating;
        enriched.year = enriched.year || tvmaze.year;
        enriched.country = enriched.country || tvmaze.country;
        if (!enriched.genres.length && tvmaze.genres.length) enriched.genres = tvmaze.genres;
        if (!enriched.cast.length && tvmaze.cast.length) enriched.cast = tvmaze.cast;
        enriched.content_type = enriched.content_type || tvmaze.content_type;
        break;
      }
    }
  }

  if (!enriched.poster || !enriched.age_rating || !enriched.director) {
    for (const q of searchTitles) {
      const itunes = await searchItunes(q, enriched.year);
      if (itunes) {
        enriched.original_title = enriched.original_title || itunes.original_title;
        enriched.poster = enriched.poster || itunes.poster;
        enriched.description = enriched.description || itunes.description;
        enriched.director = enriched.director || itunes.director;
        enriched.age_rating = enriched.age_rating || itunes.age_rating;
        enriched.year = enriched.year || itunes.year;
        if (!enriched.genres.length && itunes.genres.length) enriched.genres = itunes.genres;
        enriched.content_type = enriched.content_type || itunes.content_type;
        break;
      }
    }
  }

  const hasUsefulData =
    enriched.tmdb_id || enriched.poster || enriched.original_title ||
    enriched.rating || enriched.cast.length > 0 || enriched.director || enriched.age_rating;

  metadataCache[cacheKey] = hasUsefulData ? enriched : null;
  return metadataCache[cacheKey];
}

// Upgrades a legacy cache entry (older fetch strategy: Arabic-only trailers, no media type)
// in place, using the stored TMDB id. Cheap: one request, no search.
const TMDB_REFRESH_FIELDS = [
  'tmdb_title', 'tagline', 'runtime', 'backdrop', 'poster', 'description', 'age_rating', 'trailer_url', 'director',
  'seasons_count', 'episodes_count', 'status', 'country', 'language', 'original_title', 'release_date'
];
async function refreshLegacyEntry(entry, cleanTitle) {
  const guesses = entry.tmdb_media
    ? [entry.tmdb_media]
    : (entry.seasons_count != null || entry.content_type === 'series' ? ['tv', 'movie'] : ['movie', 'tv']);
  let refreshed = false;
  for (const media of guesses) {
    const fresh = await fetchTmdbDetail(media, entry.tmdb_id);
    if (!fresh) continue;
    refreshed = true;
    entry.tmdb_media = media;
    entry.alt_match = fresh.alt_titles; // transient: consumed below, removed before saving
    entry.i18n = fresh.i18n;
    for (const f of TMDB_REFRESH_FIELDS) if (fresh[f]) entry[f] = fresh[f];
    if (fresh.cast.length) entry.cast = fresh.cast;
    if (fresh.genres.length) entry.genres = fresh.genres;
    if (fresh.rating) { entry.rating = fresh.rating; entry.vote_count = fresh.vote_count; }
    break;
  }

  // Never stamp an entry as refreshed when TMDB returned nothing (bad key, outage, removed id).
  if (!refreshed) throw new TransientError(`refresh failed for tmdb ${entry.tmdb_id}`);

  // Legacy matches were accepted without a title check: verify them now.
  const known = [entry.tmdb_title, entry.original_title, entry.i18n && entry.i18n.en.title, entry.i18n && entry.i18n.fr.title, ...(entry.alt_match || [])];
  let verified = entry.verified === true || titleMatchesAny(known, cleanTitle);
  if (!verified) {
    const wiki = await searchWikidata(cleanTitle, entry.year);
    verified = !!(wiki && wiki.original_title && titleMatchesAny(known, wiki.original_title));
  }
  delete entry.alt_match;
  entry.verified = verified;
  entry.fv = ENTRY_FORMAT;
}

// ============================================================================
// GUIDE PARSING
// ============================================================================
function classifyProgrammeImage(url, viaTag) {
  const u = cleanUrl(url);
  if (!u) return null;
  if (/blank_photos|placeholder|no[-_]?image|default[-_]?image/i.test(u)) return null;
  // Known landscape (16:9) providers -> backdrop candidates
  if (/shahid\.mbc\.net|osn-artwork\.anghcdn\.co|\/Horizontal\//i.test(u)) return { kind: 'backdrop', url: u };
  // Known portrait thumbnail provider (150x200)
  if (/_\d{2,3}x\d{2,3}_/.test(u)) return { kind: 'poster', url: u };
  if (viaTag === 'icon' && isValidPosterUrl(u)) return { kind: 'poster', url: u };
  return null;
}

function parseEpisodeNum(inner) {
  let season = null;
  let episode = null;
  const onscreen = inner.match(/<episode-num[^>]*system="onscreen"[^>]*>([^<]*)</);
  if (onscreen) {
    const m = onscreen[1].match(/S(\d{1,2})\s*E(\d{1,4})/i);
    if (m) { season = +m[1]; episode = +m[2]; }
  }
  if (episode === null) {
    const ns = inner.match(/<episode-num[^>]*system="xmltv_ns"[^>]*>([^<]*)</);
    if (ns) {
      const m = ns[1].trim().match(/^(\d*)\s*\.\s*(\d*)/);
      if (m) {
        if (m[2] !== '') episode = parseInt(m[2], 10) + 1;
        if (m[1] !== '' && season === null) season = parseInt(m[1], 10) + 1;
      }
    }
  }
  return { season, episode };
}

function parseGuideFile(xml, channels, programmes) {
  const chRegex = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/g;
  let chMatch;
  while ((chMatch = chRegex.exec(xml)) !== null) {
    const id = decodeXml(chMatch[1]);
    if (channels.has(id)) continue;
    const inner = chMatch[2];
    const nameMatch = inner.match(/<display-name[^>]*>([\s\S]*?)<\/display-name>/);
    const iconMatch = inner.match(/<icon\s+src="([^"]+)"/);
    channels.set(id, {
      id,
      name: nameMatch ? decodeXml(nameMatch[1]) : id,
      xmlIcon: iconMatch ? decodeXml(iconMatch[1]) : null
    });
  }

  const progRegex = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = progRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const startM = attrs.match(/start="([^"]+)"/);
    const stopM = attrs.match(/stop="([^"]+)"/);
    const chanM = attrs.match(/channel="([^"]+)"/);
    if (!chanM || !startM) continue;

    const startMs = xmltvToMs(startM[1]);
    if (startMs === null) continue;
    const stopMs = stopM ? xmltvToMs(stopM[1]) : null;

    const titleM = inner.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const rawTitle = titleM ? decodeXml(titleM[1]) : '';
    if (!rawTitle) continue;

    const subM = inner.match(/<sub-title[^>]*>([\s\S]*?)<\/sub-title>/);
    const descM = inner.match(/<desc[^>]*>([\s\S]*?)<\/desc>/);
    const dateM = inner.match(/<date[^>]*>([\s\S]*?)<\/date>/);
    const countryM = inner.match(/<country[^>]*>([\s\S]*?)<\/country>/);
    const langM = inner.match(/<language[^>]*>([\s\S]*?)<\/language>/);
    const ageM = inner.match(/<rating[^>]*>[\s\S]*?<value[^>]*>([\s\S]*?)<\/value>/);
    const starM = inner.match(/<star-rating[^>]*>[\s\S]*?<value[^>]*>([\s\S]*?)<\/value>/);

    const categories = [];
    const catRegex = /<category[^>]*>([\s\S]*?)<\/category>/g;
    let cm;
    while ((cm = catRegex.exec(inner)) !== null) {
      const c = cleanText(decodeXml(cm[1]));
      if (c) categories.push(c);
    }

    const images = [];
    const imgRegex = /<(image|icon)(?:\s+src="([^"]+)")?[^>]*?(?:\/>|>([^<]*)<\/\1>)/g;
    let im;
    while ((im = imgRegex.exec(inner)) !== null) {
      const cls = classifyProgrammeImage(decodeXml(im[2] || im[3] || ''), im[1]);
      if (cls) images.push(cls);
    }

    const directors = [];
    const dirRegex = /<director[^>]*>([\s\S]*?)<\/director>/g;
    let dm;
    while ((dm = dirRegex.exec(inner)) !== null) directors.push(decodeXml(dm[1]));

    const actors = [];
    const actRegex = /<actor[^>]*>([\s\S]*?)<\/actor>/g;
    let am;
    while ((am = actRegex.exec(inner)) !== null) {
      actors.push({ name: decodeXml(am[1]), character: null, profile_image: null });
    }

    const fromTitle = parseProgramTitle(rawTitle);
    const fromNum = parseEpisodeNum(inner);

    const sub = subM ? cleanText(decodeXml(subM[1])) : null;
    const star = starM ? parseFloat(decodeXml(starM[1])) : NaN;

    programmes.push({
      channelId: decodeXml(chanM[1]),
      startMs,
      stopMs,
      rawTitle,
      cleanTitle: fromTitle.cleanTitle,
      prefix: fromTitle.prefix,
      season: fromNum.season !== null ? fromNum.season : fromTitle.season,
      episode: fromNum.episode !== null ? fromNum.episode : fromTitle.episode,
      episodeTitle: sub && normalizeName(sub) !== normalizeName(fromTitle.cleanTitle) && normalizeName(sub) !== normalizeName(rawTitle) ? sub : null,
      description: descM ? decodeXml(descM[1]) : '',
      categories,
      images,
      year: dateM ? (decodeXml(dateM[1]).match(/\d{4}/) || [null])[0] : null,
      country: countryM ? cleanText(decodeXml(countryM[1])) : null,
      language: langM ? cleanText(decodeXml(langM[1])) : null,
      ageRating: ageM ? cleanText(decodeXml(ageM[1])) : null,
      starRating: Number.isFinite(star) && star > 0 ? star : null,
      directors,
      actors,
      isLive: /مباشر|(^|[^\p{L}])live([^\p{L}]|$)/iu.test(rawTitle)
    });
  }
}

// ============================================================================
// CHANNEL LOGIC
// ============================================================================
function matchChannelRule(channelId, channelName) {
  const base = baseIdOf(channelId);
  const normName = normalizeName(channelName);
  for (let i = 0; i < CHANNEL_RULES.length; i++) {
    const r = CHANNEL_RULES[i];
    if (r.id.test(base) || normName === normalizeName(r.en) || normName === normalizeName(r.ar)) {
      return { rule: r, index: i };
    }
  }
  return null;
}

function categorizeChannelByName(channelId, name, nameAr) {
  const id = baseIdOf(channelId).toLowerCase();
  const text = `${id} ${String(name).toLowerCase()} ${nameAr || ''}`;
  for (const [cat, re] of CHANNEL_CATEGORY_RULES) {
    if (re.test(id) || re.test(text)) return cat;
  }
  return 'general';
}

function cleanChannelName(name) {
  const cleaned = name.replace(/\s+(HD|SD|FHD|UHD)$/i, '').replace(/\s+/g, ' ').trim();
  return cleaned || name;
}

const hasArabic = s => /[\u0600-\u06FF]/.test(s || '');

// ============================================================================
// MAIN PIPELINE
// ============================================================================
async function main() {
  const startedAt = Date.now();
  const nowTs = Math.floor(startedAt / 1000);

  // ---- 1. Parse guides ----------------------------------------------------
  const rawChannels = new Map();
  const programmes = [];
  for (const file of ['fast.xml', 'slow.xml']) {
    const fullPath = path.join(guidesDir, file);
    if (!fs.existsSync(fullPath)) continue;
    parseGuideFile(fs.readFileSync(fullPath, 'utf8'), rawChannels, programmes);
  }
  if (programmes.length === 0) {
    throw new Error('No programmes parsed from guides/*.xml - refusing to overwrite api/.');
  }

  const progsByChannel = new Map();
  for (const p of programmes) {
    if (!progsByChannel.has(p.channelId)) progsByChannel.set(p.channelId, []);
    progsByChannel.get(p.channelId).push(p);
  }

  // ---- 2. Select channels (logo, real programmes, dedupe) -------------------
  const { logosById, logosByName } = await fetchChannelLogos();
  const candidates = [];
  let droppedNoLogo = [];
  for (const ch of rawChannels.values()) {
    if (isJunkChannelName(ch.name) || /portrait/i.test(ch.id) || EXCLUDED_CHANNEL_RE.test(ch.id)) continue;
    const progs = (progsByChannel.get(ch.id) || []).filter(p => !isUnavailableProgram(p.rawTitle));
    if (progs.length === 0) continue;

    const icon =
      usableChannelIcon(ch.xmlIcon) ||
      logosById.get(baseIdOf(ch.id).toLowerCase()) ||
      logosByName.get(normalizeName(ch.name)) ||
      null;
    if (!icon) { droppedNoLogo.push(`${ch.id} (${progs.length} programmes)`); continue; }

    candidates.push({ id: ch.id, rawName: ch.name, icon, realCount: progs.length });
  }

  // Name-level dedupe: keep the feed with the most real programmes
  const byNorm = new Map();
  for (const c of candidates) {
    const key = normalizeName(c.rawName);
    const cur = byNorm.get(key);
    if (!cur || c.realCount > cur.realCount) byNorm.set(key, c);
  }
  let selected = Array.from(byNorm.values());

  // Single-feed rules (e.g. "Al Arabiya") keep only the feed with the most programmes
  const bestPerRule = new Map();
  for (const c of selected) {
    const m = matchChannelRule(c.id, c.rawName);
    if (!m || m.rule.multi) continue;
    const cur = bestPerRule.get(m.index);
    if (!cur || c.realCount > cur.realCount) bestPerRule.set(m.index, c);
  }
  selected = selected.filter(c => {
    const m = matchChannelRule(c.id, c.rawName);
    return !m || m.rule.multi || bestPerRule.get(m.index) === c;
  });

  // Rule matching, canonical names, categories
  const ruleUse = new Map();
  const channels = selected.map(c => {
    const match = matchChannelRule(c.id, c.rawName);
    let name = cleanChannelName(c.rawName);
    let nameAr = hasArabic(name) ? name : null;
    let tier = null;
    let ruleIndex = null;
    if (match) {
      tier = match.rule.tier;
      ruleIndex = match.index;
      ruleUse.set(match.index, (ruleUse.get(match.index) || 0) + 1);
    }
    return { ...c, name, nameAr, tier, ruleIndex, rule: match ? match.rule : null };
  });

  // Canonical names for single-feed rules (first feed with most programmes wins)
  const claimed = new Set();
  channels.sort((a, b) => b.realCount - a.realCount);
  for (const ch of channels) {
    const bein = ch.rule && ch.rule.en === 'beIN Sports' ? beinSportsNames(baseIdOf(ch.id)) : null;
    if (bein) {
      ch.name = bein.en;
      ch.nameAr = bein.ar;
    } else if (ch.rule && !ch.rule.multi && !claimed.has(ch.ruleIndex)) {
      claimed.add(ch.ruleIndex);
      ch.name = ch.rule.en;
      ch.nameAr = ch.rule.ar;
    }
  }
  for (const ch of channels) {
    ch.category = (ch.rule && ch.rule.category) || categorizeChannelByName(ch.id, ch.name, ch.nameAr || ch.rawName);
    ch.categoryFixed = !!(ch.rule && ch.rule.category);
    ch.safeId = safeFileId(ch.id);
    ch.utcOffset = COUNTRY_UTC_OFFSET[countryOf(ch.id)] ?? 3;
  }
  const channelById = new Map(channels.map(c => [c.id, c]));

  // ---- 3. Normalise slots per channel ------------------------------------------
  const slotsByChannel = new Map();
  for (const ch of channels) {
    const list = (progsByChannel.get(ch.id) || [])
      .filter(p => !isUnavailableProgram(p.rawTitle))
      .sort((a, b) => a.startMs - b.startMs);

    const dedup = [];
    for (const p of list) {
      const last = dedup[dedup.length - 1];
      if (last && last.startMs === p.startMs) {
        if (p.description.length > last.description.length) dedup[dedup.length - 1] = p;
        continue;
      }
      dedup.push(p);
    }

    const out = [];
    for (let i = 0; i < dedup.length; i++) {
      const p = dedup[i];
      const next = dedup[i + 1];
      let stopMs = p.stopMs;
      if (stopMs === null || stopMs <= p.startMs) stopMs = next ? next.startMs : p.startMs + 3600000;
      if (next && stopMs > next.startMs) stopMs = next.startMs; // trim overlaps
      if (stopMs <= p.startMs) continue;
      out.push({ ...p, startTs: Math.floor(p.startMs / 1000), stopTs: Math.floor(stopMs / 1000) });
    }
    slotsByChannel.set(ch.id, out);
  }

  // ---- 4. Group slots into show groups --------------------------------------------
  const groups = new Map();
  for (const ch of channels) {
    for (const s of slotsByChannel.get(ch.id)) {
      const normKey = normalizeName(s.cleanTitle) || s.rawTitle.toLowerCase();
      let g = groups.get(normKey);
      if (!g) {
        g = {
          key: normKey,
          titles: new Map(), rawTitles: [], categories: [], prefixes: new Set(),
          years: new Map(), countries: new Map(), languages: new Map(), ageRatings: new Map(),
          descriptions: new Map(), posters: new Map(), backdrops: new Map(),
          starRatings: [], directors: new Map(), actors: new Map(),
          hasEpisodeInfo: false, airings: 0, durations: [], channelCats: new Map(), channelNames: new Set(),
          slots: []
        };
        groups.set(normKey, g);
      }
      bump(g.titles, s.cleanTitle);
      if (g.rawTitles.length < 3) g.rawTitles.push(s.rawTitle);
      for (const c of s.categories) if (!g.categories.includes(c)) g.categories.push(c);
      if (s.prefix) g.prefixes.add(s.prefix);
      bump(g.years, s.year);
      bump(g.countries, s.country);
      bump(g.languages, s.language);
      bump(g.ageRatings, s.ageRating);
      if (s.description) bump(g.descriptions, s.description);
      for (const img of s.images) bump(img.kind === 'poster' ? g.posters : g.backdrops, img.url);
      if (s.starRating) g.starRatings.push(s.starRating);
      for (const d of s.directors) bump(g.directors, d);
      for (const a of s.actors) if (!g.actors.has(a.name)) g.actors.set(a.name, a);
      if (s.season !== null || s.episode !== null) g.hasEpisodeInfo = true;
      g.airings++;
      g.durations.push((s.stopTs - s.startTs) / 60);
      bump(g.channelCats, ch.category);
      g.channelNames.add(normalizeName(ch.name));
      g.slots.push(s);
    }
  }

  for (const g of groups.values()) {
    g.cleanTitle = mode(g.titles) || g.rawTitles[0];
    g.year = mode(g.years);
    const primaryChannelName = g.slots.length ? channelById.get(g.slots[0].channelId).name : '';
    g.filler = isFillerTitle(g.cleanTitle, primaryChannelName) ||
      (g.channelNames.size === 1 && g.slots.every(s => normalizeName(s.cleanTitle) === normalizeName(channelById.get(s.channelId).name)));
    g.preType = inferContentTypeForGroup(g, null);
  }

  // ---- 5. Enrichment ------------------------------------------------------------------
  const ENRICHABLE = new Set(['movie', 'series', 'animation', 'documentary', 'program']);
  const toEnrich = [];
  const toRefresh = [];
  for (const g of groups.values()) {
    if (g.filler || !ENRICHABLE.has(g.preType) || g.cleanTitle.length < 2) continue;
    const cacheKey = `${g.key}_${g.year || ''}`;
    g.cacheKey = cacheKey;
    const cached = metadataCache[cacheKey];
    if (cached === undefined) toEnrich.push(g);
    else if (cached && cached.tmdb_id && cached.fv !== ENTRY_FORMAT) toRefresh.push({ entry: cached, title: g.cleanTitle });
  }

  if (!OFFLINE && !TMDB_API_KEY) {
    console.warn('⚠️  TMDB_API_KEY is not set: skipping enrichment, using metadata_cache.json only.');
  }
  if (OFFLINE || !TMDB_API_KEY) {
    if (OFFLINE) console.log('📴 OFFLINE mode: using metadata_cache.json only.');
  } else {
    let transientFailures = 0;

    if (toRefresh.length) {
      const budget = toRefresh.slice(0, MAX_REFRESH_PER_RUN);
      console.log(`♻️  Refreshing ${budget.length} legacy cache entries (trailers, certifications, backdrops)...`);
      let n = 0;
      for (const { entry, title } of budget) {
        try { await refreshLegacyEntry(entry, title); } catch { transientFailures++; }
        if (++n % 25 === 0) { saveCache(); process.stdout.write(`   Refreshed ${n}/${budget.length}...\r`); }
        await sleep(40);
      }
      saveCache();
      console.log(`\n✅ Legacy refresh done.`);
    }

    console.log(`🔍 Enriching ${toEnrich.length} new unique shows...`);
    let n = 0;
    for (const g of toEnrich) {
      try {
        await enrichProgramMetadata(g.cleanTitle, g.year, g.categories.join(' '));
      } catch (err) {
        if (err instanceof TransientError) transientFailures++; // NOT cached: retried next run
      }
      if (++n % 15 === 0) { saveCache(); process.stdout.write(`   Enriched ${n}/${toEnrich.length}...\r`); }
      await sleep(60);
    }
    saveCache();
    console.log(`\n✅ Enrichment completed (${transientFailures} transient failures will be retried next run).`);
  }

  // ---- 6. Build shows ------------------------------------------------------------------------
  const trustedEnriched = e => {
    if (!e) return null;
    if (e.tmdb_id && e.verified !== true) return null; // unverified match: ignore, never guess
    return e;
  };

  const trustedRating = e => {
    if (!e || !e.rating) return null;
    if (e.vote_count == null) return e.tmdb_id ? null : e.rating; // TVMaze rating has no vote count
    return e.vote_count >= MIN_VOTES_FOR_RATING ? e.rating : null;
  };

  const droppedUnverified = [];
  const sortedGroups = Array.from(groups.values()).sort((a, b) => b.airings - a.airings);
  const showsById = new Map();
  const groupShowId = new Map();

  for (const g of sortedGroups) {
    const rawEntry = g.filler || !ENRICHABLE.has(g.preType) ? null : (metadataCache[g.cacheKey] || null);
    const enriched = trustedEnriched(rawEntry);
    if (rawEntry && rawEntry.tmdb_id && !enriched) {
      droppedUnverified.push(`${g.cleanTitle} => ${rawEntry.tmdb_title || rawEntry.original_title}`);
    }

    let showId;
    if (enriched && enriched.tmdb_id) {
      const media = enriched.tmdb_media || (enriched.seasons_count != null || enriched.content_type === 'series' ? 'tv' : 'movie');
      showId = `${media === 'tv' ? 'tv' : 'mv'}${enriched.tmdb_id}`;
    } else {
      showId = `x${shortHash(g.key)}`;
    }

    groupShowId.set(g.key, showId);
    if (showsById.has(showId)) {
      const existing = showsById.get(showId);
      existing._airingsTotal += g.airings;
      for (const d of g.durations) existing._durations.push(d);
      for (const [cat, n] of g.channelCats) bump(existing._channelCats, cat, n);
      continue;
    }

    const epgDesc = Array.from(g.descriptions.entries()).sort((a, b) => b[0].length - a[0].length)[0];
    const description = (epgDesc && epgDesc[0]) || (enriched && enriched.description) || '';

    const tmdbPoster = enriched && isValidPosterUrl(enriched.poster) ? cleanUrl(enriched.poster) : null;
    const epgPoster = mode(g.posters);
    const poster = tmdbPoster || epgPoster || null;
    const backdrop = cleanUrl(enriched && enriched.backdrop) || mode(g.backdrops) || null;

    const rating = trustedRating(enriched) ?? (g.starRatings.length ? g.starRatings[0] : null);
    const metaGenres = [];
    for (const gen of [...((enriched && enriched.genres) || []), ...g.categories]) {
      const t = cleanText(gen);
      if (t && !META_CATEGORIES.has(t.toLowerCase()) && !metaGenres.includes(t)) metaGenres.push(t);
    }

    const epgCast = Array.from(g.actors.values()).slice(0, 6);
    const cast = ((enriched && enriched.cast) || epgCast)
      .filter(a => a && cleanText(a.name))
      .map(a => ({ name: a.name.trim(), character: cleanText(a.character), profile_image: cleanUrl(a.profile_image) }));

    const original = enriched ? cleanText(enriched.original_title) : null;
    const i18n = (enriched && enriched.i18n) || null;
    const sameAsMain = t => !t || normalizeName(t) === normalizeName(g.cleanTitle);

    showsById.set(showId, {
      show_id: showId,
      tmdb_id: (enriched && enriched.tmdb_id) || null,
      content_type: null, // resolved below
      title: g.cleanTitle,
      original_title: original && normalizeName(original) !== normalizeName(g.cleanTitle) ? original : null,
      title_en: i18n && !sameAsMain(i18n.en.title) ? i18n.en.title : null,
      title_fr: i18n && !sameAsMain(i18n.fr.title) ? i18n.fr.title : null,
      description,
      description_en: i18n ? i18n.en.overview : '',
      description_fr: i18n ? i18n.fr.overview : '',
      tagline: cleanText(enriched && enriched.tagline),
      runtime_minutes: (enriched && enriched.runtime) || null,
      release_date: cleanText(enriched && enriched.release_date),
      status: cleanText(enriched && enriched.status),
      poster,
      backdrop,
      has_poster: !!poster,
      rating: rating || null,
      vote_count: rating && enriched && enriched.vote_count ? enriched.vote_count : null,
      age_rating: cleanText((enriched && enriched.age_rating) || mode(g.ageRatings)),
      year: cleanText((enriched && enriched.year) || g.year),
      country: cleanText((enriched && enriched.country) || mode(g.countries)),
      language: cleanText((enriched && enriched.language) || mode(g.languages)),
      genres: metaGenres,
      genre_keys: genreKeysFor(metaGenres),
      similar: [],
      director: cleanText((enriched && enriched.director) || mode(g.directors)),
      cast,
      trailer_url: cleanUrl(enriched && enriched.trailer_url),
      seasons_count: (enriched && enriched.seasons_count) || null,
      episodes_count: (enriched && enriched.episodes_count) || null,
      all_airings: [],
      _filler: g.filler,
      _enriched: enriched,
      _group: g,
      _airingsTotal: g.airings,
      _durations: [...g.durations],
      _channelCats: new Map(g.channelCats)
    });
  }

  // ---- 7. Channel categories refinement (content mix) & content types ------------------------
  const preTypeByShow = new Map();
  for (const show of showsById.values()) {
    const g = show._group;
    let type = inferContentTypeForGroup(g, show._enriched);
    if (type === 'program' && !show._filler) {
      const topCat = mode(show._channelCats);
      const sorted = [...show._durations].sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      if (topCat === 'movies' && median >= 75) type = 'movie';
      else if (topCat === 'sports') type = 'sports';
      else if (topCat === 'news') type = 'news';
      else if (topCat === 'kids') type = 'animation';
      else if (topCat === 'documentary') type = 'documentary';
      else if (topCat === 'drama') type = 'series';
    }
    show.content_type = type;
    const typeGenre = { animation: 'animation', documentary: 'documentary', sports: 'sports', news: 'news' }[type];
    if (typeGenre && !show.genre_keys.includes(typeGenre)) show.genre_keys.push(typeGenre);
    preTypeByShow.set(show.show_id, type);
  }

  const TYPE_TO_CHANNEL_CAT = { movie: 'movies', series: 'drama', sports: 'sports', news: 'news', animation: 'kids', documentary: 'documentary' };
  for (const ch of channels) {
    if (ch.category !== 'general' || ch.categoryFixed) continue;
    const minutes = new Map();
    let total = 0;
    for (const s of slotsByChannel.get(ch.id)) {
      const g = groups.get(normalizeName(s.cleanTitle) || s.rawTitle.toLowerCase());
      const show = showsById.get(groupShowId.get(g.key));
      const cat = TYPE_TO_CHANNEL_CAT[show.content_type];
      if (!cat || show._filler) continue;
      const mins = (s.stopTs - s.startTs) / 60;
      bump(minutes, cat, mins);
      total += mins;
    }
    const top = mode(minutes);
    if (top && total > 0 && minutes.get(top) / total >= 0.65) ch.category = top;
  }

  // ---- 8. Final slots, airings, reruns ---------------------------------------------------------------
  const finalSlotsByChannel = new Map();
  const airingsByShow = new Map();
  const episodeKeyOf = (show, s) => {
    if (s.episode !== null) return `s${s.season || 0}e${s.episode}`;
    if (s.episodeTitle) return `t:${normalizeName(s.episodeTitle)}`;
    if (show.content_type === 'movie' || show.content_type === 'documentary') return 'single';
    return null;
  };
  const firstStartByEpisode = new Map();

  for (const ch of channels) {
    const out = [];
    for (const s of slotsByChannel.get(ch.id)) {
      const g = groups.get(normalizeName(s.cleanTitle) || s.rawTitle.toLowerCase());
      const showId = groupShowId.get(g.key);
      const show = showsById.get(showId);
      const epKey = episodeKeyOf(show, s);
      const slot = {
        show_id: showId,
        start: tsToIso(s.startTs),
        stop: tsToIso(s.stopTs),
        start_ts: s.startTs,
        stop_ts: s.stopTs,
        duration_minutes: Math.round((s.stopTs - s.startTs) / 60),
        season: s.season,
        episode: s.episode,
        episode_title: s.episodeTitle,
        is_live: s.isLive,
        is_rerun: false,
        _epKey: epKey,
        _channelId: ch.id
      };
      out.push(slot);
      if (epKey) {
        const k = `${showId}|${epKey}`;
        if (!firstStartByEpisode.has(k) || firstStartByEpisode.get(k) > s.startTs) firstStartByEpisode.set(k, s.startTs);
      }
      if (!airingsByShow.has(showId)) airingsByShow.set(showId, []);
      airingsByShow.get(showId).push({
        channel_id: ch.id,
        start: slot.start,
        stop: slot.stop,
        start_ts: slot.start_ts,
        stop_ts: slot.stop_ts,
        season: s.season,
        episode: s.episode
      });
    }
    finalSlotsByChannel.set(ch.id, out);
  }
  for (const slots of finalSlotsByChannel.values()) {
    for (const slot of slots) {
      if (slot._epKey) slot.is_rerun = firstStartByEpisode.get(`${slot.show_id}|${slot._epKey}`) < slot.start_ts;
    }
  }
  for (const [showId, list] of airingsByShow) {
    list.sort((a, b) => a.start_ts - b.start_ts || a.channel_id.localeCompare(b.channel_id));
    showsById.get(showId).all_airings = list;
  }

  // ---- 9. Channel ordering ------------------------------------------------------------------------------
  const collator = new Intl.Collator('en', { numeric: true });
  const sortName = c => c.name;
  channels.sort((a, b) => {
    const ta = a.tier || 99;
    const tb = b.tier || 99;
    if (ta !== tb) return ta - tb;
    if (a.tier) {
      if (a.ruleIndex !== b.ruleIndex) return a.ruleIndex - b.ruleIndex;
      return collator.compare(sortName(a), sortName(b));
    }
    return collator.compare(sortName(a), sortName(b));
  });

  // ---- 10. Compose outputs ----------------------------------------------------------------------------------
  const generatedAt = new Date(startedAt).toISOString();
  const channelsDoc = {
    schema_version: SCHEMA_VERSION,
    updated_at: generatedAt,
    now_and_next_as_of_ts: nowTs,
    categories: CHANNEL_CATEGORIES,
    count: channels.length,
    channels: channels.map((ch, i) => {
      const slots = finalSlotsByChannel.get(ch.id);
      let startIdx = slots.findIndex(s => s.stop_ts > nowTs);
      if (startIdx === -1) startIdx = slots.length;
      const preview = slots.slice(startIdx, startIdx + NOW_AND_NEXT_COUNT).map(s => {
        const show = showsById.get(s.show_id);
        return {
          show_id: s.show_id,
          title: show.title,
          content_type: show.content_type,
          poster: show.poster,
          backdrop: show.backdrop,
          is_live: s.is_live,
          start: s.start,
          stop: s.stop,
          start_ts: s.start_ts,
          stop_ts: s.stop_ts
        };
      });
      return {
        id: ch.id,
        safe_id: ch.safeId,
        name: ch.name,
        name_ar: ch.nameAr || null,
        icon: ch.icon,
        category: ch.category,
        country: countryOf(ch.id).toUpperCase() || null,
        utc_offset_hours: ch.utcOffset,
        tier: ch.tier || null,
        rank: i + 1,
        now_and_next: preview
      };
    })
  };

  const channelFiles = new Map();
  for (const ch of channels) {
    const slots = finalSlotsByChannel.get(ch.id);
    const days = {};
    const used = new Set();
    for (const s of slots) {
      const day = tsToDay(s.start_ts);
      if (!days[day]) days[day] = [];
      const { _epKey, _channelId, ...pub } = s;
      days[day].push(pub);
      used.add(s.show_id);
    }
    const shows = {};
    for (const id of used) {
      const sh = showsById.get(id);
      shows[id] = publicShow(sh);
    }
    const sortedDays = {};
    Object.keys(days).sort().forEach(k => { sortedDays[k] = days[k]; });
    channelFiles.set(ch.safeId, {
      schema_version: SCHEMA_VERSION,
      updated_at: generatedAt,
      channel_id: ch.id,
      channel_name: ch.name,
      channel_name_ar: ch.nameAr || null,
      channel_icon: ch.icon,
      category: ch.category,
      days_count: Object.keys(sortedDays).length,
      days: sortedDays,
      shows
    });
  }

  function publicShow(sh) {
    return {
      show_id: sh.show_id,
      tmdb_id: sh.tmdb_id,
      content_type: sh.content_type,
      title: sh.title,
      title_en: sh.title_en,
      title_fr: sh.title_fr,
      original_title: sh.original_title,
      tagline: sh.tagline,
      description: sh.description,
      description_en: sh.description_en,
      description_fr: sh.description_fr,
      poster: sh.poster,
      backdrop: sh.backdrop,
      has_poster: sh.has_poster,
      rating: sh.rating,
      vote_count: sh.vote_count,
      age_rating: sh.age_rating,
      year: sh.year,
      release_date: sh.release_date,
      runtime_minutes: sh.runtime_minutes,
      status: sh.status,
      country: sh.country,
      language: sh.language,
      genres: sh.genres,
      genre_keys: sh.genre_keys,
      similar: sh.similar,
      director: sh.director,
      cast: sh.cast,
      trailer_url: sh.trailer_url,
      seasons_count: sh.seasons_count,
      episodes_count: sh.episodes_count,
      all_airings: sh.all_airings
    };
  }

  // ---- Search index & featured ----------------------------------------------------------------------------------
  const richAiring = a => {
    const ch = channelById.get(a.channel_id);
    return {
      channel_id: a.channel_id,
      channel_name: ch.name,
      channel_icon: ch.icon,
      start: a.start,
      stop: a.stop,
      start_ts: a.start_ts,
      stop_ts: a.stop_ts,
      season: a.season,
      episode: a.episode
    };
  };

  // Compact airing for the big search index: the app joins channels.json for name/icon
  // and derives ISO strings from the timestamps. Null episode info is omitted.
  const compactAiring = a => {
    const o = { channel_id: a.channel_id, start_ts: a.start_ts, stop_ts: a.stop_ts };
    if (a.season !== null) o.season = a.season;
    if (a.episode !== null) o.episode = a.episode;
    return o;
  };

  const bayes = sh => {
    if (!sh.rating) return 0;
    const v = sh.vote_count == null ? 10 : sh.vote_count;
    return (v / (v + 50)) * sh.rating + (50 / (v + 50)) * 6.5;
  };
  const visualScore = sh =>
    (sh.poster ? (isLowResPoster(sh.poster) ? 10 : 30) : 0) + (sh.backdrop ? 5 : 0);
  const rankScore = sh =>
    visualScore(sh) + bayes(sh) * 2 + Math.min(sh.all_airings.length, 10) * 0.1;

  const searchable = [];
  for (const sh of showsById.values()) {
    if (sh._filler) continue;
    if (sh.content_type === 'music') continue;
    if (sh.all_airings.length === 0) continue;
    if (sh.content_type === 'news' && !sh.poster && !sh.backdrop) continue; // bulletins without art
    searchable.push(sh);
  }
  searchable.sort((a, b) => rankScore(b) - rankScore(a) || a.title.localeCompare(b.title, 'ar'));

  // "More like this": same type, overlapping genres, with art, best-rated first
  const similarPool = searchable.filter(sh => sh.genre_keys.length && (sh.poster || sh.backdrop));
  for (const sh of searchable) {
    if (!sh.genre_keys.length) continue;
    const scored = [];
    for (const o of similarPool) {
      if (o === sh || o.content_type !== sh.content_type) continue;
      const shared = o.genre_keys.filter(k => sh.genre_keys.includes(k)).length;
      if (!shared) continue;
      scored.push([shared * 3 + bayes(o) / 3 + (o.poster && !isLowResPoster(o.poster) ? 1 : 0), o.show_id]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    sh.similar.push(...scored.slice(0, 8).map(x => x[1])); // in place: channel files already hold this array
  }

  const searchIndex = searchable.map(sh => ({
    show_id: sh.show_id,
    tmdb_id: sh.tmdb_id,
    title: sh.title,
    title_en: sh.title_en,
    title_fr: sh.title_fr,
    original_title: sh.original_title,
    search_text: [sh.title, sh.title_en, sh.title_fr, sh.original_title]
      .filter(Boolean).map(t => normalizeName(t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
      .filter((t, i, a) => a.indexOf(t) === i).join(' '),
    content_type: sh.content_type,
    genres: sh.genres,
    genre_keys: sh.genre_keys,
    rating: sh.rating,
    vote_count: sh.vote_count,
    year: sh.year,
    poster: sh.poster,
    backdrop: sh.backdrop,
    has_poster: sh.has_poster,
    airings_count: sh.all_airings.length,
    age_rating: sh.age_rating,
    runtime_minutes: sh.runtime_minutes,
    airings: sh.all_airings.map(compactAiring)
  }));

  const hasUpcoming = sh => sh.all_airings.some(a => a.stop_ts > nowTs);
  const featuredCard = (sh, airings) => ({
    show_id: sh.show_id,
    tmdb_id: sh.tmdb_id,
    title: sh.title,
    title_en: sh.title_en,
    title_fr: sh.title_fr,
    original_title: sh.original_title,
    content_type: sh.content_type,
    description: sh.description,
    description_en: sh.description_en,
    description_fr: sh.description_fr,
    tagline: sh.tagline,
    runtime_minutes: sh.runtime_minutes,
    genres: sh.genres,
    genre_keys: sh.genre_keys,
    rating: sh.rating,
    vote_count: sh.vote_count,
    year: sh.year,
    age_rating: sh.age_rating,
    poster: sh.poster,
    backdrop: sh.backdrop,
    has_poster: sh.has_poster,
    trailer_url: sh.trailer_url,
    airings_count: sh.all_airings.length,
    airings: airings.map(richAiring)
  });
  const upcomingFirst = list =>
    [...list.filter(a => a.stop_ts > nowTs), ...list.filter(a => a.stop_ts <= nowTs)];

  // hero_featured: movies/series with a widescreen backdrop and a trustworthy rating
  const heroPool = searchable.filter(sh =>
    (sh.content_type === 'movie' || sh.content_type === 'series') && sh.backdrop && hasUpcoming(sh) && sh.rating);
  const heroStrict = heroPool.filter(sh => sh.rating >= 7 && (sh.vote_count || 0) >= MIN_VOTES_FOR_FEATURED);
  const heroRelaxed = heroPool.filter(sh => sh.rating >= 6 && !heroStrict.includes(sh));
  const heroPicked = [];
  const perType = { movie: 0, series: 0 };
  for (const sh of [...heroStrict.sort((a, b) => bayes(b) - bayes(a)), ...heroRelaxed.sort((a, b) => bayes(b) - bayes(a))]) {
    if (heroPicked.length >= HERO_COUNT) break;
    if (perType[sh.content_type] >= Math.ceil(HERO_COUNT * 0.6)) continue;
    perType[sh.content_type]++;
    heroPicked.push(sh);
  }

  // tonight_movies: movies whose start falls into channel-local prime time within the next 36h
  const primeWindowEnd = nowTs + PRIME_WINDOW_HOURS * 3600;
  const tonight = [];
  for (const sh of searchable) {
    if (sh.content_type !== 'movie') continue;
    const prime = sh.all_airings.filter(a => {
      if (a.stop_ts <= nowTs || a.start_ts > primeWindowEnd) return false;
      const off = channelById.get(a.channel_id).utcOffset;
      const localHour = new Date((a.start_ts + off * 3600) * 1000).getUTCHours();
      return localHour >= PRIME_TIME_FIRST_HOUR;
    });
    if (prime.length) tonight.push({ sh, prime });
  }
  tonight.sort((a, b) => rankScore(b.sh) - rankScore(a.sh));
  const tonightPicked = tonight.slice(0, 20);

  // top_series: best-rated series (bayesian-weighted) with art
  const topSeries = searchable
    .filter(sh => sh.content_type === 'series' && sh.rating && (sh.vote_count || 0) >= MIN_VOTES_FOR_RATING && (sh.poster || sh.backdrop) && hasUpcoming(sh))
    .sort((a, b) => bayes(b) - bayes(a))
    .slice(0, 20);

  const shelfOf = (type, minRating, limit) => searchable
    .filter(sh => sh.content_type === type && (sh.poster || sh.backdrop) && hasUpcoming(sh) && (!minRating || (sh.rating && sh.rating >= minRating)))
    .sort((a, b) => rankScore(b) - rankScore(a))
    .slice(0, limit);
  const topMovies = searchable
    .filter(sh => sh.content_type === 'movie' && sh.rating && (sh.vote_count || 0) >= MIN_VOTES_FOR_RATING && sh.poster && hasUpcoming(sh))
    .sort((a, b) => bayes(b) - bayes(a))
    .slice(0, 20);
  const kidsPicks = shelfOf('animation', 0, 20);
  const documentaries = shelfOf('documentary', 0, 20);
  const sportsHighlights = shelfOf('sports', 0, 20);

  const featuredDoc = {
    schema_version: SCHEMA_VERSION,
    updated_at: generatedAt,
    prime_time: { first_local_hour: PRIME_TIME_FIRST_HOUR, window_hours: PRIME_WINDOW_HOURS, as_of_ts: nowTs },
    hero_featured: heroPicked.map(sh => featuredCard(sh, upcomingFirst(sh.all_airings).slice(0, 6))),
    tonight_movies: tonightPicked.map(t => featuredCard(t.sh, t.prime.slice(0, 6))),
    top_series: topSeries.map(sh => featuredCard(sh, upcomingFirst(sh.all_airings).slice(0, 6))),
    top_movies: topMovies.map(sh => featuredCard(sh, upcomingFirst(sh.all_airings).slice(0, 6))),
    kids_picks: kidsPicks.map(sh => featuredCard(sh, upcomingFirst(sh.all_airings).slice(0, 6))),
    documentaries: documentaries.map(sh => featuredCard(sh, upcomingFirst(sh.all_airings).slice(0, 6))),
    sports_highlights: sportsHighlights.map(sh => featuredCard(sh, upcomingFirst(sh.all_airings).slice(0, 6)))
  };

  const searchDoc = {
    schema_version: SCHEMA_VERSION,
    updated_at: generatedAt,
    count: searchIndex.length,
    items: searchIndex
  };

  // grid.json: every channel's full week in a compact tuple form so the app can show an
  // accurate "now playing" for all channels (and render a schedule) without per-channel downloads.
  // slot = [start_ts, stop_ts, show_id, flags(1=live,2=rerun), season|0, episode|0]
  const gridChannels = {};
  const gridShowIds = new Set();
  for (const ch of channels) {
    gridChannels[ch.id] = finalSlotsByChannel.get(ch.id).map(s => {
      gridShowIds.add(s.show_id);
      return [s.start_ts, s.stop_ts, s.show_id, (s.is_live ? 1 : 0) | (s.is_rerun ? 2 : 0), s.season || 0, s.episode || 0];
    });
  }
  const gridShows = {};
  for (const id of gridShowIds) {
    const sh = showsById.get(id);
    const o = { t: sh.title, c: sh.content_type };
    if (sh.title_en) o.te = sh.title_en;
    if (sh.title_fr) o.tf = sh.title_fr;
    gridShows[id] = o;
  }
  const gridDoc = {
    schema_version: SCHEMA_VERSION,
    updated_at: generatedAt,
    slot_format: ['start_ts', 'stop_ts', 'show_id', 'flags(1=live,2=rerun)', 'season', 'episode'],
    channels: gridChannels,
    shows: gridShows
  };

  const metaDoc = {
    schema_version: SCHEMA_VERSION,
    updated_at: generatedAt,
    generated_ts: nowTs,
    files: ['channels.json', 'grid.json', 'featured.json', 'search_index.json'],
    channels: channels.length,
    shows: showsById.size,
    searchable_shows: searchIndex.length,
    channel_categories: CHANNEL_CATEGORIES,
    content_types: ['movie', 'series', 'animation', 'documentary', 'sports', 'news', 'program'],
    genres: Object.fromEntries(Object.entries(GENRES).map(([k, g]) => [k, { ar: g.ar, en: g.en, fr: g.fr }])),
    days: Array.from(new Set(slotsAllDays())).sort()
  };
  function slotsAllDays() {
    const set = [];
    for (const slots of finalSlotsByChannel.values()) for (const s of slots) set.push(tsToDay(s.start_ts));
    return set;
  }

  // ---- 11. Validate BEFORE touching api/ ----------------------------------------------------------------------------------------
  const problems = validateOutputs({ channelsDoc, channelFiles, searchDoc, featuredDoc, showsById, gridDoc });
  if (problems.length) {
    console.error(`❌ Validation failed with ${problems.length} problem(s); api/ left untouched:`);
    problems.slice(0, 40).forEach(p => console.error('   - ' + p));
    process.exit(1);
  }

  // ---- 12. Write ----------------------------------------------------------------------------------------------------------------------
  const ser = obj => JSON.stringify(obj, null, PRETTY ? 2 : 0);
  if (fs.existsSync(programsDir)) fs.rmSync(programsDir, { recursive: true, force: true });
  fs.mkdirSync(programsDir, { recursive: true });
  for (const [safeId, doc] of channelFiles) {
    fs.writeFileSync(path.join(programsDir, `${safeId}.json`), ser(doc), 'utf8');
  }
  fs.writeFileSync(path.join(apiDir, 'channels.json'), ser(channelsDoc), 'utf8');
  fs.writeFileSync(path.join(apiDir, 'featured.json'), ser(featuredDoc), 'utf8');
  fs.writeFileSync(path.join(apiDir, 'search_index.json'), ser(searchDoc), 'utf8');
  fs.writeFileSync(path.join(apiDir, 'grid.json'), ser(gridDoc), 'utf8');
  fs.writeFileSync(path.join(apiDir, 'meta.json'), ser(metaDoc), 'utf8');

  // ---- 13. Report ----------------------------------------------------------------------------------------------------------------------
  const catCounts = {};
  channels.forEach(c => { catCounts[c.category] = (catCounts[c.category] || 0) + 1; });
  const typeCounts = {};
  searchable.forEach(s => { typeCounts[s.content_type] = (typeCounts[s.content_type] || 0) + 1; });
  const withPoster = searchable.filter(s => s.poster).length;
  const withRating = searchable.filter(s => s.rating).length;
  const unmatchedRules = CHANNEL_RULES.filter((_, i) => !ruleUse.has(i)).map(r => r.en);

  console.log(`🎉 Generated ${channels.length} channel schedules, ${showsById.size} unique shows.`);
  console.log(`📺 Channel categories: ${JSON.stringify(catCounts)}`);
  console.log(`🔎 search_index: ${searchIndex.length} shows (${withPoster} with poster, ${withRating} with rating) ${JSON.stringify(typeCounts)}`);
  console.log(`⭐ featured: hero=${heroPicked.length} tonight=${tonightPicked.length} series=${topSeries.length} movies=${topMovies.length} kids=${kidsPicks.length} docs=${documentaries.length} sports=${sportsHighlights.length}`);
  if (droppedUnverified.length) console.log(`🧹 Ignored ${droppedUnverified.length} unverified TMDB matches, e.g. ${droppedUnverified.slice(0, 10).join(' ; ')}`);
  if (droppedNoLogo.length) console.log(`🖼️  Skipped ${droppedNoLogo.length} channel(s) without a logo: ${droppedNoLogo.slice(0, 12).join(', ')}${droppedNoLogo.length > 12 ? ', …' : ''}`);
  if (unmatchedRules.length) console.log(`ℹ️  Priority rules with no channel in this run: ${unmatchedRules.join(', ')}`);
}

// ============================================================================
// VALIDATION (null-safety contract)
// ============================================================================
const URL_KEYS = new Set(['icon', 'channel_icon', 'poster', 'backdrop', 'trailer_url', 'profile_image']);
const ARRAY_KEYS = new Set(['cast', 'genres', 'genre_keys', 'similar', 'all_airings', 'airings', 'now_and_next', 'channels', 'items']);

function validateOutputs({ channelsDoc, channelFiles, searchDoc, featuredDoc, showsById, gridDoc }) {
  const problems = [];
  const push = msg => { if (problems.length < 500) problems.push(msg); };

  const walk = (val, where, key) => {
    if (val === undefined) { push(`${where}: undefined`); return; }
    if (typeof val === 'number' && !Number.isFinite(val)) push(`${where}: non-finite number`);
    if (typeof val === 'string') {
      if (/^(null|undefined|nan)$/i.test(val.trim())) push(`${where}: string "${val}"`);
      if (URL_KEYS.has(key) && !/^https:\/\/\S+$/.test(val)) push(`${where}: invalid URL "${val.slice(0, 60)}"`);
      if (/^description/.test(key || '') && val !== val.trim()) push(`${where}: untrimmed description`);
    }
    if (val === null && /^description/.test(key || '')) push(`${where}: ${key} must be "" not null`);
    if (val !== null && URL_KEYS.has(key) && typeof val !== 'string') push(`${where}: URL not string`);
    if (ARRAY_KEYS.has(key) && !Array.isArray(val)) push(`${where}: expected array`);
    if (Array.isArray(val)) val.forEach((v, i) => walk(v, `${where}[${i}]`, null));
    else if (val && typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) walk(v, `${where}.${k}`, k);
    }
  };

  walk(channelsDoc, 'channels.json');
  walk(searchDoc, 'search_index.json');
  walk(featuredDoc, 'featured.json');
  for (const [id, doc] of channelFiles) {
    walk(doc, `programs/${id}`);
    for (const [day, slots] of Object.entries(doc.days)) {
      for (const s of slots) {
        if (!doc.shows[s.show_id]) push(`programs/${id}: slot references unknown show ${s.show_id}`);
        if (!(s.stop_ts > s.start_ts)) push(`programs/${id}: non-positive duration at ${s.start}`);
        if (tsToDay(s.start_ts) !== day) push(`programs/${id}: slot in wrong day bucket ${s.start}`);
      }
    }
    for (const [sid, sh] of Object.entries(doc.shows)) {
      if (typeof sh.description !== 'string') push(`programs/${id}.shows.${sid}: description not string`);
      if (sh.has_poster !== !!sh.poster) push(`programs/${id}.shows.${sid}: has_poster mismatch`);
      for (const k of ['description_en', 'description_fr']) if (typeof sh[k] !== 'string') push(`programs/${id}.shows.${sid}: ${k} not string`);
    }
  }
  const ids = new Set(searchDoc.items.map(i => i.show_id));
  if (ids.size !== searchDoc.items.length) push('search_index.json: duplicate show_id');
  for (const k of ['hero_featured', 'tonight_movies', 'top_series', 'top_movies', 'kids_picks', 'documentaries', 'sports_highlights']) {
    for (const f of featuredDoc[k]) if (!ids.has(f.show_id)) push(`featured.${k}: ${f.show_id} missing from search_index`);
  }
  for (const [cid, slots] of Object.entries(gridDoc.channels)) {
    for (const t of slots) {
      if (!gridDoc.shows[t[2]]) push(`grid.json: ${cid} references unknown show ${t[2]}`);
      if (!(t[1] > t[0])) push(`grid.json: ${cid} non-positive duration`);
    }
  }
  void showsById;
  return problems;
}

if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}

module.exports = { fetchTmdbDetail, mapTranslations, parseProgramTitle, isFillerTitle, cleanUrl, normalizeName, xmltvToMs, categorizeChannelByName, matchChannelRule };
