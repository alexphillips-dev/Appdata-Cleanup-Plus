import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const plugin = path.join(root, 'source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const scopes = read(path.join(root, 'scripts/i18n_review_scopes.json'));
const ledger = read(path.join(root, 'scripts/i18n_reviews.json'));
const locales = read(path.join(plugin, 'locales/locales.json'));
const master = read(path.join(plugin, 'locales/en_US.json'));
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const sourceHash = phrase => hash(phrase.source + '\n' + phrase.context + '\n' + JSON.stringify(scopes.glossary));
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? '' : process.argv[i + 1] || ''; };
if (scopes.schemaVersion !== 1 || ledger.schemaVersion !== 1 || !Array.isArray(ledger.reviews)) throw Error('Invalid review schema');
const phrases = new Map();
for (const phrase of scopes.phrases) {
  if (phrases.has(phrase.id) || master[phrase.source] !== phrase.source || !phrase.context || !phrase.screen) throw Error(`Invalid review phrase: ${phrase.id}`);
  phrases.set(phrase.id, phrase);
}
const reviews = new Map();
for (const review of ledger.reviews) {
  const phrase = phrases.get(review.phraseId);
  if (!phrase || !locales[review.locale]) throw Error('Review must reference a supported locale and phrase');
  const key = review.locale + '/' + review.phraseId;
  if (reviews.has(key)) throw Error(`Duplicate review: ${key}`);
  const catalog = read(path.join(plugin, 'locales', review.locale + '.json'));
  if (review.sourceHash !== sourceHash(phrase) || review.translationHash !== hash(catalog[phrase.source])) throw Error(`Stale review: ${key}. Review the changed wording/context again.`);
  if (review.status !== 'native-speaker-reviewed' || typeof review.reviewer !== 'string' || !review.reviewer.trim() || typeof review.reviewedAt !== 'string' || Number.isNaN(Date.parse(review.reviewedAt)) || review.nativeSpeaker !== true || review.glossaryChecked !== true || !Array.isArray(review.screenshots) || !review.screenshots.includes(phrase.screen + '-desktop.png') || !review.screenshots.includes(phrase.screen + '-mobile.png')) throw Error(`Incomplete human review evidence: ${key}`);
  reviews.set(key, review);
}
for (const locale of Object.keys(locales)) {
  const reviewed = [...phrases.keys()].filter(id => reviews.has(locale + '/' + id)).length;
  console.log(`${locale}: ${reviewed}/${phrases.size} safety phrases native-speaker reviewed`);
}
const locale = option('--locale');
if (locale) {
  if (!locales[locale]) throw Error('Select a supported locale');
  const outputArg = option('--output');
  if (!outputArg) throw Error('--locale requires --output DIR');
  const output = path.resolve(outputArg);
  fs.mkdirSync(output, {recursive:true});
  if (process.argv.includes('--screenshots')) execFileSync(process.execPath, [path.join(root, 'tests/i18n_review_screenshots.cjs'), locale, output], {stdio:'inherit'});
  const catalog = read(path.join(plugin, 'locales', locale + '.json'));
  const rows = scopes.phrases.map(phrase => `<tr><td>${escape(phrase.id)}<p>${escape(phrase.context)}</p><a href="${escape(phrase.screen)}-desktop.png">Desktop</a> / <a href="${escape(phrase.screen)}-mobile.png">Mobile</a></td><td lang="en">${escape(phrase.source)}</td><td lang="${escape(locales[locale].tag)}" dir="${locales[locale].rtl ? 'rtl' : 'ltr'}">${escape(catalog[phrase.source])}</td><td>${reviews.has(locale + '/' + phrase.id) ? 'Native-speaker reviewed' : 'Awaiting native-speaker review'}</td></tr>`).join('\n');
  fs.writeFileSync(path.join(output, 'review.html'), `<!doctype html><meta charset="utf-8"><title>Translation review ${escape(locale)}</title><style>body{font:16px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:12px;vertical-align:top}td{width:25%}p{max-width:70ch}</style><h1>Safety translation review: ${escape(locale)}</h1><p>These are synthetic screenshots. Check meanings, grammar, actions, placeholders, mobile wrapping and reading direction. Automated checks are not human approval. Follow docs/translation-review.md to submit corrections and review records.</p><h2>Reference glossary</h2><dl>${Object.entries(scopes.glossary).map(([term,meaning])=>`<dt><strong>${escape(term)}</strong></dt><dd>${escape(meaning)}</dd>`).join('')}</dl><table><thead><tr><th>Context and screenshots</th><th>English</th><th>Translation</th><th>Review status</th></tr></thead><tbody>${rows}</tbody></table>`);
  fs.writeFileSync(path.join(output, 'review-records.json'), JSON.stringify(scopes.phrases.map(phrase => ({locale,phraseId:phrase.id,sourceHash:sourceHash(phrase),translationHash:hash(catalog[phrase.source]),status:'awaiting-review',reviewer:'',reviewedAt:'',nativeSpeaker:false,glossaryChecked:false,screenshots:[phrase.screen + '-desktop.png',phrase.screen + '-mobile.png']})), null, 2) + '\n');
  console.log(`Review packet: ${path.join(output, 'review.html')}`);
}
