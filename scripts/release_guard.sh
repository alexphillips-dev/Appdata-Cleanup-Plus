#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLG_FILE="${ROOT_DIR}/plugins/appdata.cleanup.plus.plg"
XML_FILE="${ROOT_DIR}/appdata.cleanup.plus.xml"
ARCHIVE_DIR="${APPDATA_CLEANUP_PLUS_ARCHIVE_DIR:-${ROOT_DIR}/archive}"

if [[ ! -f "${PLG_FILE}" ]]; then
    echo "ERROR: Missing plugin manifest: ${PLG_FILE}" >&2
    exit 1
fi
if [[ ! -f "${XML_FILE}" ]]; then
    echo "ERROR: Missing CA template: ${XML_FILE}" >&2
    exit 1
fi

VERSION="$(grep -m1 '^<!ENTITY version ' "${PLG_FILE}" | sed -E 's/^<!ENTITY version "([^"]+)".*/\1/' || true)"
MD5_ENTITY="$(grep -m1 '^<!ENTITY md5 ' "${PLG_FILE}" | sed -E 's/^<!ENTITY md5 "([^"]+)".*/\1/' || true)"
PLUGIN_URL_ENTITY="$(grep -m1 '^<!ENTITY pluginURL ' "${PLG_FILE}" | sed -E 's/^<!ENTITY pluginURL "([^"]+)".*/\1/' || true)"
ARCHIVE_URL_TEMPLATE="$(grep -m1 '<URL>' "${PLG_FILE}" | sed -E 's|.*<URL>(https://raw.githubusercontent.com/&github;/[^<]*/archive/&name;-&version;-x86_64-1.txz)</URL>.*|\1|' || true)"
PLUGIN_TAG_COMPACT="$(
    perl -0777 -ne '
        if (/<PLUGIN\b[^>]*>/s) {
            my $tag = $&;
            $tag =~ s/\s+/ /g;
            print $tag;
        }
    ' "${PLG_FILE}"
)"

if [[ -z "${VERSION}" || -z "${MD5_ENTITY}" || -z "${PLUGIN_URL_ENTITY}" || -z "${ARCHIVE_URL_TEMPLATE}" ]]; then
    echo "ERROR: Failed to parse required manifest metadata." >&2
    exit 1
fi

if [[ "${PLUGIN_TAG_COMPACT}" != *'name="&name;"'* ]] || [[ "${PLUGIN_TAG_COMPACT}" != *'author="&author;"'* ]] || [[ "${PLUGIN_TAG_COMPACT}" != *'version="&version;"'* ]] || [[ "${PLUGIN_TAG_COMPACT}" != *'launch="&launch;"'* ]] || [[ "${PLUGIN_TAG_COMPACT}" != *'pluginURL="&pluginURL;"'* ]]; then
    echo "ERROR: <PLUGIN> tag must stay in canonical entity form for Unraid update checks." >&2
    exit 1
fi

if [[ ! "${VERSION}" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]{2,}$ ]]; then
    echo "ERROR: Version has unexpected format: ${VERSION}" >&2
    exit 1
fi

VERSION_DATE="${VERSION:0:10}"
TODAY_DATE="$(date +"%Y.%m.%d")"
if [[ "${VERSION_DATE}" > "${TODAY_DATE}" ]]; then
    echo "ERROR: Version date (${VERSION_DATE}) is in the future (today: ${TODAY_DATE})." >&2
    exit 1
fi

EXPECTED_BRANCH="${APPDATA_CLEANUP_PLUS_EXPECT_PLUGIN_BRANCH:-}"
if [[ -z "${EXPECTED_BRANCH}" ]]; then
    if [[ -n "${GITHUB_REF_NAME:-}" ]]; then
        EXPECTED_BRANCH="${GITHUB_REF_NAME#refs/heads/}"
    elif command -v git >/dev/null 2>&1 && git -C "${ROOT_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        EXPECTED_BRANCH="$(git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    fi
fi
if [[ "${EXPECTED_BRANCH}" != "dev" ]]; then
    EXPECTED_BRANCH="main"
fi

EXPECTED_PLUGIN_URL="https://raw.githubusercontent.com/&github;/${EXPECTED_BRANCH}/plugins/&name;.plg"
EXPECTED_ARCHIVE_URL="https://raw.githubusercontent.com/&github;/${EXPECTED_BRANCH}/archive/&name;-&version;-x86_64-1.txz"
if [[ "${PLUGIN_URL_ENTITY}" != "${EXPECTED_PLUGIN_URL}" ]]; then
    echo "ERROR: pluginURL branch mismatch. expected=${EXPECTED_PLUGIN_URL}, found=${PLUGIN_URL_ENTITY}" >&2
    exit 1
fi
if [[ "${ARCHIVE_URL_TEMPLATE}" != "${EXPECTED_ARCHIVE_URL}" ]]; then
    echo "ERROR: archive URL branch mismatch. expected=${EXPECTED_ARCHIVE_URL}, found=${ARCHIVE_URL_TEMPLATE}" >&2
    exit 1
fi

CA_PLUGIN_URL="$(grep -m1 '<PluginURL>' "${XML_FILE}" | sed -E 's|.*<PluginURL>(.*)</PluginURL>.*|\1|' || true)"
CA_DATE="$(grep -m1 '<Date>' "${XML_FILE}" | sed -E 's|.*<Date>(.*)</Date>.*|\1|' || true)"
CA_ICON_URL="$(grep -m1 '<Icon>' "${XML_FILE}" | sed -E 's|.*<Icon>(.*)</Icon>.*|\1|' || true)"
EXPECTED_CA_DATE="${VERSION_DATE//./-}"
EXPECTED_CA_PLUGIN_URL="https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/${EXPECTED_BRANCH}/plugins/appdata.cleanup.plus.plg"
EXPECTED_CA_ICON_URL="https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/${EXPECTED_BRANCH}/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/images/appdata.cleanup.plus.png"

if [[ "${CA_DATE}" != "${EXPECTED_CA_DATE}" ]]; then
    echo "ERROR: CA template date mismatch. expected=${EXPECTED_CA_DATE}, found=${CA_DATE}" >&2
    exit 1
fi
if [[ "${CA_PLUGIN_URL}" != "${EXPECTED_CA_PLUGIN_URL}" ]]; then
    echo "ERROR: CA template plugin URL mismatch. expected=${EXPECTED_CA_PLUGIN_URL}, found=${CA_PLUGIN_URL}" >&2
    exit 1
fi
if [[ "${CA_ICON_URL}" != "${EXPECTED_CA_ICON_URL}" ]]; then
    echo "ERROR: CA template icon URL mismatch. expected=${EXPECTED_CA_ICON_URL}, found=${CA_ICON_URL}" >&2
    exit 1
fi

ARCHIVE_FILE="${ARCHIVE_DIR}/appdata.cleanup.plus-${VERSION}-x86_64-1.txz"
if [[ ! -f "${ARCHIVE_FILE}" ]]; then
    echo "ERROR: Missing archive for current version: ${ARCHIVE_FILE}" >&2
    exit 1
fi

ACTUAL_MD5="$(md5sum "${ARCHIVE_FILE}" | awk '{print $1}')"
if [[ "${ACTUAL_MD5}" != "${MD5_ENTITY}" ]]; then
    echo "ERROR: Manifest md5 mismatch. expected=${ACTUAL_MD5}, found=${MD5_ENTITY}" >&2
    exit 1
fi

echo "release_guard: manifest, CA template, archive, and version metadata look correct."
