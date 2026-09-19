import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const plugin = path.join(root, 'source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const dir = path.join(plugin, 'locales');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const locales = read(path.join(dir, 'locales.json'));
const overrides = read(path.join(root, 'scripts/i18n_overrides.json'));
const pluralMessages = read(path.join(root, 'scripts/i18n_plural_messages.json'));
const pluralOverrides = read(path.join(root, 'scripts/i18n_plural_overrides.json'));
const pluralRules = read(path.join(dir, 'plural-rules.json')).rules;
const messages = JSON.parse(execFileSync('php', [path.join(root, 'scripts/extract_i18n.php')], {encoding: 'utf8'}));
for (const text of read(path.join(root, 'scripts/i18n_messages.json'))) messages[text] = text;
const decode = value => JSON.parse('"' + value + '"');
const page = fs.readFileSync(path.join(plugin, 'AppdataCleanupPlus.page'), 'utf8');
for (const match of page.matchAll(/(?:_|acpT|acpH)\("((?:[^"\\]|\\.)*)"\)/g)) {
  const text = decode(match[1]); messages[text] = text;
}
for (const name of fs.readdirSync(path.join(plugin, 'scripts')).filter(name => name.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(plugin, 'scripts', name), 'utf8');
  for (const match of source.matchAll(/ACP\.(?:t\([^,]+,\s*"(?:[^"\\]|\\.)*",\s*|tr\()"((?:[^"\\]|\\.)*)"/g)) {
    const text = decode(match[1]); messages[text] = text;
  }
  for (const match of source.matchAll(/ACP\.plural\("((?:[^"\\]|\\.)*)"/g)) {
    if (!Object.hasOwn(pluralMessages, decode(match[1]))) throw Error(`${name}: missing complete plural template ${match[1]}`);
  }
}
const sorted = Object.fromEntries(Object.entries(messages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const englishFile = path.join(dir, 'en_US.json');
const signature = text => (text.match(/\{\w+\}/g) || []).sort().join('|');
const implicitCount = (locale, category) => {
  const groups = pluralRules[locale][category].filter(terms => terms.every(([operand, mod, not, ranges]) => ['n','i'].includes(operand) || (ranges.some(([lo,hi]) => lo <= 0 && hi >= 0) !== not)));
  if (!['one', 'two'].includes(category) || !groups.length) return false;
  const count = category === 'one' ? 1 : 2;
  return groups.every(terms => terms.some(([operand, mod, not, ranges]) => ['n','i'].includes(operand) && !mod && !not && ranges.length === 1 && ranges[0][0] === count && ranges[0][1] === count));
};
const pluralSignature = (text, key, locale, category) => signature(text) === signature(key) || (implicitCount(locale, category) && signature(text) === signature(key.replace('{count}', '')));
// Shared technical terms can legitimately be identical. Short UI phrases are
// otherwise checked just as strictly as long prose.
const sharedTerms = new Set(['Appdata Cleanup Plus', 'appdata cleanup plus', 'gateway timeout', 'Docker offline', 'Docker is offline', 'ZFS dataset', 'ZFS dataset: {dataset}']);
const untranslated = (key, value) => key === value && !sharedTerms.has(key) && /[a-z]{2} [a-z]{2}/i.test(key);
const missingTechnicalTerms = (key, value) => ['Appdata Cleanup Plus', 'Unraid', 'Docker', 'ZFS', 'appdata'].some(term => key.split(term).length - 1 > value.toLowerCase().split(term.toLowerCase()).length - 1);
const check = process.argv.includes('--check');
// Bundle integer formatting for PHP without requiring Unraid's optional intl extension.
const numberFormats = Object.fromEntries(Object.entries(locales).map(([locale, definition]) => {
  const formatter = new Intl.NumberFormat(definition.tag);
  const parts = formatter.formatToParts(1234567890);
  const groups = parts.filter(part => part.type === 'integer').map(part => Array.from(part.value).length);
  return [locale, {
    group: parts.find(part => part.type === 'group')?.value || '',
    primary: groups.at(-1), secondary: groups.at(-2) || groups.at(-1),
    minimum: [4,5,6,7].find(length => formatter.formatToParts(10 ** (length - 1)).some(part => part.type === 'group')) || 99,
    digits: Array.from({length:10}, (_, n) => formatter.format(n))
  }];
}));
const numberFormatFile = path.join(dir, 'number-formats.json');
if (check) {
  if (JSON.stringify(read(numberFormatFile)) !== JSON.stringify(numberFormats)) throw Error('Integer number formats are stale');
} else write(numberFormatFile, numberFormats);
const pluralMaster = path.join(dir, 'plural-messages.json');
if (check) {
  if (JSON.stringify(read(pluralMaster)) !== JSON.stringify(pluralMessages)) throw Error('Plural message master is stale');
} else {
  write(pluralMaster, pluralMessages);
  fs.mkdirSync(path.join(dir, 'plurals'), {recursive:true});
}
if (check) {
  if (JSON.stringify(read(englishFile)) !== JSON.stringify(sorted)) throw Error('English catalog is stale; run node scripts/build_i18n.mjs');
} else write(englishFile, sorted);
const batches = entries => {
  const result = []; let batch = [], size = 0;
  for (const entry of entries) {
    if (size + entry.length > 3000 && batch.length) { result.push(batch); batch = []; size = 0; }
    batch.push(entry); size += entry.length + 30;
  }
  if (batch.length) result.push(batch);
  return result;
};
async function translate(batch, target, attempt = 0) {
  const protectedWords = [];
  const protect = text => text.replace(/\{\w+\}|Appdata Cleanup Plus|Unraid|Docker|ZFS|appdata/g, value => {
    const token = `__${protectedWords.length}__`; protectedWords.push(value); return token;
  });
  const restore = text => text.replace(/__\s*(\d+)\s*__/g, (_, index) => protectedWords[Number(index)] || _);
  // Numeric delimiters survive languages that translate alphabetic sentinels.
  const markers = batch.slice(1).map((_, i) => `987654321${String(i + 1).padStart(4, '0')}`);
  const payload = batch.map((text, i) => (i ? markers[i - 1] + '\n' : '') + protect(text)).join('\n');
  const url = new URL('https://translate.googleapis.com/translate_a/t');
  for (const [key, value] of Object.entries({client:'dict-chrome-ex', sl:'en', tl:target, q:payload})) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(25000)});
    if (!response.ok) throw Error(`Translation HTTP ${response.status}`);
    const data = await response.json();
    const text = typeof data[0] === 'string' ? data[0] : data[0].map(segment => segment[0] || '').join('');
    const parts = (markers.length ? text.split(new RegExp('\\s*(?:' + markers.join('|') + ')\\s*')) : [text]).map(text => restore(text.trim()));
    if (parts.length !== batch.length || parts.some((text, i) => !text || untranslated(batch[i], text) || missingTechnicalTerms(batch[i], text) || signature(text) !== signature(batch[i]) || /ZXQ|QXZ|__ACP_|__\d+__|98765\d+/i.test(text))) {
      if (batch.length === 1) throw Error('Translation damaged placeholders: ' + batch[0]);
      const middle = Math.ceil(batch.length / 2);
      return {...await translate(batch.slice(0, middle), target), ...await translate(batch.slice(middle), target)};
    }
    return Object.fromEntries(batch.map((key, i) => [key, parts[i]]));
  } catch (error) {
    if (error.message.startsWith('Translation damaged placeholders:')) throw error;
    if (attempt >= 3) throw error;
    console.warn(`${target}: retry ${attempt + 1}, ${batch.length} phrases (${error.message})`);
    await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
    return translate(batch, target, attempt + 1);
  }
}
async function build(locale, definition) {
  await buildPlurals(locale, definition);
  if (locale === 'en_US') return;
  const file = path.join(dir, locale + '.json');
  const prior = fs.existsSync(file) ? read(file) : {};
  if (!check) Object.assign(prior, overrides[locale] || {});
  const missing = Object.keys(sorted).filter(key => typeof prior[key] !== 'string' || !prior[key].trim() || signature(prior[key]) !== signature(key) || untranslated(key, prior[key]) || missingTechnicalTerms(key, prior[key]) || /98765\d+/.test(prior[key]));
  if (missing.length && !process.argv.includes('--translate')) throw Error(`${locale}: ${missing.length} missing translations`);
  for (const batch of batches(missing)) {
    console.log(`${locale}: translating ${batch.length} missing phrases`);
    Object.assign(prior, await translate(batch, definition.translate));
    write(file, prior); // Resumable authoring; never called at runtime or in CI.
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const result = Object.fromEntries(Object.keys(sorted).map(key => [key, prior[key]]));
  Object.assign(result, overrides[locale] || {});
  const terminology = {ja_JA: ['検疫', '隔離'], zh_CN: ['检疫', '隔离'], zh_TW: ['檢疫', '隔離']}[locale];
  if (terminology) for (const key of Object.keys(result)) result[key] = result[key].split(terminology[0]).join(terminology[1]);
  for (const [key, value] of Object.entries(result)) {
    if (signature(key) !== signature(value) || missingTechnicalTerms(key, value) || /<\/?[a-z][^>]*>|ZXQ|__ACP_|__\d+__|98765\d+/i.test(value)) throw Error(`${locale}: invalid translation ${key}`);
    if (untranslated(key, value)) throw Error(`${locale}: untranslated prose ${key}`);
  }
  if (check && JSON.stringify(read(file)) !== JSON.stringify(result)) throw Error(`${locale}: stale terminology or catalog keys`);
  if (!check) write(file, result);
  console.log(`${locale}: ${Object.keys(result).length}/${Object.keys(sorted).length}`);
}

async function buildPlurals(locale, definition) {
  const file = path.join(dir, 'plurals', locale + '.json');
  const prior = fs.existsSync(file) ? read(file) : {};
  const categories = Object.keys(pluralRules[locale]);
  const selector = new Intl.PluralRules(definition.tag);
  const candidates = [1, 2, 5, 0, 3, 11, 21, 100, 101, 1000000, 1.1, ...Array.from({length:200}, (_, i) => i)];
  const requests = [];
  const result = {};
  for (const [other, one] of Object.entries(pluralMessages)) {
    result[other] = {};
    for (const category of categories) {
      const corrected = pluralOverrides[locale]?.[other]?.[category];
      const value = corrected ?? prior[other]?.[category];
      if (value && pluralSignature(value, other, locale, category)) { result[other][category] = value; continue; }
      if (check) throw Error(`${locale}: missing plural ${category}: ${other}`);
      if (locale === 'en_US') { result[other][category] = category === 'one' ? one : other; continue; }
      const sample = candidates.find(n => selector.select(n) === category);
      if (sample === undefined) throw Error(`${locale}: no sample for ${category}`);
      const source = (sample === 1 ? one : other).replace('{count}', String(sample));
      requests.push({other, category, sample, source});
    }
  }
  if (requests.length && !process.argv.includes('--translate')) throw Error(`${locale}: ${requests.length} missing plural forms`);
  for (const batch of batches([...new Set(requests.map(request => request.source))])) {
    console.log(`${locale}: translating ${batch.length} plural examples`);
    const translated = await translate(batch, definition.translate);
    for (const request of requests.filter(request => batch.includes(request.source))) {
      let value = translated[request.source];
      // Translate services sometimes return native digits or localized separators.
      value = value.replace(/[٠-٩۰-۹०-९০-৯๐-๙]/g, digit => String(digit.charCodeAt(0) - [0x660,0x6f0,0x966,0x9e6,0xe50].find(start => digit.charCodeAt(0) >= start && digit.charCodeAt(0) <= start + 9)));
      if (request.sample === 1.1) value = value.replace(/1,1/g, '1.1');
      if (request.sample === 1000000) value = value.replace(/1[.,\s\u00a0\u202f]?000[.,\s\u00a0\u202f]?000|1 (?:milhão|milhões|million|millions|millón|millones|milione|milioni)/gi, '1000000');
      const number = String(request.sample);
      // The real number provides grammatical context; it is restored to a placeholder.
      const pattern = new RegExp('(?<![0-9])' + number.replace('.', '\\.') + '(?![0-9])', 'g');
      let restored = value.replace(pattern, '{count}');
      if (request.sample === 2 && !restored.includes('{count}')) {
        const word = {et_EE:/\bkaks\b/i, fi_FI:/\bkaksi\b/i, de_DE:/\bzwei\b/i, nl_NL:/\btwee\b/i, lv_LV:/\bdiv[aiu]\b/i}[locale];
        if (word) restored = restored.replace(word, '{count}');
      }
      if (!pluralSignature(restored, request.other, locale, request.category)) {
        console.warn(`${locale}: plural number lost (${request.category}): ${request.other} => ${value}`);
        continue;
      }
      result[request.other][request.category] = restored;
    }
    write(file, result);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const terminology = {ja_JA:['検疫','隔離'], zh_CN:['检疫','隔离'], zh_TW:['檢疫','隔離']}[locale];
  for (const [key, forms] of Object.entries(result)) {
    for (const category of categories) {
      if (terminology && forms[category]) forms[category] = forms[category].split(terminology[0]).join(terminology[1]);
      if (!forms[category] || !pluralSignature(forms[category], key, locale, category) || /<\/?[a-z][^>]*>|__\d+__|98765\d+/i.test(forms[category])) throw Error(`${locale}: invalid plural: ${key}`);
      if (locale !== 'en_US' && untranslated(key, forms[category])) throw Error(`${locale}: untranslated plural: ${key}`);
    }
    result[key] = Object.fromEntries(categories.map(category => [category, forms[category]]));
  }
  if (check && JSON.stringify(read(file)) !== JSON.stringify(result)) throw Error(`${locale}: stale plural forms`);
  if (!check) write(file, result);
}
const queue = Object.entries(locales);
const failures = [];
await Promise.all(Array.from({length: process.argv.includes('--translate') ? 2 : 1}, async () => {
  while (queue.length) {
    const [locale, definition] = queue.shift();
    try { await build(locale, definition); } catch (error) { failures.push(error.message); console.error(error.message); }
  }
}));
if (failures.length) throw Error(failures.join('\n'));
