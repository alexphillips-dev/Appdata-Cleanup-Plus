#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLG_FILE="${ROOT_DIR}/plugins/appdata.cleanup.plus.plg"
VERSION="$(sed -n 's/^<!ENTITY version "\([^"]*\)".*/\1/p' "${PLG_FILE}" | head -n 1 || true)"
CHANGE_NOTES="${APPDATA_CLEANUP_PLUS_CHANGE_NOTES:-}"

if [[ -z "${VERSION}" ]]; then
    echo "ERROR: Could not parse version from ${PLG_FILE}" >&2
    exit 1
fi

if awk -v marker="###${VERSION}" '{ sub(/\r$/, ""); if ($0 == marker) found = 1 } END { exit found ? 0 : 1 }' "${PLG_FILE}"; then
    exit 0
fi

if [[ -z "${CHANGE_NOTES}" ]]; then
    cat >&2 <<EOF
ERROR: Missing changelog notes for ${VERSION}.
Set APPDATA_CLEANUP_PLUS_CHANGE_NOTES to the real user-facing release notes before building.
EOF
    exit 1
fi

tmp_file="$(mktemp)"
awk -v version="${VERSION}" -v notes="${CHANGE_NOTES}" '
    {
        print
        if ($0 ~ /^<CHANGES>\r?$/) {
            print "###" version
            print notes
            print ""
        }
    }
' "${PLG_FILE}" > "${tmp_file}"
mv "${tmp_file}" "${PLG_FILE}"
