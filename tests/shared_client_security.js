"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const sharedScriptPath = path.join(
  repoRoot,
  "source",
  "appdata.cleanup.plus",
  "usr",
  "local",
  "emhttp",
  "plugins",
  "appdata.cleanup.plus",
  "scripts",
  "appdata.cleanup.plus.shared.js"
);
const window = {};
const context = {
  window,
  document: {},
  jQuery: {
    extend(target, source) {
      return Object.assign(target, source);
    }
  }
};

vm.runInNewContext(fs.readFileSync(sharedScriptPath, "utf8"), context, {
  filename: sharedScriptPath
});

const extractErrorMessage = window.AppdataCleanupPlus.extractErrorMessage;

assert.equal(
  extractErrorMessage({ responseText: "Temporary backend failure", status: 503 }, "Request failed"),
  "Temporary backend failure",
  "plain-text upstream errors should remain useful"
);
assert.equal(
  extractErrorMessage({ responseText: "<script>alert(1)</script >Private detail", status: 500 }, "Request failed"),
  "Request failed (HTTP 500)",
  "malformed script end tags must fall back to a generic error"
);
assert.equal(
  extractErrorMessage({ responseText: "<html><body>Gateway failure</body></html>", status: 502 }, "Request failed"),
  "Request failed (HTTP 502)",
  "HTML error documents must not be rendered into a modal"
);

console.log("shared_client_security: HTML error responses use generic messages.");
