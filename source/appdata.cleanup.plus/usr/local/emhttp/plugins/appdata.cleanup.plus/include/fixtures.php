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

function appdataCleanupPlusFixtureRootCheck($candidate, $settings) {
  $root = appdataCleanupPlusCanonicalizePath($candidate);
  $check = array("reasonCode" => "unsafe_path", "symlink" => $root !== "" && @is_link($root));
  if ( strpos($root, "/mnt/") !== 0 || appdataCleanupPlusValidateManualAppdataSource($root) !== "" ) return $check;

  // Only the configured root itself may be a link. Never accept linked ancestors.
  for ( $parent = appdataCleanupPlusCanonicalizePath(dirname($root)); $parent !== "" && $parent !== "/" && $parent !== "."; $parent = appdataCleanupPlusCanonicalizePath(dirname($parent)) ) {
    if ( @is_link($parent) ) { $check["reasonCode"] = "unsafe_symlink"; return $check; }
  }
  if ( ! is_dir($root) ) { $check["reasonCode"] = "missing"; return $check; }
  $target = $root;
  if ( $check["symlink"] ) {
    $target = appdataCleanupPlusCanonicalizePath((string)@realpath($root));
    if ( strpos($target, "/mnt/") !== 0 || appdataCleanupPlusValidateManualAppdataSource($target) !== "" ) {
      $check["reasonCode"] = "unsafe_symlink";
      return $check;
    }
  }
  foreach (array($root, $target) as $path) {
    if (in_array(".appdata-cleanup-plus-quarantine", appdataPathSegments($path), true) ||
        (!empty($settings["quarantineRoot"]) && appdataCleanupPlusPathMatchesOrIsDescendantByVariants($settings["quarantineRoot"], $path, true))) return $check;
  }
  $check["reasonCode"] = is_writable($root) ? "ready" : "not_writable";
  if ($check["reasonCode"] === "ready") $check["root"] = $target;
  return $check;
}

function appdataCleanupPlusResolveFixtureRootInfo($settings=null) {
  if ( ! is_array($settings) ) {
    $settings = getAppdataCleanupPlusSafetySettings();
  }

  $info = array("root" => "", "reasonCode" => "no_sources", "checks" => array());
  foreach ( getAppdataCleanupPlusConfiguredSourceRoots($settings) as $candidate ) {
    $check = appdataCleanupPlusFixtureRootCheck($candidate, $settings);
    $info["checks"][] = array("reasonCode" => $check["reasonCode"], "symlink" => $check["symlink"]);
    if (count($info["checks"]) === 1) $info["reasonCode"] = $check["reasonCode"];
    if ($info["root"] === "" && $check["reasonCode"] === "ready") {
      // Operate on the checked backing folder, not on a link that can be retargeted.
      $info["root"] = $check["root"];
    }
  }
  if ($info["root"] !== "") $info["reasonCode"] = "ready";
  return $info;
}

function appdataCleanupPlusResolveFixtureRoot($settings=null) {
  return appdataCleanupPlusResolveFixtureRootInfo($settings)["root"];
}

function appdataCleanupPlusFixtureRootMessage($reasonCode) {
  switch ($reasonCode) {
    case "ready": return "Configured appdata source is available for test fixtures.";
    case "missing": return "The configured appdata source folder is missing or unavailable. Check that its storage is mounted.";
    case "not_writable": return "The configured appdata source is not writable. Check its permissions and storage status.";
    case "unsafe_symlink": return "The appdata source link does not resolve to a safe fixture root. Review Appdata Sources.";
    case "unsafe_path": return "The configured appdata source is protected or is not a dedicated fixture root. Review Appdata Sources.";
    default: return "No appdata source is configured. Review Appdata Sources before creating test fixtures.";
  }
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
    dirname($normalizedPath) === $normalizedRoot &&
    in_array($base, $names, true) &&
    ! @is_link($normalizedPath) &&
    ! pathIsMountPoint($normalizedPath);
}

function appdataCleanupPlusGetTestFixtureStatus($settings=null) {
  $rootInfo = appdataCleanupPlusResolveFixtureRootInfo($settings);
  $root = $rootInfo["root"];
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
    "rootReasonCode" => $rootInfo["reasonCode"],
    "rootMessage" => appdataCleanupPlusFixtureRootMessage($rootInfo["reasonCode"]),
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

    if ( $fixture["key"] !== "empty" ) {
      $file = $fixture["path"] . ($fixture["key"] === "folder" ? "/README.txt" : "/template-fixture.txt");
      if (@is_link($file) || (file_exists($file) && !is_file($file)) || @file_put_contents($file, "Appdata Cleanup Plus test fixture.\n") === false) {
        $errors[] = $fixture["name"] . ": fixture file could not be written safely";
        continue;
      }
    }

    $created[] = $fixture["name"];
  }

  if ( ! in_array(appdataCleanupPlusFixtureNames()["template"], $created, true) ) {
    $errors[] = "template file: fixture folder is unavailable";
  } elseif ( ! ensureAppdataCleanupPlusDirectory(dirname(appdataCleanupPlusFixtureTemplatePath())) ) {
    $errors[] = "template file: template directory could not be created";
  } else {
    $templateFixturePath = $root . "/" . appdataCleanupPlusFixtureNames()["template"];
    if ( @is_link(appdataCleanupPlusFixtureTemplatePath()) || @file_put_contents(appdataCleanupPlusFixtureTemplatePath(), appdataCleanupPlusFixtureTemplateXml($templateFixturePath)) === false ) {
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

  if ($root === "") {
    return array("ok" => false, "message" => "No writable appdata source root was available for test fixtures.", "status" => appdataCleanupPlusGetTestFixtureStatus($settings));
  }

  if ( $root !== "" ) {
    foreach ( appdataCleanupPlusFixtureDefinitions($root) as $fixture ) {
      if ( ! appdataCleanupPlusFixturePathIsSafe($fixture["path"], $root) ) {
        $errors[] = $fixture["name"] . ": unsafe fixture path";
        continue;
      }

      if ( ! file_exists($fixture["path"]) ) {
        continue;
      }

      $deleteResult = nativeDeleteDirectory($fixture["path"], array("allowSymlinkEntries" => true, "useExactPath" => true));
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
