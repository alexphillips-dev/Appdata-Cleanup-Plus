# CA Store Readiness

This check is based on:

- Unraid forum guidance in `Plugin Templates for CA / Appstore`
- The current Appdata Cleanup Plus repo state
- FolderView Plus as the working reference for repo-facing support/docs links

## Current Status

Ready for CA submission from `main`.

## Passing Items

- The repo has a single CA plugin XML file at the root: `appdata.cleanup.plus.xml`
- The plugin XML includes the expected CA-facing fields:
  - `PluginURL`
  - `PluginAuthor`
  - `Category`
  - `Name`
  - `Description`
  - `MinVer`
  - `Support`
  - `Icon`
  - `Project`
- The icon is hosted from this repo and points at the packaged plugin icon
- The CA support URL now points at the live Unraid forum thread
- The plugin manifest now includes a matching `support="..."` forum thread attribute
- `scripts/release_guard.sh` already enforces manifest/XML URL parity and branch-aware raw GitHub links
- The repo now has:
  - a docs banner at `docs/images/banner.png`

## FolderView Plus Comparison

FolderView Plus already has the CA-facing support pattern that Appdata Cleanup Plus now matches:

- `folderview.plus.xml` uses a full forum topic in `<Support>`
- `folderview.plus.plg` includes a matching `support="https://forums.unraid.net/topic/.../"` attribute
- `README.md` includes a forum support thread in the Support section
- `docs/images/banner.png` is present for release-facing docs and forum use

## Ready-To-Submit Sequence

1. Submit the `main` branch CA XML to Community Applications.
2. Keep the forum thread URL in sync across:
   - `appdata.cleanup.plus.xml` `<Support>`
   - `plugins/appdata.cleanup.plus.plg` `support="..."`
   - `README.md` Support section
3. Re-run the readiness and release guards after release metadata changes.

## Expected Result

The repo metadata is in good shape for CA submission based on the current Unraid template guidance and the FolderView Plus reference layout.
