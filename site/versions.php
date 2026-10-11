<?php
$os = isset($_GET['os']) ? $_GET['os'] : 'windows';
if (!in_array($os, ['windows', 'linux', 'macos'], true)) {
    http_response_code(400);
    exit('Invalid OS');
}

$os_dir = __DIR__ . "/$os";
if (!is_dir($os_dir)) {
    http_response_code(404);
    exit('No releases found for ' . $os);
}

$versions = [];
foreach (scandir($os_dir) as $entry) {
    if (preg_match('/^v\d+\.\d+\.\d+$/', $entry) && is_dir("$os_dir/$entry")) {
        $versions[] = $entry;
    }
}

if (empty($versions)) {
    http_response_code(404);
    exit('No releases found for ' . $os);
}

usort($versions, 'version_compare');
$latest = end($versions);

$exe  = $os === 'windows' ? 'maptogether-companion.exe' : 'maptogether-companion';
$base = 'https://qmtg.rhythmgamers.net/releases';
header("Location: $base/$os/$latest/$exe", true, 302);
