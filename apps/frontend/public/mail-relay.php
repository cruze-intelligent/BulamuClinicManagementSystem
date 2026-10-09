<?php
/**
 * Bulamu mail bridge: HTTPS in, SMTP out.
 *
 * The API runs on Render's free plan, which blocks outbound SMTP (ports 25,
 * 465 and 587), so it cannot reach the mail server itself. It builds each
 * message completely (headers, HTML, attachments) and posts it here; this
 * script, running on the Hostinger site, hands it to smtp.hostinger.com.
 *
 * It stores no secrets: the mailbox login arrives with each request (over
 * TLS) and is used only for that SMTP session. It only talks to Hostinger's
 * mail server and only accepts @bulamu.site mailboxes, so it cannot be used as
 * a general-purpose relay. Repeated failed logins from one address are
 * refused for a while, so it cannot be used to guess passwords either.
 */
declare(strict_types=1);

header('Content-Type: application/json');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

const SMTP_SERVER = 'ssl://smtp.hostinger.com:465';
const ALLOWED_DOMAIN = 'bulamu.site';
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_RECIPIENTS = 20;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_SECONDS = 900;

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'POST only']);
}

// --- Failed-login throttle (per client address) ------------------------------
$throttleFile = sys_get_temp_dir() . '/bulamu-mail-relay-' . sha1((string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
$failures = [];
if (is_readable($throttleFile)) {
    $failures = array_filter(
        (array)json_decode((string)@file_get_contents($throttleFile), true),
        fn($t) => is_int($t) && $t > time() - LOCKOUT_SECONDS
    );
}
if (count($failures) >= MAX_FAILED_LOGINS) {
    respond(429, ['ok' => false, 'error' => 'Too many failed sign-ins to the mail server; try again later']);
}
function recordFailedLogin(string $file, array $failures): void
{
    $failures[] = time();
    @file_put_contents($file, json_encode(array_values($failures)), LOCK_EX);
}

// --- Validate the request ----------------------------------------------------
$raw = file_get_contents('php://input', false, null, 0, MAX_BYTES + 1);
if ($raw === false || $raw === '' || strlen($raw) > MAX_BYTES) {
    respond(413, ['ok' => false, 'error' => 'Missing or oversized request']);
}
$in = json_decode($raw, true);
if (!is_array($in)) {
    respond(400, ['ok' => false, 'error' => 'Request must be JSON']);
}

$user = is_string($in['user'] ?? null) ? trim($in['user']) : '';
$pass = is_string($in['pass'] ?? null) ? $in['pass'] : '';
$from = is_string($in['from'] ?? null) ? trim($in['from']) : '';
$to = is_array($in['to'] ?? null) ? array_values($in['to']) : [];
$message = is_string($in['message'] ?? null) ? base64_decode($in['message'], true) : false;

$isEmail = fn($value) => is_string($value) && filter_var($value, FILTER_VALIDATE_EMAIL) !== false;
if (!$isEmail($user) || strtolower(substr(strrchr($user, '@'), 1)) !== ALLOWED_DOMAIN || $pass === '') {
    respond(403, ['ok' => false, 'error' => 'Only ' . ALLOWED_DOMAIN . ' mailboxes may use this bridge']);
}
if (strcasecmp($from, $user) !== 0) {
    respond(400, ['ok' => false, 'error' => 'The sender must be the signed-in mailbox']);
}
if (count($to) < 1 || count($to) > MAX_RECIPIENTS || count(array_filter($to, $isEmail)) !== count($to)) {
    respond(400, ['ok' => false, 'error' => 'Invalid recipients']);
}
if ($message === false || $message === '') {
    respond(400, ['ok' => false, 'error' => 'Missing message']);
}

// --- SMTP --------------------------------------------------------------------
$context = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
$smtp = @stream_socket_client(SMTP_SERVER, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $context);
if (!$smtp) {
    respond(502, ['ok' => false, 'error' => "Could not reach the mail server: $errstr"]);
}
stream_set_timeout($smtp, 60);

function smtpReply($smtp): array
{
    $text = '';
    while (($line = fgets($smtp, 2048)) !== false) {
        $text .= $line;
        if (strlen($line) < 4 || $line[3] !== '-') {
            break;
        }
    }
    return [(int)substr($text, 0, 3), trim($text)];
}

function fail($smtp, int $status, string $error): void
{
    @fwrite($smtp, "QUIT\r\n");
    @fclose($smtp);
    respond($status, ['ok' => false, 'error' => $error]);
}

function expectReply($smtp, array $codes, string $step): void
{
    [$code, $text] = smtpReply($smtp);
    if (!in_array($code, $codes, true)) {
        fail($smtp, 502, "$step: " . ($text !== '' ? $text : 'no answer from the mail server'));
    }
}

function command($smtp, string $line, array $codes, string $step): void
{
    fwrite($smtp, $line . "\r\n");
    expectReply($smtp, $codes, $step);
}

expectReply($smtp, [220], 'Connecting');
command($smtp, 'EHLO ' . ALLOWED_DOMAIN, [250], 'Greeting');

fwrite($smtp, "AUTH LOGIN\r\n");
expectReply($smtp, [334], 'Sign-in');
fwrite($smtp, base64_encode($user) . "\r\n");
expectReply($smtp, [334], 'Sign-in');
fwrite($smtp, base64_encode($pass) . "\r\n");
[$authCode, $authText] = smtpReply($smtp);
if ($authCode !== 235) {
    recordFailedLogin($throttleFile, $failures);
    fail($smtp, 401, 'Sign-in to the mail server failed: ' . $authText);
}

command($smtp, "MAIL FROM:<$from>", [250], 'Sender');
foreach ($to as $recipient) {
    command($smtp, "RCPT TO:<$recipient>", [250, 251], 'Recipient');
}
command($smtp, 'DATA', [354], 'Message');

// CRLF line endings, and a leading "." doubled so it isn't read as the end.
$data = preg_replace("/\r\n|\r|\n/", "\r\n", $message);
$data = preg_replace('/^\./m', '..', $data);
if (substr($data, -2) !== "\r\n") {
    $data .= "\r\n";
}
for ($offset = 0, $length = strlen($data); $offset < $length; $offset += $written) {
    $written = fwrite($smtp, substr($data, $offset, 65536));
    if ($written === false || $written === 0) {
        fail($smtp, 502, 'The connection to the mail server dropped while sending');
    }
}
command($smtp, '.', [250], 'Sending');

@fwrite($smtp, "QUIT\r\n");
@fclose($smtp);
respond(200, ['ok' => true]);
