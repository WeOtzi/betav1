<?php
/**
 * PHP Proxy for Node.js Backend
 * Forwards requests to the Node.js app running on port 4545
 */

// Node.js backend
$backendUrl = 'http://127.0.0.1:4545';

// Get the request URI
$requestUri = $_SERVER['REQUEST_URI'];

// Remove /beta prefix if present (since we're already in beta directory)
$requestUri = preg_replace('#^/beta#', '', $requestUri);

// If empty, set to /
if (empty($requestUri) || $requestUri === '') {
    $requestUri = '/';
}

// Build full URL
$url = $backendUrl . $requestUri;

// Initialize cURL
$ch = curl_init();

// Set cURL options
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_HEADER, true);

// Forward request method
$method = $_SERVER['REQUEST_METHOD'];
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);

// Forward POST/PUT data
if ($method === 'POST' || $method === 'PUT' || $method === 'PATCH') {
    $input = file_get_contents('php://input');
    curl_setopt($ch, CURLOPT_POSTFIELDS, $input);
}

// Forward headers
$headers = [];
foreach (getallheaders() as $name => $value) {
    // Skip host header
    if (strtolower($name) !== 'host') {
        $headers[] = "$name: $value";
    }
}
// Add X-Forwarded headers
$headers[] = 'X-Forwarded-For: ' . $_SERVER['REMOTE_ADDR'];
$headers[] = 'X-Forwarded-Proto: ' . (isset($_SERVER['HTTPS']) ? 'https' : 'http');
$headers[] = 'X-Real-IP: ' . $_SERVER['REMOTE_ADDR'];
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

// Execute request
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);

if (curl_errno($ch)) {
    http_response_code(502);
    echo 'Proxy Error: ' . curl_error($ch);
    curl_close($ch);
    exit;
}

curl_close($ch);

// Separate headers and body
$headerText = substr($response, 0, $headerSize);
$body = substr($response, $headerSize);

// Set response code
http_response_code($httpCode);

// Forward response headers
$headerLines = explode("\r\n", $headerText);
foreach ($headerLines as $line) {
    if (empty($line) || strpos($line, 'HTTP/') === 0) continue;
    if (stripos($line, 'transfer-encoding:') === 0) continue;
    if (stripos($line, 'connection:') === 0) continue;
    header($line);
}

// Output body
echo $body;
