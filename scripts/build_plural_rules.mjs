// Maintainer-only refresh of pinned Unicode CLDR cardinal rules. Runtime is offline.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/locales');
const url = 'https://raw.githubusercontent.com/unicode-org/cldr-json/48.0.0/cldr-json/cldr-core/supplemental/plurals.json';
const response = await fetch(url);
if (!response.ok) throw Error(`CLDR HTTP ${response.status}`);
const data = (await response.json()).supplemental;
const locales = JSON.parse(fs.readFileSync(path.join(dir, 'locales.json'), 'utf8'));
const rules = {};
for (const [locale, definition] of Object.entries(locales)) {
  const language = definition.tag.split('-')[0];
  const source = data['plurals-type-cardinal'][definition.tag] || data['plurals-type-cardinal'][language];
  if (!source) throw Error(`Missing CLDR rules: ${locale}`);
  rules[locale] = {};
  for (const [key, raw] of Object.entries(source)) {
    const category = key.replace('pluralRule-count-', '');
    const condition = raw.split('@')[0].trim();
    rules[locale][category] = condition ? condition.split(' or ').map(group => group.split(' and ').map(term => {
      const match = term.match(/^([nivwftec])(?: % (\d+))? (!?=) ([\d.,]+)$/);
      if (!match) throw Error(`Unsupported CLDR relation: ${term}`);
      return [match[1], Number(match[2] || 0), match[3] === '!=', match[4].split(',').map(range => {
        const pair = range.split('..').map(Number); return [pair[0], pair[1] ?? pair[0]];
      })];
    })) : [];
  }
}
fs.writeFileSync(path.join(dir, 'plural-rules.json'), JSON.stringify({source:url, version:data.version._cldrVersion, rules}, null, 2) + '\n');
console.log('Wrote pinned CLDR rules for ' + Object.keys(rules).length + ' locales.');
