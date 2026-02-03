<?php
/**
 * WE ÖTZI - Stop Server Script
 * Stops the Node.js server using PM2
 * 
 * FIXED: Kills BOTH PM2 daemons (.pm2 and .pm2-beta)
 */

// Security token
$SECURITY_TOKEN = 'Abnerisai24.';

// Server paths
$NODE_PATH = '/opt/alt/alt-nodejs22/root/usr/bin/node';
$PM2_PATH = '/home/u795331143/node_modules/pm2/bin/pm2';
$APP_DIR = '/home/u795331143/domains/weotzi.com/public_html/beta';

// BOTH PM2 homes that might be running
$PM2_HOME_BETA = '/home/u795331143/.pm2-beta';
$PM2_HOME_DEFAULT = '/home/u795331143/.pm2';

header('Content-Type: text/html; charset=utf-8');

// Check token
$token = $_GET['token'] ?? '';
if ($token !== $SECURITY_TOKEN) {
    http_response_code(403);
    die('<h1>403 - Access Denied</h1>');
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

$results = [];

// Step 1: Delete from .pm2-beta
$results['delete_beta'] = runCommand(
    "PM2_HOME=$PM2_HOME_BETA $NODE_PATH $PM2_PATH delete weotzi-beta 2>&1",
    $APP_DIR,
    ['PM2_HOME' => $PM2_HOME_BETA]
);

// Step 2: Kill .pm2-beta daemon
$results['kill_beta'] = runCommand(
    "PM2_HOME=$PM2_HOME_BETA $NODE_PATH $PM2_PATH kill 2>&1",
    $APP_DIR,
    ['PM2_HOME' => $PM2_HOME_BETA]
);

// Step 3: Delete from .pm2 (default)
$results['delete_default'] = runCommand(
    "PM2_HOME=$PM2_HOME_DEFAULT $NODE_PATH $PM2_PATH delete weotzi-beta 2>&1",
    $APP_DIR,
    ['PM2_HOME' => $PM2_HOME_DEFAULT]
);

// Step 4: Delete ALL from .pm2 (default)
$results['delete_all_default'] = runCommand(
    "PM2_HOME=$PM2_HOME_DEFAULT $NODE_PATH $PM2_PATH delete all 2>&1",
    $APP_DIR,
    ['PM2_HOME' => $PM2_HOME_DEFAULT]
);

// Step 5: Kill .pm2 (default) daemon
$results['kill_default'] = runCommand(
    "PM2_HOME=$PM2_HOME_DEFAULT $NODE_PATH $PM2_PATH kill 2>&1",
    $APP_DIR,
    ['PM2_HOME' => $PM2_HOME_DEFAULT]
);

// Step 6: Also try to kill any remaining node server.js processes directly
$results['pkill'] = runCommand(
    "pkill -f 'node.*server.js' 2>&1 || echo 'pkill not available or no processes'",
    $APP_DIR,
    []
);

// Wait a moment
sleep(2);

// Step 7: Verify - test backend
$backendStatus = 'Unknown';
$ch = curl_init('http://127.0.0.1:4545/');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 5);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($error) {
    $backendStatus = "STOPPED (Connection failed: $error)";
    $success = true;
} else {
    $backendStatus = "STILL RUNNING! HTTP $httpCode";
    $success = false;
}

// Step 8: Check remaining processes
$results['remaining_processes'] = runCommand(
    "ps aux 2>/dev/null | grep -E 'node|pm2' | grep -v grep || echo 'No node/pm2 processes'",
    $APP_DIR,
    []
);

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>WE ÖTZI - Stop Server</title>
    <style>
        body { font-family: 'JetBrains Mono', monospace; background: #1a1a1a; color: #fff; padding: 40px; max-width: 900px; margin: 0 auto; }
        h1 { color: #E63946; border-bottom: 2px solid #E63946; padding-bottom: 10px; }
        h2 { color: #F4D03F; margin-top: 25px; }
        .status { padding: 15px 20px; border-radius: 8px; margin: 20px 0; font-weight: bold; }
        .success { background: #2d5a27; border: 2px solid #4CAF50; }
        .error { background: #5a2727; border: 2px solid #E63946; }
        pre { background: #2a2a2a; padding: 15px; border-radius: 8px; overflow-x: auto; border: 1px solid #444; white-space: pre-wrap; font-size: 11px; }
        .back-link { color: #F4D03F; text-decoration: none; }
    </style>
</head>
<body>
    <h1>WE ÖTZI - Stop Server</h1>
    
    <div class="status <?php echo $success ? 'success' : 'error'; ?>">
        <?php echo $success ? 'Server stopped successfully!' : 'Warning: Server may still be running'; ?>
    </div>
    
    <h2>Backend Status:</h2>
    <pre style="<?php echo $success ? 'color: #4CAF50;' : 'color: #E63946;'; ?>"><?php echo htmlspecialchars($backendStatus); ?></pre>
    
    <h2>Step 1: Delete from .pm2-beta</h2>
    <pre><?php echo htmlspecialchars($results['delete_beta']); ?></pre>
    
    <h2>Step 2: Kill .pm2-beta daemon</h2>
    <pre><?php echo htmlspecialchars($results['kill_beta']); ?></pre>
    
    <h2>Step 3: Delete weotzi-beta from .pm2</h2>
    <pre><?php echo htmlspecialchars($results['delete_default']); ?></pre>
    
    <h2>Step 4: Delete ALL from .pm2</h2>
    <pre><?php echo htmlspecialchars($results['delete_all_default']); ?></pre>
    
    <h2>Step 5: Kill .pm2 daemon</h2>
    <pre><?php echo htmlspecialchars($results['kill_default']); ?></pre>
    
    <h2>Step 6: Kill remaining node processes</h2>
    <pre><?php echo htmlspecialchars($results['pkill']); ?></pre>
    
    <h2>Remaining Processes:</h2>
    <pre><?php echo htmlspecialchars($results['remaining_processes']); ?></pre>
    
    <p style="margin-top: 30px;">
        <a href="/" class="back-link">← Back to Home</a>
        <span style="margin: 0 10px; color: #666;">|</span>
        <a href="start_server.php?token=<?php echo urlencode($token); ?>" class="back-link">Start Server →</a>
    </p>
</body>
</html>
