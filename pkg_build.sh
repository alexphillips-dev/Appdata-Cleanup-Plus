#!/usr/bin/env bash
set -euo pipefail

CWD="$(pwd)"
plgfile="$CWD/plugins/appdata.cleanup.plus.plg"
xmlfile="$CWD/appdata.cleanup.plus.xml"
source_dir="$CWD/source/appdata.cleanup.plus"
archive_dir="$CWD/archive"
archive_prefix="appdata.cleanup.plus"
release_guard_script="$CWD/scripts/release_guard.sh"
ensure_changes_entry_script="$CWD/scripts/ensure_plg_changes_entry.sh"
version_override="${APPDATA_CLEANUP_PLUS_VERSION_OVERRIDE:-}"
branch_override="${APPDATA_CLEANUP_PLUS_BUILD_BRANCH:-}"
today_version="$(date +"%Y.%m.%d")"
version="${today_version}.01"
dry_run=false
validate_after_build=true
tmpdir=""

cleanup_tmpdir() {
    if [ -n "${tmpdir:-}" ] && [ -d "${tmpdir}" ]; then
        rm -rf "${tmpdir}"
    fi
}

detect_git_branch() {
    local detected=""
    if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        detected="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
        if [ -z "$detected" ] || [ "$detected" = "HEAD" ]; then
            detected="${GITHUB_REF_NAME:-}"
            detected="${detected#refs/heads/}"
        fi
    fi
    printf '%s' "$detected"
}

print_usage() {
    cat <<'EOF'
Usage: pkg_build.sh [options]
  --branch NAME   Force manifest/XML URLs to branch NAME
  --dry-run       Show the computed version and output paths without writing files
  --validate      Run scripts/release_guard.sh after build (default)
  --no-validate   Skip post-build validation
  -h, --help      Show this help
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

plugin_summary_text() {
    printf '%s' "Appdata Cleanup Plus finds orphaned appdata folders from removed Docker containers so you can review and delete them."
}

plugin_description_for_branch() {
    local target_branch="${1:-}"
    local description=""
    description="$(plugin_summary_text)"
    if [ "$target_branch" = "dev" ]; then
        description="${description} Dev build: testing channel. Expect preview changes before main."
    fi
    printf '%s' "$description"
}

apply_branch_channel_messaging() {
    local package_root="${1:-}"
    local target_branch="${2:-}"
    local readme_file="${package_root}/usr/local/emhttp/plugins/appdata.cleanup.plus/README.md"
    local description=""
    local summary=""
    if [ -z "$package_root" ] || [ -z "$target_branch" ]; then
        echo "ERROR: apply_branch_channel_messaging requires a package root and branch." >&2
        exit 1
    fi
    summary="$(plugin_summary_text)"
    if [ -f "$readme_file" ]; then
        if [ "$target_branch" = "dev" ]; then
            printf '%s\n\n%s\n' "$summary" "Dev build: testing channel. Expect preview changes before main." > "$readme_file"
        else
            printf '%s\n' "$summary" > "$readme_file"
        fi
    fi
}

ensure_repo_layout() {
    if [ ! -f "$plgfile" ]; then
        echo "ERROR: Missing plugin manifest: $plgfile" >&2
        exit 1
    fi
    if [ ! -f "$xmlfile" ]; then
        echo "ERROR: Missing CA template: $xmlfile" >&2
        exit 1
    fi
    if [ ! -d "$source_dir" ]; then
        echo "ERROR: Missing plugin source directory: $source_dir" >&2
        exit 1
    fi
}

stable_date_part() {
    local input="${1:-}"
    if [[ "$input" =~ ^([0-9]{4}\.[0-9]{2}\.[0-9]{2})(\.[0-9]+)?$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return
    fi
    echo ""
}

normalize_stable_version_for_unraid() {
    local input="${1:-}"
    if [[ "$input" =~ ^([0-9]{4}\.[0-9]{2}\.[0-9]{2})$ ]]; then
        echo "${BASH_REMATCH[1]}.01"
        return
    fi
    if [[ "$input" =~ ^([0-9]{4}\.[0-9]{2}\.[0-9]{2})\.([0-9]+)$ ]]; then
        printf '%s.%02d\n' "${BASH_REMATCH[1]}" "$((10#${BASH_REMATCH[2]}))"
        return
    fi
    echo "$input"
}

next_patch_version() {
    local input="${1:-}"
    if [[ "$input" =~ ^([0-9]{4}\.[0-9]{2}\.[0-9]{2})\.([0-9]+)$ ]]; then
        printf '%s.%02d\n' "${BASH_REMATCH[1]}" "$((10#${BASH_REMATCH[2]} + 1))"
        return
    fi
    echo "${input}.01"
}

highest_stable_archive_version_for_date() {
    local target_date="${1:-}"
    local archive=""
    local versions=()
    shopt -s nullglob
    for archive in "$archive_dir/$archive_prefix-"*-x86_64-1.txz; do
        local name="${archive##*/}"
        if [[ "$name" =~ ^${archive_prefix}-(.+)-x86_64-1\.txz$ ]]; then
            local archive_version="${BASH_REMATCH[1]}"
            if [ "$(stable_date_part "$archive_version")" = "$target_date" ]; then
                versions+=("$(normalize_stable_version_for_unraid "$archive_version")")
            fi
        fi
    done
    shopt -u nullglob
    if [ "${#versions[@]}" -eq 0 ]; then
        return
    fi
    printf '%s\n' "${versions[@]}" | sort -V | tail -n1
}

next_stable_version_for_date() {
    local target_date="${1:-}"
    local highest=""
    highest="$(highest_stable_archive_version_for_date "$target_date" || true)"
    if [ -z "$highest" ]; then
        echo "${target_date}.01"
        return
    fi
    next_patch_version "$highest"
}

rewrite_manifest_branch_metadata() {
    local target_file="${1:-}"
    local target_branch="${2:-}"
    if [ -z "$target_file" ] || [ -z "$target_branch" ]; then
        echo "ERROR: rewrite_manifest_branch_metadata requires a file and branch." >&2
        exit 1
    fi
    sed -E -i 's|^<!ENTITY pluginURL ".*">|<!ENTITY pluginURL "https://raw.githubusercontent.com/\&github;/'"$target_branch"'/plugins/\&name;.plg">|' "$target_file"
    sed -E -i 's|<URL>https://raw.githubusercontent.com/.*?/archive/.*</URL>|<URL>https://raw.githubusercontent.com/\&github;/'"$target_branch"'/archive/\&name;-\&version;-x86_64-1.txz</URL>|' "$target_file"
}

sync_ca_template_metadata() {
    local target_file="${1:-}"
    local target_date="${2:-}"
    local target_branch="${3:-}"
    local target_description=""
    if [ -z "$target_file" ] || [ -z "$target_date" ] || [ -z "$target_branch" ]; then
        echo "ERROR: sync_ca_template_metadata requires a file, date, and branch." >&2
        exit 1
    fi
    target_description="$(plugin_description_for_branch "$target_branch")"
    sed -i "s|<Date>.*</Date>|<Date>${target_date}</Date>|" "$target_file"
    sed -i "s|<PluginURL>.*</PluginURL>|<PluginURL>https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/${target_branch}/plugins/appdata.cleanup.plus.plg</PluginURL>|" "$target_file"
    sed -i "s|<Icon>.*</Icon>|<Icon>https://raw.githubusercontent.com/alexphillips-dev/Appdata-Cleanup-Plus/${target_branch}/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/images/appdata.cleanup.plus.png</Icon>|" "$target_file"
    sed -i "s|<Beta>.*</Beta>|<Beta>False</Beta>|" "$target_file"
    sed -i "s|<Name>.*</Name>|<Name>Appdata Cleanup Plus</Name>|" "$target_file"
    perl -0pi -e 's{<Description>\s*.*?\s*</Description>}{<Description>\n'"$target_description"'\n</Description>}s' "$target_file"
}

validate_manifest_branch_matrix() {
    local source_file="${1:-}"
    local branch_name=""
    for branch_name in dev main; do
        local probe_file=""
        local entity_url=""
        local archive_url=""
        local expected_entity_url="https://raw.githubusercontent.com/&github;/${branch_name}/plugins/&name;.plg"
        local expected_archive_url="https://raw.githubusercontent.com/&github;/${branch_name}/archive/&name;-&version;-x86_64-1.txz"
        probe_file="$(mktemp)"
        cp "$source_file" "$probe_file"
        rewrite_manifest_branch_metadata "$probe_file" "$branch_name"
        entity_url="$(grep -m1 '^<!ENTITY pluginURL ' "$probe_file" | sed -E 's/^<!ENTITY pluginURL "([^"]+)".*/\1/' || true)"
        archive_url="$(grep -m1 '<URL>' "$probe_file" | sed -E 's|.*<URL>(https://raw.githubusercontent.com/&github;/[^<]*/archive/&name;-&version;-x86_64-1.txz)</URL>.*|\1|' || true)"
        rm -f "$probe_file"
        if [ "$entity_url" != "$expected_entity_url" ]; then
            echo "ERROR: Manifest pluginURL rewrite mismatch for ${branch_name}." >&2
            exit 1
        fi
        if [ "$archive_url" != "$expected_archive_url" ]; then
            echo "ERROR: Manifest archive URL rewrite mismatch for ${branch_name}." >&2
            exit 1
        fi
    done
}

while [[ $# -gt 0 ]]; do
    case "${1:-}" in
        --dry-run)
            dry_run=true
            ;;
        --branch)
            if [ -z "${2:-}" ]; then
                echo "ERROR: --branch requires a branch name." >&2
                exit 1
            fi
            branch_override="${2:-}"
            shift
            ;;
        --validate)
            validate_after_build=true
            ;;
        --no-validate)
            validate_after_build=false
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

trap cleanup_tmpdir EXIT
ensure_repo_layout
require_commands tar sed date awk grep sort head tail mktemp md5sum perl cp mkdir rm

if [ -n "$branch_override" ]; then
    branch="$branch_override"
else
    detected_branch="$(detect_git_branch)"
    if [ "$detected_branch" = "dev" ]; then
        branch="dev"
    else
        branch="main"
    fi
fi

if ! [[ "$branch" =~ ^[A-Za-z0-9._/-]+$ ]]; then
    echo "ERROR: Invalid branch name: $branch" >&2
    exit 1
fi

if [ -n "$version_override" ]; then
    version="$(normalize_stable_version_for_unraid "$version_override")"
    if [ "$(stable_date_part "$version")" != "$today_version" ]; then
        echo "ERROR: APPDATA_CLEANUP_PLUS_VERSION_OVERRIDE must use today's date (${today_version})." >&2
        exit 1
    fi
else
    version="$(next_stable_version_for_date "$today_version")"
fi

filename="$archive_dir/$archive_prefix-$version-x86_64-1.txz"
while [ -f "$filename" ]; do
    version="$(next_patch_version "$version")"
    filename="$archive_dir/$archive_prefix-$version-x86_64-1.txz"
done

xml_date="${version:0:4}-${version:5:2}-${version:8:2}"

if [ "$dry_run" = true ]; then
    echo "Dry run: no files will be written."
    echo "Version: $version"
    echo "Branch: $branch"
    echo "Archive target: $filename"
    echo "Manifest: $plgfile"
    echo "CA template: $xmlfile"
    exit 0
fi

mkdir -p "$archive_dir"
tmpdir="$(mktemp -d)"
package_root="${tmpdir}/package"
mkdir -p "$package_root"
cp -R "${source_dir}/." "$package_root/"
apply_branch_channel_messaging "$package_root" "$branch"

tar --sort=name \
    --mtime='UTC 1970-01-01' \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    --exclude='./pkg_build.sh' \
    -cJf "$filename" \
    -C "$package_root" .

md5="$(md5sum "$filename" | awk '{print $1}')"

sed -i "s|<!ENTITY version.*>|<!ENTITY version \"$version\">|" "$plgfile"
sed -i "s|<!ENTITY md5.*>|<!ENTITY md5 \"$md5\">|" "$plgfile"
rewrite_manifest_branch_metadata "$plgfile" "$branch"
validate_manifest_branch_matrix "$plgfile"
sync_ca_template_metadata "$xmlfile" "$xml_date" "$branch"

if [ -f "$ensure_changes_entry_script" ]; then
    bash "$ensure_changes_entry_script"
fi
if [ "$validate_after_build" = true ] && [ -f "$release_guard_script" ]; then
    bash "$release_guard_script"
fi

echo "Package created: $filename"
echo "Version: $version"
echo "MD5: $md5"
echo "Branch: $branch"
