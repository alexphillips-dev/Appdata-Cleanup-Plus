#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
XML_FILE="${ROOT_DIR}/appdata.cleanup.plus.xml"
PLG_FILE="${ROOT_DIR}/plugins/appdata.cleanup.plus.plg"
README_FILE="${ROOT_DIR}/README.md"
BANNER_FILE="${ROOT_DIR}/docs/images/banner.png"
EXPECTED_PROJECT_URL="https://github.com/alexphillips-dev/Appdata-Cleanup-Plus"
EXPECTED_ICON_PREFIX="https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/"
EXPECTED_FORUM_PREFIX="https://forums.unraid.net/topic/"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

warn() {
    echo "WARN: $*" >&2
}

extract_xml_tag() {
    local tag_name="${1:-}"
    local file_path="${2:-}"
    grep -m1 "<${tag_name}>" "${file_path}" | sed -E "s|.*<${tag_name}>(.*)</${tag_name}>.*|\\1|" || true
}

if [[ ! -f "${XML_FILE}" ]]; then
    fail "Missing CA template: ${XML_FILE}"
fi
if [[ ! -f "${PLG_FILE}" ]]; then
    fail "Missing plugin manifest: ${PLG_FILE}"
fi
if [[ ! -f "${README_FILE}" ]]; then
    fail "Missing README: ${README_FILE}"
fi
if [[ ! -f "${BANNER_FILE}" ]]; then
    fail "Missing docs banner: ${BANNER_FILE}"
fi

mapfile -t repo_xml_files < <(find "${ROOT_DIR}" -type f -name '*.xml' ! -path "${ROOT_DIR}/.git/*" | sort)
if [[ "${#repo_xml_files[@]}" -ne 1 ]] || [[ "${repo_xml_files[0]}" != "${XML_FILE}" ]]; then
    printf 'ERROR: Expected exactly one CA XML file in the repo root.\n' >&2
    printf 'Found:\n' >&2
    printf '  %s\n' "${repo_xml_files[@]}" >&2
    exit 1
fi

support_url="$(extract_xml_tag "Support" "${XML_FILE}")"
project_url="$(extract_xml_tag "Project" "${XML_FILE}")"
icon_url="$(extract_xml_tag "Icon" "${XML_FILE}")"
xml_plugin_url="$(extract_xml_tag "PluginURL" "${XML_FILE}")"
plg_plugin_url="$(grep -m1 '^<!ENTITY pluginURL ' "${PLG_FILE}" | sed -E 's/^<!ENTITY pluginURL "([^"]+)".*/\1/' || true)"
plg_support_url="$(perl -0777 -ne 'if (/<PLUGIN\b[^>]*\bsupport="([^"]+)"/s) { print $1; }' "${PLG_FILE}")"

if [[ -z "${support_url}" ]]; then
    fail "Missing <Support> in ${XML_FILE}"
fi
if [[ "${support_url}" != ${EXPECTED_FORUM_PREFIX}* ]]; then
    fail "CA support URL must point to a full Unraid forum topic. found=${support_url}"
fi

if [[ -n "${plg_support_url}" ]] && [[ "${plg_support_url}" != "${support_url}" ]]; then
    fail "Manifest support URL does not match CA support URL."
fi
if [[ -z "${plg_support_url}" ]]; then
    warn "plugins/appdata.cleanup.plus.plg does not yet include a support=\"...\" attribute. CA can inject it from XML, but mirroring FolderView Plus is recommended."
fi

if [[ "${project_url}" != "${EXPECTED_PROJECT_URL}" ]]; then
    fail "Project URL mismatch. expected=${EXPECTED_PROJECT_URL}, found=${project_url}"
fi

if [[ "${icon_url}" != ${EXPECTED_ICON_PREFIX}* ]]; then
    fail "Icon URL must be hosted from this GitHub repo. found=${icon_url}"
fi

if [[ -z "${xml_plugin_url}" || -z "${plg_plugin_url}" ]]; then
    fail "Could not parse plugin URLs from XML/PLG."
fi

if ! grep -Fq 'docs/images/banner.png' "${README_FILE}"; then
    fail "README.md must reference docs/images/banner.png"
fi

echo "ca_readiness_guard: repo layout and CA-facing docs are present."
echo "ca_readiness_guard: support link, project link, and icon link checks passed."
