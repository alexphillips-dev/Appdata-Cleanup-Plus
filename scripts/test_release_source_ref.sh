#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_SCRIPT="${ROOT_DIR}/scripts/release_main.sh"
SYNC_SCRIPT="${ROOT_DIR}/scripts/sync_main_to_dev.sh"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

grep -Fq 'REMOTE_SOURCE_REF="origin/${SOURCE_BRANCH}"' "${RELEASE_SCRIPT}" || fail "Release flow must define the fetched remote source ref."
grep -Fq 'git merge --ff-only "${REMOTE_SOURCE_REF}"' "${RELEASE_SCRIPT}" || fail "Release flow must merge the fetched remote source ref."
grep -Fq 'git merge-base --is-ancestor "${REMOTE_SOURCE_REF}" "${MAIN_BRANCH}"' "${RELEASE_SCRIPT}" || fail "Release flow must compare main with the fetched remote source ref."

if grep -Fq 'git merge --ff-only "${SOURCE_BRANCH}"' "${RELEASE_SCRIPT}"; then
    fail "Release flow must not merge a potentially stale local source branch."
fi

grep -Fq 'git merge --ff-only "${MAIN_REF}"' "${SYNC_SCRIPT}" || fail "Main-to-dev sync must preserve linear history."
if grep -Fq -- '--no-ff' "${SYNC_SCRIPT}"; then
    fail "Main-to-dev sync must not create a merge commit."
fi

grep -Fq 'GH_USES_WINDOWS_PATHS=true' "${RELEASE_SCRIPT}" || fail "Release flow must detect the Windows GitHub CLI fallback."
grep -Fq 'GH_NOTES_FILE="$(wslpath -w "${NOTES_FILE}")"' "${RELEASE_SCRIPT}" || fail "Release notes must be translated for Windows GitHub CLI paths."
grep -Fq -- '--notes-file "${GH_NOTES_FILE}"' "${RELEASE_SCRIPT}" || fail "GitHub releases must use the translated notes path."

echo "test_release_source_ref: release promotion and back-sync preserve remote refs, linear history, and cross-platform release notes."
