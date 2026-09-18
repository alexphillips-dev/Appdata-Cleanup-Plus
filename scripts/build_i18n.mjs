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
}
const sorted = Object.fromEntries(Object.entries(messages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const englishFile = path.join(dir, 'en_US.json');
const signature = text => (text.match(/\{\w+\}/g) || []).sort().join('|');
const untranslated = (key, value) => key === value && key.length > 35 && /[a-z] [a-z]/i.test(key);
const missingTechnicalTerms = (key, value) => ['Appdata Cleanup Plus', 'Unraid', 'Docker', 'ZFS', 'appdata'].some(term => key.split(term).length - 1 > value.toLowerCase().split(term.toLowerCase()).length - 1);
const check = process.argv.includes('--check');
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
const queue = Object.entries(locales);
await Promise.all(Array.from({length: process.argv.includes('--translate') ? 2 : 1}, async () => {
  while (queue.length) { const [locale, definition] = queue.shift(); await build(locale, definition); }
}));
