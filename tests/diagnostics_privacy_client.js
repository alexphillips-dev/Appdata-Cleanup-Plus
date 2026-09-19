"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "source", "appdata.cleanup.plus", "usr", "local", "emhttp", "plugins", "appdata.cleanup.plus", "scripts", "appdata.cleanup.plus.js");
const source = fs.readFileSync(sourcePath, "utf8");
const startMarker = "  function buildDiagnosticsRedactor()";
const endMarker = "  function sanitizeDiagnosticsAuditHistory(";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

assert.notStrictEqual(start, -1, "diagnostics redactor functions should exist");
assert.notStrictEqual(end, -1, "diagnostics redactor extraction boundary should exist");

const jquery = {
  trim(value) {
    return String(value === null || value === undefined ? "" : value).trim();
  },
  each(collection, callback) {
    if (Array.isArray(collection)) {
      collection.forEach((value, index) => callback(index, value));
      return collection;
    }
    Object.keys(collection || {}).forEach((key) => callback(key, collection[key]));
    return collection;
  },
  isArray: Array.isArray,
  isPlainObject(value) {
    return !!value && Object.getPrototypeOf(value) === Object.prototype;
  },
  map(collection, callback) {
    return (Array.isArray(collection) ? collection : []).map((value, index) => callback(value, index));
  },
  extend(target, sourceValue, deepSource) {
    if (target === true) return JSON.parse(JSON.stringify(deepSource || {}));
    return Object.assign(target || {}, sourceValue || {});
  }
};

const context = { $: jquery };
vm.runInNewContext(
  source.slice(start, end) + "\nthis.privacy = { buildDiagnosticsRedactor, sanitizeDiagnosticsFreeText, diagnosticsKeyLooksLikePath, sanitizeDiagnosticsValue, sanitizeDiagnosticsPath, sanitizeDiagnosticsTemplateRefs, sanitizeDiagnosticsRow, sanitizeDiagnosticsScanMetrics };",
  context,
  { filename: sourcePath }
);

const privacy = context.privacy;
const redactor = privacy.buildDiagnosticsRedactor();
for (const message of [
  "rename(/mnt/user/appdata/My Private App,/mnt/user/appdata/.quarantine/My Private App): Permission denied",
  "cannot open '/mnt/user/appdata/Private, Financial Records': Permission denied",
  'cannot open "/mnt/user/appdata/Private (Financial) Records": Permission denied'
]) {
  const result = privacy.sanitizeDiagnosticsValue({logs:[{lines:[message]}]}, privacy.buildDiagnosticsRedactor(), "");
  assert.ok(!JSON.stringify(result).includes("Private"), "Final export scrub must remove the complete path, not only its first word");
  assert.ok(!JSON.stringify(result).includes("Records"), "Quoted path punctuation must not leave a private suffix");
  assert.ok(JSON.stringify(result).includes("Permission denied"), "Diagnostic failure context should remain useful");
}
const target = privacy.sanitizeDiagnosticsPath("/data/TaxRecords/customer-a", redactor);

assert.ok(target.startsWith("/data/"), "container target root should remain useful");
assert.ok(!target.includes("TaxRecords"), "container target details should be aliased");
assert.ok(!target.includes("customer-a"), "all private container target segments should be aliased");
assert.strictEqual(privacy.diagnosticsKeyLooksLikePath("target"), true, "target keys should be treated as paths");

const refs = privacy.sanitizeDiagnosticsTemplateRefs([{ name: "PrivateApp", file: "private.xml", target: "/private-target/customer-a" }], redactor);
const refsJson = JSON.stringify(refs);
assert.ok(!refsJson.includes("PrivateApp"), "template app names should be aliased");
assert.ok(!refsJson.includes("private.xml"), "template filenames should be aliased");
assert.ok(!refsJson.includes("private-target"), "template target paths should be aliased");
assert.ok(!refsJson.includes("customer-a"), "template target path segments should be aliased");

const url = privacy.sanitizeDiagnosticsFreeText("request https://[2001:db8::1234]:8443/private?q=1", redactor);
assert.ok(url.includes("https://<host>/private?q=1"), "bracketed IPv6 URL authorities should be replaced as a unit");
assert.ok(!url.includes("2001:db8::1234"), "bracketed IPv6 addresses should not remain in URLs");

const scrubbed = privacy.sanitizeDiagnosticsValue({ target: "/data/TaxRecords/customer-a" }, privacy.buildDiagnosticsRedactor(), "");
assert.ok(!JSON.stringify(scrubbed).includes("TaxRecords"), "recursive target fields should be path-sanitized");

const privateMountRow = {name:'PrivateApp',path:'/mnt/user/appdata/PrivateApp',mountEvidence:[{name:'PrivateContainer',paths:['/mnt/user/customer-records'],futureSecret:'private-canary'}],broadMountEvidence:[{name:'PrivateContainer',paths:['/mnt/user'],raw:'private-canary'}]};
const mountRedactor = privacy.buildDiagnosticsRedactor();
const privateMountExport = privacy.sanitizeDiagnosticsValue(privacy.sanitizeDiagnosticsRow(privateMountRow, mountRedactor), mountRedactor, '');
assert.equal(privateMountExport.mountEvidence.length,1,'Diagnostics must retain specific mount evidence');
assert.equal(privateMountExport.broadMountEvidence.length,1,'Diagnostics must distinguish broad access');
assert.equal(privateMountExport.mountEvidence[0].name,privateMountExport.broadMountEvidence[0].name,'Export-scoped aliases must correlate the same container');
assert.ok(!/PrivateContainer|customer-records|private-canary|PrivateApp/.test(JSON.stringify(privateMountExport)),'Names, private paths and unknown fields must not be exported');
assert.deepEqual(Object.keys(privateMountExport.mountEvidence[0]).sort(),['name','paths']);
assert.equal(privateMountRow.mountEvidence.length, 1, 'Export must not mutate UI evidence');
const collisionRedactor = privacy.buildDiagnosticsRedactor();
collisionRedactor.replacements = [{raw:'data',sanitized:'<app-1>'},{raw:'path',sanitized:'<app-2>'},{raw:'appdata',sanitized:'<app-3>'}];
const collision = privacy.sanitizeDiagnosticsValue({datasetName:'private data', appdataSources:{count:1}, '/mnt/user/private-data':{name:'data'}}, collisionRedactor, '');
assert.ok(Object.hasOwn(collision,'datasetName') && Object.hasOwn(collision,'appdataSources'), 'Private words must not corrupt fixed schema field names');
assert.ok(!JSON.stringify(collision).includes('/mnt/user/private-data'), 'Path-based keys must still be sanitized');
assert.ok(!collision.datasetName.includes('private data'), 'Schema-key preservation must not preserve private values');
assert.equal(privacy.sanitizeDiagnosticsFreeText('A dataset contains data. <path-1>',collisionRedactor),'A dataset contains <app-1>. <path-1>','Whole-word redaction must preserve prose and existing aliases');
const telemetry = privacy.sanitizeDiagnosticsScanMetrics({startedAt:'2026-09-18T12:00:00-04:00',phases:[{name:'docker_query',containerCount:53,raw:'private-canary'},{name:'private-canary',durationMs:5}],dockerInventory:{reasonCode:'incomplete_inventory',acceptedCount:53,issues:{invalid_mounts:1,'private-canary':1},raw:'private-canary'}});
assert.equal(telemetry.dockerInventory.reasonCode,'incomplete_inventory');
assert.equal(telemetry.dockerInventory.acceptedCount,53);
assert.equal(telemetry.dockerInventory.issues.invalid_mounts,1);
assert.equal(telemetry.phases.length,1);
assert.ok(!JSON.stringify(telemetry).includes('private-canary'),'Browser telemetry must drop unknown fields, phase names and issue codes');
collisionRedactor.replacements.push({raw:'incomplete_inventory',sanitized:'<app-4>'});
assert.equal(privacy.sanitizeDiagnosticsValue({dockerInventory:telemetry.dockerInventory},collisionRedactor,'').dockerInventory.reasonCode,'incomplete_inventory','Allowlisted support codes must remain stable');
console.log("diagnostics_privacy_client: executable client redaction checks passed.");
