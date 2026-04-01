# Appdata Cleanup Plus

<p align="center">
  <img src="docs/images/banner.png" alt="Appdata Cleanup Plus banner" />
</p>

<p align="center">
  <a href="https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/releases/latest"><img src="https://img.shields.io/github/v/release/alexphillips-dev/Appdata-Cleanup-Plus?style=flat-square" alt="Latest Release"></a>
  <a href="https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/releases"><img src="https://img.shields.io/github/release-date/alexphillips-dev/Appdata-Cleanup-Plus?style=flat-square" alt="Release Date"></a>
  <a href="https://unraid.net/"><img src="https://img.shields.io/badge/Unraid-7.0.0%2B-F15A2C?logo=unraid&logoColor=white&style=flat-square" alt="Unraid 7.0.0+"></a>
  <a href="https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/issues"><img src="https://img.shields.io/github/issues/alexphillips-dev/Appdata-Cleanup-Plus?style=flat-square" alt="Open Issues"></a>
  <a href="https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/commits/main"><img src="https://img.shields.io/github/last-commit/alexphillips-dev/Appdata-Cleanup-Plus/main?style=flat-square" alt="Last Commit"></a>
  <a href="https://forums.unraid.net/topic/197975-plugin-appdata-cleanup-plus/"><img src="https://img.shields.io/badge/Support-Unraid%20Forum-F15A2C?style=flat-square" alt="Support Thread"></a>
</p>

Appdata Cleanup Plus is an Unraid plugin for finding orphaned Docker appdata folders, reviewing why they were surfaced, and then quarantining or deleting only the paths you explicitly choose.

It is built around conservative cleanup: grouped scan results, server-side action snapshots, quarantine-first workflow, restore and purge management, and hard safety locks for risky filesystem targets.

Quick links: [Install](#install) | [Update](#update) | [What It Detects](#what-it-detects) | [Safety Model](#safety-model) | [Quarantine and Restore](#quarantine-and-restore) | [Stored State](#stored-state) | [Development](#development) | [Support](#support)

## Why Install This

- Find leftover appdata folders from removed containers without manually digging through shares.
- Cross-check saved Docker templates against live container mounts when Docker is online.
- Catch direct-child orphan folders in the configured appdata share even when no saved template still references them.
- Review grouped results with search, risk filtering, sorting, badges, and progressive stat loading instead of a raw folder dump.
- Default real actions to quarantine so cleanup stays reversible until you intentionally purge.

## What It Detects

The scan combines multiple sources into one result set:

- Saved Docker template references from `/boot/config/plugins/dockerMan/templates-user/`
- Live Docker host mount paths from installed containers when Docker is online
- Direct child folder discovery inside the configured appdata share when Docker is online

Rows are grouped in the UI as:

- `Saved template references`
- `Appdata share discovery`
- `Ignored`

The scan automatically excludes or blocks paths that should not be treated as normal appdata cleanup candidates, including:

- Active live container mappings
- The plugin quarantine root
- Share roots and mount points
- Paths containing symlinked segments
- Unsafe canonical targets
- VM Manager storage paths read from `domain.cfg`
  - vdisk storage
  - ISO storage
  - libvirt storage

If Docker is offline, the plugin can still surface template-backed candidates, but those rows should be reviewed more carefully because active container mounts cannot be verified at scan time.

## What The UI Gives You

- Compact Unraid Settings page built around one scan and one global action bar
- Grouped result sections for template-backed rows, filesystem discovery rows, and ignored rows
- Search, risk filtering, sort order, and section-aware rendering
- Badge-based row summaries with `Ready`, `Review`, and `Locked` action states plus source and reason badges
- Progressive stat hydration so rows can render first and fill in heavier size data afterward
- Bulk selection, `Select visible`, and `Select all`
- Quarantine manager with bulk restore and purge actions
- Restore collision handling with `Skip conflicts`, `Restore with suffix`, and `Review conflict`
- Audit history for quarantine, restore, purge, and cleanup activity
- Ignore and restore controls for paths you do not want surfaced in the active list

## Safety Model

Safety is the core behavior, not an afterthought.

- Real actions default to `Quarantine selected`, not permanent delete
- `Dry run` previews the current action without changing anything
- `Allow outside-share cleanup` must be enabled before outside-share review rows can be acted on
- `Enable permanent delete` must be enabled before irreversible delete becomes the primary action
- Locked rows stay visible, but they are not selectable
- Actions run from server-side scan snapshots using candidate ids instead of trusting posted client paths
- CSRF validation is required for action requests
- Share roots, mount points, symlinked path segments, VM Manager managed paths, and other unsafe targets are blocked at action time
- Restore operations preflight collisions before moving folders back out of quarantine

## Quarantine And Restore

Quarantine is the default real action path for a reason: it gives you a reversible buffer before permanent removal.

Quarantine workflow:

- Move selected folders into the plugin quarantine root
- Track quarantined entries in the built-in quarantine manager
- Restore entries later to their original path
- Purge entries permanently only when you intend to

Restore behavior:

- Single and bulk restore are supported
- If the original path already exists, the plugin stops and shows a conflict flow
- You can skip the conflicting restore, restore beside it with a generated suffix, or review the conflict before continuing

Default quarantine root:

- Preferred: inside the configured appdata share at `/.appdata-cleanup-plus-quarantine`
- Fallback: `/mnt/user/system/.appdata-cleanup-plus-quarantine`

## Requirements

- Unraid `7.0.0+`
- Docker templates stored in the normal Unraid templates-user path for saved-template detection
- A current major browser:
  - Chrome
  - Edge (Chromium)
  - Firefox
  - Safari
- Manual review before destructive actions

Compatibility notes:

- The plugin does not depend on the Community Applications helper runtime
- Stable `main` builds point to `main` metadata and archives
- Testing `dev` builds point to `dev` metadata and archives
- Package versions use `YYYY.MM.DD.UU` so same-day releases sort correctly in Unraid

## Install

Stable `main` channel:

```bash
plugin install https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/main/plugins/appdata.cleanup.plus.plg
```

Dev `testing` channel:

```bash
plugin install https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/dev/plugins/appdata.cleanup.plus.plg
```

Community Applications XML:

```text
https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/main/appdata.cleanup.plus.xml
```

Commit-pinned install pattern:

```text
https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/<commit>/plugins/appdata.cleanup.plus.plg
```

## Update

- Preferred: `Plugins -> Check for Updates`
- Manual: rerun the same `plugin install` command for the channel you track
- If GitHub or Unraid caching delays detection, install once from a commit-pinned raw URL, then return to normal `main` or `dev` branch tracking

## Quick Workflow

1. Open `Settings -> Appdata Cleanup Plus`.
2. Click `Rescan`.
3. Review grouped sections, row badges, size/age metadata, and lock reasons.
4. Use `Dry run` if you want a no-change preview of the current action.
5. Leave permanent delete off unless you intentionally want irreversible removal.
6. Quarantine selected folders first, then use the quarantine manager to restore or purge as needed.

## Stored State

Runtime state is stored under:

```text
/boot/config/plugins/appdata.cleanup.plus/
```

Important files and directories:

- `ignored-paths.json`: ignored rows hidden from the default result list
- `cleanup-audit.jsonl`: append-only audit log for cleanup, quarantine, restore, and purge activity
- `safety-settings.json`: persisted safety toggle state
- `quarantine-records.json`: tracked quarantine entries
- `path-stats-cache.json`: cached size and mtime lookups
- `snapshots/`: session-scoped action snapshots used for server-side action validation

## Development

Build the package and refresh manifest/XML metadata:

```bash
bash pkg_build.sh
```

Preview the next computed package version without writing release files:

```bash
bash pkg_build.sh --dry-run
```

Run backend behavior smoke tests:

```bash
bash scripts/test_behavior.sh
```

Validate manifest, CA metadata, archive, and branch-aware raw URLs:

```bash
bash scripts/release_guard.sh
```

Validate CA-facing repository readiness:

```bash
bash scripts/ca_readiness_guard.sh
```

Ensure the current manifest version has a top changelog entry:

```bash
bash scripts/ensure_plg_changes_entry.sh
```

Promote `dev` into `main`, build the stable package, tag the release, publish or update the GitHub release, verify live raw metadata, and print the exact cache-busting install command:

```bash
bash scripts/release_main.sh
```

After promoting `main`, sync release artifacts and branch ancestry back into `dev` while restoring `dev` feed URLs:

```bash
bash scripts/sync_main_to_dev.sh
```

## Repo Layout

- `plugins/appdata.cleanup.plus.plg`: Unraid plugin manifest and changelog
- `appdata.cleanup.plus.xml`: Community Applications XML metadata
- `source/appdata.cleanup.plus/`: packaged plugin source
- `archive/`: built `.txz` packages
- `docs/images/`: banner and repository documentation images
- `tests/`: behavior smoke coverage and fixtures

## Support

General usage, screenshots, and testing feedback:

- Unraid forum thread: `https://forums.unraid.net/topic/197975-plugin-appdata-cleanup-plus/`

Repository and release tracking:

- Repo: `https://github.com/alexphillips-dev/Appdata-Cleanup-Plus`
- Latest release: `https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/releases/latest`

GitHub issue forms:

- `Bug report`: reproducible plugin bugs
- `Feature request`: workflow, safety, UI, or maintainer-tooling improvements
- `Release / update problem`: install failures, stale update detection, branch tracking issues, or raw URL problems

Blank issues are disabled so reports get routed into the right support path.
