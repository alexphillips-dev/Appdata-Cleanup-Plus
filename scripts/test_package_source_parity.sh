#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${ROOT_DIR}/plugins/appdata.cleanup.plus.plg"
SOURCE_DIR="${ROOT_DIR}/source/appdata.cleanup.plus"
VERSION="$(sed -n 's/^<!ENTITY version "\([^"]*\)".*/\1/p' "${MANIFEST}" | head -n1)"
ARCHIVE="${ROOT_DIR}/archive/appdata.cleanup.plus-${VERSION}-x86_64-1.txz"
TMP_DIR="$(mktemp -d)"
EXPECTED_DIR="${TMP_DIR}/expected"
EXTRACTED_DIR="${TMP_DIR}/archive"

cleanup() {
    rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

[[ -n "${VERSION}" ]] || fail "Could not parse the manifest version."
[[ -f "${ARCHIVE}" ]] || fail "Current package archive is missing: ${ARCHIVE}"

mkdir -p "${EXPECTED_DIR}" "${EXTRACTED_DIR}"
cp -a "${SOURCE_DIR}/." "${EXPECTED_DIR}/"
tar -xf "${ARCHIVE}" -C "${EXTRACTED_DIR}"

find "${EXPECTED_DIR}" "${EXTRACTED_DIR}" -type f \( \
    -name '*.php' -o \
    -name '*.page' -o \
    -name '*.js' -o \
    -name '*.css' -o \
    -name '*.md' \
\) -exec sed -i 's/\r$//' {} +

diff -ru \
    --exclude='pkg_build.sh' \
    --exclude='README.md' \
    "${EXPECTED_DIR}" \
    "${EXTRACTED_DIR}" || fail "Current archive contents do not match shipped source files."

PACKAGED_README="${EXTRACTED_DIR}/usr/local/emhttp/plugins/appdata.cleanup.plus/README.md"
[[ -f "${PACKAGED_README}" ]] || fail "Packaged README is missing."
grep -Fq 'Appdata Cleanup Plus (Dev)' "${PACKAGED_README}" || fail "Packaged README does not identify the dev channel."

echo "test_package_source_parity: current archive matches shipped source files."
