<?php

// Backups contain private container configuration. They stay on flash, outside
// the served plugin tree, and are never included in diagnostics or UI payloads.
function appdataCleanupPlusTemplateBackupDir() {
  return appdataCleanupPlusStateFile("template-backups");
}

function appdataCleanupPlusTemplateRead($path) {
  if ( preg_match('/[\x00-\x1f\x7f]/', basename($path)) ) return null;
  if ( is_link($path) || pathHasSymlinkSegment($path) || ! is_file($path) || ! is_readable($path) || filesize($path) > 2097152 ) return null;
  $contents = @file_get_contents($path);
  if ( ! is_string($contents) || strlen($contents) > 2097152 || preg_match('/<!DOCTYPE|<!ENTITY/i', $contents) ) return null;
  $xml = @simplexml_load_string($contents, "SimpleXMLElement", LIBXML_NONET | LIBXML_NOCDATA);
  if ( ! $xml || $xml->getName() !== "Container" || trim((string)$xml->Name) === "" ) return null;
  return array("name" => trim((string)$xml->Name), "filename" => basename($path), "contents" => $contents, "sha256" => hash("sha256", $contents));
}

function appdataCleanupPlusStaleTemplates($inventory) {
  if ( empty($inventory["ok"]) ) return array();
  $names = array();
  foreach ( $inventory["containers"] as $container ) $names[strtolower($container["Name"])] = true;
  $rows = array();
  foreach ( (array)glob(appdataCleanupPlusDockerTemplateDir() . "/*.xml") as $path ) {
    $template = appdataCleanupPlusTemplateRead($path);
    if ( ! $template || isset($names[strtolower($template["name"])]) ) continue;
    $template["id"] = hash("sha256", basename($path) . "\0" . $template["sha256"]);
    $template["path"] = $path;
    $rows[] = $template;
  }
  return $rows;
}

function appdataCleanupPlusTemplateBackup($id) {
  if ( ! preg_match('/^[a-f0-9]{32}$/D', (string)$id) ) return null;
  $path = appdataCleanupPlusTemplateBackupDir() . "/" . $id . ".json";
  if ( is_link($path) || pathHasSymlinkSegment($path) || ! is_file($path) || filesize($path) > 12582912 ) return null;
  $record = readAppdataCleanupPlusJsonFile($path, array());
  if ( ($record["schemaVersion"] ?? 0) !== 1 || ($record["id"] ?? "") !== $id ) return null;
  $filename = (string)($record["filename"] ?? "");
  $contents = $record["contents"] ?? null;
  if ( $filename === "" || basename($filename) !== $filename || preg_match('/[\\\\\/\x00-\x1f\x7f]/', $filename) || substr($filename, -4) !== ".xml" ) return null;
  if ( ! is_string($contents) || strlen($contents) > 2097152 || ! hash_equals((string)($record["sha256"] ?? ""), hash("sha256", $contents)) ) return null;
  return $record;
}

function appdataCleanupPlusTemplateManagerPayload() {
  $inventory = appdataCleanupPlusDockerInventory();
  $active = array();
  foreach ( appdataCleanupPlusStaleTemplates($inventory) as $template ) {
    $active[] = array("id" => $template["id"], "name" => $template["name"], "filename" => $template["filename"]);
  }
  $backups = array();
  foreach ( (array)glob(appdataCleanupPlusTemplateBackupDir() . "/*.json") as $path ) {
    $record = appdataCleanupPlusTemplateBackup(basename($path, ".json"));
    if ( ! $record ) continue;
    $target = appdataCleanupPlusDockerTemplateDir() . "/" . $record["filename"];
    $backups[] = array("id" => $record["id"], "name" => (string)$record["name"], "filename" => $record["filename"], "archivedAt" => (string)$record["archivedAt"], "canRestore" => ! file_exists($target) && ! is_link($target));
    $last = count($backups) - 1;
    $backups[$last]["timestamp"] = (string)$record["archivedAt"];
    $backups[$last]["timestampLabel"] = formatDateTimeLabel(strtotime($record["archivedAt"]));
  }
  return array("available" => $inventory["ok"], "message" => $inventory["message"], "templates" => $active, "backups" => $backups);
}

function appdataCleanupPlusTemplateManagerAction($operation, $id) {
  $failure = array("ok" => false, "message" => "The template action could not be completed. Refresh the list and try again.");
  if ( ! in_array($operation, array("archive", "restore"), true) ) return $failure;
  $dir = appdataCleanupPlusDockerTemplateDir();
  if ( ! is_dir($dir) || is_link($dir) || pathHasSymlinkSegment($dir) ) return $failure;
  if ( $operation === "archive" ) {
    // Re-read the inventory and contents after confirmation, under the shared
    // cleanup lock. An ID from an older revision cannot remove a changed file.
    $inventory = appdataCleanupPlusDockerInventory();
    if ( ! $inventory["ok"] ) return array("ok" => false, "message" => $inventory["message"]);
    $template = null;
    foreach ( appdataCleanupPlusStaleTemplates($inventory) as $candidate ) {
      if ( hash_equals($candidate["id"], (string)$id) ) { $template = $candidate; break; }
    }
    if ( ! $template ) return array("ok" => false, "message" => "This template changed or its container is installed. Refresh the list before continuing.");
    $backupDir = appdataCleanupPlusTemplateBackupDir();
    if ( ! ensureAppdataCleanupPlusDirectory($backupDir) || is_link($backupDir) || pathHasSymlinkSegment($backupDir) ) return $failure;
    @chmod($backupDir, 0700);
    $backupId = bin2hex(random_bytes(16));
    $record = array("schemaVersion" => 1, "id" => $backupId, "name" => $template["name"], "filename" => $template["filename"], "contents" => $template["contents"], "sha256" => $template["sha256"], "archivedAt" => date("c"));
    $backupFile = $backupDir . "/" . $backupId . ".json";
    if ( ! writeAppdataCleanupPlusJsonFile($backupFile, $record) || ! appdataCleanupPlusTemplateBackup($backupId) ) return $failure;
    @chmod($backupFile, 0600);
    // The backup survives a failed removal and is never pruned automatically.
    $current = appdataCleanupPlusTemplateRead($template["path"]);
    if ( ! $current || ! hash_equals($current["sha256"], $record["sha256"]) || ! @unlink($template["path"]) ) return $failure;
    $message = "The saved template was archived. Its backup is available for restore. Appdata, images, and containers were not changed.";
    $resultPath = $template["path"];
  } else {
    $record = appdataCleanupPlusTemplateBackup($id);
    if ( ! $record ) return $failure;
    $target = $dir . "/" . $record["filename"];
    // Exclusive creation works on Unraid's flash filesystem and never replaces
    // an existing file or symlink. The verified backup remains after restore.
    $handle = @fopen($target, "xb");
    if ( ! $handle ) return array("ok" => false, "message" => "Restore was refused because the template already exists or its destination is not writable.");
    $bytes = $record["contents"];
    $written = 0;
    while ( $written < strlen($bytes) ) {
      $n = @fwrite($handle, substr($bytes, $written));
      if ( ! $n ) break;
      $written += $n;
    }
    $complete = $written === strlen($bytes) && @fflush($handle);
    if ( $complete && function_exists("fsync") ) $complete = @fsync($handle);
    @fclose($handle);
    if ( ! $complete ) {
      @unlink($target); // only the file created exclusively by this operation
      return $failure;
    }
    $restored = appdataCleanupPlusTemplateRead($target);
    if ( ! $restored || ! hash_equals($record["sha256"], $restored["sha256"]) ) return $failure;
    $message = "The saved template was restored. The backup has been retained.";
    $resultPath = $target;
  }
  appendAppdataCleanupPlusAuditEntry(array("timestamp" => date("c"), "operation" => "template_" . $operation, "requestedCount" => 1, "summary" => array("restored" => $operation === "restore" ? 1 : 0, "quarantined" => $operation === "archive" ? 1 : 0, "errors" => 0), "results" => array(array("path" => $resultPath, "status" => $operation === "restore" ? "restored" : "quarantined", "message" => $message))));
  return array("ok" => true, "message" => $message);
}

function handleTemplateManagerAction() {
  $operation = getPostedString("managerAction");
  if ( $operation === "status" ) jsonResponse(array("ok" => true, "templateManager" => appdataCleanupPlusTemplateManagerPayload()));
  $result = appdataCleanupPlusTemplateManagerAction($operation, getPostedString("templateId"));
  $result["templateManager"] = appdataCleanupPlusTemplateManagerPayload();
  jsonResponse($result, $result["ok"] ? 200 : 409);
}
