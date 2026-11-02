#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
unset APPDATA_CLEANUP_PLUS_VERSION_OVERRIDE APPDATA_CLEANUP_PLUS_BUILD_BRANCH GITHUB_REF_NAME

fail() { echo "ERROR: $*" >&2; exit 1; }

prepare_fixture() {
    fixture="$TEST_DIR/$1"
    mkdir -p "$fixture/plugins" "$fixture/scripts" \
        "$fixture/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus"
    cp "$ROOT_DIR/pkg_build.sh" "$fixture/"
    cp "$ROOT_DIR/plugins/appdata.cleanup.plus.plg" "$fixture/plugins/"
    cp "$ROOT_DIR/appdata.cleanup.plus.xml" "$fixture/"
    cp "$ROOT_DIR/scripts/ensure_plg_changes_entry.sh" "$fixture/scripts/"
    cp "$ROOT_DIR/scripts/validate_plugin_xml.php" "$fixture/scripts/"
    # No existing notes can accidentally make the missing-notes case succeed.
    perl -0pi -e 's{<CHANGES>.*?</CHANGES>}{<CHANGES>\n###2000.01.01.01\nSynthetic prior build.\n</CHANGES>}s' "$fixture/plugins/appdata.cleanup.plus.plg"
    printf '%s\n' 'Synthetic package input.' > "$fixture/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/README.md"
}

output_digest() {
    (
        cd "$fixture"
        sha256sum plugins/appdata.cleanup.plus.plg appdata.cleanup.plus.xml
        if [ -d archive ]; then
            find archive -type f -print0 | sort -z | xargs -0 -r sha256sum
        fi
    )
}

build() {
    mkdir -p "$fixture/.build-tmp"
    (cd "$fixture" && TMPDIR="$fixture/.build-tmp" bash pkg_build.sh --branch dev "$@")
}

prepare_fixture dry-run
before_tree="$(find "$fixture" -printf '%P %y\n' | sort)"
before="$(output_digest)"
(cd "$fixture" && bash pkg_build.sh --branch dev --dry-run) > "$TEST_DIR/dry-run.log"
[[ "$(find "$fixture" -printf '%P %y\n' | sort)" = "$before_tree" && "$(output_digest)" = "$before" ]] || fail 'Dry run must not create a lock, staging directory or output.'

prepare_fixture missing-notes
before="$(output_digest)"
if APPDATA_CLEANUP_PLUS_CHANGE_NOTES='' build --no-validate > "$TEST_DIR/missing-notes.log" 2>&1; then
    fail 'Missing notes must reject a fresh candidate.'
fi
grep -Fq 'Missing changelog notes' "$TEST_DIR/missing-notes.log" || fail 'Expected the actual note-validation failure.'
[[ "$(output_digest)" = "$before" ]] || fail 'Missing notes changed final outputs.'

prepare_fixture missing-helper
rm "$fixture/scripts/ensure_plg_changes_entry.sh"
before="$(output_digest)"
if APPDATA_CLEANUP_PLUS_CHANGE_NOTES='Synthetic notes.' build --no-validate > "$TEST_DIR/missing-helper.log" 2>&1; then
    fail 'A missing required notes helper must reject the build.'
fi
[[ "$(output_digest)" = "$before" ]] || fail 'Missing helper changed final outputs.'

prepare_fixture failed-validation
printf '%s\n' '#!/usr/bin/env bash' 'exit 42' > "$fixture/scripts/release_guard.sh"
before="$(output_digest)"
if APPDATA_CLEANUP_PLUS_CHANGE_NOTES='Synthetic notes.' build > "$TEST_DIR/failed-validation.log" 2>&1; then
    fail 'Failed staged validation must reject the build.'
fi
[[ "$(output_digest)" = "$before" ]] || fail 'Failed validation changed final outputs.'

prepare_fixture failed-archive
mkdir -p "$TEST_DIR/tar-bin"
printf '%s\n' '#!/usr/bin/env bash' 'exit 43' > "$TEST_DIR/tar-bin/tar"
chmod +x "$TEST_DIR/tar-bin/tar"
before="$(output_digest)"
if PATH="$TEST_DIR/tar-bin:$PATH" APPDATA_CLEANUP_PLUS_CHANGE_NOTES='Synthetic notes.' build --no-validate > "$TEST_DIR/failed-archive.log" 2>&1; then
    fail 'Failed archive creation must reject the build.'
fi
[[ "$(output_digest)" = "$before" ]] || fail 'Failed archive creation changed final outputs.'

# Exercise actual rollback after the archive and manifest have been finalized.
mkdir -p "$TEST_DIR/mv-bin"
real_mv="$(command -v mv)"
cat > "$TEST_DIR/mv-bin/mv" <<'EOF'
#!/usr/bin/env bash
if [[ "${!#}" = "$ACP_ATOMICITY_FAIL_XML" ]]; then
    if [[ "${ACP_ATOMICITY_EXTERNAL_XML:-}" = true ]]; then printf '\n<!-- external owner -->\n' >> "$ACP_ATOMICITY_FAIL_XML"; fi
    exit 44
fi
if [[ "${!#}" = "${ACP_ATOMICITY_COLLISION:-}" ]]; then printf '%s\n' 'Competing archive bytes.' > "${!#}"; fi
exec "$ACP_ATOMICITY_REAL_MV" "$@"
EOF
chmod +x "$TEST_DIR/mv-bin/mv"
prepare_fixture failed-finalization
before="$(output_digest)"
if PATH="$TEST_DIR/mv-bin:$PATH" ACP_ATOMICITY_REAL_MV="$real_mv" \
    ACP_ATOMICITY_FAIL_XML="$fixture/appdata.cleanup.plus.xml" \
    APPDATA_CLEANUP_PLUS_CHANGE_NOTES='Synthetic notes.' build --no-validate > "$TEST_DIR/failed-finalization.log" 2>&1; then
    fail 'Failed final metadata rename must reject the build.'
fi
[[ "$(output_digest)" = "$before" ]] || fail 'Failed finalization did not restore original outputs.'

prepare_fixture concurrent-metadata
manifest_before="$(sha256sum "$fixture/plugins/appdata.cleanup.plus.plg")"
cp "$fixture/appdata.cleanup.plus.xml" "$TEST_DIR/expected-external.xml"
printf '\n<!-- external owner -->\n' >> "$TEST_DIR/expected-external.xml"
if PATH="$TEST_DIR/mv-bin:$PATH" ACP_ATOMICITY_REAL_MV="$real_mv" \
    ACP_ATOMICITY_FAIL_XML="$fixture/appdata.cleanup.plus.xml" ACP_ATOMICITY_EXTERNAL_XML=true \
    APPDATA_CLEANUP_PLUS_CHANGE_NOTES='Synthetic notes.' build --no-validate > "$TEST_DIR/concurrent-metadata.log" 2>&1; then
    fail 'Concurrent metadata replacement must reject finalization.'
fi
cmp "$fixture/appdata.cleanup.plus.xml" "$TEST_DIR/expected-external.xml" || fail 'Rollback overwrote external metadata changes.'
[[ "$(sha256sum "$fixture/plugins/appdata.cleanup.plus.plg")" = "$manifest_before" ]] || fail 'Owned manifest was not rolled back.'
[[ -z "$(find "$fixture/archive" -type f -print)" ]] || fail 'Owned archive was not rolled back.'

prepare_fixture archive-collision
before="$(output_digest)"
target="$(build --dry-run | sed -n 's/^Archive target: //p')"
if PATH="$TEST_DIR/mv-bin:$PATH" ACP_ATOMICITY_REAL_MV="$real_mv" \
    ACP_ATOMICITY_FAIL_XML='' ACP_ATOMICITY_COLLISION="$target" \
    APPDATA_CLEANUP_PLUS_CHANGE_NOTES='Synthetic notes.' build --no-validate > "$TEST_DIR/archive-collision.log" 2>&1; then
    fail 'A newly competing archive must reject finalization.'
fi
[[ "$(cat "$target")" = 'Competing archive bytes.' ]] || fail 'The competing archive was overwritten or removed.'
rm "$target"
[[ "$(output_digest)" = "$before" ]] || fail 'Archive collision modified metadata.'

prepare_fixture busy-lock
before="$(output_digest)"
mkdir "$fixture/.acp-package-build.lock"
printf '%s\n' 'Other fixture owner.' > "$fixture/.acp-package-build.lock/pid"
if APPDATA_CLEANUP_PLUS_CHANGE_NOTES='Synthetic notes.' build --no-validate > "$TEST_DIR/busy-lock.log" 2>&1; then
    fail 'A second builder must not enter another build lock.'
fi
[[ "$(cat "$fixture/.acp-package-build.lock/pid")" = 'Other fixture owner.' ]] || fail 'Another build lock was changed.'
[[ "$(output_digest)" = "$before" ]] || fail 'Busy build changed final outputs.'

prepare_fixture successful-build
cp "$ROOT_DIR/scripts/release_guard.sh" "$fixture/scripts/"
APPDATA_CLEANUP_PLUS_CHANGE_NOTES='Synthetic notes for atomicity verification.' build > "$TEST_DIR/success.log" 2>&1
version="$(sed -n 's/^<!ENTITY version "\([^"]*\)".*/\1/p' "$fixture/plugins/appdata.cleanup.plus.plg")"
archive="$fixture/archive/appdata.cleanup.plus-$version-x86_64-1.txz"
[[ -f "$archive" ]] || fail 'Successful build did not finalize the archive.'
grep -Fxq "###$version" "$fixture/plugins/appdata.cleanup.plus.plg" || fail 'Successful build omitted candidate notes.'
grep -Fq 'Synthetic notes for atomicity verification.' "$fixture/plugins/appdata.cleanup.plus.plg" || fail 'Candidate notes were not retained.'

# An explicitly authorized replacement must restore the old archive on failure.
printf '%s\n' 'Changed synthetic input.' > "$fixture/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/changed.txt"
before="$(output_digest)"
if PATH="$TEST_DIR/mv-bin:$PATH" ACP_ATOMICITY_REAL_MV="$real_mv" \
    ACP_ATOMICITY_FAIL_XML="$fixture/appdata.cleanup.plus.xml" \
    APPDATA_CLEANUP_PLUS_VERSION_OVERRIDE="$version" \
    APPDATA_CLEANUP_PLUS_CHANGE_NOTES='Synthetic replacement.' build --replace-current --no-validate > "$TEST_DIR/failed-replacement.log" 2>&1; then
    fail 'Failed replacement must reject the build.'
fi
[[ "$(output_digest)" = "$before" ]] || fail 'Failed replacement did not restore the exact original archive and metadata.'

echo 'test_package_atomicity: prerequisites, validation, rollback, replacement, concurrent metadata/archive ownership and build locking verified.'
