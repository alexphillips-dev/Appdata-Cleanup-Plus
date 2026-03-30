#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLG_FILE="${ROOT_DIR}/plugins/appdata.cleanup.plus.plg"
SYNC_DEV_SCRIPT="${ROOT_DIR}/scripts/sync_main_to_dev.sh"
SOURCE_BRANCH="dev"
MAIN_BRANCH="main"
SYNC_DEV=true
DRY_RUN=false

print_usage() {
    cat <<'EOF'
Usage: bash scripts/release_main.sh [options]

Promote a source branch into main, build the main-channel package, create the
matching git tag, and publish or update the GitHub release from the same top
manifest changelog block.

Options:
  --source NAME    Source branch to promote (default: dev)
  --main NAME      Main release branch to publish (default: main)
  --no-sync-dev    Do not run scripts/sync_main_to_dev.sh after publishing
  --dry-run        Show the planned release actions without mutating the repo
  -h, --help       Show this help
EOF
}

require_commands() {
    local missing=()
    local cmd=""
    for cmd in "$@"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing+=("$cmd")
        fi
    done
    if [ "${#missing[@]}" -gt 0 ]; then
        echo "ERROR: Missing required commands: ${missing[*]}" >&2
        exit 1
    fi
}

require_clean_worktree() {
    if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "ERROR: Working tree has uncommitted changes. Commit or stash them first." >&2
        exit 1
    fi
    if [ -n "$(git ls-files --others --exclude-standard)" ]; then
        echo "ERROR: Working tree has untracked files. Commit, move, or remove them first." >&2
        exit 1
    fi
}

extract_manifest_version() {
    sed -n 's/^<!ENTITY version "\([^"]*\)".*/\1/p' "${PLG_FILE}" | head -n1
}

extract_release_notes() {
    local version="${1:-}"
    if [ -z "${version}" ]; then
        return 1
    fi
    awk -v marker="###${version}" '
        $0 == marker { in_block = 1; next }
        in_block && /^###/ { exit }
        in_block && length($0) > 0 { print }
    ' "${PLG_FILE}"
}

assert_release_notes_ready() {
    local version="${1:-}"
    local notes="${2:-}"
    local placeholder="- Maintenance: Refresh package metadata and build artifacts"
    if [ -z "${notes}" ]; then
        echo "ERROR: Missing changelog notes for ${version} in ${PLG_FILE}." >&2
        exit 1
    fi
    if [ "${notes}" = "${placeholder}" ]; then
        echo "ERROR: ${version} still uses the placeholder changelog entry." >&2
        echo "Update the top ###${version} block in ${PLG_FILE} with the real release notes, then rerun." >&2
        exit 1
    fi
}

ensure_local_branch() {
    local branch_name="${1:-}"
    if git show-ref --verify --quiet "refs/heads/${branch_name}"; then
        return
    fi
    if git show-ref --verify --quiet "refs/remotes/origin/${branch_name}"; then
        git checkout -b "${branch_name}" "origin/${branch_name}"
        return
    fi
    echo "ERROR: Missing local and remote branch: ${branch_name}" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "${1:-}" in
        --source)
            if [ -z "${2:-}" ]; then
                echo "ERROR: --source requires a branch name." >&2
                exit 1
            fi
            SOURCE_BRANCH="${2:-}"
            shift
            ;;
        --main)
            if [ -z "${2:-}" ]; then
                echo "ERROR: --main requires a branch name." >&2
                exit 1
            fi
            MAIN_BRANCH="${2:-}"
            shift
            ;;
        --no-sync-dev)
            SYNC_DEV=false
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        *)
            echo "ERROR: Unknown argument: ${1}" >&2
            print_usage >&2
            exit 1
            ;;
    esac
    shift
done

require_commands git gh bash grep sed awk mktemp
cd "${ROOT_DIR}"

git fetch origin "${MAIN_BRANCH}" "${SOURCE_BRANCH}" --tags

if [ "${DRY_RUN}" = true ]; then
    CURRENT_VERSION="$(extract_manifest_version || true)"
    NEXT_VERSION="$(bash "${ROOT_DIR}/pkg_build.sh" --branch "${MAIN_BRANCH}" --dry-run | sed -n 's/^Version: //p' | head -n1 || true)"
    echo "Dry run: no files will be written."
    echo "Source branch: ${SOURCE_BRANCH}"
    echo "Main branch: ${MAIN_BRANCH}"
    echo "Current manifest version: ${CURRENT_VERSION}"
    echo "Next main build version: ${NEXT_VERSION}"
    echo "Planned actions:"
    echo "  1. Fast-forward ${MAIN_BRANCH} to origin/${MAIN_BRANCH}"
    echo "  2. Fast-forward merge ${SOURCE_BRANCH} into ${MAIN_BRANCH}"
    echo "  3. Build main-channel package metadata via pkg_build.sh"
    echo "  4. Create or verify tag v<version> at the release commit"
    echo "  5. Create or update the matching GitHub release from the top ###<version> manifest notes"
    if [ "${SYNC_DEV}" = true ] && [ "${SOURCE_BRANCH}" = "dev" ] && [ -f "${SYNC_DEV_SCRIPT}" ]; then
        echo "  6. Run scripts/sync_main_to_dev.sh to return to dev and keep branch metadata aligned"
    fi
    exit 0
fi

require_clean_worktree
gh auth status >/dev/null
START_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

ensure_local_branch "${SOURCE_BRANCH}"
ensure_local_branch "${MAIN_BRANCH}"

git checkout "${MAIN_BRANCH}"
git merge --ff-only "origin/${MAIN_BRANCH}"
if git merge-base --is-ancestor "${SOURCE_BRANCH}" "${MAIN_BRANCH}"; then
    echo "ERROR: ${SOURCE_BRANCH} does not contain new commits beyond ${MAIN_BRANCH}." >&2
    echo "Push the new source changes first, then rerun the release script." >&2
    exit 1
fi
git merge --ff-only "${SOURCE_BRANCH}"

bash "${ROOT_DIR}/pkg_build.sh" --branch "${MAIN_BRANCH}"

VERSION="$(extract_manifest_version)"
if [ -z "${VERSION}" ]; then
    echo "ERROR: Failed to parse release version from ${PLG_FILE} after build." >&2
    exit 1
fi

NOTES="$(extract_release_notes "${VERSION}")"
assert_release_notes_ready "${VERSION}" "${NOTES}"

ARCHIVE_FILE="${ROOT_DIR}/archive/appdata.cleanup.plus-${VERSION}-x86_64-1.txz"
if [ ! -f "${ARCHIVE_FILE}" ]; then
    echo "ERROR: Expected release archive is missing: ${ARCHIVE_FILE}" >&2
    exit 1
fi

git add "${PLG_FILE}" "${ROOT_DIR}/appdata.cleanup.plus.xml" "${ARCHIVE_FILE}"
if git diff --cached --quiet; then
    echo "ERROR: Release build produced no staged changes." >&2
    exit 1
fi
git commit -m "Release ${VERSION} to ${MAIN_BRANCH}"

RELEASE_TAG="v${VERSION}"
HEAD_COMMIT="$(git rev-parse HEAD)"
if git rev-parse -q --verify "refs/tags/${RELEASE_TAG}" >/dev/null 2>&1; then
    TAG_COMMIT="$(git rev-list -n1 "${RELEASE_TAG}")"
    if [ "${TAG_COMMIT}" != "${HEAD_COMMIT}" ]; then
        echo "ERROR: Existing tag ${RELEASE_TAG} points to ${TAG_COMMIT}, expected ${HEAD_COMMIT}." >&2
        exit 1
    fi
else
    git tag -a "${RELEASE_TAG}" "${HEAD_COMMIT}" -m "Release ${VERSION}"
fi

NOTES_FILE="$(mktemp)"
trap 'rm -f "${NOTES_FILE}"' EXIT
printf '%s\n' "${NOTES}" > "${NOTES_FILE}"

git push origin "${MAIN_BRANCH}"
git push origin "${RELEASE_TAG}"

if gh release view "${RELEASE_TAG}" >/dev/null 2>&1; then
    gh release edit "${RELEASE_TAG}" --title "${VERSION}" --notes-file "${NOTES_FILE}"
else
    gh release create "${RELEASE_TAG}" --verify-tag --title "${VERSION}" --notes-file "${NOTES_FILE}"
fi

if [ "${SYNC_DEV}" = true ] && [ "${SOURCE_BRANCH}" = "dev" ] && [ -f "${SYNC_DEV_SCRIPT}" ]; then
    bash "${SYNC_DEV_SCRIPT}"
elif [ -n "${START_BRANCH}" ] && [ "${START_BRANCH}" != "${MAIN_BRANCH}" ]; then
    git checkout "${START_BRANCH}"
fi

echo "Published ${VERSION} on ${MAIN_BRANCH} with tag ${RELEASE_TAG}."
