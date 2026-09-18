# Localization

Appdata Cleanup Plus follows Unraid's session locale, including the empty locale used by the switch back to English. Translation catalogs ship in the plugin archive and require no runtime network connection or extra PHP extension.

## Language coverage

The supported roster is the union of Unraid's [native language identifiers](https://github.com/unraid/webgui/blob/master/emhttp/plugins/dynamix/include/languages.key) and [official language repositories](https://github.com/orgs/unraid/repositories?q=lang-), checked on September 18, 2026. Some native selector languages do not yet have an official installable language pack. Bundling their plugin translations does not install a webGUI language pack.

42 locales: Afrikaans, Arabic, Bengali, Bosnian, Catalan, Chinese (Simplified), Chinese (Traditional), Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Irish, Italian, Japanese, Korean, Latvian, Norwegian, Persian, Polish, Portuguese (Brazil), Portuguese (Portugal), Romanian, Russian, Serbian, Slovak, Slovenian, Spanish, Swedish, Thai, Turkish, Ukrainian and Vietnamese.

The roster and BCP 47 formatting tags live in `source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/locales/locales.json`. Native aliases such as `ja_JP`/`ja_JA`, `ko_KR`/`ko_KO` and `da_DK`/`da_DA` resolve to the same catalog. Unknown locales and missing phrases fall back to English. Arabic, Hebrew and Persian use RTL layout; paths remain isolated LTR text.

## Runtime boundaries

- `acpT` returns plain translated text; `acpH` escapes it for HTML and attributes. The page embeds the catalog with JSON HTML escaping. JavaScript renders translated values with the existing escaping helpers.
- `ACP.t` resolves the existing named page strings, then uses the English fallback as a catalog key. `ACP.tr` formats complete sentences with named placeholders.
- `acpMessage` formats English message templates for unchanged storage and audit semantics. Only allowlisted presentation fields are translated by `acpLocalizeResponse`, after actions, locks, safety validation and persistence have finished.
- Paths, names, IDs, status codes, action names, settings, breadcrumbs and diagnostics stay literal. Only designated nested message parameters may be translated; path/name parameters are inserted unchanged.
- Browser `Intl` formatters use the selected language and the server's time zone for date labels, relative ages and sizes. PHP uses its optional Intl date formatter when present and a numeric local timestamp otherwise. No extension is required.
- Diagnostic bundles, system/installer logs and third-party command output remain support evidence in their original language. On-screen diagnostic controls are translated. English is the reference for release notes and repository documentation.

## Maintaining translations

`locales/en_US.json` is the English translation master. Catalogs contain public source strings only. Initial non-English catalogs were machine translated and structurally checked; native-speaker wording review is welcome, particularly for destructive-action terminology. Structural coverage is not a claim that every phrase has received native-speaker review.

1. Wrap page text with `acpT` or `acpH`, and browser text with `ACP.t` or `ACP.tr`. Use a complete sentence with named parameters when inserting a count, path or name.
2. For backend messages that are persisted, use `acpMessage`. Preserve all machine data and ensure the response field is in the presentation allowlist. Avoid translating state before validation or persistence.
3. Add irregular legacy presentation templates to `scripts/i18n_messages.json`. The extractor tokenizes PHP strings and reads browser translation calls; do not assume it discovers arbitrary new DOM text automatically.
4. Run `node scripts/build_i18n.mjs --translate` to update the English master and missing locale entries. This is an explicit maintainer-only operation that sends public source phrases to Google Translate. It saves each completed batch and resumes existing entries after a network failure. Existing translations are retained so community corrections survive regeneration. Manual catalog corrections should preserve every `{placeholder}` exactly.
5. Run the offline checks:

   ```text
   node scripts/build_i18n.mjs --check
   php tests/i18n_smoke.php
   node tests/i18n_client.js
   node tests/i18n_page.js
   ```

CI checks catalog coverage, placeholder integrity, locale aliases and fallback, path/ID preservation, backend dynamic results, history, escaping, dates and numbers. Runtime safety, privacy and confirmation tests still apply. Package changes with the normal dev builder so Unraid detects the updated catalogs.

For local layout verification, `node tests/i18n_layout.cjs` uses Playwright with Chromium and jQuery from the maintainer's tooling environment. `ACP_BROWSER_MODULES` can point to an existing tooling `node_modules` directory. This optional check renders every locale at desktop/mobile widths, exercises a Details modal fixture, and verifies RTL path isolation and light-theme direction. It uses a synthetic host, not a live Unraid server; these tools are not plugin dependencies.

On Unraid, select a language in Display Settings and reload the plugin. Check scan results, sources, details, help, history, quarantine, restore conflicts, purge timing, permanent-delete confirmation and Tools. Switch back to English and reopen dialogs. Check Arabic RTL and long German labels at desktop and mobile widths. Real-server and native-speaker validation are separate from isolated fixture tests.
