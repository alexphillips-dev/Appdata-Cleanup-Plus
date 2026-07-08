<?php

function appdataCleanupPlusFixtureNames() {
  return array(
    "empty" => "acp-test-empty",
    "folder" => "acp-test-folder",
    "template" => "acp-test-template"
  );
}

function appdataCleanupPlusFixtureTemplatePath() {
  return appdataCleanupPlusDockerTemplateDir() . "/appdata-cleanup-plus-fixture.xml";
}

function appdataCleanupPlusFixtureTemplateXml($fixturePath) {
  $name = "AppdataCleanupPlusFixture";
  $target = "/config";
  $hostDir = appdataCleanupPlusCanonicalizePath($fixturePath);

  return "<?xml version='1.0'?>\n" .
    "<Container>\n" .
    "  <Name>" . htmlspecialchars($name, ENT_QUOTES) . "</Name>\n" .
    "  <Config Type=\"Path\" Target=\"" . htmlspecialchars($target, ENT_QUOTES) . "\">" . htmlspecialchars($hostDir, ENT_QUOTES) . "</Config>\n" .
    "</Container>\n";
}

function appdataCleanupPlusResolveFixtureRoot($settings=null) {
  if ( ! is_array($settings) ) {
    $settings = getAppdataCleanupPlusSafetySettings();
  }

  $sourceInfo = buildAppdataCleanupPlusSourceInfo($settings);
  $candidates = array();

  foreach ( array("effective", "detected", "manual") as $key ) {
    if ( isset($sourceInfo[$key]) && is_array($sourceInfo[$key]) ) {
      $candidates = array_merge($candidates, $sourceInfo[$key]);
    }
  }

  foreach ( $candidates as $candidate ) {
    $root = appdataCleanupPlusCanonicalizePath($candidate);
    if ( $root === "" || strpos($root, "/mnt/") !== 0 ) {
      continue;
    }

    if ( in_array($root, array("/mnt", "/mnt/user", "/mnt/cache"), true) ) {
      continue;
    }

    if ( is_dir($root) && ! @is_link($root) ) {
      return $root;
    }
  }

  return "";
}

function appdataCleanupPlusFixtureDefinitions($root) {
  $normalizedRoot = appdataCleanupPlusCanonicalizePath($root);
  $names = appdataCleanupPlusFixtureNames();

  return array(
    array(
      "key" => "empty",
      "name" => $names["empty"],
      "path" => $normalizedRoot . "/" . $names["empty"],
      "type" => "Folder",
      "description" => "Empty folder fixture for verifying empty-folder size and cleanup flow."
    ),
    array(
      "key" => "folder",
      "name" => $names["folder"],
      "path" => $normalizedRoot . "/" . $names["folder"],
      "type" => "Folder",
      "description" => "Small folder fixture for verifying normal discovery cleanup flow."
    ),
    array(
      "key" => "template",
      "name" => $names["template"],
      "path" => $normalizedRoot . "/" . $names["template"],
      "type" => "Template",
      "description" => "Saved-template fixture for verifying template evidence in scan results."
    )
  );
}

function appdataCleanupPlusFixturePathIsSafe($path, $root) {
  $normalizedPath = appdataCleanupPlusCanonicalizePath($path);
  $normalizedRoot = rtrim(appdataCleanupPlusCanonicalizePath($root), "/");
  $names = array_values(appdataCleanupPlusFixtureNames());
  $base = basename($normalizedPath);

  return $normalizedPath !== "" &&
    $normalizedRoot !== "" &&
    strpos($normalizedPath, $normalizedRoot . "/") === 0 &&
    in_array($base, $names, true);
}

function appdataCleanupPlusGetTestFixtureStatus($settings=null) {
  $root = appdataCleanupPlusResolveFixtureRoot($settings);
  $templatePath = appdataCleanupPlusFixtureTemplatePath();
  $fixtures = array();
  $createdCount = 0;

  if ( $root !== "" ) {
    foreach ( appdataCleanupPlusFixtureDefinitions($root) as $fixture ) {
      $exists = is_dir($fixture["path"]);
      if ( $exists ) {
        $createdCount++;
      }

      $fixture["exists"] = $exists;
      $fixtures[] = $fixture;
    }
  }

  return array(
    "root" => $root,
    "fixtures" => $fixtures,
    "createdCount" => $createdCount,
    "templatePath" => $templatePath,
    "templateExists" => is_file($templatePath),
    "zfsNote" => "ZFS dataset fixture creation is intentionally manual. Existing exact ZFS dataset rows are still detected and can be tested from the scan results."
  );
}

function appdataCleanupPlusCreateTestFixtures($settings=null) {
  $root = appdataCleanupPlusResolveFixtureRoot($settings);
  $created = array();
  $errors = array();

  if ( $root === "" ) {
    return array(
      "ok" => false,
      "message" => "No writable appdata source root was available for test fixtures.",
      "status" => appdataCleanupPlusGetTestFixtureStatus($settings)
    );
  }

  foreach ( appdataCleanupPlusFixtureDefinitions($root) as $fixture ) {
    if ( ! appdataCleanupPlusFixturePathIsSafe($fixture["path"], $root) ) {
      $errors[] = $fixture["name"] . ": unsafe fixture path";
      continue;
    }

    if ( ! ensureAppdataCleanupPlusDirectory($fixture["path"]) ) {
      $errors[] = $fixture["name"] . ": folder could not be created";
      continue;
    }

    if ( $fixture["key"] === "folder" ) {
      @file_put_contents($fixture["path"] . "/README.txt", "Appdata Cleanup Plus test fixture. This folder can be safely removed from the Tools modal.\n");
    }

    if ( $fixture["key"] === "template" ) {
      @file_put_contents($fixture["path"] . "/template-fixture.txt", "Saved-template fixture for Appdata Cleanup Plus.\n");
    }

    $created[] = $fixture["name"];
  }

  if ( ! ensureAppdataCleanupPlusDirectory(dirname(appdataCleanupPlusFixtureTemplatePath())) ) {
    $errors[] = "template file: template directory could not be created";
  } else {
    $templateFixturePath = $root . "/" . appdataCleanupPlusFixtureNames()["template"];
    if ( @file_put_contents(appdataCleanupPlusFixtureTemplatePath(), appdataCleanupPlusFixtureTemplateXml($templateFixturePath)) === false ) {
      $errors[] = "template file: could not be written";
    }
  }

  return array(
    "ok" => empty($errors),
    "message" => empty($errors)
      ? "Test fixtures were created. Rescan to see them in the Ready to Clean results."
      : "Some test fixtures could not be created.",
    "created" => $created,
    "errors" => $errors,
    "status" => appdataCleanupPlusGetTestFixtureStatus($settings)
  );
}

function appdataCleanupPlusRemoveTestFixtures($settings=null) {
  $root = appdataCleanupPlusResolveFixtureRoot($settings);
  $removed = array();
  $errors = array();

  if ( $root !== "" ) {
    foreach ( appdataCleanupPlusFixtureDefinitions($root) as $fixture ) {
      if ( ! appdataCleanupPlusFixturePathIsSafe($fixture["path"], $root) ) {
        $errors[] = $fixture["name"] . ": unsafe fixture path";
        continue;
      }

      if ( ! file_exists($fixture["path"]) ) {
        continue;
      }

      $deleteResult = nativeDeleteDirectory($fixture["path"], array("allowSymlinkEntries" => true));
      if ( ! $deleteResult["ok"] ) {
        $errors[] = $fixture["name"] . ": " . $deleteResult["message"];
        continue;
      }

      $removed[] = $fixture["name"];
    }
  }

  $templatePath = appdataCleanupPlusFixtureTemplatePath();
  if ( is_file($templatePath) ) {
    if ( @unlink($templatePath) ) {
      $removed[] = basename($templatePath);
    } else {
      $errors[] = "template file: could not be removed";
    }
  }

  return array(
    "ok" => empty($errors),
    "message" => empty($errors)
      ? "Test fixtures were removed. Rescan to refresh the results."
      : "Some test fixtures could not be removed.",
    "removed" => $removed,
    "errors" => $errors,
    "status" => appdataCleanupPlusGetTestFixtureStatus($settings)
  );
}

