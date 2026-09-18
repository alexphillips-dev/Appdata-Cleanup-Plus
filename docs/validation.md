# Validation status

Appdata Cleanup Plus targets Unraid 7.0.0 and later. Supporting older Unraid releases requires a separate PHP, DockerClient, installer, theme, and browser compatibility matrix; the minimum version has not been lowered based on another plugin's declaration.

## Automated evidence

Repository CI checks PHP and JavaScript syntax, direct plugin function resolution, shell scripts, packaging and canonical URLs, diagnostics privacy, destructive confirmations, isolated filesystem behavior, localization catalogs, and rendered UI message flows. Dedicated ownership and template tests cover Docker list success/failure, mount overlap, action-time ownership changes, supported Compose syntax, template revision changes, verified backups, and restore collisions. Test data is synthetic and never points at a live Unraid server.

The optional Playwright layout suite exercises desktop/mobile rendering for the bundled locales. Passing catalog and rendering tests does not establish native-speaker review: the catalogs are machine translated.

## Runtime confirmation still required

Local fixtures and CI do not establish successful behavior on every real pool or Compose layout. The owner should confirm the install/update cycle, secondary pools, stopped Compose stacks, nested/broad container mounts, template archive/restore, and ZFS destroy previews on suitable recoverable data. Real dataset destruction requires separate owner-run validation. Never treat an unattended test suite as authorization to act on server data.

Docker ownership comes from a successful `/containers/json?all=1` request, including stopped containers. Cleanup rechecks that inventory and Compose references at action time. A failure or incomplete inventory blocks cleanup. Docker can still change independently during any filesystem operation; plugin locks serialize plugin operations, not external Docker changes.

Compose protection covers Compose Manager project files, indirect projects, supported short/long bind syntax, `.env` variables (including `export`), and override files. It is a conservative scanner, not a complete YAML/Compose interpreter. Unresolved variables, traversal, relative bind paths, and detected include/extends/inline-volume forms block cleanup until the configuration can be inspected safely. Additional syntax requires regression fixtures before claiming support.

## Pull-request test packages

A maintainer can apply the `test-build` label to a pull request. **PR test package** builds that exact head SHA with a read-only token and uploads a 14-day artifact whose name includes the PR number and SHA. Remove and reapply the label to request a new build after changes. Review the PR's normal CI results before installing its package.

Download the artifact from the workflow run and follow `INSTALL.txt`. Its standalone local `.plg` embeds the package built by `pkg_build.sh`, verifies the package checksum before installation, and retains the canonical dev update URL. It does not depend on an unpublished archive URL. No release, tag, branch push, or PR comment is created by this workflow.

After testing, reinstall the published dev manifest to return to the regular channel. Confirm the installed version and hard-refresh the webGUI. Test packages can have a version ahead of the currently published dev build, so use the explicit install command in `INSTALL.txt` rather than waiting for an update notification.
