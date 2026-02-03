<?php
/**
 * WE ÖTZI - Start Server Script
 * Starts the Node.js server using PM2
 * 
 * FIXED: Uses default PM2_HOME (.pm2) for consistency
 */

// Security token
$SECURITY_TOKEN = 'Abnerisai24.';

// Server paths
$NODE_PATH = '/opt/alt/alt-nodejs22/root/usr/bin/node';
$PM2_PATH = '/home/u795331143/node_modules/pm2/bin/pm2';
$APP_DIR = '/home/u795331143/domains/weotzi.com/public_html/beta';
$PM2_HOME = '/home/u795331143/.pm2';  // Use default PM2 home

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

// Start the server
$command = "cd $APP_DIR && PM2_HOME=$PM2_HOME $NODE_PATH $PM2_PATH start ecosystem.config.js 2>&1";
$output = runCommand($command, $APP_DIR, ['PM2_HOME' => $PM2_HOME]);

// Get status
$statusOutput = runCommand(
    "PM2_HOME=$PM2_HOME $NODE_PATH $PM2_PATH list 2>&1",
    $APP_DIR,
    ['PM2_HOME' => $PM2_HOME]
);

// Verify backend is responding
sleep(2);
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
    $backendStatus = "NOT RESPONDING: $error";
    $success = false;
} else {
    $backendStatus = "RUNNING - HTTP $httpCode";
    $success = true;
}

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>WE ÖTZI - Start Server</title>
    <style>
        body { font-family: 'JetBrains Mono', monospace; background: #1a1a1a; color: #fff; padding: 40px; max-width: 900px; margin: 0 auto; }
        h1 { color: #F4D03F; border-bottom: 2px solid #F4D03F; padding-bottom: 10px; }
        h2 { color: #F4D03F; margin-top: 25px; }
        .status { padding: 15px 20px; border-radius: 8px; margin: 20px 0; font-weight: bold; }
        .success { background: #2d5a27; border: 2px solid #4CAF50; }
        .error { background: #5a2727; border: 2px solid #E63946; }
        pre { background: #2a2a2a; padding: 15px; border-radius: 8px; overflow-x: auto; border: 1px solid #444; white-space: pre-wrap; }
        .back-link { color: #F4D03F; text-decoration: none; }
    </style>
</head>
<body>
    <h1>WE ÖTZI - Start Server</h1>
    
    <div class="status <?php echo $success ? 'success' : 'error'; ?>">
        <?php echo $success ? 'Server started successfully!' : 'Warning: Server may not be running'; ?>
    </div>
    
    <h2>Backend Status:</h2>
    <pre style="<?php echo $success ? 'color: #4CAF50;' : 'color: #E63946;'; ?>"><?php echo htmlspecialchars($backendStatus); ?></pre>
    
    <h2>Command Output:</h2>
    <pre><?php echo htmlspecialchars($output ?: '(no output)'); ?></pre>
    
    <h2>PM2 Status:</h2>
    <pre><?php echo htmlspecialchars($statusOutput ?: '(no status)'); ?></pre>
    
    <p><strong>PM2 Home:</strong> <?php echo htmlspecialchars($PM2_HOME); ?></p>
    
    <p style="margin-top: 30px;">
        <a href="/" class="back-link">← Back to Home</a>
        <span style="margin: 0 10px; color: #666;">|</span>
        <a href="stop_server.php?token=<?php echo urlencode($token); ?>" class="back-link">Stop Server →</a>
    </p>
</body>
</html>
