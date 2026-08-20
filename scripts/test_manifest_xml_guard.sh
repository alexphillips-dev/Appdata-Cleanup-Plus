#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_FILE="${ROOT_DIR}/plugins/appdata.cleanup.plus.plg"
INVALID_MANIFEST="$(mktemp)"
ERROR_OUTPUT="$(mktemp)"
trap 'rm -f "${INVALID_MANIFEST}" "${ERROR_OUTPUT}"' EXIT

PHP_BIN="${APPDATA_CLEANUP_PLUS_PHP_BIN:-}"
if [[ -z "${PHP_BIN}" ]]; then
    if command -v php >/dev/null 2>&1; then
        PHP_BIN="php"
    elif command -v php.exe >/dev/null 2>&1; then
        PHP_BIN="php.exe"
    else
        echo "ERROR: PHP CLI is required to test manifest validation." >&2
        exit 1
    fi
fi

validate_manifest() {
    local manifest_path="${1:-}"
    local validator_path="${ROOT_DIR}/scripts/validate_plugin_xml.php"

    if [[ "${PHP_BIN}" == *.exe ]] && command -v wslpath >/dev/null 2>&1; then
        validator_path="$(wslpath -w "${validator_path}")"
        manifest_path="$(wslpath -w "${manifest_path}")"
    fi
    "${PHP_BIN}" "${validator_path}" "${manifest_path}"
}

validate_manifest "${MANIFEST_FILE}"

sed "s|&lt;&lt;'EOF'|<<'EOF'|" "${MANIFEST_FILE}" > "${INVALID_MANIFEST}"
if validate_manifest "${INVALID_MANIFEST}" >"${ERROR_OUTPUT}" 2>&1; then
    echo "ERROR: Malformed inline shell XML unexpectedly passed validation." >&2
    exit 1
fi
grep -Fq "Plugin manifest is not valid XML" "${ERROR_OUTPUT}"

echo "test_manifest_xml_guard: malformed inline shell XML is rejected."
