#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DEV_BRANCH="dev"
MAIN_REF="origin/main"
DEV_REF="origin/dev"
PKG_BUILD_SCRIPT="${ROOT_DIR}/pkg_build.sh"
PLG_FILE="${ROOT_DIR}/plugins/appdata.cleanup.plus.plg"

git fetch origin main dev --tags

if ! git diff --quiet --ignore-cr-at-eol --ignore-space-at-eol ||
    ! git diff --cached --quiet --ignore-cr-at-eol --ignore-space-at-eol ||
    [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "ERROR: Working tree must be clean before syncing main into dev." >&2
    exit 1
fi

if git show-ref --verify --quiet "refs/heads/${DEV_BRANCH}"; then
    git checkout "${DEV_BRANCH}"
else
    git checkout -b "${DEV_BRANCH}" "${DEV_REF}"
fi

if ! git merge --ff-only "${DEV_REF}"; then
    echo "ERROR: Local dev has diverged from origin/dev; refusing to rewrite branch history." >&2
    exit 1
fi

if git merge-base --is-ancestor "${MAIN_REF}" "${DEV_BRANCH}"; then
    echo "Dev already includes main. Nothing to sync."
    exit 0
fi

if ! git merge --ff-only "${MAIN_REF}"; then
    echo "ERROR: Dev cannot be fast-forwarded to main; refusing to create a merge commit." >&2
    echo "Reconcile the branch histories explicitly, then rerun this script." >&2
    exit 1
fi

sed -E -i 's|^<!ENTITY pluginURL ".*">|<!ENTITY pluginURL "https://raw.githubusercontent.com/\&github;/dev/plugins/\&name;.plg">|' plugins/appdata.cleanup.plus.plg
sed -E -i 's|<URL>https://raw.githubusercontent.com/.*?/archive/.*</URL>|<URL>https://raw.githubusercontent.com/\&github;/dev/archive/\&name;-\&version;-x86_64-1.txz</URL>|' plugins/appdata.cleanup.plus.plg
sed -i 's|<PluginURL>.*</PluginURL>|<PluginURL>https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/dev/plugins/appdata.cleanup.plus.plg</PluginURL>|' appdata.cleanup.plus.xml
sed -i 's|<Icon>.*</Icon>|<Icon>https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/dev/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/images/appdata.cleanup.plus.png</Icon>|' appdata.cleanup.plus.xml

VERSION="$(sed -n 's/^<!ENTITY version "\([^"]*\)".*/\1/p' "${PLG_FILE}" | head -n1)"
if ! [[ "${VERSION}" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}$ ]]; then
    echo "ERROR: Could not parse a safe release version from ${PLG_FILE}." >&2
    exit 1
fi

APPDATA_CLEANUP_PLUS_VERSION_OVERRIDE="${VERSION}" \
    bash "${PKG_BUILD_SCRIPT}" --branch "${DEV_BRANCH}" --replace-current

git add archive plugins/appdata.cleanup.plus.plg appdata.cleanup.plus.xml

if git diff --cached --quiet; then
    echo "Dev already contains the main release metadata. Nothing to commit."
else
    git commit -m "Sync main into dev (linear back-sync)"
    echo "Linear back-sync commit created."
fi
