const fs = require('fs');
const path = require('path');

const guidesDir = path.join(__dirname, 'guides');
const apiDir = path.join(__dirname, 'api');
const programsDir = path.join(apiDir, 'programs');
const cacheFile = path.join(__dirname, 'metadata_cache.json');

const CACHE_VERSION = 6;
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

const PRIORITY_ORDER = [
  'mbc1', 'mbc2', 'mbcmasr', 'aljazeera', 'beinsports', 'mbcdrama', 'alarabiya',
  'mbcaction', 'mbcmax', 'rotanacinema', 'spacetoon', 'nationalgeographicabudhabi',
  'dmc', 'on.', 'one.', 'dubaione', 'beinmovies', 'alhadath', 'rotanakhalijiah',
  'cbc', 'alnahar', 'abudhabitv', 'dubaitv', 'mbc3', 'mbc4', '2m.ma',
  'mbciraq', 'rotanadrama', 'ssc', 'skynewsarabia', 'roya', 'saudiatv',
  'echorouk', 'ennahar', 'lbci', 'mtv.lb', 'abudhabisports', 'alkass',
  'elwatania', 'alhayah', 'asharq', 'samadubai', 'aljadeed', 'iqraa'
];

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
  de: 'ألمانية', it: 'الإيطالية', ru: 'الروسية', pt: 'البرتغالية'
};

const BLOCKED_WIKIDATA_TYPES = new Set([
  'Q5', 'Q515', 'Q6256', 'Q4167410', 'Q13442814', 'Q482994', 'Q7366'
]);

const ALLOWED_WIKIDATA_TYPES = new Set([
  'Q11424', 'Q5398426', 'Q581714', 'Q202866', 'Q15416',
  'Q1259759', 'Q24856', 'Q21191270', 'Q506240'
]);

let metadataCache = { _version: CACHE_VERSION };
if (fs.existsSync(cacheFile)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (parsed && parsed._version === CACHE_VERSION) {
      metadataCache = parsed;
    }
  } catch {
    metadataCache = { _version: CACHE_VERSION };
  }
}

function saveCache() {
  metadataCache._version = CACHE_VERSION;
  fs.writeFileSync(cacheFile, JSON.stringify(metadataCache, null, 2), 'utf8');
}

function getPriorityScore(id) {
  const cleanId = id.toLowerCase();
  const idx = PRIORITY_ORDER.findIndex(prefix => cleanId.startsWith(prefix));
  return idx === -1 ? 999 : idx;
}

function isJunkChannelName(name) {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (trimmed.includes('#')) return true;
  if (/^\d+$/.test(trimmed)) return true;
  if (/^(channel|ch|test|feed|service)\s*\d*$/i.test(trimmed)) return true;
  return false;
}

function normalizeName(name) {
  const normalized = name
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
  return normalized || name.trim().toLowerCase();
}

function isTitleMatch(candidateTitle, queryTitle) {
  const a = normalizeName(candidateTitle);
  const b = normalizeName(queryTitle);
  if (!a || !b) return false;
  return a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ');
}

function isValidPosterUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.endsWith('.svg') || lower.includes('.svg.png')) return false;
  const badPatterns = [
    'flag_of_', 'commons-logo', 'disambig', 'question_book',
    'ambox', 'replace_this_image', 'portrait'
  ];
  return !badPatterns.some(pattern => lower.includes(pattern));
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

function parseProgramTitle(rawTitle) {
  let season = null;
  let episode = null;

  const seasonMatch = rawTitle.match(/(?:موسم|الموسم|جزء|الجزء|S)\s*(\d+)/i);
  if (seasonMatch) season = parseInt(seasonMatch[1], 10);

  const episodeMatch = rawTitle.match(/(?:حلقة|الحلقة|ح|E|Ep)\s*(\d+)/i);
  if (episodeMatch) episode = parseInt(episodeMatch[1], 10);

  const cleanTitle = rawTitle
    .replace(/(?:موسم|الموسم|جزء|الجزء|S)\s*\d+/gi, '')
    .replace(/(?:حلقة|الحلقة|ح|E|Ep)\s*\d+/gi, '')
    .replace(/^(?:مسلسل|فيلم|برنامج|سهرة|عرض|مباشر)\s*[:\-]?\s*/i, '')
    .replace(/[-:|،]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    cleanTitle: cleanTitle || rawTitle.trim(),
    season,
    episode
  };
}

function isGenericBroadcast(cleanTitle) {
  const genericKeywords = [
    'نشرة الأخبار', 'موجز', 'أخبار', 'القرآن الكريم', 'قرآن كريم',
    'أذان', 'صلاة', 'صباح الخير', 'فترة مفتوحة', 'استوديو تحليلي',
    'تغطية خاصة', 'حصاد اليوم', 'الحدث اليوم', 'news', 'weather', 'teleshopping'
  ];
  const lower = cleanTitle.toLowerCase();
  return genericKeywords.some(k => lower.includes(k));
}

function inferContentType(rawTitle, category, season, episode, apiType) {
  if (apiType) return apiType;
  const cat = (category || '').toLowerCase();
  const title = (rawTitle || '').toLowerCase();

  if (cat.includes('رسوم متحركة') || cat.includes('أنمي') || cat.includes('أطفال') || cat.includes('animation')) {
    return 'animation';
  }
  if (cat.includes('رياضة') || cat.includes('كرة') || cat.includes('sport') || title.includes('مباراة')) {
    return 'sports';
  }
  if (cat.includes('أخبار') || cat.includes('إخباري') || cat.includes('news') || isGenericBroadcast(title)) {
    return 'news';
  }
  if (season !== null || episode !== null || title.startsWith('مسلسل') || cat.includes('مسلسل')) {
    return 'series';
  }
  if (title.startsWith('فيلم') || cat.includes('فيلم') || cat.includes('movie')) {
    return 'movie';
  }
  if (cat.includes('دراما') || cat.includes('تشويق') || cat.includes('تاريخي') || cat.includes('سيرة ذاتية')) {
    return 'series';
  }
  if (cat.includes('أكشن') || cat.includes('رعب') || cat.includes('خيال علمي') || cat.includes('أجنبي')) {
    return 'movie';
  }
  return 'program';
}

function decodeXml(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function xmltvToIso(str) {
  if (!str) return null;
  const m = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/);
  if (!m) return str;
  const [, y, mo, d, h, mi, s, tz] = m;
  const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : 'Z';
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`;
}

function calcDurationMinutes(startIso, stopIso) {
  if (!startIso || !stopIso) return null;
  const diff = (new Date(stopIso) - new Date(startIso)) / 60000;
  return diff > 0 ? Math.round(diff) : null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchChannelLogos() {
  const logosById = new Map();
  const logosByName = new Map();

  try {
    console.log('⏳ Fetching official channel logos database...');
    const [logosRes, channelsRes] = await Promise.all([
      fetch('https://iptv-org.github.io/api/logos.json'),
      fetch('https://iptv-org.github.io/api/channels.json')
    ]);

    if (logosRes.ok) {
      const logosList = await logosRes.json();
      for (const item of logosList) {
        if (!item.channel || !item.url) continue;
        const key = item.channel.toLowerCase();
        if (!logosById.has(key) || item.format === 'PNG') {
          logosById.set(key, item.url);
        }
      }
    }

    if (channelsRes.ok) {
      const channelsList = await channelsRes.json();
      for (const ch of channelsList) {
        if (!ch.id) continue;
        const logoUrl = logosById.get(ch.id.toLowerCase());
        if (!logoUrl) continue;

        if (ch.name) {
          const norm = normalizeName(ch.name);
          if (!logosByName.has(norm)) logosByName.set(norm, logoUrl);
        }
        if (Array.isArray(ch.alt_names)) {
          for (const alt of ch.alt_names) {
            const normAlt = normalizeName(alt);
            if (!logosByName.has(normAlt)) logosByName.set(normAlt, logoUrl);
          }
        }
      }
    }

    console.log(`✅ Loaded ${logosById.size} channel logos (${logosByName.size} name aliases).`);
  } catch (err) {
    console.error('⚠️ Failed to fetch channel logos:', err.message);
  }

  return { logosById, logosByName };
}

// ============================================================================
// 1. PRIMARY ENGINE: TMDB Full Details (Posters, Backdrops, Cast, Trailers)
// ============================================================================
async function searchTmdbFull(queryTitle, expectedYear, category) {
  if (!TMDB_API_KEY) return null;

  const isMovieHint = /فيلم|movie/i.test(category || '');
  const isSeriesHint = /مسلسل|series/i.test(category || '');

  try {
    const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=ar&query=${encodeURIComponent(queryTitle)}`;
    const res = await fetch(searchUrl);
    if (!res.ok) return null;
    const data = await res.json();

    const validResults = (data.results || []).filter(r => {
      if (r.media_type !== 'movie' && r.media_type !== 'tv') return false;
      const rel = r.release_date || r.first_air_date || '';
      if (expectedYear && rel) {
        if (Math.abs(parseInt(rel.slice(0, 4), 10) - parseInt(expectedYear, 10)) > 1) return false;
      }
      return true;
    });

    if (validResults.length === 0) return null;

    validResults.sort((a, b) => {
      if (isMovieHint && a.media_type !== b.media_type) return a.media_type === 'movie' ? -1 : 1;
      if (isSeriesHint && a.media_type !== b.media_type) return a.media_type === 'tv' ? -1 : 1;
      return (b.popularity || 0) - (a.popularity || 0);
    });

    const hit = validResults[0];
    const mediaType = hit.media_type;

    const detailUrl = `https://api.themoviedb.org/3/${mediaType}/${hit.id}?api_key=${TMDB_API_KEY}&language=ar&append_to_response=credits,videos,content_ratings,release_dates,images&include_image_language=ar,en,null`;
    const detailRes = await fetch(detailUrl);
    const detail = detailRes.ok ? await detailRes.json() : hit;

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
      const preferredCountries = ['AE', 'SA', 'EG', 'US', 'GB'];
      for (const cc of preferredCountries) {
        const entry = detail.release_dates.results.find(r => r.iso_3166_1 === cc);
        const cert = entry && entry.release_dates && entry.release_dates.find(d => d.certification);
        if (cert && cert.certification) {
          ageRating = cert.certification;
          break;
        }
      }
    } else if (mediaType === 'tv' && detail.content_ratings && Array.isArray(detail.content_ratings.results)) {
      const preferredCountries = ['AE', 'SA', 'EG', 'US', 'GB'];
      for (const cc of preferredCountries) {
        const entry = detail.content_ratings.results.find(r => r.iso_3166_1 === cc);
        if (entry && entry.rating) {
          ageRating = entry.rating;
          break;
        }
      }
    }

    let trailerUrl = null;
    if (detail.videos && Array.isArray(detail.videos.results)) {
      const trailer =
        detail.videos.results.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
        detail.videos.results.find(v => v.site === 'YouTube');
      if (trailer && trailer.key) {
        trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
      }
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
        ? detail.credits.cast.slice(0, 6).map(actor => ({
            name: actor.name,
            character: actor.character || null,
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
    const contentType = genreIds.includes(16)
      ? 'animation'
      : (mediaType === 'movie' ? 'movie' : 'series');

    const releaseDate = detail.release_date || detail.first_air_date || '';

    return {
      tmdb_id: detail.id,
      original_title: detail.original_title || detail.original_name || null,
      tagline: detail.tagline || null,
      poster: posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null,
      backdrop: backdropPath ? `https://image.tmdb.org/t/p/w780${backdropPath}` : null,
      description: detail.overview || '',
      rating: detail.vote_average ? Number(detail.vote_average.toFixed(1)) : null,
      vote_count: detail.vote_count || null,
      age_rating: ageRating,
      year: releaseDate ? releaseDate.slice(0, 4) : null,
      release_date: releaseDate || null,
      genres: Array.isArray(detail.genres) ? detail.genres.map(g => g.name) : [],
      country,
      language,
      director,
      cast,
      trailer_url: trailerUrl,
      seasons_count: mediaType === 'tv' ? (detail.number_of_seasons || null) : null,
      episodes_count: mediaType === 'tv' ? (detail.number_of_episodes || null) : null,
      status: detail.status || null,
      content_type: contentType
    };
  } catch {
    return null;
  }
}

// ============================================================================
// 2. WIKIDATA ENTITY RESOLVER (Resolves Arabic -> English titles & verifies type)
// ============================================================================
async function searchWikidata(cleanTitle, expectedYear) {
  const isLatin = /^[a-zA-Z0-9\s\-:&'.,!?]+$/.test(cleanTitle);
  const searchLang = isLatin ? 'en' : 'ar';

  try {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(cleanTitle)}&language=${searchLang}&uselang=${searchLang}&format=json&limit=5`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'ArabicTVGuideBot/1.0' }
    });
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const candidates = (searchData.search || []).filter(item => {
      const labelMatch = isTitleMatch(item.label || '', cleanTitle);
      const aliasMatch = Array.isArray(item.aliases) && item.aliases.some(a => isTitleMatch(a, cleanTitle));
      return labelMatch || aliasMatch;
    });

    if (candidates.length === 0) return null;

    const ids = candidates.map(c => c.id).join('|');
    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels|descriptions|claims&languages=ar|en&format=json`;
    const entityRes = await fetch(entityUrl, {
      headers: { 'User-Agent': 'ArabicTVGuideBot/1.0' }
    });
    if (!entityRes.ok) return null;

    const entityData = await entityRes.json();
    const entities = entityData.entities || {};

    for (const cand of candidates) {
      const ent = entities[cand.id];
      if (!ent || !ent.claims) continue;

      const p31Claims = ent.claims.P31 || [];
      const typeIds = p31Claims
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

      if (expectedYear && year && Math.abs(parseInt(expectedYear, 10) - parseInt(year, 10)) > 1) {
        continue;
      }

      let poster = null;
      const imgClaim = (ent.claims.P3383 && ent.claims.P3383[0]) || (ent.claims.P18 && ent.claims.P18[0]);
      const fileName = imgClaim && imgClaim.mainsnak && imgClaim.mainsnak.datavalue && imgClaim.mainsnak.datavalue.value;
      if (fileName && isValidPosterUrl(fileName)) {
        poster = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=500`;
      }

      let country = null;
      const p495 = ent.claims.P495 && ent.claims.P495[0];
      const countryId = p495 && p495.mainsnak && p495.mainsnak.datavalue && p495.mainsnak.datavalue.value && p495.mainsnak.datavalue.value.id;
      if (countryId && COUNTRY_NAMES_AR[countryId]) {
        country = COUNTRY_NAMES_AR[countryId];
      }

      const enLabel = ent.labels && ent.labels.en ? ent.labels.en.value : null;
      const contentType = typeIds.includes('Q581714') || typeIds.includes('Q202866')
        ? 'animation'
        : (typeIds.includes('Q11424') || typeIds.includes('Q506240') ? 'movie' : 'series');

      return {
        original_title: enLabel && !isLatin ? enLabel : null,
        poster,
        year,
        country,
        content_type: contentType
      };
    }
  } catch {}
  return null;
}

// ============================================================================
// 3. FALLBACK ENGINES: TVMaze & iTunes
// ============================================================================
async function searchTvMaze(queryTitle, expectedYear) {
  try {
    const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(queryTitle)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const list = await res.json();

    const hit = (list || []).find(item => {
      if (!item.show || !isTitleMatch(item.show.name, queryTitle)) return false;
      if (expectedYear && item.show.premiered) {
        const showYear = parseInt(item.show.premiered.slice(0, 4), 10);
        if (Math.abs(showYear - parseInt(expectedYear, 10)) > 1) return false;
      }
      return true;
    });

    if (hit && hit.show) {
      const s = hit.show;
      const poster = s.image ? (s.image.original || s.image.medium) : null;

      let cast = [];
      try {
        const castRes = await fetch(`https://api.tvmaze.com/shows/${s.id}/cast`);
        if (castRes.ok) {
          const castList = await castRes.json();
          cast = (castList || [])
            .filter(c => c.person && c.person.name)
            .slice(0, 6)
            .map(c => ({
              name: c.person.name,
              character: (c.character && c.character.name) || null,
              profile_image: (c.person.image && c.person.image.medium) || null
            }));
        }
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
    }
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
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(queryTitle)}&country=${country}&media=${media}&limit=5`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();

      const hit = (data.results || []).find(r => {
        const title = r.trackName || r.collectionName;
        if (!title || !isTitleMatch(title, queryTitle)) return false;
        if (expectedYear && r.releaseDate) {
          const relYear = parseInt(r.releaseDate.slice(0, 4), 10);
          if (Math.abs(relYear - parseInt(expectedYear, 10)) > 1) return false;
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

// ============================================================================
// COMBINED METADATA ENRICHMENT PIPELINE
// ============================================================================
async function enrichProgramMetadata(cleanTitle, expectedYear, category) {
  const cacheKey = `${normalizeName(cleanTitle)}_${expectedYear || ''}`;
  if (metadataCache[cacheKey] !== undefined) {
    return metadataCache[cacheKey];
  }

  if (isGenericBroadcast(cleanTitle) || cleanTitle.length < 2) {
    metadataCache[cacheKey] = null;
    return null;
  }

  let tmdb = await searchTmdbFull(cleanTitle, expectedYear, category);
  const wiki = await searchWikidata(cleanTitle, expectedYear);

  if (!tmdb && wiki && wiki.original_title) {
    tmdb = await searchTmdbFull(wiki.original_title, wiki.year || expectedYear, category);
  }

  const enriched = {
    tmdb_id: (tmdb && tmdb.tmdb_id) || null,
    original_title: (tmdb && tmdb.original_title) || (wiki && wiki.original_title) || null,
    tagline: (tmdb && tmdb.tagline) || null,
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

// ============================================================================
// MAIN PIPELINE (7-DAY SCHEDULE + OPTIMIZED ENDPOINTS)
// ============================================================================
async function main() {
  if (fs.existsSync(programsDir)) {
    fs.rmSync(programsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(programsDir, { recursive: true });

  const { logosById, logosByName } = await fetchChannelLogos();

  const channelsMap = new Map();
  const seenNames = new Set();
  const programsByChannel = {};
  const sharedShowInfo = new Map();

  const filesToRead = ['fast.xml', 'slow.xml'];

  for (const file of filesToRead) {
    const fullPath = path.join(guidesDir, file);
    if (!fs.existsSync(fullPath)) continue;

    const xml = fs.readFileSync(fullPath, 'utf8');

    const chRegex = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/g;
    let chMatch;
    while ((chMatch = chRegex.exec(xml)) !== null) {
      const id = chMatch[1];
      const inner = chMatch[2];
      const nameMatch = inner.match(/<display-name[^>]*>([\s\S]*?)<\/display-name>/);
      const xmlIconMatch = inner.match(/<icon\s+src="([^"]+)"/);

      const name = nameMatch ? decodeXml(nameMatch[1]) : id;
      if (isJunkChannelName(name)) continue;

      const baseId = id.split('@')[0].toLowerCase();
      const normName = normalizeName(name);

      const channelLogo =
        (xmlIconMatch ? xmlIconMatch[1].trim() : null) ||
        logosById.get(baseId) ||
        logosByName.get(normName) ||
        null;

      if (!channelLogo) continue;

      if (!channelsMap.has(id) && !seenNames.has(normName)) {
        seenNames.add(normName);
        channelsMap.set(id, { id, name, icon: channelLogo });
      }
    }

    const progRegex = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/g;
    let progMatch;
    while ((progMatch = progRegex.exec(xml)) !== null) {
      const attrs = progMatch[1];
      const inner = progMatch[2];

      const startM = attrs.match(/start="([^"]+)"/);
      const stopM = attrs.match(/stop="([^"]+)"/);
      const chanM = attrs.match(/channel="([^"]+)"/);
      if (!chanM || !startM) continue;

      const channelId = chanM[1];
      const titleM = inner.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      const subTitleM = inner.match(/<sub-title[^>]*>([\s\S]*?)<\/sub-title>/);
      const descM = inner.match(/<desc[^>]*>([\s\S]*?)<\/desc>/);
      const catM = inner.match(/<category[^>]*>([\s\S]*?)<\/category>/);
      const iconM = inner.match(/<icon\s+src="([^"]+)"/);
      const dateM = inner.match(/<date[^>]*>([\s\S]*?)<\/date>/);
      const countryM = inner.match(/<country[^>]*>([\s\S]*?)<\/country>/);
      const langM = inner.match(/<language[^>]*>([\s\S]*?)<\/language>/);
      const ageRatingM = inner.match(/<rating[^>]*>[\s\S]*?<value[^>]*>([\s\S]*?)<\/value>/);
      const starRatingM = inner.match(/<star-rating[^>]*>[\s\S]*?<value[^>]*>([\s\S]*?)<\/value>/);

      const directors = [];
      const dirRegex = /<director[^>]*>([\s\S]*?)<\/director>/g;
      let dirMatch;
      while ((dirMatch = dirRegex.exec(inner)) !== null) {
        directors.push(decodeXml(dirMatch[1]));
      }

      const actors = [];
      const actRegex = /<actor[^>]*>([\s\S]*?)<\/actor>/g;
      let actMatch;
      while ((actMatch = actRegex.exec(inner)) !== null) {
        actors.push({ name: decodeXml(actMatch[1]), character: null, profile_image: null });
      }

      const rawTitle = titleM ? decodeXml(titleM[1]) : 'Untitled';
      const { cleanTitle, season, episode } = parseProgramTitle(rawTitle);
      const description = descM ? decodeXml(descM[1]) : '';
      const category = catM ? decodeXml(catM[1]) : 'General';
      const xmlPoster = iconM ? iconM[1].trim() : null;
      const year = dateM ? decodeXml(dateM[1]).slice(0, 4) : null;
      const startIso = xmltvToIso(startM[1]);
      const stopIso = stopM ? xmltvToIso(stopM[1]) : null;

      const normKey = normalizeName(cleanTitle);
      if ((description || xmlPoster) && !sharedShowInfo.has(normKey)) {
        sharedShowInfo.set(normKey, { description, poster: xmlPoster });
      }

      if (!programsByChannel[channelId]) programsByChannel[channelId] = [];

      programsByChannel[channelId].push({
        tmdb_id: null,
        title: rawTitle,
        clean_title: cleanTitle,
        original_title: null,
        tagline: null,
        episode_title: subTitleM ? decodeXml(subTitleM[1]) : null,
        content_type: inferContentType(rawTitle, category, season, episode, null),
        season,
        episode,
        seasons_count: null,
        episodes_count: null,
        description,
        category,
        genres: category ? [category] : [],
        rating: starRatingM ? parseFloat(decodeXml(starRatingM[1])) || null : null,
        vote_count: null,
        age_rating: ageRatingM ? decodeXml(ageRatingM[1]) : null,
        year,
        release_date: null,
        status: null,
        country: countryM ? decodeXml(countryM[1]) : null,
        language: langM ? decodeXml(langM[1]) : null,
        director: directors.length ? directors.join(', ') : null,
        cast: actors.slice(0, 6),
        trailer_url: null,
        start: startIso,
        stop: stopIso,
        duration_minutes: calcDurationMinutes(startIso, stopIso),
        is_live: /مباشر|live/i.test(rawTitle) || category.includes('رياضة'),
        poster: xmlPoster,
        backdrop: null,
        icon: xmlPoster
      });
    }
  }

  const uniqueShowsToEnrich = new Map();
  for (const [channelId, progs] of Object.entries(programsByChannel)) {
    if (!channelsMap.has(channelId)) continue;
    for (const p of progs) {
      if (isUnavailableProgram(p.title) || isGenericBroadcast(p.clean_title)) continue;
      const cacheKey = `${normalizeName(p.clean_title)}_${p.year || ''}`;
      if (metadataCache[cacheKey] === undefined && !uniqueShowsToEnrich.has(cacheKey)) {
        uniqueShowsToEnrich.set(cacheKey, { cleanTitle: p.clean_title, year: p.year, category: p.category });
      }
    }
  }

  console.log(`🔍 Enriching ${uniqueShowsToEnrich.size} unique shows across 7 days with TMDB full details...`);
  let processedCount = 0;
  for (const item of uniqueShowsToEnrich.values()) {
    await enrichProgramMetadata(item.cleanTitle, item.year, item.category);
    processedCount++;
    if (processedCount % 15 === 0) {
      saveCache();
      process.stdout.write(`   Enriched ${processedCount}/${uniqueShowsToEnrich.size}...\r`);
    }
    await sleep(60);
  }
  saveCache();
  console.log('\n✅ TMDB enrichment completed and cached.');

  const airingsMap = new Map();
  const validChannels = [];
  const finalChannelPrograms = {};
  const featuredCandidates = new Map();

  let programsWithPosterCount = 0;
  let programsWithDetailsCount = 0;
  let totalProgramsCount = 0;

  for (const [channelId, channelObj] of channelsMap.entries()) {
    const rawPrograms = programsByChannel[channelId] || [];
    const uniquePrograms = Array.from(
      new Map(rawPrograms.map(p => [`${p.start}_${p.title}`, p])).values()
    ).sort((a, b) => new Date(a.start) - new Date(b.start));

    const hasRealPrograms = uniquePrograms.some(p => !isUnavailableProgram(p.title));
    if (!hasRealPrograms) continue;

    validChannels.push(channelObj);

    for (const p of uniquePrograms) {
      const normKey = normalizeName(p.clean_title);
      const cacheKey = `${normKey}_${p.year || ''}`;
      const shared = sharedShowInfo.get(normKey);
      const enriched = metadataCache[cacheKey];

      const showPoster = p.poster || (shared && shared.poster) || (enriched && enriched.poster) || null;
      p.tmdb_id = (enriched && enriched.tmdb_id) || null;
      p.poster = showPoster;
      p.icon = showPoster;
      p.backdrop = (enriched && enriched.backdrop) || null;
      p.channel_icon = channelObj.icon;

      p.original_title = (enriched && enriched.original_title) || null;
      p.tagline = (enriched && enriched.tagline) || null;
      p.description = p.description || (shared && shared.description) || (enriched && enriched.description) || '';
      p.rating = p.rating || (enriched && enriched.rating) || null;
      p.vote_count = (enriched && enriched.vote_count) || null;
      p.age_rating = p.age_rating || (enriched && enriched.age_rating) || null;
      p.year = p.year || (enriched && enriched.year) || null;
      p.release_date = (enriched && enriched.release_date) || null;
      p.status = (enriched && enriched.status) || null;
      p.country = p.country || (enriched && enriched.country) || null;
      p.language = p.language || (enriched && enriched.language) || null;
      p.director = p.director || (enriched && enriched.director) || null;
      p.trailer_url = (enriched && enriched.trailer_url) || null;
      p.seasons_count = (enriched && enriched.seasons_count) || null;
      p.episodes_count = (enriched && enriched.episodes_count) || null;

      if (enriched && Array.isArray(enriched.cast) && enriched.cast.length) {
        p.cast = enriched.cast;
      }
      if (enriched && Array.isArray(enriched.genres) && enriched.genres.length) {
        p.genres = Array.from(new Set([...p.genres, ...enriched.genres]));
      }
      p.content_type = inferContentType(
        p.title,
        p.category,
        p.season,
        p.episode,
        enriched && enriched.content_type
      );

      totalProgramsCount++;
      if (showPoster) programsWithPosterCount++;
      if (p.rating || p.cast.length || p.director || p.tmdb_id) {
        programsWithDetailsCount++;
      }

      if (showPoster && p.rating && p.rating >= 6.5 && !isGenericBroadcast(p.clean_title)) {
        if (!featuredCandidates.has(normKey)) {
          featuredCandidates.set(normKey, {
            tmdb_id: p.tmdb_id,
            title: p.clean_title,
            original_title: p.original_title,
            content_type: p.content_type,
            rating: p.rating,
            year: p.year,
            genres: p.genres,
            poster: p.poster,
            backdrop: p.backdrop,
            description: p.description,
            channel_id: channelId,
            channel_name: channelObj.name,
            channel_icon: channelObj.icon,
            next_airing: p.start
          });
        }
      }

      if (!isGenericBroadcast(p.clean_title)) {
        const airingKey = `${normKey}_${p.episode || '0'}`;
        if (!airingsMap.has(airingKey)) airingsMap.set(airingKey, []);
        airingsMap.get(airingKey).push({
          channel_id: channelId,
          channel_name: channelObj.name,
          start: p.start
        });
      }
    }

    finalChannelPrograms[channelId] = uniquePrograms;
  }

  // Save full 7-day program files per channel
  for (const [channelId, programs] of Object.entries(finalChannelPrograms)) {
    for (const p of programs) {
      if (isGenericBroadcast(p.clean_title)) {
        p.is_rerun = false;
        p.reruns = [];
        continue;
      }

      const airingKey = `${normalizeName(p.clean_title)}_${p.episode || '0'}`;
      const allAirings = (airingsMap.get(airingKey) || []).sort(
        (a, b) => new Date(a.start) - new Date(b.start)
      );

      p.is_rerun = allAirings.length > 1 && allAirings[0].start !== p.start;
      p.reruns = allAirings
        .filter(a => a.start !== p.start)
        .map(a => ({ channel: a.channel_name, start: a.start }));
    }

    const safeFileName = channelId.replace(/[^a-zA-Z0-9._-]/g, '_');
    fs.writeFileSync(
      path.join(programsDir, `${safeFileName}.json`),
      JSON.stringify(
        {
          channel_id: channelId,
          channel_name: channelsMap.get(channelId).name,
          channel_icon: channelsMap.get(channelId).icon,
          days_count: 7,
          programs
        },
        null,
        2
      ),
      'utf8'
    );
  }

  validChannels.sort((a, b) => {
    const scoreA = getPriorityScore(a.id);
    const scoreB = getPriorityScore(b.id);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return a.name.localeCompare(b.name, 'ar');
  });

  // 1. Save channels.json with a compact 36-hour preview window so Home Screen stays fast
  const nowMs = Date.now();
  const minPreviewMs = nowMs - 2 * 3600 * 1000;
  const maxPreviewMs = nowMs + 36 * 3600 * 1000;

  const enrichedChannels = validChannels.map(ch => {
    const progs = finalChannelPrograms[ch.id] || [];
    const nearProgs = progs.filter(p => {
      const startMs = new Date(p.start).getTime();
      return startMs >= minPreviewMs && startMs <= maxPreviewMs;
    });
    const previewList = nearProgs.length ? nearProgs : progs.slice(0, 20);

    return {
      ...ch,
      preview_programs: previewList.map(p => ({
        title: p.clean_title,
        content_type: p.content_type,
        start: p.start,
        stop: p.stop
      }))
    };
  });

  fs.writeFileSync(
    path.join(apiDir, 'channels.json'),
    JSON.stringify({ updated_at: new Date().toISOString(), count: enrichedChannels.length, channels: enrichedChannels }, null, 2),
    'utf8'
  );

  // 2. Save featured.json (Top 30 highest-rated shows/movies across the 7-day week)
  const featuredList = Array.from(featuredCandidates.values())
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 30);

  fs.writeFileSync(
    path.join(apiDir, 'featured.json'),
    JSON.stringify({ updated_at: new Date().toISOString(), count: featuredList.length, featured: featuredList }, null, 2),
    'utf8'
  );

  // 3. Save search_index.json (All unique shows across the 7-day week with airing counts)
  const searchMap = new Map();
  for (const [channelId, programs] of Object.entries(finalChannelPrograms)) {
    const chObj = channelsMap.get(channelId);
    for (const p of programs) {
      if (isUnavailableProgram(p.title) || isGenericBroadcast(p.clean_title)) continue;
      const key = `${normalizeName(p.clean_title)}_${channelId}`;
      if (!searchMap.has(key)) {
        searchMap.set(key, {
          title: p.clean_title,
          original_title: p.original_title,
          content_type: p.content_type,
          category: p.category,
          rating: p.rating,
          poster: p.poster,
          channel_id: channelId,
          channel_name: chObj.name,
          channel_icon: chObj.icon,
          start: p.start,
          stop: p.stop,
          airings_count: 1
        });
      } else {
        searchMap.get(key).airings_count += 1;
      }
    }
  }

  const searchIndex = Array.from(searchMap.values());
  fs.writeFileSync(
    path.join(apiDir, 'search_index.json'),
    JSON.stringify({ updated_at: new Date().toISOString(), count: searchIndex.length, items: searchIndex }, null, 2),
    'utf8'
  );

  console.log(`🎉 Success! Generated 7-day schedules for ${enrichedChannels.length} channels.`);
  console.log(`📦 Endpoints: channels.json, featured.json (${featuredList.length}), search_index.json (${searchIndex.length} shows).`);
  console.log(`🎬 Matched ${programsWithPosterCount}/${totalProgramsCount} entries with dedicated posters.`);
  console.log(`📋 Enriched ${programsWithDetailsCount}/${totalProgramsCount} entries with TMDB cast, ratings, trailers & details.`);
}

main().catch(err => console.error('Error:', err));