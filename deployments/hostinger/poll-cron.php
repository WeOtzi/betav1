<?php
// hPanel must invoke this file with PHP CLI, never with an HTTP cron URL.
// Example: php /private/path/poll-cron.php --config /private/control/deploy-config.json
// Install a reviewed copy privately; branches cannot replace the controller.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    header('Cache-Control: no-store');
    exit(1);
}
umask(0077);

function weotziCronFail(string $message): void
{
    // Failure text contains no config contents, environment values or secrets.
    fwrite(STDERR, '[WeOtzi cron] ' . $message . PHP_EOL);
    exit(1);
}

function weotziCronAbsolutePath(string $value): bool
{
    return $value !== '' && $value[0] === '/' && !preg_match('/[\x00-\x20\x7f]/', $value)
        && strpos($value, '/public_html/') === false && !str_ends_with($value, '/public_html');
}

$home = getenv('HOME') ?: '/home/u795331143';
$configPath = getenv('WEOTZI_DEPLOY_CONFIG') ?: rtrim($home, '/') . '/weotzi-deploy/control/deploy-config.json';
if ($argc > 1) {
    if ($argc !== 3 || $argv[1] !== '--config') weotziCronFail('Use --config with one private absolute JSON path.');
    $configPath = $argv[2];
}
if (!weotziCronAbsolutePath($configPath) || !is_file($configPath) || !is_readable($configPath) || @filesize($configPath) > 32768) {
    weotziCronFail('Private deployment configuration is unavailable.');
}
$configBytes = @file_get_contents($configPath);
$config = $configBytes !== false ? json_decode($configBytes, true) : null;
if (!is_array($config) || !is_string($config['stateRoot'] ?? null) || !is_string($config['node'] ?? null)) {
    weotziCronFail('Private deployment configuration is invalid.');
}
$stateRoot = realpath($config['stateRoot']);
$configRealPath = realpath($configPath);
if (!$stateRoot || !weotziCronAbsolutePath($stateRoot) || $stateRoot === '/'
    || !$configRealPath || dirname($configRealPath) !== $stateRoot . '/control') {
    weotziCronFail('Configuration must belong to the private deployment control directory.');
}
$node = $config['node'];
$controller = $stateRoot . '/control/poll.cjs';
if ($node === '' || $node[0] !== '/' || preg_match('/[\x00-\x20\x7f]/', $node) || !is_file($node) || !is_executable($node)
    || !is_file($controller) || is_link($controller)) {
    weotziCronFail('Trusted Node binary or poll controller is unavailable.');
}
$pm2Home = $config['pm2Home'] ?? $stateRoot . '/pm2';
if (!is_string($pm2Home) || !weotziCronAbsolutePath($pm2Home)
    || !str_starts_with($pm2Home, $stateRoot . '/') || preg_match('#/(?:\.|\.\.)(?:/|$)#', $pm2Home)) {
    weotziCronFail('PM2_HOME must stay inside private deployment state.');
}
$logDirectory = $stateRoot . '/logs';
if (is_link($logDirectory) || (!is_dir($logDirectory) && !mkdir($logDirectory, 0700, true))) {
    weotziCronFail('Private log directory is unavailable.');
}
if (!chmod($logDirectory, 0700)) weotziCronFail('Could not protect the log directory.');
$lockFile = $logDirectory . '/cron-wrapper.lock';
if (is_link($lockFile)) weotziCronFail('Invalid cron lock file.');
$lock = fopen($lockFile, 'c');
if (!$lock) weotziCronFail('Cron lock is unavailable.');
if (!chmod($lockFile, 0600)) { fclose($lock); weotziCronFail('Could not protect the cron lock.'); }
if (!flock($lock, LOCK_EX | LOCK_NB)) { fclose($lock); exit(0); }
try {
    $log = $logDirectory . '/cron-wrapper.log';
    if (is_link($log) || is_link($log . '.previous')) weotziCronFail('Invalid cron log file.');
    if (is_file($log) && filesize($log) > 131072 && !rename($log, $log . '.previous')) {
        weotziCronFail('Cron log rotation failed.');
    }
    if (is_file($log) && !chmod($log, 0600)) weotziCronFail('Could not protect the cron log.');
    if (is_file($log . '.previous') && !chmod($log . '.previous', 0600)) weotziCronFail('Could not protect the previous cron log.');
    // The array command bypasses shell parsing. No shell fragments, branch
    // command or request data can choose what is executed.
    $process = proc_open(
        [$node, $controller, '--config', $configRealPath],
        [0 => ['file', '/dev/null', 'r'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']],
        $pipes,
        $stateRoot . '/control',
        [
            'HOME' => dirname($stateRoot),
            'PATH' => dirname($node) . ':/usr/bin:/bin',
            'PM2_HOME' => $pm2Home,
            'NODE_ENV' => 'production',
            'GIT_TERMINAL_PROMPT' => '0',
        ],
        ['bypass_shell' => true]
    );
    if (!is_resource($process)) weotziCronFail('Could not start the trusted poller.');
    $exitCode = proc_close($process);
} finally {
    flock($lock, LOCK_UN);
    fclose($lock);
}
exit($exitCode < 0 ? 1 : $exitCode);
