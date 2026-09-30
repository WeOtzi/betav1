<?php
// Operator installs this as proxy.php on the dedicated preview origin.
// WEOTZI_DEPLOY_CONFIG may select a private JSON file; it never comes from HTTP.
// By default the configuration is ~/weotzi-deploy/control/deploy-config.json.
// The deployed gateway and this bridge are trusted operator files, never branch code.
ini_set('display_errors', '0');

function weotziPreviewUnavailable(): void
{
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'La preview se está preparando. Volvé a intentar en unos minutos.';
    exit;
}

function weotziPreviewAbsolutePath(string $value): bool
{
    return $value !== '' && $value[0] === '/' && !preg_match('/[\x00-\x20\x7f]/', $value)
        && strpos($value, '/public_html/') === false && !str_ends_with($value, '/public_html');
}

header('X-Weotzi-Environment: preview');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'HEAD'], true)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['preview' => true, 'error' => 'Las operaciones reales están desactivadas en preview'], JSON_UNESCAPED_UNICODE);
    exit;
}
$host = strtolower($_SERVER['HTTP_HOST'] ?? '');
if (!preg_match('/^preview\.weotzi\.(?:com|chat)(?::443)?$/D', $host)) {
    http_response_code(400);
    exit('Invalid preview host');
}
$uri = $_SERVER['REQUEST_URI'] ?? '/';
if ($uri === '' || $uri[0] !== '/' || str_starts_with($uri, '//') || strlen($uri) > 8192 || preg_match('/[\x00-\x20\x7f]/', $uri)) {
    http_response_code(400);
    exit('Invalid request');
}
$home = getenv('HOME') ?: '/home/u795331143';
$configPath = getenv('WEOTZI_DEPLOY_CONFIG') ?: rtrim($home, '/') . '/weotzi-deploy/control/deploy-config.json';
if (!weotziPreviewAbsolutePath($configPath) || !is_file($configPath) || !is_readable($configPath) || @filesize($configPath) > 32768) {
    weotziPreviewUnavailable();
}
$configBytes = @file_get_contents($configPath);
$config = $configBytes !== false ? json_decode($configBytes, true) : null;
if (!is_array($config) || !is_string($config['stateRoot'] ?? null)
    || !is_string($config['previewPublicUrl'] ?? null) || !is_string($config['previewSocket'] ?? null)) {
    weotziPreviewUnavailable();
}
$stateRoot = realpath($config['stateRoot']);
$configRealPath = realpath($configPath);
if (!$stateRoot || !weotziPreviewAbsolutePath($stateRoot) || $stateRoot === '/'
    || !$configRealPath || dirname($configRealPath) !== $stateRoot . '/control') {
    weotziPreviewUnavailable();
}
$origin = parse_url($config['previewPublicUrl']);
if (!is_array($origin) || ($origin['scheme'] ?? '') !== 'https'
    || !preg_match('/^preview\.weotzi\.(?:com|chat)$/D', strtolower($origin['host'] ?? ''))
    || isset($origin['user']) || isset($origin['pass']) || isset($origin['query']) || isset($origin['fragment'])
    || !in_array($origin['path'] ?? '', ['', '/'], true) || (isset($origin['port']) && $origin['port'] !== 443)) {
    weotziPreviewUnavailable();
}
$expectedHost = strtolower($origin['host']);
if ($host !== $expectedHost && $host !== $expectedHost . ':443') {
    http_response_code(400);
    exit('Invalid preview host');
}
$socket = $config['previewSocket'];
if (!weotziPreviewAbsolutePath($socket) || dirname($socket) !== $stateRoot . '/sockets'
    || !file_exists($socket) || !function_exists('curl_init') || !defined('CURLOPT_UNIX_SOCKET_PATH')) {
    weotziPreviewUnavailable();
}

// No Authorization, forwarding headers or application cookies reach the gateway.
// Its sole cookie is an opaque demo branch selector, not an authenticated session.
$headers = ['Host: ' . $expectedHost, 'X-Forwarded-Proto: https'];
foreach (['HTTP_ACCEPT' => 'Accept', 'HTTP_ACCEPT_ENCODING' => 'Accept-Encoding'] as $serverName => $headerName) {
    $value = $_SERVER[$serverName] ?? '';
    if ($value !== '' && strlen($value) <= 8192 && !preg_match('/[\x00-\x1f\x7f]/', $value)) $headers[] = $headerName . ': ' . $value;
}
$referer = $_SERVER['HTTP_REFERER'] ?? '';
$refererParts = $referer !== '' && strlen($referer) <= 8192 && !preg_match('/[\x00-\x20\x7f]/', $referer) ? parse_url($referer) : false;
if (is_array($refererParts) && ($refererParts['scheme'] ?? '') === 'https'
    && strtolower($refererParts['host'] ?? '') === $expectedHost && !isset($refererParts['user']) && !isset($refererParts['pass'])
    && (!isset($refererParts['port']) || $refererParts['port'] === 443)) {
    $headers[] = 'Referer: ' . $referer;
}
if (preg_match('/(?:^|;\s*)weotzi_preview_target=(preview-[a-z0-9-]{1,100})(?:;|$)/', $_SERVER['HTTP_COOKIE'] ?? '', $cookie)) {
    $headers[] = 'Cookie: weotzi_preview_target=' . $cookie[1];
}
$responseHeaders = [];
$ch = curl_init('http://localhost' . $uri);
curl_setopt_array($ch, [
    CURLOPT_UNIX_SOCKET_PATH => $socket,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_PROXY => '',
    CURLOPT_CONNECTTIMEOUT => 3,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_HEADERFUNCTION => function ($curl, string $line) use (&$responseHeaders): int {
        if (preg_match('#^HTTP/\S+\s+\d+#', $line)) $responseHeaders = [];
        elseif (strpos($line, ':') !== false) $responseHeaders[] = trim($line);
        return strlen($line);
    },
]);
if (defined('CURLOPT_PROTOCOLS_STR')) curl_setopt($ch, CURLOPT_PROTOCOLS_STR, 'http');
else curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTP);
if ($method === 'HEAD') curl_setopt($ch, CURLOPT_NOBODY, true);
$body = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);
if ($body === false || $status < 200 || $status > 599) weotziPreviewUnavailable();
http_response_code($status);
foreach ($responseHeaders as $line) {
    [$name, $value] = explode(':', $line, 2);
    $name = strtolower(trim($name));
    $value = trim($value);
    if (!preg_match('/^[a-z0-9-]+$/D', $name) || preg_match('/[\x00-\x1f\x7f]/', $value)) continue;
    if (in_array($name, ['connection', 'transfer-encoding', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'trailer', 'upgrade', 'cache-control', 'x-weotzi-environment', 'x-content-type-options'], true)) continue;
    if ($name === 'location' && (!str_starts_with($value, '/') || str_starts_with($value, '//'))) continue;
    if ($name === 'set-cookie' && !preg_match('/^weotzi_preview_target=preview-[a-z0-9-]{1,100};/D', $value)) continue;
    header($name . ': ' . $value, false);
}
if ($method !== 'HEAD') echo $body;
