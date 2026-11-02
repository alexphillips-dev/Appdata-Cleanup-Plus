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
replace_current=false
tmpdir=""
outputs_started=false
outputs_committed=false
archive_preexisting=false
archive_attempted=false
plg_attempted=false
xml_attempted=false
rollback_failed=false
build_lock="$CWD/.acp-package-build.lock"
build_lock_owned=false
final_archive_tmp=""
final_plg_tmp=""
final_xml_tmp=""

restore_owned_output() {
    local destination="$1" candidate="$2" original="${3:-}"
    if cmp -s "$destination" "$candidate"; then
        if [ -n "$original" ]; then
            cp -p -- "$original" "$destination" || rollback_failed=true
        else
            rm -f -- "$destination" || rollback_failed=true
        fi
    elif { [ -n "$original" ] && cmp -s "$destination" "$original"; } ||
        { [ -z "$original" ] && [ ! -e "$destination" ] && [ ! -L "$destination" ]; }; then
        : # The attempted rename failed before changing this output.
    else
        echo "ERROR: Output changed outside this build; left untouched: $destination" >&2
        rollback_failed=true
    fi
}

cleanup_tmpdir() {
    local result=$?
    if [ "$outputs_started" = true ] && [ "$outputs_committed" != true ]; then
        echo "Build failed during finalization; restoring original package outputs." >&2
        if [ "$plg_attempted" = true ]; then restore_owned_output "$plgfile" "$candidate_plg" "$tmpdir/original.plg"; fi
        if [ "$xml_attempted" = true ]; then restore_owned_output "$xmlfile" "$candidate_xml" "$tmpdir/original.xml"; fi
        if [ "$archive_attempted" = true ]; then
            if [ "$archive_preexisting" = true ]; then
                restore_owned_output "$filename" "$candidate_archive" "$tmpdir/original.txz"
            else
                restore_owned_output "$filename" "$candidate_archive"
            fi
        fi
    fi
    local pending=""
    for pending in "$final_archive_tmp" "$final_plg_tmp" "$final_xml_tmp"; do
        if [ -n "$pending" ]; then rm -f -- "$pending" || result=1; fi
    done
    if [ "$build_lock_owned" = true ]; then
        rm -f -- "$build_lock/pid" || result=1
        rmdir -- "$build_lock" || result=1
    fi
    if [ "$rollback_failed" = true ]; then
        echo "ERROR: Recovery copies retained for inspection: $tmpdir" >&2
        result=1
    elif [ -n "${tmpdir:-}" ] && [ -d "${tmpdir}" ]; then
        rm -rf "${tmpdir}"
    fi
    return "$result"
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
  --replace-current
                  Replace the archive for the manifest's exact current version;
                  requires APPDATA_CLEANUP_PLUS_VERSION_OVERRIDE to match it
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
    printf '%s' "Appdata Cleanup Plus scans for unused Docker appdata folders and exact ZFS dataset candidates, then lets you review, dry run, quarantine, restore, audit, or permanently delete them from a guided cleanup dashboard."
}

plugin_readme_title_for_branch() {
    local target_branch="${1:-}"
    if [ "$target_branch" = "dev" ]; then
        printf '%s' "Appdata Cleanup Plus (Dev)"
        return
    fi
    printf '%s' "Appdata Cleanup Plus"
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
    local summary=""
    local title=""
    local channel="main"
    if [ -z "$package_root" ] || [ -z "$target_branch" ]; then
        echo "ERROR: apply_branch_channel_messaging requires a package root and branch." >&2
        exit 1
    fi
    summary="$(plugin_summary_text)"
    title="$(plugin_readme_title_for_branch "$target_branch")"
    if [ -f "$readme_file" ]; then
        {
            printf '%s\n' '<div id="acp-plugin-description" lang="en-US" dir="ltr" style="white-space:normal;overflow-wrap:anywhere;text-align:start">'
            printf '<p><strong data-acp-plugin-text="title">%s</strong></p>\n' "$title"
            printf '<p data-acp-plugin-text="summary">%s</p>\n' "$summary"
            if [ "$target_branch" = "dev" ]; then
                channel="dev"
                printf '%s\n' '<p data-acp-plugin-text="notice">Dev build: testing channel. Expect preview changes before main.</p>'
            fi
            printf '%s\n' '</div>'
            printf '\n<script src="/plugins/appdata.cleanup.plus/include/plugin-description.php?channel=%s"></script>\n' "$channel"
        } > "$readme_file"
    fi
}

normalize_packaged_text_line_endings() {
    local package_root="${1:-}"
    if [ -z "$package_root" ]; then
        echo "ERROR: normalize_packaged_text_line_endings requires a package root." >&2
        exit 1
    fi
    # Branch checkouts on Windows can convert newly added catalogs to CRLF.
    # Normalize shipped text, including JSON and licenses, without touching images.
    find "$package_root" -type f \( \
        -name '*.php' -o -name '*.page' -o -name '*.js' -o \
        -name '*.css' -o -name '*.md' -o -name '*.json' -o \
        -name '*.txt' -o -name '*.sh' \
    \) -exec perl -0pi -e 's/\r\n/\n/g' {} +
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
        --replace-current)
            replace_current=true
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
trap 'exit 130' INT
trap 'exit 143' TERM
ensure_repo_layout
require_commands tar sed date awk grep sort head tail mktemp md5sum perl cp mkdir rm rmdir find mv cmp

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

if [ "$dry_run" != true ]; then
    # Serialize allocation and finalization without adding a platform-specific
    # flock dependency. Never remove a lock belonging to another invocation.
    if ! mkdir "$build_lock" 2>/dev/null; then
        echo "ERROR: Another build owns .acp-package-build.lock. Verify an interrupted build has stopped before removing its lock directory." >&2
        exit 1
    fi
    build_lock_owned=true
    printf '%s\n' "$$" > "$build_lock/pid"
fi

if [ -n "$version_override" ]; then
    version="$(normalize_stable_version_for_unraid "$version_override")"
    if [ "$replace_current" = true ]; then
        current_manifest_version="$(sed -n 's/^<!ENTITY version "\([^"]*\)".*/\1/p' "$plgfile" | head -n1)"
        if [ -z "$current_manifest_version" ] || [ "$version" != "$current_manifest_version" ]; then
            echo "ERROR: --replace-current requires the version override to match the current manifest version." >&2
            exit 1
        fi
    elif [ "$(stable_date_part "$version")" != "$today_version" ]; then
        echo "ERROR: APPDATA_CLEANUP_PLUS_VERSION_OVERRIDE must use today's date (${today_version})." >&2
        exit 1
    fi
elif [ "$replace_current" = true ]; then
    echo "ERROR: --replace-current requires APPDATA_CLEANUP_PLUS_VERSION_OVERRIDE." >&2
    exit 1
else
    version="$(next_stable_version_for_date "$today_version")"
fi

filename="$archive_dir/$archive_prefix-$version-x86_64-1.txz"
if [ "$replace_current" != true ]; then
    while [ -f "$filename" ]; do
        version="$(next_patch_version "$version")"
        filename="$archive_dir/$archive_prefix-$version-x86_64-1.txz"
    done
fi

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

if [ ! -f "$ensure_changes_entry_script" ]; then
    echo "ERROR: Missing required changelog helper: $ensure_changes_entry_script" >&2
    exit 1
fi
if [ "$validate_after_build" = true ] && { [ ! -f "$release_guard_script" ] || [ ! -f "$CWD/scripts/validate_plugin_xml.php" ]; }; then
    echo "ERROR: Required package validation scripts are missing." >&2
    exit 1
fi

tmpdir="$(mktemp -d)"
candidate_root="$tmpdir/candidate"
candidate_plg="$candidate_root/plugins/appdata.cleanup.plus.plg"
candidate_xml="$candidate_root/appdata.cleanup.plus.xml"
candidate_archive="$candidate_root/archive/${filename##*/}"
package_root="$candidate_root/source/appdata.cleanup.plus"
mkdir -p "$package_root" "$candidate_root/plugins" "$candidate_root/archive" "$candidate_root/scripts"
cp -p -- "$plgfile" "$tmpdir/original.plg"
cp -p -- "$xmlfile" "$tmpdir/original.xml"
cp -p -- "$plgfile" "$candidate_plg"
cp -p -- "$xmlfile" "$candidate_xml"
cp -R "$CWD/scripts/." "$candidate_root/scripts/"

# Resolve notes and all metadata against a private candidate before creating any
# final archive or modifying the checkout. The notes helper retains one owner.
sed -i "s|<!ENTITY version.*>|<!ENTITY version \"$version\">|" "$candidate_plg"
bash "$candidate_root/scripts/ensure_plg_changes_entry.sh"
rewrite_manifest_branch_metadata "$candidate_plg" "$branch"
validate_manifest_branch_matrix "$candidate_plg"
sync_ca_template_metadata "$candidate_xml" "$xml_date" "$branch"

cp -R "${source_dir}/." "$package_root/"
apply_branch_channel_messaging "$package_root" "$branch"
normalize_packaged_text_line_endings "$package_root"

tar --sort=name \
    --mtime='UTC 1970-01-01' \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    --exclude='./pkg_build.sh' \
    -cJf "$candidate_archive" \
    -C "$package_root" .

md5="$(md5sum "$candidate_archive" | awk '{print $1}')"

sed -i "s|<!ENTITY md5.*>|<!ENTITY md5 \"$md5\">|" "$candidate_plg"

if [ "$validate_after_build" = true ]; then
    APPDATA_CLEANUP_PLUS_ARCHIVE_DIR="$candidate_root/archive" \
        APPDATA_CLEANUP_PLUS_EXPECT_PLUGIN_BRANCH="$branch" \
        bash "$candidate_root/scripts/release_guard.sh"
fi

# Final renames use temporary files in each destination's own filesystem.
# Preserve replacement bytes until every rename succeeds; ordinary failures and
# handled interruption roll back only this invocation's outputs.
if [ -e "$filename" ] || [ -L "$filename" ]; then
    if [ "$replace_current" != true ] || [ ! -f "$filename" ] || [ -L "$filename" ]; then
        echo "ERROR: Archive target changed during build; refusing to overwrite it." >&2
        exit 1
    fi
    cp -p -- "$filename" "$tmpdir/original.txz"
    archive_preexisting=true
fi
mkdir -p "$archive_dir"
final_archive_tmp="$(mktemp "$archive_dir/.acp-package.XXXXXX")"
final_plg_tmp="$(mktemp "$CWD/plugins/.acp-manifest.XXXXXX")"
final_xml_tmp="$(mktemp "$CWD/.acp-ca.XXXXXX")"
cp -p -- "$candidate_archive" "$final_archive_tmp"
cp -p -- "$candidate_plg" "$final_plg_tmp"
cp -p -- "$candidate_xml" "$final_xml_tmp"
if ! cmp -s "$plgfile" "$tmpdir/original.plg" || ! cmp -s "$xmlfile" "$tmpdir/original.xml"; then
    echo "ERROR: Package metadata changed during build; refusing to replace it." >&2
    exit 1
fi
outputs_started=true
archive_attempted=true
if [ "$archive_preexisting" = true ]; then
    if ! cmp -s "$filename" "$tmpdir/original.txz"; then
        echo "ERROR: Replacement archive changed during build; refusing to overwrite it." >&2
        archive_attempted=false
        exit 1
    fi
    mv -fT -- "$final_archive_tmp" "$filename"
else
    mv -nT -- "$final_archive_tmp" "$filename"
    if [ -e "$final_archive_tmp" ]; then
        echo "ERROR: Archive appeared during finalization; refusing to overwrite it." >&2
        exit 1
    fi
fi
final_archive_tmp=""
plg_attempted=true
mv -fT -- "$final_plg_tmp" "$plgfile"
final_plg_tmp=""
xml_attempted=true
mv -fT -- "$final_xml_tmp" "$xmlfile"
final_xml_tmp=""
outputs_committed=true

echo "Package created: $filename"
echo "Version: $version"
echo "MD5: $md5"
echo "Branch: $branch"
