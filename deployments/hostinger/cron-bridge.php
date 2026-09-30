<?php
// Compatibility bridge for the existing hPanel PHP CLI schedule.
// Install as beta/auto_monitor.php only when that schedule already points there.
// All deployment logic and configuration stay outside public_html.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}
$operatorHome = getenv('HOME') ?: '/home/u795331143';
$pollWrapper = rtrim($operatorHome, '/') . '/weotzi-deploy/control/poll-cron.php';
if (!is_file($pollWrapper) || is_link($pollWrapper)) {
    fwrite(STDERR, '[WeOtzi cron] Private wrapper is unavailable.' . PHP_EOL);
    exit(1);
}
require $pollWrapper;
