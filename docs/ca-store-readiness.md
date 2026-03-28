# CA Store Readiness

This check is based on:

- Unraid forum guidance in `Plugin Templates for CA / Appstore`
- The current Appdata Cleanup Plus repo state
- FolderView Plus as the working reference for repo-facing support/docs links

## Current Status

Not ready for CA submission yet.

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
- `scripts/release_guard.sh` already enforces manifest/XML URL parity and branch-aware raw GitHub links
- The repo now has:
  - a docs banner at `docs/images/banner.png`

## Current Blockers

1. `appdata.cleanup.plus.xml` still points `Support` to GitHub issues instead of a full Unraid forum support thread URL.
2. `plugins/appdata.cleanup.plus.plg` does not yet include a matching `support="..."` forum thread attribute.
3. The current `dev` branch is a testing feed. CA submission should use the stable `main` channel after promotion.

## FolderView Plus Comparison

FolderView Plus already has the CA-facing support pattern that Appdata Cleanup Plus still needs:

- `folderview.plus.xml` uses a full forum topic in `<Support>`
- `folderview.plus.plg` includes a matching `support="https://forums.unraid.net/topic/.../"` attribute
- `README.md` includes a forum support thread in the Support section
- `docs/images/banner.png` is present for release-facing docs and forum use

## Ready-To-Submit Sequence

1. Post the prepared launch text as the new Unraid forum support topic.
2. Copy the real forum topic URL.
   - Placeholder until then: `FORUM_URL_PENDING`
3. Update:
   - `appdata.cleanup.plus.xml` `<Support>`
   - `plugins/appdata.cleanup.plus.plg` `support="..."`
   - `README.md` Support section
4. Promote the stable release to `main`.
5. Rebuild from `main` so the CA metadata and manifest URLs point to `main`.
6. Re-run the readiness and release guards.

## Expected Result After Forum URL Update

Once the forum thread exists and the support links are updated to it, the remaining CA-facing metadata should be in good shape for submission based on the current Unraid template guidance and the FolderView Plus reference layout.
