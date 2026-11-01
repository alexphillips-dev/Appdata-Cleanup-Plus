# Cleanup wording and guidance review

Review date: November 1, 2026. Baseline: `3805de4` on `dev`.

This review covers the plugin's user-facing cleanup guidance and access to existing controls. It is not a complete security, performance, or destructive-operation audit. The baseline line references below describe the code before this change; function and string-key names identify the corresponding current owners.

## Coverage

The tracked repository was inventoried before implementation. Review depth is recorded separately from inventory coverage.

| Surface | Inspection | Decision |
|---|---|---|
| Page bootstrap, named strings, toolbar, selection controls | Page strings and markup read; producers and JavaScript consumers traced | Align status vocabulary, action wording, and Help with rendered controls |
| Scan notices, summary cards, empty/search/ignored states | Relevant main-script renderers and scan payload/metrics construction read | Distinguish skipped or partial discovery from a complete empty scan; remove safety guarantees |
| Candidate rows and Details | Shared explanation, evidence, outcome, next-step, and modal renderers read; mount and verification producers traced | Explain the specific restriction and show the next step alongside its evidence |
| Safe Mode and action bar | Mode renderer, toggle handler, selection summary, and settings consumer read | Explain action choice separately from eligibility; display the guidance already calculated by the action bar |
| Ignore list | Row actions, Details actions, local state updates, and ignored empty state inspected | Use “Stop ignoring” for visibility changes; retain “Restore” for recovery from quarantine |
| Appdata Sources and ZFS mappings | Browser/draft/status rendering, save controls, existing openers, and source-resolution contracts inspected | Avoid advice to remove a container without review; expose the existing mapping dialog from Tools |
| Dry run, confirmation, progress, action results | Preview/outcome, checkbox confirmation, result grouping, next steps, and recovered-result consumers inspected | Retain explicit irreversible-action confirmation and space-reclamation limits; clarify retry guidance |
| Quarantine, restore conflicts, purge schedules | Manager and conflict renderers read; default/manual scheduling producers and settings synchronization traced | Explain default timers, individual timers, and their effects on existing entries |
| History, recent operations, interrupted/failed requests | History and recovery presentation read; recorded/partial-result and reconnect guidance inspected | Retain uncertainty about partial completion, retained evidence, and instructions to avoid repeating an unknown operation |
| Saved templates and private backups | Manager, archive/restore/removal wording, and response/error paths inspected | Retain separation between template configuration, appdata, private backups, and sanitized diagnostics |
| Tools, test fixtures, diagnostics | Tool renderer, fixture-root feedback, export wording, and navigation handlers inspected | Keep fixture-root status distinct from production discovery; retain review-before-sharing language |
| Localization and documentation | Localization/runtime boundary and review documentation read; extractor/build/review contracts structurally inspected | Regenerate catalogs and check complete messages/placeholders; do not manufacture human translation approvals |
| Themes, mobile, keyboard, RTL | Existing layout/disclosure/confirmation tests and scoped styles structurally inspected | Validate changed presentation using the existing browser suites |
| Backend, cron, installer, distribution | Relevant scan, ownership, settings, and schedule dependencies traced; package/CI paths inventoried | Preserve action authorization, persisted schemas, scheduling behavior, and install/update contracts |
| Historical archives, images, generated catalogs | Inventory/structural coverage only | Binary assets and historical packages excluded from prose review; generated translations require separate linguistic review |

The backend, tests, scripts, and configuration were not all read line by line as part of this guidance review. Real Unraid behavior and fluent native-speaker acceptance remain separate checks.

## Confirmed findings and resolution scope

All findings below are source-confirmed usability issues. They are not evidence that an unsafe operation occurred.

| Finding | Baseline evidence | Resolution in this change |
|---|---|---|
| Generic safety language suggests an unlock mechanism and hides useful next steps | `AppdataCleanupPlus.page:202,347,360`; panels `getRowExplanationUnlockability`, `getRowDetailsNextStep`, `buildMountEvidenceHtml` | Replace unlock terminology with reason-specific guidance; distinguish protection, incomplete verification, required action mode, and ignored visibility; expand blocking mount evidence in Details |
| A normal warning is labeled “Read-only scan” even when the scan has a valid action snapshot | Main script `buildLocalNotices:2529-2534` | Reserve read-only wording for an unavailable action snapshot; otherwise identify a scan warning |
| Skipped discovery can still produce a clean-looking empty result | Main script `buildEmptyStateMessage:2721-2746` and `renderResults:4680-4685`; API `buildDashboardPayload:1706-1707` | Show partial/limited discovery explicitly, including zero-row cases, rather than claiming the sources were fully scanned |
| Some wording overstates confidence or recommends removing a container prematurely | Page `readySectionMessage:200`, `emptyNextStepsMessage:83`; main script `renderSummaryCards` and `buildEmptyStateMessage` | Describe apparent candidates and available actions without promising safety; ask users to review source paths and container mappings before changing configuration |
| “Live” mappings can be read as excluding stopped containers | Dashboard inventory `/containers/json?all=1:251`; root-mounted warning in API `buildDashboardPayload:1707`; README Safety Model | State that installed containers, including stopped containers, remain protective |
| Ignore-list visibility and quarantine recovery share the “Restore” label | Page `restoreActionLabel:141`; main script `buildRowActionHtml`; panels `buildRowDetailsModalHtml` | Name the ignore-list action “Stop ignoring”; preserve filesystem restore terminology |
| The action bar computes a mode/read-only explanation and then discards it | Main script `updateActionBar:4859-4871` | Display the explanation together with the total rather than only showing a count |
| The existing ZFS mapping dialog has a handler but no rendered entry point | Main script `bindEvents:434`, `openZfsPathMappingsModal`; page/panel action search; Tools renderer | Add a visible Tools entry using the existing dialog and save flow; support its actual modal click path |
| The default purge field does not explain its effect on existing entries | Page `quarantinePurgeScheduleDaysLabel:445`; API settings handler `1946-1947`; quarantine `syncTrackedQuarantineEntriesToDefaultPurgeSchedule:67-109` | Explain that default schedules include existing entries using that default, age starts at quarantine time, older folders may already be due, and individual timers remain separate |
| Help and results use stale or inconsistent vocabulary | Page `helpTroubleshootingBody:184`, `resultBlockedLabel:514`; main script `buildHelpModalHtml`, shared status formatter | Use the actual Details labels and consistent restriction/result terms throughout the flow |

Default purge behavior is unchanged: positive defaults calculate due dates from each folder's original quarantine time; changing the default synchronizes eligible existing entries. A value of zero disables default scheduling. Explicit individual timers are preserved. Wording must not claim that the default applies only to newly quarantined folders.

## Preserved contracts and acceptance

Presentation changes must not turn evidence into permission to act. Candidate IDs, scan validity, ownership revalidation, protected paths, ZFS identity checks, confirmation requirements, persisted settings, quarantine records, and scheduled-purge behavior keep their existing meaning. Broad mounts strictly above a containing appdata source remain informational; mappings of the source itself or related paths within it remain protective.

Behavioral verification should cover the same state in rows and Details, incomplete verification taking precedence over action-mode advice, blocking versus informational mounts, escaped names/paths, ignored visibility, partial empty results, navigation into ZFS mappings, action-bar guidance, and clear quarantine timers. Existing privacy, ownership, confirmation, recovery, localization, and browser regression suites remain relevant. This document records review coverage and expected acceptance; it does not itself claim those tests passed.

Before owner acceptance on Unraid, verify the installed dev version, hard-refresh, repeat the original blocked-row scenario, reopen Details after reload, and review the named container's actual configuration. Confirm behavior with stopped containers and intentional root mappings. Use recoverable synthetic data for cleanup checks; this change does not require destructive validation on live user data.

Bundled machine translations require the checks in [Localization](localization.md). Automated catalog and layout coverage does not establish native-speaker approval; use the separate [translation review process](translation-review.md). The implementation report should state actual local/CI/package results and any remaining runtime or language-review limits.
