<?php
$checker = dirname(__DIR__) . '/scripts/check_php_functions.php';
$root = sys_get_temp_dir() . '/acp-function-check-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
$cases = array(
  array(0, '<?php function acpExample() {} ACPExample();'),
  array(1, '<?php acpMissing();'),
  array(1, '<?php class Example { function acpMethod() {} } acpMethod();'),
  array(0, '<?php class Example { function acpMethod() {} } $a->acpMethod(); Example::acpMethod();'),
  array(0, '<? function &acpReference() {} acpReference();'),
  array(0, '<?php $a = Thing::class; function appdataCleanupPlusThing() {} appdataCleanupPlusThing();'),
  array(1, '<?php $x = new class((function(){})()) { function acpMethod() {} }; acpMethod();'),
  array(0, '<?php function acpGood() {} /* acpMissing(); */ $text="acpMissing()"; \\acpGood();')
);
try {
  foreach ($cases as $i=>$case) {
    file_put_contents($root . '/case.page', $case[1]);
    $output = array(); $status = 0;
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($checker) . ' ' . escapeshellarg($root) . ' 2>&1', $output, $status);
    if ($status !== $case[0]) throw new RuntimeException('Function checker case ' . $i . ' failed: ' . implode("\n", $output));
  }
  echo "php_function_checker: OK\n";
} finally { unlink($root . '/case.page'); rmdir($root); }
