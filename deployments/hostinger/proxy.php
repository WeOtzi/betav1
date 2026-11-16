<?php
// Bridge the existing Hostinger web server to the private Node listener.
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$host = $_SERVER['HTTP_HOST'] ?? 'beta.weotzi.com';
if (!preg_match('/^(beta\.)?weotzi\.com(?::443)?$/i', $host)) {
    http_response_code(400);
    exit('Invalid application host');
}
// La generación de imágenes con IA puede tardar hasta dos minutos: solo estas
// tres rutas esperan más que el resto. Node corta antes (AI_IMAGE_TIMEOUT_MS,
// 120 s por defecto) y responde su propio 504 en JSON; este límite es la red
// de seguridad. Si se sube AI_IMAGE_TIMEOUT_MS, subir también este valor.
$requestPath = (string) parse_url($requestUri, PHP_URL_PATH);
$isAiImage = preg_match('#^/(?:beta/)?api/(?:(?:ai|gemini)/generate-image|quotations/ai-reference)/?$#i', $requestPath) === 1;
$timeoutSeconds = $isAiImage ? 150 : 60;
if ($isAiImage && function_exists('set_time_limit')) {
    @set_time_limit($timeoutSeconds + 20);
}
$ch = curl_init('http://127.0.0.1:4545' . $requestUri);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => $timeoutSeconds,
    CURLOPT_CUSTOMREQUEST => $_SERVER['REQUEST_METHOD'],
    CURLOPT_HEADER => false,
]);
if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'HEAD'], true)) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
}
if ($_SERVER['REQUEST_METHOD'] === 'HEAD') curl_setopt($ch, CURLOPT_NOBODY, true);
$headers = [];
foreach (getallheaders() as $name => $value) {
    if (in_array(strtolower($name), ['host', 'connection', 'content-length', 'transfer-encoding', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'], true)) continue;
    $headers[] = "$name: $value";
}
$https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
$headers[] = 'Host: ' . $host;
$headers[] = 'X-Forwarded-Host: ' . $host;
$headers[] = 'X-Forwarded-Proto: ' . ($https ? 'https' : 'http');
$headers[] = 'X-Forwarded-For: ' . $_SERVER['REMOTE_ADDR'];
$headers[] = 'X-Real-IP: ' . $_SERVER['REMOTE_ADDR'];
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($curl, $line) {
    if (preg_match('#^HTTP/\S+\s+(\d+)#', $line, $match)) {
        if ((int)$match[1] >= 200) http_response_code((int)$match[1]);
    } elseif (strpos($line, ':') !== false) {
        $name = strtolower(trim(explode(':', $line, 2)[0]));
        if (!in_array($name, ['connection', 'transfer-encoding', 'keep-alive'], true)) header(trim($line), false);
    }
    return strlen($line);
});
$body = curl_exec($ch);
if ($body === false) {
    error_log('We Otzi backend proxy: ' . curl_error($ch));
    // 28 = CURLE_OPERATION_TIMEDOUT. Solo cuenta como espera vencida si se agotó
    // el tiempo total (un corte al conectar también da 28, a los 5 s).
    $waitedOut = curl_errno($ch) === 28 && curl_getinfo($ch, CURLINFO_TOTAL_TIME) >= ($timeoutSeconds - 1);
    if ($isAiImage && $waitedOut) {
        // Misma forma que el 504 del servidor: el navegador muestra este mensaje
        // en vez de un error genérico.
        header_remove('Content-Length');
        http_response_code(504);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode([
            'success' => false,
            'code' => 'ai_timeout',
            'error' => 'La imagen tardó demasiado en generarse. Inténtalo de nuevo.',
        ], JSON_UNESCAPED_UNICODE);
    } else {
        http_response_code(502);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'La aplicación se está reiniciando. Volvé a intentar en unos segundos.';
    }
} else {
    echo $body;
}
curl_close($ch);
