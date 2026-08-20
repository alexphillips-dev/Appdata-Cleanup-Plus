#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_SCRIPT="${ROOT_DIR}/scripts/release_main.sh"

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

echo "test_release_source_ref: release promotion consumes the fetched remote source ref."
