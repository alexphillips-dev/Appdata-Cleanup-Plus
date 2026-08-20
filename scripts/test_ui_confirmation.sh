#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JS_FILE="${ROOT_DIR}/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/scripts/appdata.cleanup.plus.js"
PAGE_FILE="${ROOT_DIR}/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/AppdataCleanupPlus.page"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

if grep -n -E 'deleteTyped|quarantinePurgeTyped|Type DELETE|typed confirmation|showInputError.*DELETE' "${JS_FILE}" "${PAGE_FILE}"; then
    fail "Obsolete typed DELETE confirmation remains in the UI source."
fi

purge_flow="$(sed -n '/function startQuarantineManagerActionFlow/,/function runQuarantineManagerAction/p' "${JS_FILE}")"
purge_confirmation_html="$(sed -n '/function buildQuarantineActionConfirmHtml/,/function inspectQuarantineRestoreConflicts/p' "${JS_FILE}")"

grep -Fq 'type: "warning"' <<<"${purge_flow}" || fail "Quarantine purge must use a warning confirmation dialog."
grep -Fq 'requireDeleteConfirmationChecked()' <<<"${purge_flow}" || fail "Quarantine purge must enforce the confirmation checkbox."
grep -Fq 'syncDeleteConfirmationState()' <<<"${purge_flow}" || fail "Quarantine purge must initialize the confirmation state."
grep -Fq 'quarantinePurgeCheckboxConfirmLabel' <<<"${purge_confirmation_html}" || fail "Quarantine purge confirmation copy is missing."
grep -Fq 'buildDeleteConfirmationHtml' <<<"${purge_confirmation_html}" || fail "Quarantine purge must render the shared confirmation checkbox."

echo "test_ui_confirmation: destructive confirmation flows use checkbox confirmation."
