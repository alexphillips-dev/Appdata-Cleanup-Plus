"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "source", "appdata.cleanup.plus", "usr", "local", "emhttp", "plugins", "appdata.cleanup.plus", "scripts", "appdata.cleanup.plus.js");
const source = fs.readFileSync(sourcePath, "utf8");
const startMarker = "  function buildDiagnosticsRedactor()";
const endMarker = "  function sanitizeDiagnosticsRow(";
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
  extend(target, sourceValue) {
    return Object.assign(target || {}, sourceValue || {});
  }
};

const context = { $: jquery };
vm.runInNewContext(
  source.slice(start, end) + "\nthis.privacy = { buildDiagnosticsRedactor, sanitizeDiagnosticsFreeText, diagnosticsKeyLooksLikePath, sanitizeDiagnosticsValue, sanitizeDiagnosticsPath, sanitizeDiagnosticsTemplateRefs };",
  context,
  { filename: sourcePath }
);

const privacy = context.privacy;
const redactor = privacy.buildDiagnosticsRedactor();
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

console.log("diagnostics_privacy_client: executable client redaction checks passed.");
