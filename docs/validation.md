# Validation status

Appdata Cleanup Plus targets Unraid 7.0.0 and later. Supporting older Unraid releases requires a separate PHP, DockerClient, installer, theme, and browser compatibility matrix; the minimum version has not been lowered based on another plugin's declaration.

## Automated evidence

Repository CI checks PHP and JavaScript syntax, direct plugin function resolution, shell scripts, packaging and canonical URLs, diagnostics privacy, destructive confirmations, isolated filesystem behavior, localization catalogs, and rendered UI message flows. Dedicated ownership and template tests cover Docker list success/failure, mount overlap, action-time ownership changes, supported Compose syntax, template revision changes, verified backups, and restore collisions. Test data is synthetic and never points at a live Unraid server.

The optional Playwright layout suite exercises desktop/mobile rendering for the bundled locales. Passing catalog and rendering tests does not establish native-speaker review: the catalogs are machine translated.

`tests/theme_ui.cjs` runs in CI using pinned Playwright and jQuery test dependencies. It loads official Unraid stylesheets pinned to 7.0 commit `25bc9e2d16525e4e4f9796c9c64c1a3e1c63402d` and 7.3 commit `41e8d5ad5db20b0e9aeea4334b39bea56729579a`, and checks Black, White, Azure, and Gray at desktop/mobile widths. It compares native page/input/button colors and backgrounds, exercises Help, Details, sources, ZFS mappings, Tools, quarantine, history, confirmation, progress, results, and restore conflicts, and verifies reused dialogs and live theme changes. Stylesheet fetch failures fail the test. The reference CSS and browser dependencies are not shipped in the plugin. For local runs, set `ACP_BROWSER_MODULES` to the tooling `node_modules` directory; optional `ACP_NATIVE_THEME_DIR` supplies downloaded reference files under `7.0/` and `7.3/` (replace `/` in filenames with `-`).

The plugin consumes Unraid's semantic CSS variables directly. Scoped native 7.0 palette fallbacks cover releases before those variables existed. White and Azure are light themes; Black and Gray are dark themes. Page and modal tokens share a single definition, and modal reuse copies theme identity rather than freezing individual colors. Status colors adapt to light/dark surfaces, while component layout remains scoped to the plugin.

## Runtime confirmation still required

Local fixtures and CI do not establish successful behavior on every real pool or Compose layout. The owner should confirm the install/update cycle, secondary pools, stopped Compose stacks, nested/broad container mounts, template archive/restore, and ZFS destroy previews on suitable recoverable data. Real dataset destruction requires separate owner-run validation. Never treat an unattended test suite as authorization to act on server data.

Docker ownership comes from a successful `/containers/json?all=1` request, including stopped containers. Cleanup rechecks that inventory and Compose references at action time. A failure or incomplete inventory blocks cleanup. Docker can still change independently during any filesystem operation; plugin locks serialize plugin operations, not external Docker changes.

Broad access is a mount strictly above every configured appdata source containing the candidate. It is informational, not ownership. Mounts of the source itself, exact candidate paths, and parents/children within a source remain protective. Nested source settings cannot relax protection of an outer source. Unknown source roots remain conservative. Docker scan rows, Details, action-time revalidation, and Compose filtering share this boundary. Regressions cover the four-viewer `/mnt/user` and `/mnt` scenario, real fixture folder deletion, quarantine/delete previews, synthetic ZFS destruction, and a specific mapping added after scanning.

Nameless dead entries retain their known mounts without invalidating healthy containers. Explicit null mount collections are normalized; missing or malformed fields trigger at most 32 inspect lookups per inventory. Requests use unchunked responses and validate the complete JSON body with a 16 MiB acceptance limit. Malformed JSON must not be mistaken for a successful empty inventory. Known mappings remain protective when another record cannot be verified. Incomplete scans label their remaining rows **Unverified**; enabling permanent deletion does not bypass ownership verification.

Diagnostics schema 4 reports the recorded inventory reason code, request success, accepted/rejected counts, dead entries, normalized null collections, inspect recoveries, collector limits, and each candidate-filter stage. A successful request and a verified inventory are separate fields. Blocked action results also include aggregate ownership diagnostics. Exports use allowlists, omit raw Docker payloads and identifiers, and preserve fixed schema keys even when a private folder shares their wording. Generating diagnostics reads existing telemetry; it does not rescan Docker or perform cleanup.

Row exports distinguish blocking `mountEvidence` from informational `broadMountEvidence`. Each category includes at most 50 containers and 50 paths per container, with export-scoped aliases and only allowlisted name/path fields. The final recursive privacy scrub still applies; unknown future mount fields are discarded.

`not_checked` means the bundle predates collection or has no saved scan. `request_failed` identifies a request/transport failure; `invalid_json` and `invalid_list` identify unusable response bodies; `incomplete_inventory` includes fixed issue counts such as `invalid_names`, `invalid_mounts`, `invalid_mount_source`, `unsupported_mount`, `inspect_failed`, and `inspect_limit`. Rescan after addressing an underlying condition. These are support codes, not container names or raw errors.

Compose protection covers Compose Manager project files, indirect projects, supported short/long bind syntax, `.env` variables (including `export`), and override files. It is a conservative scanner, not a complete YAML/Compose interpreter. Unresolved variables, traversal, relative bind paths, and detected include/extends/inline-volume forms block cleanup until the configuration can be inspected safely. Additional syntax requires regression fixtures before claiming support.

## Pull-request test packages

A maintainer can apply the `test-build` label to a pull request. **PR test package** builds that exact head SHA with a read-only token and uploads a 14-day artifact whose name includes the PR number and SHA. Remove and reapply the label to request a new build after changes. Review the PR's normal CI results before installing its package.

Download the artifact from the workflow run and follow `INSTALL.txt`. Its standalone local `.plg` embeds the package built by `pkg_build.sh`, verifies the package checksum before installation, and retains the canonical dev update URL. It does not depend on an unpublished archive URL. No release, tag, branch push, or PR comment is created by this workflow.

After testing, reinstall the published dev manifest to return to the regular channel. Confirm the installed version and hard-refresh the webGUI. Test packages can have a version ahead of the currently published dev build, so use the explicit install command in `INSTALL.txt` rather than waiting for an update notification.
