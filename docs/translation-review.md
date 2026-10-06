# Safety-critical translation review

All 42 locales have bundled translations and automated coverage. Native-speaker review is a separate, recorded process. No locale is marked approved merely because a catalog or browser test passes. The initial review ledger deliberately contains no human approvals.

## Scope and reference glossary

`scripts/i18n_review_scopes.json` identifies safety phrases, their full English source, UI context, screenshot scene, and a reference glossary. It covers Safe Mode, recoverable quarantine, irreversible deletion/purge, restore conflicts, cancellation, interrupted operations, and private recovery backups. Translate these concepts consistently. Keep paths, names, identifiers, technical product names, and named placeholders literal. Do not translate “quarantine” as antivirus scanning or imply that moving data frees disk space. Do not imply that an interrupted operation rolled back.

## Create a review packet

Use the existing maintainer Playwright/Chromium and jQuery environment; these are not plugin dependencies. Choose an output directory outside tracked source. For example:

```text
node scripts/review_i18n.mjs --locale de_DE --output /tmp/acp-review-de --screenshots
```

On Windows, use a temporary Windows path for `--output`. Set `ACP_BROWSER_MODULES` to your browser tooling `node_modules` directory if needed. The packet includes `review.html`, synthetic desktop/mobile screenshots generated from shipped renderers and pinned Unraid styles, and `review-records.json` containing source/context/glossary and translation hashes. Screenshots contain fixture names and paths only. Repeat for the reviewer's locale; Arabic, Hebrew, and Persian require RTL review. Generate another packet after wording or context changes.

## Review and submit

1. A fluent native speaker checks every scoped phrase against its glossary meaning, full sentence context, and both screenshot sizes. Check verbs, grammar, direction, wrapping, and the meaning of confirmation/cancellation. Identify errors rather than guessing the intended action.
2. Submit corrections in `scripts/i18n_overrides.json` or `scripts/i18n_plural_overrides.json`, using the complete source sentence. Regenerate catalogs and screenshots and run the localization checks before recording approval.
3. For phrases actually reviewed, copy the packet's corresponding records into `scripts/i18n_reviews.json`. Set `status` to `native-speaker-reviewed`, `nativeSpeaker` and `glossaryChecked` to `true`, and provide a public reviewer handle, ISO review date, and the desktop/mobile screenshot filenames checked. Do not include private contact details or real-server screenshots. These are maintainer-reviewed declarations of human review, not an automated identity or fluency certification.
4. Leave unreviewed phrases absent from the ledger. An approval is specific to its locale, phrase, context/glossary, and exact translation hash. Changing any reviewed wording or context requires another review, not silently refreshing its hash.

```text
node scripts/build_i18n.mjs --check
node scripts/review_i18n.mjs --check
php tests/i18n_smoke.php
node tests/i18n_client.js
node tests/i18n_page.js
node tests/i18n_flows.js
```

The review checker reports approved counts for every locale, rejects duplicate/incomplete approvals, and fails CI when an approved phrase changes. Zero reviewed phrases is a visible pending-review state, not a failure of catalog support. The generator's machine translation is never allowed to manufacture human approval records.
