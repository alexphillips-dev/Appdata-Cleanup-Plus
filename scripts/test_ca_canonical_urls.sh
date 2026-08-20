#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${ROOT_DIR}/plugins/appdata.cleanup.plus.plg"
XML_FILE="${ROOT_DIR}/appdata.cleanup.plus.xml"
README_FILE="${ROOT_DIR}/README.md"
PACKAGED_README="${ROOT_DIR}/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/README.md"
REGISTERED_BASE="https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

functional_files=(
    "${ROOT_DIR}/pkg_build.sh"
    "${ROOT_DIR}/scripts/release_guard.sh"
    "${ROOT_DIR}/scripts/release_main.sh"
    "${ROOT_DIR}/scripts/sync_main_to_dev.sh"
    "${XML_FILE}"
    "${README_FILE}"
    "${PACKAGED_README}"
)

if grep -n -F "${REGISTERED_BASE}/refs/heads/" "${functional_files[@]}"; then
    fail "CA-facing raw URLs must not replace the registered /main/ or /dev/ identity with /refs/heads/."
fi

plugin_url="$(sed -n 's/^<!ENTITY pluginURL "\([^"]*\)".*/\1/p' "${MANIFEST}" | head -n1)"
archive_url="$(sed -n 's|.*<URL>\(.*\)</URL>.*|\1|p' "${MANIFEST}" | head -n1)"
xml_plugin_url="$(sed -n 's|.*<PluginURL>\(.*\)</PluginURL>.*|\1|p' "${XML_FILE}" | head -n1)"

case "${plugin_url}" in
    "https://raw.githubusercontent.com/&github;/main/plugins/&name;.plg")
        expected_branch="main"
        ;;
    "https://raw.githubusercontent.com/&github;/dev/plugins/&name;.plg")
        expected_branch="dev"
        ;;
    *)
        fail "Manifest pluginURL is not one of the registered canonical branch URLs: ${plugin_url}"
        ;;
esac

expected_archive_url="https://raw.githubusercontent.com/&github;/${expected_branch}/archive/&name;-&version;-x86_64-1.txz"
expected_xml_url="${REGISTERED_BASE}/${expected_branch}/plugins/appdata.cleanup.plus.plg"

[[ "${archive_url}" == "${expected_archive_url}" ]] ||
    fail "Manifest archive URL is not canonical for ${expected_branch}."
[[ "${xml_plugin_url}" == "${expected_xml_url}" ]] ||
    fail "CA XML PluginURL is not canonical for ${expected_branch}."

grep -Fq "${REGISTERED_BASE}/main/plugins/appdata.cleanup.plus.plg" "${README_FILE}" ||
    fail "README is missing the registered stable install URL."
grep -Fq "${REGISTERED_BASE}/dev/plugins/appdata.cleanup.plus.plg" "${README_FILE}" ||
    fail "README is missing the canonical dev install URL."
cmp -s "${README_FILE}" "${PACKAGED_README}" ||
    fail "Root and packaged README files must stay identical."

echo "test_ca_canonical_urls: registered CA plugin identities are preserved."
