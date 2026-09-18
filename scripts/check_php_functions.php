<?php
// Check direct calls to plugin-owned functions without executing plugin code.
// PHP lint cannot detect a renamed helper whose callers still use its old name.
$root = $argv[1] ?? dirname(__DIR__) . '/source';
$definitions = $calls = array();
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root)) as $file) {
  if (!$file->isFile() || !preg_match('/\.(php|page)$/', $file->getFilename())) continue;
  $source = preg_replace('/<\?(?!php|=|xml)/i', '<?php ', file_get_contents($file->getPathname()));
  $tokens = array_values(array_filter(token_get_all($source), function($token) {
    return !is_array($token) || !in_array($token[0], array(T_WHITESPACE, T_COMMENT, T_DOC_COMMENT), true);
  }));
  $depth = 0; $classDepths = array(); $pendingClass = false; $parens = 0;
  foreach ($tokens as $index=>$token) {
    $previous = $tokens[$index-1] ?? null;
    if (is_array($token) && in_array($token[0], array(T_CLASS, T_INTERFACE, T_TRAIT, T_ENUM), true) && !(is_array($previous) && $previous[0] === T_DOUBLE_COLON)) $pendingClass = true;
    if ($pendingClass && $token === '(') $parens++;
    if ($pendingClass && $token === ')') $parens--;
    if ($token === '{' || (is_array($token) && in_array($token[0], array(T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES), true))) {
      $depth++;
      if ($pendingClass && !$parens) { $classDepths[$depth] = true; $pendingClass = false; }
    }
    if ($token === '}') { unset($classDepths[$depth]); $depth--; }
    if (!is_array($token) || !in_array($token[0], array(T_STRING, T_NAME_FULLY_QUALIFIED), true)) continue;
    $name = strtolower(ltrim($token[1], '\\'));
    if (!preg_match('/^(?:appdatacleanupplus|acp)[a-z0-9_]*$/', $name)) continue;
    $before = $previous;
    if ((is_array($before) ? $before[1] : $before) === '&') $before = $tokens[$index-2] ?? null;
    if (is_array($before) && $before[0] === T_FUNCTION) {
      if (!$classDepths) $definitions[$name] = true;
      continue;
    }
    if (is_array($previous) && in_array($previous[0], array(T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON, T_NEW), true)) continue;
    if (($tokens[$index+1] ?? null) === '(') $calls[$name] = $file->getPathname() . ':' . $token[2];
  }
}
$missing = array_diff_key($calls, $definitions);
foreach ($missing as $name=>$location) fwrite(STDERR, $location . ': undefined plugin function ' . $name . "\n");
if ($missing) exit(1);
echo 'check_php_functions: ' . count($definitions) . ' definitions; all direct plugin calls resolve.' . PHP_EOL;
