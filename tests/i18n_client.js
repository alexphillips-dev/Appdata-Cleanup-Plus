"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plugin = path.resolve(__dirname, '../source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const locales = JSON.parse(fs.readFileSync(path.join(plugin, 'locales/locales.json'), 'utf8'));
const window = {};
const jquery = {
  isArray: Array.isArray,
  isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value),
  trim: value => String(value || '').trim(),
  extend: (...values) => Object.assign(...values),
  map: (values, callback) => values.map(callback),
  grep: (values, callback) => values.filter(callback),
  each: (values, callback) => Object.keys(values || {}).forEach(key => callback(key, values[key]))
};
const context = {window, document: {}, jQuery: jquery, Intl, Date};
vm.runInNewContext(fs.readFileSync(path.join(plugin, 'scripts/appdata.cleanup.plus.shared.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(path.join(plugin, 'scripts/appdata.cleanup.plus.panels.js'), 'utf8'), context);
const ACP = window.AppdataCleanupPlus;
for (const [locale, definition] of Object.entries(locales)) {
  const catalog = JSON.parse(fs.readFileSync(path.join(plugin, 'locales', locale + '.json'), 'utf8'));
  window.appdataCleanupPlusConfig = {catalog, languageTag: definition.tag, timeZone: 'UTC'};
  assert.equal(ACP.t({}, 'missingKey', 'Delete'), catalog.Delete, locale + ' missing page key uses catalog');
  const template = 'Saved templates {names}';
  assert.equal(ACP.tr(template, {names: '<b>Delete</b>'}), catalog[template].replace('{names}', '<b>Delete</b>'));
  assert.ok(ACP.escapeHtml(ACP.tr(template, {names: '<b>Delete</b>'})).includes('&lt;b&gt;Delete&lt;/b&gt;'));
  assert.equal(ACP.tr('Missing future phrase'), 'Missing future phrase');
  const data = {name:'Delete', path:'/mnt/user/Delete', status:'ready', timestamp:'2026-09-18T12:30:00Z', timestampLabel:'English date', sizeBytes:1536, sizeLabel:'1.5 KB', bundle:{timestampLabel:'English date', timestamp:'2026-09-18T12:30:00Z'}};
  const result = ACP.localizePresentation(data);
  assert.equal(result.name, 'Delete');
  assert.equal(result.path, '/mnt/user/Delete');
  assert.equal(result.status, 'ready');
  assert.equal(result.bundle.timestampLabel, 'English date');
  assert.equal(result.timestampLabel, new Intl.DateTimeFormat(definition.tag, {dateStyle:'medium', timeStyle:'short', timeZone:'UTC'}).format(new Date(data.timestamp)));
  assert.equal(result.sizeLabel, new Intl.NumberFormat(definition.tag, {maximumFractionDigits:1}).format(1.5) + ' KB');
  const explanation = ACP.buildRowReviewExplanation({strings:{}, state:{settings:{}}}, {sourceNames:['Delete'], targetPaths:['/data/Delete'], path:'/mnt/user/Delete', sourceRoot:'/mnt/user', canDelete:true});
  assert.ok(explanation.evidence.includes('Delete') && explanation.evidence.includes('/mnt/user/Delete'));
  if (locale !== 'en_US') assert.ok(!explanation.evidence.includes('Saved templates:'), locale + ' evidence is translated');
  assert.equal(ACP.getRowBlockType({storageKind:'zfs', policyLocked:true, policyReason:catalog.Delete, policyReasonCode:'permanent_delete'}), 'options');
  assert.equal(ACP.getRowBlockType({securityLockReason:catalog.Delete, securityReasonCode:'symlink'}), 'safety');
}
console.log('i18n_client: all locales, escaping, dates, numbers and literal data passed.');
