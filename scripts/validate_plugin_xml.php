<?php

if (PHP_SAPI !== "cli") {
    fwrite(STDERR, "ERROR: Plugin manifest validation must run from the command line.\n");
    exit(1);
}

$manifestPath = isset($argv[1]) ? (string)$argv[1] : "";
if ($manifestPath === "" || ! is_file($manifestPath)) {
    fwrite(STDERR, "ERROR: Plugin manifest path is missing or unreadable.\n");
    exit(1);
}

$previousInternalErrors = libxml_use_internal_errors(true);
libxml_clear_errors();

$document = new DOMDocument();
$loaded = $document->load($manifestPath, LIBXML_NONET);
$errors = libxml_get_errors();

libxml_clear_errors();
libxml_use_internal_errors($previousInternalErrors);

if (! $loaded || ! $document->documentElement || $document->documentElement->nodeName !== "PLUGIN") {
    fwrite(STDERR, "ERROR: Plugin manifest is not valid XML: {$manifestPath}\n");
    foreach ($errors as $error) {
        $message = trim((string)$error->message);
        fwrite(STDERR, "  line {$error->line}, column {$error->column}: {$message}\n");
    }
    exit(1);
}

fwrite(STDOUT, "validate_plugin_xml: plugin manifest is valid XML.\n");
