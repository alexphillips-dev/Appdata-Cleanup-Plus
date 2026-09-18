"use strict";
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const plugin = path.resolve(__dirname, '../source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus');
const locales = JSON.parse(fs.readFileSync(path.join(plugin, 'locales/locales.json'), 'utf8'));
for (const [locale, definition] of Object.entries(locales)) {
  const html = execFileSync('php', [path.join(__dirname, 'render_i18n_page.php'), locale], {encoding:'utf8', maxBuffer:4 * 1024 * 1024});
  const config = JSON.parse(html.match(/window\.appdataCleanupPlusConfig = (.+);/)[1]);
  assert.equal(config.locale, locale);
  assert.equal(config.direction, definition.rtl ? 'rtl' : 'ltr');
  assert.ok(html.includes('lang="' + definition.tag + '"'));
  assert.equal(config.strings.deleteConfirmButton, config.catalog.Delete, locale + ' delete translation');
  assert.equal(config.strings.quarantineConfirmButton, config.catalog.Quarantine);
  assert.equal(config.strings.helpTitle, config.catalog.Help);
  assert.ok(config.csrfToken, 'rendering retains CSRF configuration');
  assert.equal(config.apiUrl, '/plugins/appdata.cleanup.plus/include/exec.php');
  if (locale !== 'en_US') assert.notEqual(config.strings.deleteConfirmTitle, 'Delete selected folders?');
}
console.log('i18n_page: actual PHP page rendered successfully in all 42 languages.');
