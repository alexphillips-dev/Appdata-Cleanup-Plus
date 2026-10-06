<?php
// Match ShowPlugins.php's trusted Markdown(file_get_contents($readme)) path.
require_once $argv[1] . '/MarkdownExtra.inc.php';
echo Markdown(file_get_contents($argv[2]));
