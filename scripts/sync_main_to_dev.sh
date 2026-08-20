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

release_only_path() {
    local path="${1:-}"
    case "${path}" in
        plugins/appdata.cleanup.plus.plg|appdata.cleanup.plus.xml|archive/appdata.cleanup.plus-*.txz)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

if git show-ref --verify --quiet "refs/heads/${DEV_BRANCH}"; then
    git checkout "${DEV_BRANCH}"
else
    git checkout -b "${DEV_BRANCH}" "${DEV_REF}"
fi

if git merge-base --is-ancestor "${MAIN_REF}" "${DEV_BRANCH}"; then
    echo "Dev already includes main. Nothing to sync."
    exit 0
fi

MERGED_CLEANLY=1
if ! git merge --no-ff --no-commit "${MAIN_REF}"; then
    MERGED_CLEANLY=0
fi

if [ "${MERGED_CLEANLY}" -eq 0 ]; then
    mapfile -t CONFLICTS < <(git diff --name-only --diff-filter=U)
    if [ "${#CONFLICTS[@]}" -eq 0 ]; then
        echo "Merge reported conflicts but none were detected." >&2
        exit 1
    fi
    for FILE in "${CONFLICTS[@]}"; do
        if ! release_only_path "${FILE}"; then
            echo "Unexpected merge conflict in ${FILE}; aborting auto back-merge." >&2
            git merge --abort
            exit 1
        fi
    done
    git checkout HEAD -- archive plugins/appdata.cleanup.plus.plg appdata.cleanup.plus.xml
    git add archive plugins/appdata.cleanup.plus.plg appdata.cleanup.plus.xml
fi

sed -E -i 's|^<!ENTITY pluginURL ".*">|<!ENTITY pluginURL "https://raw.githubusercontent.com/\&github;/refs/heads/dev/plugins/\&name;.plg">|' plugins/appdata.cleanup.plus.plg
sed -E -i 's|<URL>https://raw.githubusercontent.com/.*?/archive/.*</URL>|<URL>https://raw.githubusercontent.com/\&github;/refs/heads/dev/archive/\&name;-\&version;-x86_64-1.txz</URL>|' plugins/appdata.cleanup.plus.plg
sed -i 's|<PluginURL>.*</PluginURL>|<PluginURL>https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/refs/heads/dev/plugins/appdata.cleanup.plus.plg</PluginURL>|' appdata.cleanup.plus.xml
sed -i 's|<Icon>.*</Icon>|<Icon>https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/refs/heads/dev/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/images/appdata.cleanup.plus.png</Icon>|' appdata.cleanup.plus.xml

VERSION="$(sed -n 's/^<!ENTITY version "\([^"]*\)".*/\1/p' "${PLG_FILE}" | head -n1)"
if ! [[ "${VERSION}" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}$ ]]; then
    echo "ERROR: Could not parse a safe release version from ${PLG_FILE}." >&2
    exit 1
fi

APPDATA_CLEANUP_PLUS_VERSION_OVERRIDE="${VERSION}" \
    bash "${PKG_BUILD_SCRIPT}" --branch "${DEV_BRANCH}" --replace-current

git add archive plugins/appdata.cleanup.plus.plg appdata.cleanup.plus.xml

if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    if git diff --cached --quiet; then
        git commit --allow-empty -m "Sync main into dev (auto back-merge)"
    else
        git commit -m "Sync main into dev (auto back-merge)"
    fi
    echo "Back-merge commit created."
else
    echo "No merge head present; nothing to commit."
fi
