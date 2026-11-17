const fs = require('fs');
const path = require('path');

// Exclusively Arab/MENA network sources (shahid.mbc.net includes all MBC + Shahid FAST channels)
const ARAB_ONLY_FAST_SITES = [
  'shahid.mbc.net',
  'adtv.ae',
  'awaan.ae',
  'maraya.sba.net.ae',
  'aloula.sa',
  'alkass.net',
  'roya.tv',
  'roya-tv.com',
  'lbcgroup.tv',
  'mtv.com.lb',
  'aljadeed.tv',
  '2m.ma',
  'medi1tv.com',
  'stctv.com',
  'osn.com'
];

// Multi-region sources (include ar channels + MENA country-coded en/fr channels)
const MULTI_REGION_FAST_SITES = [
  'bein.com',
  'beinsports.com',
  'aljazeera.com',
  'alarabiya.net',
  'skynewsarabia.com',
  'now.asharq.com',
  'starzplay.com'
];

// elcinema.com provides complete Arabic EPG data for ART TV & Rotana channels
const SLOW_SITES = [
  'elcinema.com'
];

const ARAB_COUNTRY_CODES = new Set([
  'ae', 'sa', 'eg', 'qa', 'ma', 'tn', 'dz', 'lb', 'jo',
  'kw', 'bh', 'om', 'iq', 'sy', 'ps', 'ye', 'sd', 'ly', 'mr'
]);

const ALLOWED_LANGS = new Set(['ar', 'en', 'fr']);

const seenBaseIds = new Set();
const seenNames = new Set();
const fastChannels = [];
const slowChannels = [];

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
    .replace(/(?:ايه|اي)\s*ار\s*تي/gi, 'art')
    .replace(/\b(hd|sd|fhd|uhd|tv)\b/gi, '')
    .replace(/([a-z\u0600-\u06FF])(\d)/gi, '$1 $2')
    .replace(/(\d)([a-z\u0600-\u06FF])/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || name.trim().toLowerCase();
}

function isArtChannel(xmltvId, name) {
  const id = xmltvId.toLowerCase();
  const n = normalizeName(name);
  return (
    id.startsWith('artaflam') ||
    id.startsWith('arthikayat') ||
    id.startsWith('artcinema') ||
    id.startsWith('art.') ||
    n.startsWith('art ')
  );
}

function getCountryCode(xmltvId) {
  const baseId = xmltvId.split('@')[0].toLowerCase();
  const parts = baseId.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function isMenaChannel(site, attrs, isArabOnlySite) {
  if (!ALLOWED_LANGS.has(attrs.lang)) return false;
  if (attrs.lang === 'ar') return true;
  if (isArabOnlySite) return true;

  const countryCode = getCountryCode(attrs.xmltv_id);
  return ARAB_COUNTRY_CODES.has(countryCode);
}

function processSites(sitesList, targetArray, isArabOnlySite, isFastPass) {
  for (const site of sitesList) {
    const siteDir = path.join(__dirname, 'sites', site);
    if (!fs.existsSync(siteDir)) continue;

    const files = fs.readdirSync(siteDir).filter(f => f.endsWith('.channels.xml'));
    const candidates = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(siteDir, file), 'utf8');
      const lineRegex = /<channel\s+([^>]+)>([^<]+)<\/channel>/g;
      let match;

      while ((match = lineRegex.exec(content)) !== null) {
        const attrsRaw = match[1];
        const name = match[2].trim();

        const attrs = {};
        const attrRegex = /(\w+)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrsRaw)) !== null) {
          attrs[attrMatch[1]] = attrMatch[2];
        }

        if (!attrs.xmltv_id || !attrs.site_id) continue;
        if (isJunkChannelName(name)) continue;

        // Defer ART channels during fast pass so elcinema.com grabs their full Arabic guide
        if (isFastPass && isArtChannel(attrs.xmltv_id, name)) continue;

        if (!isMenaChannel(site, attrs, isArabOnlySite)) continue;

        candidates.push({ site: attrs.site || site, attrs, name });
      }
    }

    candidates.sort((a, b) => (a.attrs.lang === 'ar' ? -1 : 1) - (b.attrs.lang === 'ar' ? -1 : 1));

    for (const item of candidates) {
      const baseId = item.attrs.xmltv_id.split('@')[0].toLowerCase();
      const normName = normalizeName(item.name);

      if (!seenBaseIds.has(baseId) && !seenNames.has(normName)) {
        seenBaseIds.add(baseId);
        seenNames.add(normName);
        targetArray.push(
          `  <channel site="${item.site}" lang="${item.attrs.lang}" xmltv_id="${item.attrs.xmltv_id}" site_id="${item.attrs.site_id}">${item.name}</channel>`
        );
      }
    }
  }
}

processSites(ARAB_ONLY_FAST_SITES, fastChannels, true, true);
processSites(MULTI_REGION_FAST_SITES, fastChannels, false, true);
processSites(SLOW_SITES, slowChannels, true, false);

fs.writeFileSync(
  path.join(__dirname, 'fast_channels.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<channels>\n${fastChannels.join('\n')}\n</channels>\n`,
  'utf8'
);

fs.writeFileSync(
  path.join(__dirname, 'slow_channels.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<channels>\n${slowChannels.join('\n')}\n</channels>\n`,
  'utf8'
);

console.log(`✅ Prepared ${fastChannels.length} channels in fast_channels.xml`);
console.log(`✅ Prepared ${slowChannels.length} channels in slow_channels.xml`);
console.log(`📊 Total: ${fastChannels.length + slowChannels.length} unique MENA channels (including Shahid & ART TV)`);