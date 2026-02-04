<?php
/**
 * WE ÖTZI - Server Logs Viewer
 * Shows PM2 error and output logs to diagnose crashes
 */

// Security token
$SECURITY_TOKEN = 'Abnerisai24.';

// Paths
$NODE_PATH = '/opt/alt/alt-nodejs22/root/usr/bin/node';
$PM2_PATH = '/home/u795331143/node_modules/pm2/bin/pm2';
$APP_DIR = '/home/u795331143/domains/weotzi.com/public_html/beta';
$PM2_HOME = '/home/u795331143/.pm2';

// Log files
$ERROR_LOG = '/home/u795331143/.pm2/logs/weotzi-beta-error.log';
$OUT_LOG = '/home/u795331143/.pm2/logs/weotzi-beta-out.log';

header('Content-Type: text/html; charset=utf-8');

// Check token
$token = $_GET['token'] ?? '';
if ($token !== $SECURITY_TOKEN) {
    http_response_code(403);
    die('<h1>403 - Access Denied</h1>');
}

// Action: clear logs
if (isset($_GET['clear'])) {
    @file_put_contents($ERROR_LOG, '');
    @file_put_contents($OUT_LOG, '');
    header("Location: server_logs.php?token=$token&cleared=1");
    exit;
}

function runCommand($cmd, $appDir, $env = []) {
    $descriptors = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w']
    ];
    $output = '';
    $process = proc_open($cmd, $descriptors, $pipes, $appDir, $env);
    if (is_resource($process)) {
        fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($process);
    }
    return $output;
}

function getLastLines($file, $lines = 100) {
    if (!file_exists($file)) {
        return "(file not found: $file)";
    }
    $content = @file_get_contents($file);
    if ($content === false) {
        // Try with tail command
        return "(could not read file)";
    }
    $allLines = explode("\n", $content);
    $lastLines = array_slice($allLines, -$lines);
    return implode("\n", $lastLines);
}

// Get PM2 status
$pm2Status = runCommand(
    "PM2_HOME=$PM2_HOME $NODE_PATH $PM2_PATH list 2>&1",
    $APP_DIR,
    ['PM2_HOME' => $PM2_HOME]
);

// Get PM2 info for restart count
$pm2Info = runCommand(
    "PM2_HOME=$PM2_HOME $NODE_PATH $PM2_PATH describe weotzi-beta 2>&1",
    $APP_DIR,
    ['PM2_HOME' => $PM2_HOME]
);

// Read logs
$errorLog = getLastLines($ERROR_LOG, 100);
$outLog = getLastLines($OUT_LOG, 50);

// Try reading from .pm2-beta too (legacy)
$errorLogBeta = getLastLines('/home/u795331143/.pm2-beta/logs/weotzi-beta-error.log', 50);

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>WE ÖTZI - Server Logs</title>
    <style>
        body { font-family: 'JetBrains Mono', monospace; background: #1a1a1a; color: #fff; padding: 20px; max-width: 1200px; margin: 0 auto; }
        h1 { color: #00BFFF; border-bottom: 2px solid #00BFFF; padding-bottom: 10px; }
        h2 { color: #F4D03F; margin-top: 25px; }
        pre { background: #2a2a2a; padding: 15px; border-radius: 8px; overflow-x: auto; border: 1px solid #444; white-space: pre-wrap; font-size: 11px; max-height: 400px; overflow-y: auto; }
        .error-log { border-color: #E63946; }
        .actions { margin: 20px 0; }
        .btn { display: inline-block; padding: 10px 20px; background: #333; color: #F4D03F; text-decoration: none; border-radius: 5px; margin-right: 10px; }
        .btn:hover { background: #444; }
        .btn-danger { background: #5a2727; }
        .success { background: #2d5a27; padding: 10px; border-radius: 5px; margin: 10px 0; }
    </style>
</head>
<body>
    <h1>WE ÖTZI - Server Logs</h1>
    
    <?php if (isset($_GET['cleared'])): ?>
    <div class="success">Logs cleared successfully!</div>
    <?php endif; ?>
    
    <div class="actions">
        <a href="start_server.php?token=<?php echo urlencode($token); ?>" class="btn">Start Server</a>
        <a href="stop_server.php?token=<?php echo urlencode($token); ?>" class="btn">Stop Server</a>
        <a href="server_logs.php?token=<?php echo urlencode($token); ?>&clear=1" class="btn btn-danger">Clear Logs</a>
        <a href="server_logs.php?token=<?php echo urlencode($token); ?>" class="btn">Refresh</a>
    </div>
    
    <h2>PM2 Status</h2>
    <pre><?php echo htmlspecialchars($pm2Status); ?></pre>
    
    <h2>PM2 Process Info (restart count, uptime, etc.)</h2>
    <pre><?php echo htmlspecialchars($pm2Info); ?></pre>
    
    <h2>Error Log (last 100 lines) - <?php echo $ERROR_LOG; ?></h2>
    <pre class="error-log"><?php echo htmlspecialchars($errorLog); ?></pre>
    
    <h2>Output Log (last 50 lines)</h2>
    <pre><?php echo htmlspecialchars($outLog); ?></pre>
    
    <?php if ($errorLogBeta && strpos($errorLogBeta, 'not found') === false): ?>
    <h2>Legacy Error Log (.pm2-beta)</h2>
    <pre class="error-log"><?php echo htmlspecialchars($errorLogBeta); ?></pre>
    <?php endif; ?>
    
    <p style="margin-top: 30px; color: #666;">
        Auto-refresh: <a href="javascript:location.reload();" style="color: #F4D03F;">Click here</a> or press F5
    </p>
</body>
</html>
