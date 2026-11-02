#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Both variants must start from the same bytes even if a developer saves source
# while the test runs. Only the deliberate line-ending conversion may differ.
INPUT_DIR="$TMP_DIR/input"
mkdir -p "$INPUT_DIR/plugins" "$INPUT_DIR/source" "$INPUT_DIR/scripts"
cp "$ROOT_DIR/pkg_build.sh" "$INPUT_DIR/"
cp "$ROOT_DIR/plugins/appdata.cleanup.plus.plg" "$INPUT_DIR/plugins/"
cp "$ROOT_DIR/appdata.cleanup.plus.xml" "$INPUT_DIR/"
cp "$ROOT_DIR/scripts/ensure_plg_changes_entry.sh" "$INPUT_DIR/scripts/"
cp -a "$ROOT_DIR/source/appdata.cleanup.plus" "$INPUT_DIR/source/"

# Exercise the real builder from equivalent Linux and Windows text checkouts.
# Both fixture builds stay outside the repository and never publish anything.
for style in lf crlf; do
    fixture="$TMP_DIR/$style"
    mkdir -p "$fixture/plugins" "$fixture/source" "$fixture/scripts"
    cp -a "$INPUT_DIR/." "$fixture/"
    if [ "$style" = crlf ]; then
        find "$fixture/source" -type f \( -name '*.php' -o -name '*.page' -o -name '*.js' -o -name '*.css' -o -name '*.md' -o -name '*.json' -o -name '*.txt' -o -name '*.sh' \) -exec perl -0pi -e 's/\r\n/\n/g; s/\n/\r\n/g' {} +
    else
        find "$fixture/source" -type f \( -name '*.php' -o -name '*.page' -o -name '*.js' -o -name '*.css' -o -name '*.md' -o -name '*.json' -o -name '*.txt' -o -name '*.sh' \) -exec perl -0pi -e 's/\r\n/\n/g' {} +
    fi
    (cd "$fixture" && APPDATA_CLEANUP_PLUS_CHANGE_NOTES='Synthetic line-ending reproducibility build.' bash pkg_build.sh --branch dev --no-validate >/dev/null)
done
cmp "$TMP_DIR/lf/archive/"*.txz "$TMP_DIR/crlf/archive/"*.txz
echo "test_package_line_endings: LF and CRLF checkouts produce identical archives."
