<?php
/**
 * WE ÖTZI - Auto Monitor & Restoration
 * This script checks if the Node.js server is alive and restarts it if not.
 * Recommended to run via Cron Job every 1-5 minutes.
 */

// Paths
$NODE_PATH = '/opt/alt/alt-nodejs22/root/usr/bin/node';
$APP_DIR = '/home/u795331143/domains/weotzi.com/public_html/beta';
$PM2_PATH = $APP_DIR . '/node_modules/.bin/pm2';
$PM2_HOME = '/home/u795331143/.pm2';
$PORT = 4545;

header('Content-Type: text/plain');

function isServerAlive($port) {
    $connection = @fsockopen('127.0.0.1', $port, $errno, $errstr, 1);
    if (is_resource($connection)) {
        fclose($connection);
        return true;
    }
    return false;
}

function restartServer($node, $pm2, $dir, $pm2Home) {
    $cmd = "cd $dir && export PATH=/opt/alt/alt-nodejs22/root/usr/bin:\$PATH && PM2_HOME=$pm2Home $node $pm2 start ecosystem.config.js --update-env 2>&1";
    $descriptors = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w']
    ];
    $process = proc_open($cmd, $descriptors, $pipes, $dir, ['PM2_HOME' => $pm2Home]);
    if (is_resource($process)) {
        $output = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
        fclose($pipes[0]); fclose($pipes[1]); fclose($pipes[2]);
        proc_close($process);
        return $output;
    }
    return "Failed to execute restart command.";
}

echo "[" . date('Y-m-d H:i:s') . "] Checking server status on port $PORT...\n";

if (isServerAlive($PORT)) {
    echo "SUCCESS: Server is alive and responding.\n";
} else {
    echo "CRITICAL: Server is DOWN. Attempting automatic restart...\n";
    $result = restartServer($NODE_PATH, $PM2_PATH, $APP_DIR, $PM2_HOME);
    echo "Restart Result:\n$result\n";
    
    // Log crash to a file for history
    file_put_contents("$APP_DIR/crash_history.log", "[" . date('Y-m-d H:i:s') . "] Server was down, restarted.\n", FILE_APPEND);
}
