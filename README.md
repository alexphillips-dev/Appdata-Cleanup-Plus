# Appdata Cleanup Plus

Appdata Cleanup Plus is an Unraid plugin that scans your appdata share for orphaned folders left behind by removed Docker applications and lets you review them before deleting anything.

## Requirements

- Unraid `6.12.14+`
- Docker templates or previously installed app metadata available for comparison
- Manual review of every folder before deletion

## Install

Stable `main` channel:

```bash
plugin install https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/main/plugins/appdata.cleanup.plus.plg
```

Dev `testing` channel:

```bash
plugin install https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/dev/plugins/appdata.cleanup.plus.plg
```

CA template URL:

```text
https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/main/appdata.cleanup.plus.xml
```

## What It Does

- Reads saved Docker template paths and installed container volume mappings
- Finds appdata folders that no longer appear to belong to active containers
- Lists candidates for manual review instead of deleting blindly
- Removes only the folders you explicitly select
- Refuses installation if Community Applications already provides the built-in Cleanup Appdata module

## Update Channels

- `main` builds keep their manifest and archive URLs pinned to `main`
- `dev` builds keep their manifest and archive URLs pinned to `dev`
- The CA XML template is rewritten the same way so the stable CA link stays on `main`
- If Unraid caches update detection, install once from a commit URL and then return to the normal branch URL

One-time commit URL pattern:

```text
https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/<commit>/plugins/appdata.cleanup.plus.plg
```

## Versioning

- Unraid package versions use `YYYY.MM.DD.UU`
- `UU` is a zero-padded same-day update counter so repeat builds sort correctly in Unraid
- Example sequence: `2026.03.27.01`, `2026.03.27.02`

## Build And Release

- Build package and refresh manifest/XML metadata:
  - `bash pkg_build.sh`
- Preview the next computed version without writing files:
  - `bash pkg_build.sh --dry-run`
- Validate manifest, CA XML, archive, and branch URLs:
  - `bash scripts/release_guard.sh`
- After promoting `main`, sync release artifacts back into `dev` while restoring `dev` update URLs:
  - `bash scripts/sync_main_to_dev.sh`

## Repo Layout

- `plugins/appdata.cleanup.plus.plg`: branch-aware Unraid plugin manifest
- `appdata.cleanup.plus.xml`: branch-aware CA template
- `source/appdata.cleanup.plus/`: packaged plugin files
- `archive/`: generated `.txz` artifacts

## Support

- Repository: `https://github.com/alexphillips-dev/Appdata-Cleanup-Plus`
- Issues: `https://github.com/alexphillips-dev/Appdata-Cleanup-Plus/issues`
