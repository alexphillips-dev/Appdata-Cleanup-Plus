# Appdata Cleanup Plus

<p align="center">
  <img src="docs/images/banner.png" alt="Appdata Cleanup Plus banner" />
</p>

<p align="center">
  <a href="https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/actions/workflows/ci.yml"><img src="https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/releases"><img src="https://img.shields.io/github/v/release/alexphillips-dev/Appdata-Cleanup-Plus?style=flat-square" alt="Latest Release"></a>
  <a href="https://unraid.net/"><img src="https://img.shields.io/badge/Unraid-7.0.0%2B-F15A2C?logo=unraid&logoColor=white&style=flat-square" alt="Unraid 7.0.0+"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/alexphillips-dev/Appdata-Cleanup-Plus?style=flat-square" alt="License: MIT"></a>
  <a href="https://forums.unraid.net/topic/197975-plugin-appdata-cleanup-plus/"><img src="https://img.shields.io/badge/Support-Unraid%20Forum-F15A2C?style=flat-square" alt="Unraid forum support"></a>
  <a href="https://buymeacoffee.com/alexphillipsdev"><img src="https://img.shields.io/badge/Sponsor-Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=000&style=flat-square" alt="Sponsor"></a>
</p>

Appdata Cleanup Plus is a cleanup and recovery plugin for Unraid. It finds orphaned Docker appdata folders, explains why each folder was found, shows size and age information, and lets you quarantine or permanently delete only the folders you select. It is built for servers that have accumulated old containers, renamed apps, template leftovers, and appdata folders that are hard to audit by hand.

- Find orphaned appdata folders from configured appdata sources.
- Review saved-template and filesystem-discovery results in one clean table.
- Use Safe Mode to quarantine first, restore later, and purge only when ready.
- Permanently delete with confirmation when Safe Mode is disabled.
- Track cleanup, quarantine, restore, purge, and failed action results in audit history.

Quick links: [Install](#install) | [Features](#features) | [Getting Started](#getting-started) | [Safety Model](#safety-model) | [Advanced Tools](#advanced-tools) | [Documentation](#documentation) | [Support](#support)

## Why Appdata Cleanup Plus

Unraid appdata shares can collect folders long after containers are removed. Manually deciding what is safe to clean means comparing Docker templates, live container mappings, appdata share contents, filesystem paths, and old folder sizes. Appdata Cleanup Plus brings that review into one Settings page with a safer action flow: scan, review, select, dry run, quarantine, restore, purge, or permanently delete with confirmation.

The plugin is intentionally conservative around filesystem operations. Actions use server-side scan snapshots and candidate IDs instead of trusting paths posted from the browser, and protected locations such as share roots, mount points, symlinked paths, quarantine roots, live container mappings, and VM Manager storage paths are guarded before cleanup runs.

## Features

| Orphaned appdata review | Safe cleanup workflow |
|---|---|
| Scan configured appdata sources, Docker template references, and live Docker mappings to surface folders that appear unused. Results show name, source, size, last used age, path, and simple badges. | Keep Safe Mode on for quarantine-first cleanup, run dry runs before changing files, disable Safe Mode only when you intentionally want permanent deletion, and confirm destructive deletes with a checkbox. |

| Quarantine manager | Audit history |
|---|---|
| Restore quarantined folders, purge selected entries, set or clear purge timers, and recover tracked entries from quarantine markers when possible. | Review compact history for cleanup, quarantine, restore, purge, submitted item counts, result statuses, paths, destinations, and errors. |

| Appdata sources | ZFS-aware delete |
|---|---|
| Auto-detect the Docker appdata root when available, browse filesystem paths, and add dedicated appdata roots for non-standard layouts. | Resolve configured user-share paths to exact ZFS dataset mountpoints, preview destroy impact, and use `zfs destroy` for dataset-backed rows when permanent delete is enabled. |

| Modern Unraid UI | Server-side safety |
|---|---|
| Uses shared dark and light theme tokens, compact action bars, simple modal dialogs, readable status badges, and a workflow designed for repeated cleanup checks. | CSRF validation, canonical path checks, action snapshots, protected-path locks, restore collision handling, and progress tracking keep filesystem changes auditable. |

## Install

Install from Unraid:

1. Open `Plugins`.
2. Choose `Install Plugin`.
3. Paste the stable plugin URL:

```bash
plugin install https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/main/plugins/appdata.cleanup.plus.plg
```

Dev testing branch:

```bash
plugin install https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/dev/plugins/appdata.cleanup.plus.plg
```

Requirements:

- Unraid `7.0.0+`
- Docker templates stored in the normal Unraid `templates-user` path for saved-template detection
- A current major Chrome, Edge, Firefox, or Safari browser
- Manual review before destructive actions

## Getting Started

1. Open `Settings -> Appdata Cleanup Plus`.
2. Use `Appdata Sources` to confirm the appdata roots the plugin should scan.
3. Click `Rescan`.
4. Review the ready-to-clean table, folder sizes, last-used ages, paths, and source badges.
5. Select the rows you want to act on.
6. Use `Dry Run` to preview the action without changing files.
7. Keep Safe Mode on to quarantine selected folders first, then restore or purge from `Show Quarantine`.

Recommended first cleanup:

- Start with Safe Mode on.
- Select only folders you recognize.
- Run a dry run before the first real cleanup.
- Quarantine instead of deleting until you are comfortable with the results.
- Use History after cleanup to confirm what happened.

## Safety Model

Appdata Cleanup Plus is designed to make cleanup understandable before it becomes destructive.

- Safe Mode is on by default, so selected folders are quarantined instead of permanently deleted.
- Permanent delete is only used after Safe Mode is disabled and the delete confirmation checkbox is checked.
- Dry run previews the current action without modifying folders.
- Actions run against server-side scan snapshots.
- Browser requests submit candidate IDs, not arbitrary filesystem paths.
- CSRF validation is required for action requests.
- Share roots, mount points, symlinked path segments, VM Manager managed paths, quarantine roots, and active live container mappings are protected.
- Restore operations preflight collisions before moving folders back out of quarantine.
- ZFS-backed rows require permanent delete and exact dataset mountpoint resolution.

## Quarantine And Restore

Quarantine gives you a reversible buffer before permanent removal. When Safe Mode is on, selected folders are moved into a hidden quarantine root and tracked in the quarantine manager.

Default quarantine root:

```text
/mnt/user/appdata/.appdata-cleanup-plus-quarantine
```

Quarantine manager tools:

- Restore selected folders to their original path.
- Purge selected folders permanently.
- Set or clear purge timers.
- Review original paths, quarantine paths, age, and size.
- Recover tracked entries from quarantine markers when possible.

Restore behavior:

- If the original path is free, the folder is moved back.
- If the original path already exists, the plugin stops and shows a conflict flow.
- Conflicts can be skipped or restored with a generated suffix where supported.

## ZFS-Backed Appdata

ZFS support is available for appdata layouts where the visible user-share path and the real dataset mountpoint are different.

Example:

```text
User share root: /mnt/user/appdata
Dataset root:    /mnt/docker_vm_nvme/appdata
```

Supported behavior:

- Add mappings from user-share roots to real dataset roots.
- Resolve exact dataset mountpoint matches.
- Preview child dataset and snapshot impact before destructive actions.
- Use standard or recursive `zfs destroy` only when required.
- Keep ZFS-backed rows out of quarantine, because dataset-backed rows cannot be moved like normal folders.

Recommended workflow:

1. Add the ZFS mapping.
2. Rescan.
3. Run `Dry Run`.
4. Disable Safe Mode only when you intentionally want permanent dataset destroy.
5. Confirm the delete action.

## Advanced Tools

| Tool | What it is for |
|---|---|
| Appdata Sources | Review detected appdata roots, browse filesystem paths, and add manual sources for non-standard layouts. |
| Show Quarantine | Restore, purge, schedule purge timers, and review tracked quarantined folders. |
| History | Review cleanup, quarantine, restore, purge, skipped, missing, and failed item results. |
| Tools | Manage supporting workflows such as ZFS path mappings and plugin maintenance tools. |
| Dry Run | Preview the selected cleanup action before changing files. |
| Safe Mode | Switch between quarantine-first cleanup and confirmed permanent delete. |

## Documentation

- [CA Store Readiness](docs/ca-store-readiness.md)
- [Bug report](https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/issues/new?template=bug_report.yml)
- [Feature request](https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/issues/new?template=feature_request.yml)
- [Release / update problem](https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/issues/new?template=release_update_problem.yml)

## Support

- Forum support thread: https://forums.unraid.net/topic/197975-plugin-appdata-cleanup-plus/
- GitHub issues: https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/issues

When reporting a problem, include:

- Unraid version
- Appdata Cleanup Plus version
- Browser and browser version
- Screenshot or screen recording if the issue is visual
- The action you were running: scan, dry run, quarantine, restore, purge, or delete
- Relevant modal text or audit history result for failed filesystem actions

## Sponsor

If Appdata Cleanup Plus helps your Unraid setup, you can support ongoing development here:

https://buymeacoffee.com/alexphillipsdev
