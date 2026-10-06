<?php

// Backups contain private container configuration. They stay on flash, outside
// the served plugin tree. Only an explicitly requested private backup export
// contains configuration bytes; status and diagnostics never contain them.
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
  if ( $operation === "export" ) {
    $archive = appdataCleanupPlusExportTemplateBackups(parseCandidateIds(getPostedString("backupIds")));
    if ( $archive === null ) jsonResponse(array("ok" => false, "message" => "Backup export exceeds the supported limits or contains an invalid record."), 409);
    jsonResponse(array("ok" => true, "backupArchive" => $archive));
  }
  if ( $operation === "import" ) {
    $result = appdataCleanupPlusImportTemplateBackups(getPostedString("backupJson"));
  } elseif ( $operation === "remove-backups" ) {
    if ( getPostedString("backupRemovalConfirmed") !== "yes" ) jsonResponse(array("ok" => false, "message" => "Backup removal requires explicit confirmation."), 400);
    $result = appdataCleanupPlusRemoveTemplateBackups(parseCandidateIds(getPostedString("backupIds")));
  } else {
    $result = appdataCleanupPlusTemplateManagerAction($operation, getPostedString("templateId"));
  }
  $result["templateManager"] = appdataCleanupPlusTemplateManagerPayload();
  jsonResponse($result, $result["ok"] ? 200 : 409);
}

function appdataCleanupPlusExportTemplateBackups($ids=array()) {
  foreach ( $ids as $id ) if ( ! appdataCleanupPlusTemplateBackup($id) ) return null;
  $files = $ids ? array_map(function($id) { return appdataCleanupPlusTemplateBackupDir() . "/" . $id . ".json"; }, $ids) : (array)glob(appdataCleanupPlusTemplateBackupDir() . "/*.json");
  if ( count($files) > 50 ) return null;
  $records = array();
  foreach ( $files as $file ) {
    $id = basename($file, ".json");
    if ( $ids && ! in_array($id, $ids, true) ) return null;
    $record = appdataCleanupPlusTemplateBackup($id);
    if ( ! $record ) return null;
    $records[] = array_intersect_key($record, array_flip(array("filename", "contents", "sha256", "archivedAt")));
  }
  $archive = array("format" => "appdata-cleanup-plus-template-backups", "schemaVersion" => 1, "backups" => $records);
  $archive["sha256"] = hash("sha256", appdataCleanupPlusJsonEncode($records));
  return strlen(appdataCleanupPlusJsonEncode($archive)) <= 16777216 ? $archive : null;
}

function appdataCleanupPlusValidateImportedTemplateBackup($record) {
  if ( ! is_array($record) ) return null;
  $filename = $record["filename"] ?? null;
  $contents = $record["contents"] ?? null;
  $checksum = $record["sha256"] ?? null;
  $date = $record["archivedAt"] ?? null;
  if ( ! is_string($filename) || $filename === "" || strlen($filename) > 255 || basename($filename) !== $filename || preg_match('/[\\\\\/:\x00-\x1f\x7f]/', $filename) || substr($filename, -4) !== ".xml" ) return null;
  if ( ! is_string($contents) || strlen($contents) > 2097152 || ! is_string($checksum) || ! hash_equals(hash("sha256", $contents), $checksum) ) return null;
  if ( strpos($contents, "\0") !== false || preg_match('//u', $contents) !== 1 ) return null;
  if ( ! is_string($date) || strlen($date) > 64 || strtotime($date) === false || preg_match('/<!DOCTYPE|<!ENTITY/i', $contents) ) return null;
  $xml = @simplexml_load_string($contents, "SimpleXMLElement", LIBXML_NONET | LIBXML_NOCDATA);
  if ( ! $xml || $xml->getName() !== "Container" || trim((string)$xml->Name) === "" ) return null;
  return array("schemaVersion" => 1, "id" => bin2hex(random_bytes(16)), "name" => trim((string)$xml->Name), "filename" => $filename, "contents" => $contents, "sha256" => $checksum, "archivedAt" => $date);
}

function appdataCleanupPlusImportTemplateBackups($json) {
  $failure = array("ok" => false, "message" => "Backup import was refused. Check the file format, integrity, and size limits.");
  if ( ! is_string($json) || strlen($json) > 16777216 ) return $failure;
  $archive = json_decode($json, true);
  if ( ! is_array($archive) || ($archive["format"] ?? "") !== "appdata-cleanup-plus-template-backups" || ($archive["schemaVersion"] ?? 0) !== 1 || ! is_array($archive["backups"] ?? null) || ! array_is_list($archive["backups"]) || count($archive["backups"]) > 50 ) return $failure;
  $checksum = $archive["sha256"] ?? null;
  if ( ! is_string($checksum) || ! hash_equals(hash("sha256", appdataCleanupPlusJsonEncode($archive["backups"])), $checksum) ) return $failure;
  // Validate the whole archive before writing. Imported IDs and extra fields
  // are never trusted. Import stores backups; it cannot install a template.
  $records = array();
  foreach ( $archive["backups"] as $record ) {
    $validated = appdataCleanupPlusValidateImportedTemplateBackup($record);
    if ( ! $validated ) return $failure;
    $records[] = $validated;
  }
  $dir = appdataCleanupPlusTemplateBackupDir();
  if ( is_link($dir) || pathHasSymlinkSegment($dir) || ! ensureAppdataCleanupPlusDirectory($dir) ) return $failure;
  @chmod($dir, 0700);
  $existing = array();
  foreach ( (array)glob($dir . "/*.json") as $file ) {
    $record = appdataCleanupPlusTemplateBackup(basename($file, ".json"));
    if ( $record ) $existing[$record["filename"] . "\0" . $record["sha256"]] = true;
  }
  $imported = 0;
  foreach ( $records as $record ) {
    $key = $record["filename"] . "\0" . $record["sha256"];
    if ( isset($existing[$key]) ) continue;
    $file = $dir . "/" . $record["id"] . ".json";
    if ( file_exists($file) || is_link($file) || ! writeAppdataCleanupPlusJsonFile($file, $record) || ! appdataCleanupPlusTemplateBackup($record["id"]) ) {
      return array("ok" => false, "message" => "Backup import stopped because storage could not be written. Valid backups already imported have been retained.");
    }
    @chmod($file, 0600);
    @chmod($dir, 0700);
    $existing[$key] = true;
    $imported++;
  }
  appendAppdataCleanupPlusAuditEntry(array("timestamp" => date("c"), "operation" => "template_import", "requestedCount" => count($records), "message" => "Template backup import finished.", "summary" => array("imported" => $imported), "results" => array()));
  return array("ok" => true, "message" => "Template backup import finished. Restore a backup separately to recover its saved template.");
}

function appdataCleanupPlusRemoveTemplateBackups($ids) {
  $failure = array("ok" => false, "message" => "Backup removal was refused. Refresh the list before continuing.");
  if ( ! $ids || count($ids) > 50 ) return $failure;
  foreach ( $ids as $id ) if ( ! appdataCleanupPlusTemplateBackup($id) ) return $failure;
  $removed = 0;
  foreach ( $ids as $id ) {
    $file = appdataCleanupPlusTemplateBackupDir() . "/" . $id . ".json";
    if ( ! @unlink($file) ) break;
    $removed++;
  }
  appendAppdataCleanupPlusAuditEntry(array("timestamp" => date("c"), "operation" => "template_remove_backups", "requestedCount" => count($ids), "message" => "Template backup removal finished.", "summary" => array("removed" => $removed, "errors" => count($ids) - $removed), "results" => array()));
  return array("ok" => $removed === count($ids), "message" => $removed === count($ids) ? "The selected template backups were removed. Saved templates and appdata were not changed." : "Some template backups could not be removed. Refresh the list before continuing.");
}
