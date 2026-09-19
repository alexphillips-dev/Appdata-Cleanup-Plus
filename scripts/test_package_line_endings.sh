#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Exercise the real builder from equivalent Linux and Windows text checkouts.
# Both fixture builds stay outside the repository and never publish anything.
for style in lf crlf; do
    fixture="$TMP_DIR/$style"
    mkdir -p "$fixture/plugins" "$fixture/source"
    cp "$ROOT_DIR/pkg_build.sh" "$fixture/"
    cp "$ROOT_DIR/plugins/appdata.cleanup.plus.plg" "$fixture/plugins/"
    cp "$ROOT_DIR/appdata.cleanup.plus.xml" "$fixture/"
    cp -a "$ROOT_DIR/source/appdata.cleanup.plus" "$fixture/source/"
    if [ "$style" = crlf ]; then
        find "$fixture/source" -type f \( -name '*.php' -o -name '*.page' -o -name '*.js' -o -name '*.css' -o -name '*.md' -o -name '*.json' -o -name '*.txt' -o -name '*.sh' \) -exec perl -0pi -e 's/\r\n/\n/g; s/\n/\r\n/g' {} +
    else
        find "$fixture/source" -type f \( -name '*.php' -o -name '*.page' -o -name '*.js' -o -name '*.css' -o -name '*.md' -o -name '*.json' -o -name '*.txt' -o -name '*.sh' \) -exec perl -0pi -e 's/\r\n/\n/g' {} +
    fi
    (cd "$fixture" && bash pkg_build.sh --branch dev --no-validate >/dev/null)
done
cmp "$TMP_DIR/lf/archive/"*.txz "$TMP_DIR/crlf/archive/"*.txz
echo "test_package_line_endings: LF and CRLF checkouts produce identical archives."
