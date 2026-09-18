<?php
// Wrap an already-built, checksum-verified package in a local test installer.
// pkg_build.sh remains the only version/package/checksum authority.
$root = dirname(__DIR__);
$output = $argv[1] ?? '';
if ($output === '' || !is_dir($output)) throw new RuntimeException('An existing artifact output directory is required.');
$manifest = file_get_contents($root . '/plugins/appdata.cleanup.plus.plg');
preg_match('/<!ENTITY version "([0-9.]+)">/', $manifest, $versionMatch);
preg_match('/<!ENTITY md5 "([a-f0-9]{32})">/', $manifest, $md5Match);
$version = $versionMatch[1] ?? '';
$md5 = $md5Match[1] ?? '';
if (!preg_match('/^\d{4}\.\d{2}\.\d{2}\.\d{2,}$/D', $version) || !$md5) throw new RuntimeException('Invalid package metadata.');
$filename = 'appdata.cleanup.plus-' . $version . '-x86_64-1.txz';
$archive = $root . '/archive/' . $filename;
if (!is_file($archive) || !hash_equals($md5, md5_file($archive))) throw new RuntimeException('Package checksum mismatch.');
$encoded = chunk_split(base64_encode(file_get_contents($archive)), 76, "\n");
$shell = "set -euo pipefail\n";
$shell .= 'test_package_dir="$(mktemp -d)"' . "\n";
$shell .= 'trap \'rm -rf "$test_package_dir"\' EXIT' . "\n";
$shell .= 'base64 --decode > "$test_package_dir/package.txz" <<\'ACP_TEST_ARCHIVE\'' . "\n" . $encoded . "ACP_TEST_ARCHIVE\n";
$shell .= 'printf \'%s  %s\\n\' ' . escapeshellarg($md5) . ' "$test_package_dir/package.txz" | md5sum --check --strict' . "\n";
$shell .= "mkdir -p /boot/config/plugins/appdata.cleanup.plus\n";
$shell .= 'cp "$test_package_dir/package.txz" /boot/config/plugins/appdata.cleanup.plus/' . $filename . "\n";
$shell .= 'upgradepkg --install-new /boot/config/plugins/appdata.cleanup.plus/' . $filename . "\n";
$replacement = '<FILE Run="/bin/bash"><INLINE>' . htmlspecialchars($shell, ENT_NOQUOTES | ENT_XML1, 'UTF-8') . '</INLINE></FILE>';
$pattern = '#<FILE Name="/boot/config/plugins/&name;/&name;-&version;-x86_64-1\.txz" Run="upgradepkg --install-new">.*?</FILE>#s';
$installer = preg_replace_callback($pattern, function() use ($replacement) { return $replacement; }, $manifest, 1, $count);
if ($count !== 1) throw new RuntimeException('Expected exactly one package transport block.');
file_put_contents($output . '/appdata.cleanup.plus.plg', $installer);
echo 'build_pr_artifact: standalone installer for ' . $version . "\n";
