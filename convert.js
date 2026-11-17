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
const ENTRY_FORMAT = 10;
const TEAM_ENTRY_FORMAT = 3; // Bumped to refresh previously missing team/national logos

const TMDB_API_KEY = process.env.TMDB_API_KEY || '99cc02ee4fab8a8435598646547ae0ac';
const THESPORTSDB_API_KEY = process.env.THESPORTSDB_API_KEY || '123';

const PRETTY = process.env.PRETTY === '1';
const OFFLINE = process.env.OFFLINE === '1' || process.argv.includes('--offline');
const MAX_REFRESH_PER_RUN = parseInt(process.env.MAX_REFRESH || '1500', 10);
const MAX_TEAM_LOOKUPS_PER_RUN = parseInt(process.env.MAX_TEAM_LOOKUPS || '400', 10);

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

const COUNTRY_UTC_OFFSET = {
  ae: 4, om: 4, sa: 3, qa: 3, kw: 3, bh: 3, iq: 3, jo: 3, sy: 3, ye: 3,
  eg: 2, lb: 2, ps: 2, sd: 2, ly: 2, ma: 1, dz: 1, tn: 1
};

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
  { category: 'movies', tier: 1, en: 'ART Aflam 1', ar: 'إيه آر تي أفلام 1', id: /^artaflam1/i },
  { category: 'movies', tier: 1, en: 'ART Aflam 2', ar: 'إيه آر تي أفلام 2', id: /^artaflam2/i },
  { category: 'drama', tier: 1, en: 'ART Hekayat', ar: 'إيه آر تي حكايات', id: /^arthikayat/i },
  { category: 'movies', tier: 1, en: 'ART Cinema', ar: 'إيه آر تي سينما', id: /^artcinema/i },
  { category: 'general', tier: 1, en: 'Shahid', ar: 'شاهد', id: /^shahid/i, multi: true },
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
// SPORTS / FOOTBALL DICTIONARIES (Leagues, 300+ Clubs, 210+ National Teams)
// ============================================================================
const LEAGUES = {
  premier_league: { tsdbId: '4328', ar: 'الدوري الإنجليزي الممتاز', en: 'Premier League', fr: 'Premier League', re: /الدوري الإنجليزي|البريميرليج|premier league/i },
  champions_league: { tsdbId: '4480', ar: 'دوري أبطال أوروبا', en: 'UEFA Champions League', fr: 'Ligue des champions', re: /دوري أبطال أوروبا|champions league/i },
  europa_league: { tsdbId: '4481', ar: 'الدوري الأوروبي', en: 'UEFA Europa League', fr: 'Ligue Europa', re: /الدوري الأوروبي|europa league/i },
  conference_league: { tsdbId: '5071', ar: 'دوري المؤتمر الأوروبي', en: 'UEFA Conference League', fr: 'Ligue Conférence', re: /دوري المؤتمر|conference league/i },
  la_liga: { tsdbId: '4335', ar: 'الدوري الإسباني', en: 'La Liga', fr: 'La Liga', re: /الدوري الإسباني|الليغا|la liga/i },
  serie_a: { tsdbId: '4332', ar: 'الدوري الإيطالي', en: 'Serie A', fr: 'Serie A', re: /الدوري الإيطالي|الكالتشيو|serie a/i },
  bundesliga: { tsdbId: '4331', ar: 'الدوري الألماني', en: 'Bundesliga', fr: 'Bundesliga', re: /الدوري الألماني|البوندسليغا|bundesliga/i },
  ligue_1: { tsdbId: '4334', ar: 'الدوري الفرنسي', en: 'Ligue 1', fr: 'Ligue 1', re: /الدوري الفرنسي|ligue 1/i },
  saudi_pro_league: { tsdbId: '4668', ar: 'دوري روشن السعودي', en: 'Saudi Pro League', fr: 'Saudi Pro League', re: /دوري روشن|الدوري السعودي|saudi pro league/i },
  egyptian_league: { tsdbId: '4673', ar: 'الدوري المصري الممتاز', en: 'Egyptian Premier League', fr: 'Championnat d\'Égypte', re: /الدوري المصري|egyptian premier/i },
  moroccan_botola: { tsdbId: '4734', ar: 'البطولة المغربية', en: 'Botola Pro', fr: 'Botola Pro', re: /البطولة المغربية|الدوري المغربي|botola/i },
  tunisian_ligue: { tsdbId: '4735', ar: 'الرابطة التونسية المحترفة', en: 'Tunisian Ligue 1', fr: 'Ligue 1 Tunisie', re: /الرابطة التونسية|الدوري التونسي|tunisian ligue/i },
  algerian_ligue: { tsdbId: '4736', ar: 'الرابطة الجزائرية المحترفة', en: 'Algerian Ligue 1', fr: 'Ligue 1 Algérie', re: /الرابطة الجزائرية|الدوري الجزائري|algerian ligue/i },
  qatari_league: { tsdbId: '4737', ar: 'دوري نجوم قطر', en: 'Qatar Stars League', fr: 'Qatar Stars League', re: /دوري نجوم قطر|الدوري القطري|qatar stars/i },
  uae_pro_league: { tsdbId: '4740', ar: 'دوري أدنوك للمحترفين', en: 'UAE Pro League', fr: 'UAE Pro League', re: /دوري أدنوك|الدوري الإماراتي|uae pro/i },
  jordan_league: { tsdbId: null, ar: 'الدوري الأردني للمحترفين', en: 'Jordanian Pro League', fr: 'Championnat de Jordanie', re: /الدوري الأردني|jordanian pro/i },
  iraqi_league: { tsdbId: null, ar: 'دوري نجوم العراق', en: 'Iraq Stars League', fr: 'Championnat d\'Irak', re: /دوري نجوم العراق|الدوري العراقي|iraq stars/i },
  caf_champions: { tsdbId: '4739', ar: 'دوري أبطال أفريقيا', en: 'CAF Champions League', fr: 'Ligue des champions CAF', re: /دوري أبطال أفريقيا|أبطال إفريقيا|caf champions/i },
  caf_confederation: { tsdbId: null, ar: 'كأس الكونفدرالية الأفريقية', en: 'CAF Confederation Cup', fr: 'Coupe de la confédération CAF', re: /الكونفدرالية|confederation cup/i },
  afc_champions: { tsdbId: '4738', ar: 'دوري أبطال آسيا', en: 'AFC Champions League', fr: 'Ligue des champions AFC', re: /دوري أبطال آسيا|أبطال آسيا|afc champions/i },
  world_cup: { tsdbId: '4429', ar: 'كأس العالم', en: 'FIFA World Cup', fr: 'Coupe du monde', re: /كأس العالم|تصفيات كأس العالم|world cup/i },
  afcon: { tsdbId: '4499', ar: 'كأس أمم أفريقيا', en: 'Africa Cup of Nations', fr: 'Coupe d\'Afrique des nations', re: /كأس أمم أفريقيا|أمم إفريقيا|africa cup|afcon/i },
  asian_cup: { tsdbId: '4500', ar: 'كأس آسيا', en: 'AFC Asian Cup', fr: 'Coupe d\'Asie', re: /كأس آسيا|asian cup/i },
  nations_league: { tsdbId: '4490', ar: 'دوري الأمم الأوروبية', en: 'UEFA Nations League', fr: 'Ligue des nations', re: /دوري الأمم الأوروبية|nations league/i },
  arab_cup: { tsdbId: null, ar: 'كأس العرب', en: 'FIFA Arab Cup', fr: 'Coupe arabe', re: /كأس العرب|arab cup/i },
  friendly: { tsdbId: null, ar: 'مباراة ودية', en: 'International Friendly', fr: 'Match amical', re: /ودية|مباراة ودية|friendly/i }
};

// Club names (folded via normalizeName) -> English club name for TheSportsDB / Wikidata / Wikipedia
const CLUB_AR_TO_EN = {
  // England (Premier League & Championship)
  'ارسنال': 'Arsenal', 'ارسنال الانجليزي': 'Arsenal',
  'تشيلسي': 'Chelsea', 'تشلسي': 'Chelsea',
  'ليفربول': 'Liverpool',
  'مانشستر سيتي': 'Manchester City', 'مان سيتي': 'Manchester City',
  'مانشستر يونايتد': 'Manchester United', 'مان يونايتد': 'Manchester United',
  'توتنهام': 'Tottenham Hotspur', 'توتنهام هوتسبير': 'Tottenham Hotspur', 'توتنام': 'Tottenham Hotspur',
  'نيوكاسل': 'Newcastle United', 'نيوكاسل يونايتد': 'Newcastle United',
  'استون فيلا': 'Aston Villa',
  'وست هام': 'West Ham United', 'وست هام يونايتد': 'West Ham United',
  'برايتون': 'Brighton & Hove Albion',
  'ايفرتون': 'Everton',
  'ليستر سيتي': 'Leicester City',
  'ولفرهامبتون': 'Wolverhampton Wanderers',
  'نوتينغهام فورست': 'Nottingham Forest', 'نوتنغهام فورست': 'Nottingham Forest',
  'كريستال بالاس': 'Crystal Palace',
  'فولهام': 'Fulham',
  'برينتفورد': 'Brentford',
  'بورنموث': 'AFC Bournemouth',
  'ساوثهامبتون': 'Southampton', 'ساوثامبتون': 'Southampton',
  'ايبسويتش تاون': 'Ipswich Town',
  'ليدز يونايتد': 'Leeds United',
  'بيرنلي': 'Burnley',
  'شيفيلد يونايتد': 'Sheffield United',
  'سندرلاند': 'Sunderland',
  // Spain (La Liga)
  'ريال مدريد': 'Real Madrid',
  'برشلونه': 'Barcelona',
  'اتلتيكو مدريد': 'Atletico Madrid', 'اتليتكو مدريد': 'Atletico Madrid',
  'اشبيليه': 'Sevilla',
  'ريال بيتيس': 'Real Betis',
  'ريال سوسيداد': 'Real Sociedad',
  'فياريال': 'Villarreal',
  'اتلتيك بلباو': 'Athletic Bilbao', 'اتليتك بلباو': 'Athletic Bilbao',
  'فالنسيا': 'Valencia',
  'جيرونا': 'Girona',
  'سيلتا فيغو': 'Celta Vigo', 'سلتا فيغو': 'Celta Vigo',
  'ريال مايوركا': 'Mallorca', 'مايوركا': 'Mallorca',
  'رايو فاليكانو': 'Rayo Vallecano',
  'خيتافي': 'Getafe',
  'اوساسونا': 'Osasuna',
  'ديبورتيفو الافيس': 'Alaves', 'الافيس': 'Alaves',
  'لاس بالماس': 'Las Palmas',
  'اسبانيول': 'Espanyol',
  'بلد الوليد': 'Real Valladolid', 'ريال بلد الوليد': 'Real Valladolid',
  'ليغانيس': 'Leganes',
  // Italy (Serie A)
  'يوفنتوس': 'Juventus', 'جوفنتوس': 'Juventus',
  'انتر ميلان': 'Inter Milan', 'الانتر': 'Inter Milan', 'انتر': 'Inter Milan',
  'ميلان': 'AC Milan', 'اي سي ميلان': 'AC Milan',
  'نابولي': 'Napoli',
  'روما': 'AS Roma',
  'لاتسيو': 'Lazio',
  'اتالانتا': 'Atalanta',
  'فيورنتينا': 'Fiorentina',
  'بولونيا': 'Bologna',
  'تورينو': 'Torino',
  'اودينيزي': 'Udinese',
  'جنوي': 'Genoa',
  'كالياري': 'Cagliari',
  'امبولي': 'Empoli',
  'بارما': 'Parma',
  'كومو': 'Como',
  'فينيزيا': 'Venezia',
  'هيلاس فيرونا': 'Hellas Verona', 'فيرونا': 'Hellas Verona',
  'ليتشي': 'Lecce',
  'مونزا': 'Monza',
  // Germany (Bundesliga)
  'بايرن ميونخ': 'Bayern Munich', 'بايرن ميونيخ': 'Bayern Munich',
  'بوروسيا دورتموند': 'Borussia Dortmund', 'بروسيا دورتموند': 'Borussia Dortmund',
  'باير ليفركوزن': 'Bayer Leverkusen',
  'لايبزيج': 'RB Leipzig', 'لايبزيغ': 'RB Leipzig', 'ار بي لايبزيج': 'RB Leipzig',
  'شتوتغارت': 'VfB Stuttgart',
  'اينتراخت فرانكفورت': 'Eintracht Frankfurt', 'فرانكفورت': 'Eintracht Frankfurt',
  'فولفسبورغ': 'VfL Wolfsburg',
  'فرايبورغ': 'SC Freiburg',
  'هوفنهايم': 'TSG Hoffenheim',
  'ماينتس': 'Mainz 05',
  'اوغسبورغ': 'FC Augsburg',
  'فيردر بريمن': 'Werder Bremen',
  'يونيون برلين': 'Union Berlin',
  'بوخوم': 'VfL Bochum',
  'بوروسيا مونشنغلادباخ': 'Borussia Monchengladbach',
  'سانت باولي': 'FC St. Pauli',
  'هايدنهايم': '1. FC Heidenheim',
  // France (Ligue 1)
  'باريس سان جيرمان': 'Paris Saint-Germain', 'باريس سان جرمان': 'Paris Saint-Germain',
  'مارسيليا': 'Marseille', 'اولمبيك مارسيليا': 'Marseille',
  'ليون': 'Lyon', 'اولمبيك ليون': 'Lyon',
  'موناكو': 'AS Monaco',
  'ليل': 'Lille',
  'نيس': 'OGC Nice',
  'لانس': 'RC Lens',
  'رين': 'Stade Rennais',
  'ستراسبورغ': 'RC Strasbourg',
  'نانت': 'FC Nantes',
  'تولوز': 'Toulouse FC',
  'مونبلييه': 'Montpellier HSC',
  'بريست': 'Stade Brestois 29', 'ستاد بريست': 'Stade Brestois 29',
  'ستاد ريمس': 'Stade de Reims', 'ريمس': 'Stade de Reims',
  'اوكسير': 'AJ Auxerre',
  'انجيه': 'Angers SCO',
  'سانت ايتيان': 'AS Saint-Etienne',
  // Portugal, Netherlands, Scotland, Belgium, Turkey, Rest of Europe
  'بنفيكا': 'Benfica',
  'بورتو': 'FC Porto',
  'سبورتينغ لشبونه': 'Sporting CP', 'سبورتنج لشبونه': 'Sporting CP',
  'سبورتينغ براغا': 'SC Braga', 'براغا': 'SC Braga',
  'اياكس': 'Ajax', 'اياكس امستردام': 'Ajax',
  'ايندهوفن': 'PSV Eindhoven', 'بي اس في ايندهوفن': 'PSV Eindhoven',
  'فينورد': 'Feyenoord',
  'الكمار': 'AZ Alkmaar',
  'سيلتك': 'Celtic',
  'رينجرز': 'Rangers',
  'كلوب بروج': 'Club Brugge',
  'اندرلخت': 'Anderlecht',
  'يونيون سانت جيلواز': 'Union Saint-Gilloise',
  'غلطة سراي': 'Galatasaray', 'غلطه سراي': 'Galatasaray',
  'فنربخشة': 'Fenerbahce', 'فنربخشه': 'Fenerbahce',
  'بشكتاش': 'Besiktas',
  'طرابزون سبور': 'Trabzonspor',
  'شاختار دونيتسك': 'Shakhtar Donetsk',
  'دينامو كييف': 'Dynamo Kyiv',
  'سالزبورغ': 'Red Bull Salzburg',
  'شتورم غراتس': 'Sturm Graz',
  'دينامو زغرب': 'Dinamo Zagreb',
  'النجم الاحمر': 'Red Star Belgrade',
  'يونغ بويز': 'Young Boys',
  'سبارتا براغ': 'Sparta Prague',
  'سلافيا براغ': 'Slavia Prague',
  'اولمبياكوس': 'Olympiacos',
  'باوك': 'PAOK',
  'باناثينايكوس': 'Panathinaikos',
  // Saudi Arabia (Saudi Pro League & First Division)
  'الهلال': 'Al-Hilal', 'الهلال السعودي': 'Al-Hilal',
  'النصر': 'Al-Nassr', 'النصر السعودي': 'Al-Nassr',
  'الاتحاد': 'Al-Ittihad', 'الاتحاد السعودي': 'Al-Ittihad',
  'الاهلي السعودي': 'Al-Ahli Saudi',
  'الشباب': 'Al-Shabab', 'الشباب السعودي': 'Al-Shabab',
  'الاتفاق': 'Al-Ettifaq',
  'التعاون': 'Al-Taawoun',
  'الفتح': 'Al-Fateh',
  'القادسيه': 'Al-Qadsiah',
  'الرائد': 'Al-Raed',
  'ضمك': 'Damac FC',
  'الفيحاء': 'Al-Fayha',
  'الخليج': 'Al-Khaleej',
  'الاخدود': 'Al-Okhdood',
  'الرياض': 'Al-Riyadh',
  'العروبه': 'Al-Orobah',
  'الخلود': 'Al-Kholood',
  'الوحدة السعودي': 'Al-Wehda',
  'ابها': 'Abha Club',
  'الطائي': 'Al-Tai',
  'الحزم': 'Al-Hazem',
  'نيوم': 'Neom SC',
  // Egypt (Egyptian Premier League)
  'الاهلي': 'Al Ahly', 'الاهلي المصري': 'Al Ahly',
  'الزمالك': 'Zamalek',
  'بيراميدز': 'Pyramids FC',
  'المصري': 'Al Masry', 'المصري البورسعيدي': 'Al Masry',
  'الاسماعيلي': 'Ismaily',
  'فيوتشر': 'Modern Sport FC', 'مودرن سبورت': 'Modern Sport FC',
  'الاتحاد السكندري': 'Al Ittihad Alexandria',
  'سموحه': 'Smouha SC',
  'انبي': 'ENPPI SC',
  'طلائع الجيش': 'Tala\'ea El Gaish',
  'البنك الاهلي': 'National Bank of Egypt SC',
  'سيراميكا كليوباترا': 'Ceramica Cleopatra',
  'زد': 'ZED FC', 'زد اف سي': 'ZED FC',
  'فاركو': 'Pharco FC',
  'الجونه': 'El Gouna FC',
  'المقاولون العرب': 'Al Mokawloon Al Arab',
  'غزل المحله': 'Ghazl El Mahalla',
  'حرس الحدود': 'Haras El Hodoud',
  'بتروجيت': 'Petrojet',
  // Morocco (Botola Pro)
  'الوداد': 'Wydad AC', 'الوداد الرياضي': 'Wydad AC', 'الوداد البيضاوي': 'Wydad AC',
  'الرجاء': 'Raja CA', 'الرجاء الرياضي': 'Raja CA', 'الرجاء البيضاوي': 'Raja CA',
  'نهضه بركان': 'RS Berkane',
  'الجيش الملكي': 'AS FAR',
  'الفتح الرياضي': 'FUS Rabat',
  'المغرب الفاسي': 'MAS Fez',
  'اتحاد طنجه': 'Ittihad Tanger',
  'حسنيه اكادير': 'Hassania Agadir',
  'اولمبيك اسفي': 'Olympic Safi',
  'الدفاع الحسني الجديدي': 'Difaa El Jadida',
  'المغرب التطواني': 'Moghreb Tetouan',
  'نهضه الزمامره': 'Renaissance Zemamra',
  'اتحاد تواركه': 'Union Touarga',
  'شباب السوالم': 'JS Soualem',
  'النادي المكناسي': 'COD Meknes',
  // Tunisia (Ligue 1)
  'الترجي': 'Esperance de Tunis', 'الترجي التونسي': 'Esperance de Tunis', 'الترجي الرياضي': 'Esperance de Tunis',
  'النجم الساحلي': 'Etoile du Sahel', 'النجم الرياضي الساحلي': 'Etoile du Sahel',
  'النادي الافريقي': 'Club Africain', 'الافريقي': 'Club Africain',
  'الصفاقسي': 'CS Sfaxien', 'النادي الصفاقسي': 'CS Sfaxien',
  'الاتحاد المنستيري': 'US Monastir',
  'الملعب التونسي': 'Stade Tunisien',
  'النادي البنزرتي': 'CA Bizertin',
  'النجم المتلوي': 'ES Metlaoui',
  'اتحاد بن قردان': 'US Ben Guerdane',
  'الاولمبي الباجي': 'Olympique Beja',
  'مستقبل سليمان': 'AS Soliman',
  'قوافل قفصه': 'EGS Gafsa',
  'شبيبه العمران': 'JS El Omrane',
  'ترجي جرجيس': 'ES Zarzis',
  // Algeria (Ligue 1)
  'مولوديه الجزائر': 'MC Alger',
  'شباب بلوزداد': 'CR Belouizdad',
  'اتحاد العاصمه': 'USM Alger',
  'شبيبه القبائل': 'JS Kabylie',
  'وفاق سطيف': 'ES Setif',
  'شباب قسنطينه': 'CS Constantine',
  'شبيبه الساوره': 'JS Saoura',
  'مولوديه وهران': 'MC Oran',
  'نادي بارادو': 'Paradou AC',
  'اتحاد خنشله': 'USM Khenchela',
  'اولمبي الشلف': 'ASO Chlef',
  'نجم مقره': 'NC Magra',
  'اتحاد بسكره': 'US Biskra',
  // Qatar, UAE, Iraq, Jordan, Kuwait, Bahrain, Oman, Lebanon, Sudan
  'السد': 'Al Sadd', 'السد القطري': 'Al Sadd',
  'الدحيل': 'Al-Duhail',
  'الريان': 'Al-Rayyan',
  'الغرافه': 'Al-Gharafa',
  'الوكره': 'Al-Wakrah',
  'العربي القطري': 'Al-Arabi SC',
  'قطر القطري': 'Qatar SC',
  'ام صلال': 'Umm Salal SC',
  'الاهلي القطري': 'Al Ahli SC (Doha)',
  'الشمال': 'Al-Shamal SC',
  'الخور': 'Al-Khor SC',
  'العين': 'Al Ain', 'العين الاماراتي': 'Al Ain',
  'شباب الاهلي': 'Shabab Al Ahli',
  'الوصل': 'Al Wasl',
  'الجزيره الاماراتي': 'Al Jazira', 'الجزيره': 'Al Jazira',
  'الشارقه': 'Sharjah FC',
  'الوحده الاماراتي': 'Al Wahda FC',
  'بني ياس': 'Baniyas Club',
  'عجمان': 'Ajman Club',
  'النصر الاماراتي': 'Al-Nasr SC (Dubai)',
  'كلباء': 'Al-Ittihad Kalba',
  'خورفكان': 'Khor Fakkan Club',
  'الشرطه': 'Al-Shorta SC', 'الشرطه العراقي': 'Al-Shorta SC',
  'القوه الجويه': 'Al-Quwa Al-Jawiya',
  'الزوراء': 'Al-Zawraa SC',
  'الطلبه': 'Al-Talaba SC',
  'اربيل': 'Erbil SC',
  'الفيصلي': 'Al-Faisaly SC (Amman)', 'الفيصلي الاردني': 'Al-Faisaly SC (Amman)',
  'الوحدات': 'Al-Wehdat SC',
  'الحسين اربد': 'Al-Hussein SC (Irbid)',
  'الكويت الكويتي': 'Kuwait SC',
  'القادسيه الكويتي': 'Qadsia SC',
  'العربي الكويتي': 'Al-Arabi SC (Kuwait)',
  'المحرق': 'Al-Muharraq SC',
  'الرفاع': 'Al-Riffa SC',
  'الخالديه': 'Al-Khaldiya SC',
  'السيب': 'Al-Seeb Club',
  'النهضه العماني': 'Al-Nahda Club',
  'العهد': 'Al Ahed FC',
  'النجمه اللبناني': 'Nejmeh SC',
  'الانصار اللبناني': 'Al Ansar FC',
  'الهلال السوداني': 'Al-Hilal Club (Omdurman)',
  'المريخ السوداني': 'Al-Merrikh SC',
  // Major African, Asian & Americas Clubs
  'صن داونز': 'Mamelodi Sundowns', 'ماميلودي صن داونز': 'Mamelodi Sundowns',
  'اورلاندو بايرتس': 'Orlando Pirates',
  'كايزر تشيفز': 'Kaizer Chiefs',
  'مازيمبي': 'TP Mazembe', 'تي بي مازيمبي': 'TP Mazembe',
  'سيمبا': 'Simba SC',
  'يانغ افريكانز': 'Young Africans SC',
  'بترو اتلتيكو': 'Petro de Luanda',
  'اسيك ميموزا': 'ASEC Mimosas',
  'انييمبا': 'Enyimba',
  'برسبوليس': 'Persepolis',
  'استقلال طهران': 'Esteghlal',
  'سباهان': 'Sepahan',
  'تراكتور': 'Tractor SC',
  'اولسان هيونداي': 'Ulsan HD',
  'جيونبوك': 'Jeonbuk Hyundai Motors',
  'بوهانغ ستيلرز': 'Pohang Steelers',
  'كاواساكي فرونتال': 'Kawasaki Frontale',
  'يوكوهاما مارينوس': 'Yokohama F. Marinos',
  'فيسيل كوبي': 'Vissel Kobe',
  'اوراوا ريد دايموندز': 'Urawa Red Diamonds',
  'انتر ميامي': 'Inter Miami CF',
  'بوكا جونيورز': 'Boca Juniors',
  'ريفر بليت': 'River Plate',
  'فلامنغو': 'Flamengo',
  'بالميراس': 'Palmeiras',
  'فلومينينسي': 'Fluminense',
  'كورينثيانز': 'Corinthians',
  'ساو باولو': 'Sao Paulo FC',
  'سانتوس': 'Santos FC'
};

// National Teams (folded Arabic name -> { en, iso2 }) -> Guaranteed FlagCDN fallback
const NATIONAL_TEAMS = {
  // Arab World
  'مصر': { en: 'Egypt', iso2: 'eg' },
  'المغرب': { en: 'Morocco', iso2: 'ma' },
  'تونس': { en: 'Tunisia', iso2: 'tn' },
  'الجزائر': { en: 'Algeria', iso2: 'dz' },
  'السعوديه': { en: 'Saudi Arabia', iso2: 'sa' }, 'المملكه العربيه السعوديه': { en: 'Saudi Arabia', iso2: 'sa' },
  'قطر': { en: 'Qatar', iso2: 'qa' },
  'الامارات': { en: 'United Arab Emirates', iso2: 'ae' }, 'الامارات العربيه المتحده': { en: 'United Arab Emirates', iso2: 'ae' },
  'العراق': { en: 'Iraq', iso2: 'iq' },
  'الاردن': { en: 'Jordan', iso2: 'jo' },
  'فلسطين': { en: 'Palestine', iso2: 'ps' },
  'سوريا': { en: 'Syria', iso2: 'sy' },
  'لبنان': { en: 'Lebanon', iso2: 'lb' },
  'عمان': { en: 'Oman', iso2: 'om' }, 'سلطنه عمان': { en: 'Oman', iso2: 'om' },
  'البحرين': { en: 'Bahrain', iso2: 'bh' },
  'الكويت': { en: 'Kuwait', iso2: 'kw' },
  'اليمن': { en: 'Yemen', iso2: 'ye' },
  'السودان': { en: 'Sudan', iso2: 'sd' },
  'جنوب السودان': { en: 'South Sudan', iso2: 'ss' },
  'ليبيا': { en: 'Libya', iso2: 'ly' },
  'موريتانيا': { en: 'Mauritania', iso2: 'mr' },
  'جزر القمر': { en: 'Comoros', iso2: 'km' },
  'جيبوتي': { en: 'Djibouti', iso2: 'dj' },
  'الصومال': { en: 'Somalia', iso2: 'so' },
  // Africa (CAF)
  'السنغال': { en: 'Senegal', iso2: 'sn' },
  'نيجيريا': { en: 'Nigeria', iso2: 'ng' },
  'الكاميرون': { en: 'Cameroon', iso2: 'cm' },
  'كوت ديفوار': { en: 'Ivory Coast', iso2: 'ci' }, 'ساحل العاج': { en: 'Ivory Coast', iso2: 'ci' },
  'غانا': { en: 'Ghana', iso2: 'gh' },
  'مالي': { en: 'Mali', iso2: 'ml' },
  'بوركينا فاسو': { en: 'Burkina Faso', iso2: 'bf' },
  'جنوب افريقيا': { en: 'South Africa', iso2: 'za' },
  'الكونغو الديمقراطيه': { en: 'DR Congo', iso2: 'cd' }, 'جمهورية الكونغو الديمقراطيه': { en: 'DR Congo', iso2: 'cd' },
  'الكونغو': { en: 'Congo', iso2: 'cg' },
  'غينيا': { en: 'Guinea', iso2: 'gn' },
  'غينيا الاستوائيه': { en: 'Equatorial Guinea', iso2: 'gq' },
  'غينيا بيساو': { en: 'Guinea-Bissau', iso2: 'gw' },
  'الراس الاخضر': { en: 'Cape Verde', iso2: 'cv' }, 'كاب فيردي': { en: 'Cape Verde', iso2: 'cv' },
  'انغولا': { en: 'Angola', iso2: 'ao' },
  'زامبيا': { en: 'Zambia', iso2: 'zm' },
  'زيمبابوي': { en: 'Zimbabwe', iso2: 'zw' },
  'موزمبيق': { en: 'Mozambique', iso2: 'mz' },
  'ناميبيا': { en: 'Namibia', iso2: 'na' },
  'اوغندا': { en: 'Uganda', iso2: 'ug' },
  'تنزانيا': { en: 'Tanzania', iso2: 'tz' },
  'كينيا': { en: 'Kenya', iso2: 'ke' },
  'اثيوبيا': { en: 'Ethiopia', iso2: 'et' },
  'الغابون': { en: 'Gabon', iso2: 'ga' },
  'بنين': { en: 'Benin', iso2: 'bj' },
  'توغو': { en: 'Togo', iso2: 'tg' },
  'النيجر': { en: 'Niger', iso2: 'ne' },
  'مدغشقر': { en: 'Madagascar', iso2: 'mg' },
  'رواندا': { en: 'Rwanda', iso2: 'rw' },
  'بوروندي': { en: 'Burundi', iso2: 'bi' },
  'مالاوي': { en: 'Malawi', iso2: 'mw' },
  'بوتسوانا': { en: 'Botswana', iso2: 'bw' },
  'ليبيريا': { en: 'Liberia', iso2: 'lr' },
  'سيراليون': { en: 'Sierra Leone', iso2: 'sl' },
  'غامبيا': { en: 'Gambia', iso2: 'gm' },
  'تشاد': { en: 'Chad', iso2: 'td' },
  'افريقيا الوسطى': { en: 'Central African Republic', iso2: 'cf' },
  'موريشيوس': { en: 'Mauritius', iso2: 'mu' },
  'سيشل': { en: 'Seychelles', iso2: 'sc' },
  'اسواتيني': { en: 'Eswatini', iso2: 'sz' },
  'ليسوتو': { en: 'Lesotho', iso2: 'ls' },
  // Europe (UEFA)
  'فرنسا': { en: 'France', iso2: 'fr' },
  'اسبانيا': { en: 'Spain', iso2: 'es' },
  'انجلترا': { en: 'England', iso2: 'gb-eng' },
  'المانيا': { en: 'Germany', iso2: 'de' },
  'ايطاليا': { en: 'Italy', iso2: 'it' },
  'البرتغال': { en: 'Portugal', iso2: 'pt' },
  'هولندا': { en: 'Netherlands', iso2: 'nl' },
  'بلجيكا': { en: 'Belgium', iso2: 'be' },
  'كرواتيا': { en: 'Croatia', iso2: 'hr' },
  'سويسرا': { en: 'Switzerland', iso2: 'ch' },
  'الدنمارك': { en: 'Denmark', iso2: 'dk' },
  'النمسا': { en: 'Austria', iso2: 'at' },
  'بولندا': { en: 'Poland', iso2: 'pl' },
  'اوكرانيا': { en: 'Ukraine', iso2: 'ua' },
  'تركيا': { en: 'Turkey', iso2: 'tr' },
  'صربيا': { en: 'Serbia', iso2: 'rs' },
  'السويد': { en: 'Sweden', iso2: 'se' },
  'النرويج': { en: 'Norway', iso2: 'no' },
  'التشيك': { en: 'Czech Republic', iso2: 'cz' }, 'جمهوريه التشيك': { en: 'Czech Republic', iso2: 'cz' },
  'المجر': { en: 'Hungary', iso2: 'hu' },
  'رومانيا': { en: 'Romania', iso2: 'ro' },
  'اسكتلندا': { en: 'Scotland', iso2: 'gb-sct' },
  'ويلز': { en: 'Wales', iso2: 'gb-wls' },
  'ايرلندا': { en: 'Republic of Ireland', iso2: 'ie' },
  'ايرلندا الشماليه': { en: 'Northern Ireland', iso2: 'gb-nir' },
  'اليونان': { en: 'Greece', iso2: 'gr' },
  'سلوفاكيا': { en: 'Slovakia', iso2: 'sk' },
  'سلوفينيا': { en: 'Slovenia', iso2: 'si' },
  'البانيا': { en: 'Albania', iso2: 'al' },
  'جورجيا': { en: 'Georgia', iso2: 'ge' },
  'ايسلندا': { en: 'Iceland', iso2: 'is' },
  'فنلندا': { en: 'Finland', iso2: 'fi' },
  'البوسنه والهرسك': { en: 'Bosnia and Herzegovina', iso2: 'ba' },
  'مقدونيا الشماليه': { en: 'North Macedonia', iso2: 'mk' },
  'الجبل الاسود': { en: 'Montenegro', iso2: 'me' },
  'بلغاريا': { en: 'Bulgaria', iso2: 'bg' },
  'روسيا': { en: 'Russia', iso2: 'ru' },
  'بيلاروسيا': { en: 'Belarus', iso2: 'by' },
  'كوسوفو': { en: 'Kosovo', iso2: 'xk' },
  'لوكسمبورغ': { en: 'Luxembourg', iso2: 'lu' },
  'قبرص': { en: 'Cyprus', iso2: 'cy' },
  'مالطا': { en: 'Malta', iso2: 'mt' },
  'استونيا': { en: 'Estonia', iso2: 'ee' },
  'لاتفيا': { en: 'Latvia', iso2: 'lv' },
  'ليتوانيا': { en: 'Lithuania', iso2: 'lt' },
  'كازاخستان': { en: 'Kazakhstan', iso2: 'kz' },
  'اذربيجان': { en: 'Azerbaijan', iso2: 'az' },
  'ارمينيا': { en: 'Armenia', iso2: 'am' },
  'مولدوفا': { en: 'Moldova', iso2: 'md' },
  'جزر فارو': { en: 'Faroe Islands', iso2: 'fo' },
  'جبل طارق': { en: 'Gibraltar', iso2: 'gi' },
  'اندورا': { en: 'Andorra', iso2: 'ad' },
  'سان مارينو': { en: 'San Marino', iso2: 'sm' },
  'ليختنشتاين': { en: 'Liechtenstein', iso2: 'li' },
  // Americas & Asia & Oceania
  'الارجنتين': { en: 'Argentina', iso2: 'ar' },
  'البرازيل': { en: 'Brazil', iso2: 'br' },
  'اوروغواي': { en: 'Uruguay', iso2: 'uy' },
  'كولومبيا': { en: 'Colombia', iso2: 'co' },
  'تشيلي': { en: 'Chile', iso2: 'cl' },
  'الاكوادور': { en: 'Ecuador', iso2: 'ec' },
  'بيرو': { en: 'Peru', iso2: 'pe' },
  'باراغواي': { en: 'Paraguay', iso2: 'py' },
  'فنزويلا': { en: 'Venezuela', iso2: 've' },
  'بوليفيا': { en: 'Bolivia', iso2: 'bo' },
  'الولايات المتحده': { en: 'United States', iso2: 'us' }, 'امريكا': { en: 'United States', iso2: 'us' },
  'المكسيك': { en: 'Mexico', iso2: 'mx' },
  'كندا': { en: 'Canada', iso2: 'ca' },
  'كوستاريكا': { en: 'Costa Rica', iso2: 'cr' },
  'بنما': { en: 'Panama', iso2: 'pa' },
  'جامايكا': { en: 'Jamaica', iso2: 'jm' },
  'هندوراس': { en: 'Honduras', iso2: 'hn' },
  'اليابان': { en: 'Japan', iso2: 'jp' },
  'كوريا الجنوبيه': { en: 'South Korea', iso2: 'kr' },
  'ايران': { en: 'Iran', iso2: 'ir' },
  'استراليا': { en: 'Australia', iso2: 'au' },
  'اوزبكستان': { en: 'Uzbekistan', iso2: 'uz' },
  'الصين': { en: 'China', iso2: 'cn' },
  'تايلاند': { en: 'Thailand', iso2: 'th' },
  'فيتنام': { en: 'Vietnam', iso2: 'vn' },
  'اندونيسيا': { en: 'Indonesia', iso2: 'id' },
  'ماليزيا': { en: 'Malaysia', iso2: 'my' },
  'الهند': { en: 'India', iso2: 'in' },
  'كوريا الشماليه': { en: 'North Korea', iso2: 'kp' },
  'قيرغيزستان': { en: 'Kyrgyzstan', iso2: 'kg' },
  'طاجيكستان': { en: 'Tajikistan', iso2: 'tj' },
  'تركمانستان': { en: 'Turkmenistan', iso2: 'tm' },
  'نيوزيلندا': { en: 'New Zealand', iso2: 'nz' }
};

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
if (!metadataCache._teams || typeof metadataCache._teams !== 'object') {
  metadataCache._teams = {};
}
if (!metadataCache._leagues || typeof metadataCache._leagues !== 'object') {
  metadataCache._leagues = {};
}

function saveCache() {
  metadataCache._version = CACHE_VERSION;
  fs.writeFileSync(cacheFile, JSON.stringify(metadataCache, null, 2), 'utf8');
}

// ============================================================================
// GENERIC HELPERS
// ============================================================================
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

function cleanUrl(value) {
  if (typeof value !== 'string') return null;
  let u = value.trim();
  if (!u || /^(null|undefined|n\/a|none)$/i.test(u)) return null;
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('http://')) u = 'https://' + u.slice(7);
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

function cleanHexColor(value) {
  const t = cleanText(value);
  if (!t) return null;
  const hex = t.startsWith('#') ? t : `#${t}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : null;
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
      if (!res.ok) return null;
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
  if (channelName && norm === normalizeName(channelName)) return true;
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
  if (SPORTS_CAT_RE.test(catText) || /مباراة|ضد|\bvs\.?\b/i.test(title)) return 'sports';
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
// SPORTS MATCH PARSER & MULTI-SOURCE BADGE ENRICHMENT
// ============================================================================
const STUDIO_RE = /استوديو|تحليلي|ما قبل المباراة|ما بعد المباراة|ملخص|أهداف|pre[\s-]?match|post[\s-]?match|highlights|review|studio/i;
const EXPLICIT_VS_RE = /\s+(?:ضد|×|x|vs\.?|v\.?)\s+/i;
const NON_TEAM_WORD_RE = /حلقة|جزء|موسم|برنامج|نشرة|موجز|فيلم|مسلسل|j[o0]urn[eé]e|week|round|matchday|episode|part/i;
const COMMENTATOR_RE = /(?:المعلق|تعليق)\s*[:\-]?\s*([^\n،,|.\-()]+)|(?:commentator|commentary)\s*[:\-]?\s*([^\n,|.\-()]+)/i;
const ROUND_RE = /(?:الجولة|الأسبوع|ربع النهائي|نصف النهائي|النهائي|دور الـ?\s*\d+|المجموعات|Matchday|Round|Week|Quarter-?final|Semi-?final|Final)\s*\d*/i;
const WIKI_HEADERS = { 'User-Agent': 'ArabicTVGuideBot/1.0 (https://github.com/samijalloulien/arabic-tv-guide)' };

function classifyLeague(text) {
  const raw = cleanText(text);
  if (!raw) return { key: null, tsdbId: null, ar: null, en: null, fr: null };
  for (const [key, def] of Object.entries(LEAGUES)) {
    if (def.re.test(raw)) {
      return { key, tsdbId: def.tsdbId || null, ar: def.ar, en: def.en, fr: def.fr };
    }
  }
  return { key: null, tsdbId: null, ar: raw, en: raw, fr: raw };
}

function inferSportKind(text) {
  const t = String(text || '');
  if (/تنس|tennis|atp|wta|roland garros|wimbledon/i.test(t)) return 'tennis';
  if (/سلة|basketball|nba|euroleague/i.test(t)) return 'basketball';
  if (/فورمولا|formula|motogp|rally|سباق/i.test(t)) return 'motorsport';
  if (/ملاكمة|boxing|ufc|mma|مصارعة/i.test(t)) return 'combat';
  return 'football';
}

function extractCommentator(description) {
  if (!description) return null;
  const m = description.match(COMMENTATOR_RE);
  const raw = m && (m[1] || m[2]);
  return raw ? cleanText(raw) : null;
}

function extractRound(rawTitle, episodeTitle, description) {
  const text = `${episodeTitle || ''} ${rawTitle || ''} ${description || ''}`;
  const m = text.match(ROUND_RE);
  return m ? cleanText(m[0]) : null;
}

function parseSportsEvent(rawTitle, description, episodeTitle, categories, channelCategory) {
  const fullText = `${rawTitle} ${description || ''} ${(categories || []).join(' ')}`;
  const isSportsChannel = channelCategory === 'sports' || SPORTS_CAT_RE.test(fullText);
  const isStudio = STUDIO_RE.test(rawTitle);

  let work = String(rawTitle || '')
    .replace(/^(?:مباشر|نقل مباشر|مباراة|الاستوديو التحليلي|استوديو تحليلي)\s*[:\-]?\s*/i, '')
    .replace(/\((?:مباشر|إعادة|live|rerun)\)/gi, '')
    .trim();

  let leagueRaw = null;
  let matchPart = work;

  const colonIdx = work.search(/[:|]/);
  if (colonIdx > 1 && colonIdx < work.length - 3) {
    const left = work.slice(0, colonIdx).trim();
    const right = work.slice(colonIdx + 1).trim();
    if (EXPLICIT_VS_RE.test(right) || (isSportsChannel && /\s+[-–—]\s+/.test(right))) {
      leagueRaw = left;
      matchPart = right;
    } else if (EXPLICIT_VS_RE.test(left)) {
      matchPart = left;
      leagueRaw = right;
    }
  } else if (/\s+[-–—]\s+/.test(work)) {
    const dashParts = work.split(/\s+[-–—]\s+/);
    if (dashParts.length === 2) {
      if (EXPLICIT_VS_RE.test(dashParts[0]) && !EXPLICIT_VS_RE.test(dashParts[1])) {
        matchPart = dashParts[0].trim();
        leagueRaw = dashParts[1].trim();
      } else if (EXPLICIT_VS_RE.test(dashParts[1]) && !EXPLICIT_VS_RE.test(dashParts[0])) {
        leagueRaw = dashParts[0].trim();
        matchPart = dashParts[1].trim();
      }
    } else if (dashParts.length >= 3) {
      leagueRaw = dashParts[0].trim();
      matchPart = `${dashParts[1].trim()} - ${dashParts[2].trim()}`;
    }
  }

  let homeTeam = null;
  let awayTeam = null;

  const vsMatch = matchPart.match(EXPLICIT_VS_RE);
  if (vsMatch) {
    const idx = vsMatch.index;
    homeTeam = matchPart.slice(0, idx).trim();
    awayTeam = matchPart.slice(idx + vsMatch[0].length).trim();
  } else if (isSportsChannel && /\s+[-–—]\s+/.test(matchPart)) {
    const parts = matchPart.split(/\s+[-–—]\s+/);
    if (parts.length === 2) {
      const a = parts[0].trim();
      const b = parts[1].trim();
      if (
        a.length >= 2 && a.length <= 35 &&
        b.length >= 2 && b.length <= 35 &&
        !/^\d+$/.test(a) && !/^\d+$/.test(b) &&
        !NON_TEAM_WORD_RE.test(a) && !NON_TEAM_WORD_RE.test(b)
      ) {
        homeTeam = a;
        awayTeam = b;
      }
    }
  }

  if (!homeTeam || !awayTeam) return null;

  const cleanTeam = t => t.replace(/^(?:نادي|فريق|منتخب)\s+/i, '').replace(/[-:|،]+$/g, '').trim();
  homeTeam = cleanTeam(homeTeam);
  awayTeam = cleanTeam(awayTeam);
  if (!homeTeam || !awayTeam || homeTeam.length < 2 || awayTeam.length < 2) return null;

  const leagueInfo = classifyLeague(leagueRaw || `${episodeTitle || ''} ${description || ''} ${(categories || []).join(' ')}`);
  return {
    sport: inferSportKind(fullText),
    isStudio,
    league: leagueInfo,
    round: extractRound(rawTitle, episodeTitle, description),
    commentator: extractCommentator(description),
    homeTeam,
    awayTeam
  };
}

// Strips youth/women/age suffixes for logo lookup while keeping original display names intact
function stripTeamQualifiers(name) {
  return String(name || '')
    .replace(/\((?:سيدات|شباب|ناشئين|أولمبي|تحت\s*\d+|women|u\d+|w)\)/gi, '')
    .replace(/\b(?:الأولمبي|الاولمبي|للشباب|للناشئين|سيدات|للسيدات|تحت\s*\d+|women|u\d+)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lookupDictionaryTeam(rawTeamName) {
  const base = stripTeamQualifiers(rawTeamName);
  const norm = normalizeName(base);
  const variants = [norm, norm.replace(/^ال/, ''), `ال${norm}`];

  // Check clubs first so e.g. "المصري" matches Al Masry club rather than Egypt national team
  for (const v of variants) {
    if (CLUB_AR_TO_EN[v]) return { type: 'club', en: CLUB_AR_TO_EN[v], iso2: null };
  }
  for (const v of variants) {
    if (NATIONAL_TEAMS[v]) return { type: 'national', en: NATIONAL_TEAMS[v].en, iso2: NATIONAL_TEAMS[v].iso2 };
  }
  if (/^[a-zA-Z0-9\s\-.'&]+$/.test(base)) {
    return { type: 'club', en: base, iso2: null };
  }
  return { type: 'unknown', en: null, iso2: null };
}

function isUsableCrestUrl(url) {
  const u = cleanUrl(url);
  if (!u) return false;
  const lower = u.toLowerCase();
  if (lower.endsWith('.svg') || lower.includes('.svg.png')) return false;
  const bad = ['flag_of_', 'soccerball', 'kit_body', 'stadium', 'map_', 'silhouette', 'commons-logo', 'disambig'];
  return !bad.some(p => lower.includes(p));
}

// Source 2: Wikidata resolver (returns English club name + official P154 logo PNG)
async function lookupTeamWikidata(queryTitle, lang = 'ar') {
  try {
    const searchData = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(queryTitle)}&language=${lang}&uselang=${lang}&format=json&limit=4`,
      { headers: WIKI_HEADERS, retries: 1 }
    );
    const candidates = (searchData && searchData.search) || [];
    if (!candidates.length) return null;

    const ids = candidates.map(c => c.id).join('|');
    const entityData = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels|descriptions|claims&languages=ar|en&format=json`,
      { headers: WIKI_HEADERS, retries: 1 }
    );
    const entities = (entityData && entityData.entities) || {};

    for (const cand of candidates) {
      const ent = entities[cand.id];
      if (!ent || !ent.claims) continue;
      const descAr = (ent.descriptions && ent.descriptions.ar && ent.descriptions.ar.value) || '';
      const descEn = (ent.descriptions && ent.descriptions.en && ent.descriptions.en.value) || '';
      if (!/نادي|فريق|منتخب|كرة|football|soccer|club|national|team|sport/i.test(`${descAr} ${descEn}`)) continue;

      const enLabel = (ent.labels && ent.labels.en && ent.labels.en.value) || null;
      let logo = null;
      const logoClaim = ent.claims.P154 && ent.claims.P154[0];
      const fileName = logoClaim && logoClaim.mainsnak && logoClaim.mainsnak.datavalue && logoClaim.mainsnak.datavalue.value;
      if (fileName) {
        const candidateUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=200`;
        if (isUsableCrestUrl(candidateUrl)) logo = candidateUrl;
      }
      return { enName: enLabel, badge: logo };
    }
  } catch {}
  return null;
}

// Source 3: Wikipedia PageImages thumbnail (catches Arab/African clubs whose crest is on Wikipedia)
async function lookupTeamWikipediaCrest(title, lang = 'en') {
  if (!title) return null;
  try {
    const data = await fetchJson(
      `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=200&format=json`,
      { headers: WIKI_HEADERS, retries: 1 }
    );
    const pages = (data && data.query && data.query.pages) || {};
    for (const page of Object.values(pages)) {
      const thumb = page && page.thumbnail && page.thumbnail.source;
      if (thumb && isUsableCrestUrl(thumb)) return cleanUrl(thumb);
    }
  } catch {}
  return null;
}

async function fetchTeamDetails(rawTeamName) {
  const normKey = normalizeName(rawTeamName);
  const existing = metadataCache._teams[normKey];
  if (existing !== undefined && existing.tv === TEAM_ENTRY_FORMAT && existing.badge) {
    return existing;
  }

  const dict = lookupDictionaryTeam(rawTeamName);
  let enName = (existing && existing.name_en) || dict.en || null;
  let badge = null;
  let jersey = (existing && existing.jersey) || null;
  let stadium = (existing && existing.stadium) || null;
  let stadiumCity = (existing && existing.stadium_city) || null;
  let stadiumImage = (existing && existing.stadium_image) || null;
  let color = (existing && existing.color) || null;

  // Step 1: Resolve English name via Wikidata if still unknown
  let wikiResult = null;
  if (!enName) {
    wikiResult = await lookupTeamWikidata(stripTeamQualifiers(rawTeamName), 'ar');
    if (wikiResult && wikiResult.enName) enName = wikiResult.enName;
  }

  // Step 2: Query TheSportsDB for official badge, jersey, stadium & club color
  if (enName) {
    try {
      const data = await fetchJson(
        `https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_API_KEY}/searchteams.php?t=${encodeURIComponent(enName)}`,
        { retries: 1 }
      );
      const teams = (data && Array.isArray(data.teams) && data.teams) || [];
      const hit =
        teams.find(t => normalizeName(t.strTeam) === normalizeName(enName)) ||
        teams.find(t => /soccer|football/i.test(t.strSport || '') && isTitleMatch(t.strTeam, enName)) ||
        teams.find(t => /soccer|football/i.test(t.strSport || '')) ||
        null;

      if (hit) {
        enName = cleanText(hit.strTeam) || enName;
        badge = cleanUrl(hit.strBadge || hit.strTeamBadge) || badge;
        jersey = cleanUrl(hit.strJersey) || jersey;
        stadium = cleanText(hit.strStadium) || stadium;
        stadiumCity = cleanText(hit.strStadiumLocation) || stadiumCity;
        stadiumImage = cleanUrl(hit.strStadiumThumb) || stadiumImage;
        color = cleanHexColor(hit.strColour1) || color;
      }
      await sleep(250);
    } catch {}
  }

  // Step 3: Wikidata P154 logo fallback
  if (!badge) {
    if (!wikiResult && enName) {
      wikiResult = await lookupTeamWikidata(enName, 'en');
    }
    if (wikiResult && wikiResult.badge) badge = wikiResult.badge;
  }

  // Step 4: Wikipedia infobox crest thumbnail fallback (English & Arabic Wikipedia)
  if (!badge && enName) {
    badge = await lookupTeamWikipediaCrest(enName, 'en');
  }
  if (!badge) {
    badge = await lookupTeamWikipediaCrest(stripTeamQualifiers(rawTeamName), 'ar');
  }

  // Step 5: Guaranteed high-res PNG flag fallback for national teams
  if (!badge && dict.type === 'national' && dict.iso2) {
    badge = `https://flagcdn.com/w160/${dict.iso2}.png`;
  }

  const resolved = {
    tv: TEAM_ENTRY_FORMAT,
    name_en: enName || null,
    badge: cleanUrl(badge),
    jersey: cleanUrl(jersey),
    stadium: cleanText(stadium),
    stadium_city: cleanText(stadiumCity),
    stadium_image: cleanUrl(stadiumImage),
    color: cleanHexColor(color)
  };
  metadataCache._teams[normKey] = resolved;
  return resolved;
}

async function fetchLeagueBadge(leagueKey, tsdbId) {
  if (!leagueKey || !tsdbId) return null;
  if (metadataCache._leagues[leagueKey] !== undefined) {
    return metadataCache._leagues[leagueKey];
  }

  try {
    const data = await fetchJson(
      `https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_API_KEY}/lookupleague.php?id=${encodeURIComponent(tsdbId)}`,
      { retries: 1 }
    );
    const leagueObj = data && Array.isArray(data.leagues) && data.leagues[0];
    const badge = leagueObj ? cleanUrl(leagueObj.strBadge || leagueObj.strLogo) : null;
    metadataCache._leagues[leagueKey] = badge;
    return badge;
  } catch {
    return null;
  }
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
      if (!rank) continue;
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
  if (/\.svg(\?.*)?$/i.test(u)) return null;
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

  for (const hit of validResults.slice(0, 3)) {
    if (!direct(hit) && (hit.vote_count || 0) < 20) continue;
    const mapped = await fetchTmdbDetail(hit.media_type, hit.id);
    if (mapped && isVerifiedDetail(mapped, queryTitle)) return mapped;
  }
  return null;
}

async function searchWikidata(cleanTitle, expectedYear) {
  const isLatin = /^[a-zA-Z0-9\s\-:&'.,!?]+$/.test(cleanTitle);
  const searchLang = isLatin ? 'en' : 'ar';

  try {
    const searchData = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(cleanTitle)}&language=${searchLang}&uselang=${searchLang}&format=json&limit=5`,
      { headers: WIKI_HEADERS, retries: 1 }
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
      { headers: WIKI_HEADERS, retries: 1 }
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

  let tmdb = await searchTmdbFull(cleanTitle, expectedYear, category);
  const wiki = await searchWikidata(cleanTitle, expectedYear);
  if (!tmdb && wiki && wiki.original_title) {
    tmdb = await searchTmdbFull(wiki.original_title, wiki.year || expectedYear, category);
  }

  const enriched = {
    fv: ENTRY_FORMAT,
    tmdb_id: (tmdb && tmdb.tmdb_id) || null,
    tmdb_media: (tmdb && tmdb.tmdb_media) || null,
    tmdb_title: (tmdb && tmdb.tmdb_title) || null,
    verified: !!tmdb,
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
    entry.alt_match = fresh.alt_titles;
    entry.i18n = fresh.i18n;
    for (const f of TMDB_REFRESH_FIELDS) if (fresh[f]) entry[f] = fresh[f];
    if (fresh.cast.length) entry.cast = fresh.cast;
    if (fresh.genres.length) entry.genres = fresh.genres;
    if (fresh.rating) { entry.rating = fresh.rating; entry.vote_count = fresh.vote_count; }
    break;
  }

  if (!refreshed) throw new TransientError(`refresh failed for tmdb ${entry.tmdb_id}`);

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
  if (/shahid\.mbc\.net|osn-artwork\.anghcdn\.co|\/Horizontal\//i.test(u)) return { kind: 'backdrop', url: u };
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

    const baseId = baseIdOf(ch.id).toLowerCase();
    const normName = normalizeName(ch.name);
    const isArt = baseId.startsWith('artaflam') || baseId.startsWith('arthikayat') || baseId.startsWith('artcinema') || normName.startsWith('art ');
    const isShahid = baseId.includes('shahid') || normName.includes('shahid') || normName.includes('شاهد') || (progs.length && progs[0].channelId.includes('shahid.mbc.net'));

    const brandFallbackLogo = isArt
      ? (logosById.get('artaflam1.sa') || logosById.get('artcinema.sa') || null)
      : isShahid
        ? (logosByName.get('shahid') || logosById.get('mbc1.ae') || 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Shahid_logo.svg/512px-Shahid_logo.svg.png')
        : null;

    const icon =
      usableChannelIcon(ch.xmlIcon) ||
      logosById.get(baseId) ||
      logosByName.get(normName) ||
      brandFallbackLogo ||
      null;

    if (!icon) { droppedNoLogo.push(`${ch.id} (${progs.length} programmes)`); continue; }

    candidates.push({ id: ch.id, rawName: ch.name, icon, realCount: progs.length });
  }

  const byNorm = new Map();
  for (const c of candidates) {
    const key = normalizeName(c.rawName);
    const cur = byNorm.get(key);
    if (!cur || c.realCount > cur.realCount) byNorm.set(key, c);
  }
  let selected = Array.from(byNorm.values());

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
      if (last && last.stopMs && p.startMs < last.stopMs) {
        if (last.stopMs - p.startMs < 60000) last.stopMs = p.startMs;
      }
      dedup.push(p);
    }

    const out = [];
    for (let i = 0; i < dedup.length; i++) {
      const p = dedup[i];
      const next = dedup[i + 1];
      let stopMs = p.stopMs;
      if (stopMs === null || stopMs <= p.startMs) stopMs = next ? next.startMs : p.startMs + 3600000;
      if (next && stopMs > next.startMs) stopMs = next.startMs;
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

  // ---- 5. Enrichment (Movies/Series via TMDB) -------------------------------------
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
    console.warn('⚠️  TMDB_API_KEY is not set: skipping TMDB enrichment, using metadata_cache.json only.');
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
        if (err instanceof TransientError) transientFailures++;
      }
      if (++n % 15 === 0) { saveCache(); process.stdout.write(`   Enriched ${n}/${toEnrich.length}...\r`); }
      await sleep(60);
    }
    saveCache();
    console.log(`\n✅ TMDB enrichment completed (${transientFailures} transient failures will be retried next run).`);
  }

  // ---- 6. Build shows ------------------------------------------------------------------------
  const trustedEnriched = e => {
    if (!e) return null;
    if (e.tmdb_id && e.verified !== true) return null;
    return e;
  };

  const trustedRating = e => {
    if (!e || !e.rating) return null;
    if (e.vote_count == null) return e.tmdb_id ? null : e.rating;
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
      content_type: null,
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

  // ---- 7. Channel categories refinement & content types ------------------------
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

  // ---- 8b. Sports & Football Match Extraction with Multi-Source Logos (api/sports.json) --------
  const rawMatchSlots = [];
  const rawStudioSlots = [];
  const teamsToLookup = new Set();
  const leaguesToLookup = new Map();

  for (const ch of channels) {
    for (const s of slotsByChannel.get(ch.id)) {
      const g = groups.get(normalizeName(s.cleanTitle) || s.rawTitle.toLowerCase());
      const showId = groupShowId.get(g.key);
      const show = showsById.get(showId);
      if (ch.category !== 'sports' && show.content_type !== 'sports') continue;

      const parsed = parseSportsEvent(s.rawTitle, s.description, s.episodeTitle, s.categories, ch.category);
      if (!parsed) continue;

      if (parsed.isStudio) {
        rawStudioSlots.push({ ch, s, parsed });
        continue;
      }

      rawMatchSlots.push({ ch, s, showId, parsed });
      if (parsed.league.key && parsed.league.tsdbId && metadataCache._leagues[parsed.league.key] === undefined) {
        leaguesToLookup.set(parsed.league.key, parsed.league.tsdbId);
      }
      for (const teamName of [parsed.homeTeam, parsed.awayTeam]) {
        const tKey = normalizeName(teamName);
        const existing = metadataCache._teams[tKey];
        if (existing === undefined || existing.tv !== TEAM_ENTRY_FORMAT || !existing.badge) {
          teamsToLookup.add(teamName);
        }
      }
    }
  }

  if (!OFFLINE && (teamsToLookup.size > 0 || leaguesToLookup.size > 0)) {
    for (const [lKey, tsdbId] of leaguesToLookup.entries()) {
      await fetchLeagueBadge(lKey, tsdbId);
      await sleep(250);
    }

    const budget = Array.from(teamsToLookup).slice(0, MAX_TEAM_LOOKUPS_PER_RUN);
    console.log(`⚽ Enriching ${budget.length} clubs & national teams (TheSportsDB + Wikidata + Wikipedia + Flags)...`);
    let tCount = 0;
    for (const teamName of budget) {
      await fetchTeamDetails(teamName);
      if (++tCount % 10 === 0) {
        saveCache();
        process.stdout.write(`   Teams ${tCount}/${budget.length}...\r`);
      }
      await sleep(100);
    }
    saveCache();
    console.log('\n✅ Sports team logos, national flags, stadiums & league badges completed.');
  }

  const emptyTeam = rawName => {
    const dict = lookupDictionaryTeam(rawName);
    return {
      name_en: dict.en || null,
      badge: dict.type === 'national' && dict.iso2 ? `https://flagcdn.com/w160/${dict.iso2}.png` : null,
      jersey: null,
      stadium: null,
      stadium_city: null,
      stadium_image: null,
      color: null
    };
  };

  const matchesMap = new Map();
  let matchesWithBothBadges = 0;

  for (const { ch, s, showId, parsed } of rawMatchSlots) {
    const homeInfo = metadataCache._teams[normalizeName(parsed.homeTeam)] || emptyTeam(parsed.homeTeam);
    const awayInfo = metadataCache._teams[normalizeName(parsed.awayTeam)] || emptyTeam(parsed.awayTeam);

    const homeNorm = normalizeName(homeInfo.name_en || stripTeamQualifiers(parsed.homeTeam));
    const awayNorm = normalizeName(awayInfo.name_en || stripTeamQualifiers(parsed.awayTeam));
    const startBucket = Math.floor(s.startTs / 900) * 900;
    const matchKey = `${homeNorm}_vs_${awayNorm}_${startBucket}`;

    if (!matchesMap.has(matchKey)) {
      const hBadge = cleanUrl(homeInfo.badge);
      const aBadge = cleanUrl(awayInfo.badge);
      if (hBadge && aBadge) matchesWithBothBadges++;

      matchesMap.set(matchKey, {
        match_id: `m_${shortHash(matchKey)}`,
        show_id: showId,
        sport: parsed.sport,
        league: parsed.league.ar,
        league_en: parsed.league.en,
        league_fr: parsed.league.fr,
        league_key: parsed.league.key,
        league_badge: parsed.league.key ? cleanUrl(metadataCache._leagues[parsed.league.key]) : null,
        round: parsed.round || null,
        home_team: parsed.homeTeam,
        home_team_en: homeInfo.name_en || null,
        home_badge: hBadge,
        home_jersey: cleanUrl(homeInfo.jersey),
        home_color: cleanHexColor(homeInfo.color),
        away_team: parsed.awayTeam,
        away_team_en: awayInfo.name_en || null,
        away_badge: aBadge,
        away_jersey: cleanUrl(awayInfo.jersey),
        away_color: cleanHexColor(awayInfo.color),
        stadium: cleanText(homeInfo.stadium),
        stadium_city: cleanText(homeInfo.stadium_city),
        stadium_image: cleanUrl(homeInfo.stadium_image),
        title: `${parsed.homeTeam} × ${parsed.awayTeam}`,
        description: cleanText(s.description) || '',
        commentator: parsed.commentator || null,
        start: tsToIso(s.startTs),
        stop: tsToIso(s.stopTs),
        start_ts: s.startTs,
        stop_ts: s.stopTs,
        duration_minutes: Math.round((s.stopTs - s.startTs) / 60),
        is_live: s.isLive,
        channels: [],
        studio_shows: [],
        _teamPairKey: `${homeNorm}_vs_${awayNorm}`
      });
    }

    const matchObj = matchesMap.get(matchKey);
    if (s.isLive) matchObj.is_live = true;
    const desc = cleanText(s.description);
    if (desc && desc.length > matchObj.description.length) matchObj.description = desc;
    if (!matchObj.commentator && parsed.commentator) matchObj.commentator = parsed.commentator;
    if (!matchObj.round && parsed.round) matchObj.round = parsed.round;

    if (!matchObj.channels.some(c => c.channel_id === ch.id)) {
      matchObj.channels.push({
        channel_id: ch.id,
        safe_id: ch.safeId,
        channel_name: ch.name,
        channel_name_ar: ch.nameAr || null,
        channel_icon: ch.icon
      });
    }
  }

  // Attach pre-match and post-match studio shows to their corresponding match card
  for (const { ch, s, parsed } of rawStudioSlots) {
    const hInfo = metadataCache._teams[normalizeName(parsed.homeTeam)] || emptyTeam(parsed.homeTeam);
    const aInfo = metadataCache._teams[normalizeName(parsed.awayTeam)] || emptyTeam(parsed.awayTeam);
    const pairKey = `${normalizeName(hInfo.name_en || stripTeamQualifiers(parsed.homeTeam))}_vs_${normalizeName(aInfo.name_en || stripTeamQualifiers(parsed.awayTeam))}`;

    for (const matchObj of matchesMap.values()) {
      if (matchObj._teamPairKey !== pairKey) continue;
      if (Math.abs(s.startTs - matchObj.start_ts) > 4 * 3600) continue;
      if (!matchObj.commentator && parsed.commentator) matchObj.commentator = parsed.commentator;

      if (!matchObj.studio_shows.some(st => st.channel_id === ch.id && st.start_ts === s.startTs)) {
        matchObj.studio_shows.push({
          channel_id: ch.id,
          channel_name: ch.name,
          channel_icon: ch.icon,
          title: s.rawTitle,
          start: tsToIso(s.startTs),
          stop: tsToIso(s.stopTs),
          start_ts: s.startTs,
          stop_ts: s.stopTs
        });
      }
    }
  }

  const allMatches = Array.from(matchesMap.values())
    .map(m => {
      delete m._teamPairKey;
      m.studio_shows.sort((a, b) => a.start_ts - b.start_ts);
      return m;
    })
    .sort((a, b) => a.start_ts - b.start_ts || a.title.localeCompare(b.title, 'ar'));

  const sportsDays = {};
  const leagueStats = new Map();
  for (const m of allMatches) {
    const day = tsToDay(m.start_ts);
    if (!sportsDays[day]) sportsDays[day] = [];
    sportsDays[day].push(m);

    if (m.league_key) {
      if (!leagueStats.has(m.league_key)) {
        leagueStats.set(m.league_key, {
          key: m.league_key,
          ar: m.league,
          en: m.league_en,
          fr: m.league_fr,
          badge: m.league_badge,
          count: 0
        });
      }
      leagueStats.get(m.league_key).count += 1;
    }
  }

  const sortedSportsDays = {};
  Object.keys(sportsDays).sort().forEach(d => { sortedSportsDays[d] = sportsDays[d]; });

  const sportsDoc = {
    schema_version: SCHEMA_VERSION,
    updated_at: new Date(startedAt).toISOString(),
    as_of_ts: nowTs,
    days_count: Object.keys(sortedSportsDays).length,
    matches_count: allMatches.length,
    leagues: Array.from(leagueStats.values()).sort((a, b) => b.count - a.count),
    days: sortedSportsDays,
    upcoming_matches: allMatches.filter(m => m.stop_ts > nowTs).slice(0, 50)
  };

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
    if (sh.content_type === 'news' && !sh.poster && !sh.backdrop) continue;
    searchable.push(sh);
  }
  searchable.sort((a, b) => rankScore(b) - rankScore(a) || a.title.localeCompare(b.title, 'ar'));

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
    sh.similar.push(...scored.slice(0, 8).map(x => x[1]));
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
    files: ['channels.json', 'grid.json', 'featured.json', 'search_index.json', 'sports.json'],
    channels: channels.length,
    shows: showsById.size,
    searchable_shows: searchIndex.length,
    sports_matches: allMatches.length,
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
  const problems = validateOutputs({ channelsDoc, channelFiles, searchDoc, featuredDoc, showsById, gridDoc, sportsDoc });
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
  fs.writeFileSync(path.join(apiDir, 'sports.json'), ser(sportsDoc), 'utf8');
  fs.writeFileSync(path.join(apiDir, 'meta.json'), ser(metaDoc), 'utf8');

  // ---- 13. Report ----------------------------------------------------------------------------------------------------------------------
  const catCounts = {};
  channels.forEach(c => { catCounts[c.category] = (catCounts[c.category] || 0) + 1; });
  const typeCounts = {};
  searchable.forEach(s => { typeCounts[s.content_type] = (typeCounts[s.content_type] || 0) + 1; });
  const withPoster = searchable.filter(s => s.poster).length;
  const withRating = searchable.filter(s => s.rating).length;
  const unmatchedRules = CHANNEL_RULES.filter((_, i) => !ruleUse.has(i)).map(r => r.en);

  console.log(`🎉 Generated ${channels.length} channel schedules, ${showsById.size} unique shows, ${allMatches.length} sports matches.`);
  console.log(`📺 Channel categories: ${JSON.stringify(catCounts)}`);
  console.log(`🔎 search_index: ${searchIndex.length} shows (${withPoster} with poster, ${withRating} with rating) ${JSON.stringify(typeCounts)}`);
  console.log(`⚽ sports.json: ${matchesWithBothBadges}/${allMatches.length} matches with both team/national logos (${sportsDoc.leagues.length} leagues)`);
  console.log(`⭐ featured: hero=${heroPicked.length} tonight=${tonightPicked.length} series=${topSeries.length} movies=${topMovies.length} kids=${kidsPicks.length} docs=${documentaries.length} sports=${sportsHighlights.length}`);
  if (droppedUnverified.length) console.log(`🧹 Ignored ${droppedUnverified.length} unverified TMDB matches, e.g. ${droppedUnverified.slice(0, 10).join(' ; ')}`);
  if (droppedNoLogo.length) console.log(`🖼️  Skipped ${droppedNoLogo.length} channel(s) without a logo: ${droppedNoLogo.slice(0, 12).join(', ')}${droppedNoLogo.length > 12 ? ', …' : ''}`);
  if (unmatchedRules.length) console.log(`ℹ️  Priority rules with no channel in this run: ${unmatchedRules.join(', ')}`);
}

// ============================================================================
// VALIDATION (null-safety contract)
// ============================================================================
const URL_KEYS = new Set([
  'icon', 'channel_icon', 'poster', 'backdrop', 'trailer_url', 'profile_image',
  'home_badge', 'away_badge', 'league_badge', 'stadium_image', 'home_jersey', 'away_jersey'
]);
const ARRAY_KEYS = new Set([
  'cast', 'genres', 'genre_keys', 'similar', 'all_airings', 'airings',
  'now_and_next', 'channels', 'items', 'leagues', 'upcoming_matches', 'studio_shows'
]);

function validateOutputs({ channelsDoc, channelFiles, searchDoc, featuredDoc, showsById, gridDoc, sportsDoc }) {
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
  walk(sportsDoc, 'sports.json');
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

module.exports = { fetchTmdbDetail, mapTranslations, parseProgramTitle, parseSportsEvent, isFillerTitle, cleanUrl, normalizeName, xmltvToMs, categorizeChannelByName, matchChannelRule };