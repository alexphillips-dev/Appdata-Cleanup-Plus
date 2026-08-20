#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JS_FILE="${ROOT_DIR}/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/scripts/appdata.cleanup.plus.js"
API_FILE="${ROOT_DIR}/source/appdata.cleanup.plus/usr/local/emhttp/plugins/appdata.cleanup.plus/include/api.php"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

payload_flow="$(sed -n '/function buildDiagnosticsPayload/,/function buildDiagnosticsFilename/p' "${JS_FILE}")"
support_flow="$(sed -n '/function buildSupportSummaryText/,/function summarizeScanMetrics/p' "${JS_FILE}")"
server_bundle="$(sed -n '/function buildAppdataCleanupPlusDiagnosticsBundle/,/function resolveSnapshotCandidates/p' "${API_FILE}")"

if grep -Fq 'searchTerm:' <<<"${payload_flow}"; then
    fail "Diagnostics export must not include the raw UI search term."
fi

grep -Fq 'schemaVersion: 2' <<<"${payload_flow}" || fail "Client diagnostics schema version is missing."
grep -Fq 'sanitizeDiagnosticsRowId' <<<"${payload_flow}" || fail "Client diagnostics row IDs must use export-scoped aliases."
grep -Fq 'sanitizeDiagnosticsValue(payload' <<<"${payload_flow}" || fail "Client diagnostics payload needs a final recursive privacy scrub."
grep -Fq 'sanitizeDiagnosticsPath(path, redactor)' <<<"${support_flow}" || fail "Copied support summaries must sanitize scan roots."
grep -Fq '"schemaVersion" => 2' <<<"${server_bundle}" || fail "Server diagnostics schema version is missing."
grep -Fq 'appdataCleanupPlusDiagnosticsSafetySettingsSummary()' <<<"${server_bundle}" || fail "Server diagnostics safety settings must use an allowlisted summary."
grep -Fq 'appdataCleanupPlusDiagnosticsQuarantineRegistrySummary(50)' <<<"${server_bundle}" || fail "Server diagnostics quarantine state must use an allowlisted summary."
grep -Fq 'appdataCleanupPlusDiagnosticsIgnoredCandidatesSummary(50)' <<<"${server_bundle}" || fail "Server diagnostics ignored state must use an allowlisted summary."
grep -Fq 'appdataCleanupPlusDiagnosticsRedactValue($bundle)' <<<"${server_bundle}" || fail "Server diagnostics bundle needs a final recursive privacy scrub."

echo "test_diagnostics_privacy: diagnostics exports use schema allowlists, aliases, and final recursive scrubs."
