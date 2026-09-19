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
server_bundle="$(sed -n '/function buildAppdataCleanupPlusDiagnosticsBundle/,/function resolveSnapshotCandidates/p' "${API_FILE}")"

if grep -Fq 'searchTerm:' <<<"${payload_flow}"; then
    fail "Diagnostics export must not include the raw UI search term."
fi

grep -Fq 'schemaVersion: 5' <<<"${payload_flow}" || fail "Client diagnostics schema version is missing."
grep -Fq 'sanitizeDiagnosticsRowId' <<<"${payload_flow}" || fail "Client diagnostics row IDs must use export-scoped aliases."
grep -Fq 'sanitizeDiagnosticsValue(payload' <<<"${payload_flow}" || fail "Client diagnostics payload needs a final recursive privacy scrub."
grep -Fq 'nextRow.mountEvidence = sanitizeDiagnosticsMountEvidence' "${JS_FILE}" || fail "Specific container mount evidence must use an allowlisted sanitizer."
grep -Fq 'nextRow.broadMountEvidence = sanitizeDiagnosticsMountEvidence' "${JS_FILE}" || fail "Broad container access evidence must use an allowlisted sanitizer."
if grep -Eq 'templateManager|template-backups|TemplateBackup' <<<"${payload_flow}${server_bundle}"; then
    fail "Private template backups and manager state must not enter diagnostics exports."
fi
grep -Fq 'downloadJsonFile(buildDiagnosticsFilename(), payload)' "${JS_FILE}" || fail "Diagnostics must retain the sanitized JSON download."
if grep -Eq 'copyDiagnosticsText|copySupportSummary|buildDiagnosticsTextPayload|buildSupportSummaryText' "${JS_FILE}"; then
    fail "Removed diagnostics and support-summary clipboard flows must not return."
fi
grep -Fq '"schemaVersion" => 5' <<<"${server_bundle}" || fail "Server diagnostics schema version is missing."
grep -Fq 'appdataCleanupPlusSanitizeScanMetrics' <<<"${server_bundle}" || fail "Persisted scan telemetry must use its schema allowlist."
grep -Fq 'appdataCleanupPlusDiagnosticsTroubleshootingSummary($logs)' <<<"${server_bundle}" || fail "Server diagnostics structured health summary is missing."
grep -Fq 'appdataCleanupPlusDiagnosticsSafetySettingsSummary()' <<<"${server_bundle}" || fail "Server diagnostics safety settings must use an allowlisted summary."
grep -Fq 'appdataCleanupPlusDiagnosticsQuarantineRegistrySummary(50)' <<<"${server_bundle}" || fail "Server diagnostics quarantine state must use an allowlisted summary."
grep -Fq 'appdataCleanupPlusDiagnosticsIgnoredCandidatesSummary(50)' <<<"${server_bundle}" || fail "Server diagnostics ignored state must use an allowlisted summary."
grep -Fq 'appdataCleanupPlusDiagnosticsRedactValue($bundle)' <<<"${server_bundle}" || fail "Server diagnostics bundle needs a final recursive privacy scrub."

node "${ROOT_DIR}/tests/diagnostics_privacy_client.js"
grep -Fq 'Partial exports must omit response bodies' "${ROOT_DIR}/tests/maintenance_ui.cjs" || fail "Partial diagnostics privacy coverage is missing."
grep -Fq 'Diagnostics must not prune expired snapshots' "${ROOT_DIR}/tests/behavior_smoke.php" || fail "Read-only snapshot diagnostics coverage is missing."
grep -Fq 'Final export scrub must remove the complete path' "${ROOT_DIR}/tests/diagnostics_privacy_client.js" || fail "Spaced-path export regression coverage must be retained."
grep -Fq 'The complete server bundle must remove private path fragments' "${ROOT_DIR}/tests/behavior_smoke.php" || fail "Server log-bundle path privacy coverage must be retained."

echo "test_diagnostics_privacy: diagnostics exports use schema allowlists, aliases, and final recursive scrubs."
