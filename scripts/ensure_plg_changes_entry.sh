#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLG_FILE="${ROOT_DIR}/plugins/appdata.cleanup.plus.plg"
VERSION="$(sed -n 's/^<!ENTITY version "\([^"]*\)".*/\1/p' "${PLG_FILE}" | head -n 1 || true)"

if [[ -z "${VERSION}" ]]; then
    echo "ERROR: Could not parse version from ${PLG_FILE}" >&2
    exit 1
fi

if grep -q "^###${VERSION}$" "${PLG_FILE}"; then
    exit 0
fi

tmp_file="$(mktemp)"
awk -v version="${VERSION}" '
    {
        print
        if ($0 == "<CHANGES>") {
            print "###" version
            print "- Maintenance: Refresh package metadata and build artifacts"
            print ""
        }
    }
' "${PLG_FILE}" > "${tmp_file}"
mv "${tmp_file}" "${PLG_FILE}"
