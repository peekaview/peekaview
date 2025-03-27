<?php
// CORS headers
header('Access-Control-Allow-Origin: *'); // Or specify your frontend domain
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Max-Age: 3600');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('HTTP/1.1 204 No Content');
    exit();
}

header('Content-Type: application/json');

// Add a custom error handler
function handleError($errno, $errstr, $errfile, $errline) {
    http_response_code(500);
    //TODO: return something else in production
    die(json_encode(['error' => $errstr, 'file' => $errfile, 'line' => $errline]));
}
set_error_handler('handleError');

// Validate required environment variables
foreach (['APP_DOMAIN', 'FROM_EMAIL', 'FROM_NAME', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'TURN_SHARED_SECRET'] as $required) {
    if (!getenv($required)) {
        die(json_encode(['error' => "Missing required environment variable: $required"]));
    }
}

define('ENABLE_LOGGING', false);
define('TURN_SHARED_SECRET', getenv('TURN_SHARED_SECRET'));
define('TURN_EXPIRE', 8640000);
define('APP_DOMAIN', getenv('APP_DOMAIN'));
define('CONTROL_SERVERS', array_filter(array_map('trim', explode(',', getenv('CONTROL_SERVERS')))));
define('VIDEO_SERVERS', array_filter(array_map('trim', explode(',', getenv('VIDEO_SERVERS')))));
define('STORAGE_PATH', '/storage');
define('REQUEST_TIMEOUT', 20); // seconds
define('OFFLINE_TIMEOUT', 120); // seconds

$out = [];
$log = [];

// Input validation functions
function validateEmail($email) {
    $email = filter_var(trim($email), FILTER_VALIDATE_EMAIL);
    if (!$email) {
        throw new InvalidArgumentException("Invalid email format: $email");
    }
    return strtolower($email);
}

function validateRequestId($requestId) {
    $requestId = preg_replace('/[^a-zA-Z0-9]/', '', $requestId);
    if (strlen($requestId) !== 8) {
        throw new InvalidArgumentException('Invalid request ID format');
    }
    return $requestId;
}

function validateLang($lang) {
    $lang = strtolower($lang);
    if ($lang !== 'de' && $lang !== 'en') {
        throw new InvalidArgumentException('Invalid language');
    }
    return $lang;
}

function validateName($name) {
    // Trim whitespace
    $name = trim($name);
    
    // Remove any HTML tags
    $name = strip_tags($name);
    
    // Convert special characters to HTML entities
    $name = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
    
    // Check length after sanitization
    if (strlen($name) < 2 || strlen($name) > 50) {
        throw new InvalidArgumentException('Invalid name length');
    }
    
    return $name;
}

// Ensure storage directories exist
if (!file_exists(STORAGE_PATH . '/users')) {
    mkdir(STORAGE_PATH . '/users', 0777, true);
}
if (!file_exists(STORAGE_PATH . '/push')) {
    mkdir(STORAGE_PATH . '/push', 0777, true);
}
if (!file_exists(STORAGE_PATH . '/requests')) {
    mkdir(STORAGE_PATH . '/requests', 0777, true);
}
if (!file_exists(STORAGE_PATH . '/tempdata')) {
    mkdir(STORAGE_PATH . '/tempdata', 0777, true);
}

function generateJWT($email, $roomId) {
    // Header
    $header = [
        'alg' => 'HS256',
        'typ' => 'JWT'
    ];
    
    // Payload
    $payload = [
        'sub' => $email,
        'exp' => time() + 3600,
        'video' => [
            'roomJoin' => true,
            'room' => $roomId
        ]
    ];
    
    // Base64URL encode
    $base64UrlEncode = function($data) {
        return rtrim(strtr(base64_encode(json_encode($data)), '+/', '-_'), '=');
    };
    
    $headerEncoded = $base64UrlEncode($header);
    $payloadEncoded = $base64UrlEncode($payload);
    
    // Create signature
    $unsignedToken = "$headerEncoded.$payloadEncoded";
    $signature = hash_hmac('sha256', $unsignedToken, 'JWT_SECRET', true);
    $signatureEncoded = rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');
    
    // Combine all parts
    return "$headerEncoded.$payloadEncoded.$signatureEncoded";
}

function generateRandomString($length = 10) {
    return substr(str_shuffle(str_repeat($x='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 
        ceil($length/strlen($x)))), 1, $length);
}

function generateSafeRandomCode($length = 8) {
    // Exclude easily confused characters: O, 0, l, I, 1
    $chars = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
    $code = '';
    $max = strlen($chars) - 1;
    
    for ($i = 0; $i < $length; $i++) {
        $code .= $chars[random_int(0, $max)];
    }
    
    return $code;
}

function getPushFilename($uuid) {
    return STORAGE_PATH . '/push/' . $uuid . '.txt';
}

function getUserFilename($email) {
    return STORAGE_PATH . '/users/' . str_replace(['@', '.'], ['_', '_'], $email) . '.txt';
}

function getRequestFilename($email, $requestId) {
    return STORAGE_PATH . '/requests/' . str_replace(['@', '.'], ['_', '_'], $email) . '.' . $requestId . '.txt';
}

function getTempDataFilename($code) {
    return STORAGE_PATH . '/tempdata/' . $code . '.txt';
}

function getUserFile() {
    global $log;
    $email = validateEmail($_GET['email']);
    $log[] = "Looking for user file for $email";
    
    $userFile = getUserFilename($email);
    $log[] = "User file: $userFile";
    if (!file_exists($userFile)) {
        throw new Exception('User not found');
    }

    $log[] = "User file found";
    return $userFile;
}

function authorizeUser($userFile) {
    global $log;
    $token = $_GET['token'];
    $log[] = "Authorizing user by token $token";
    $userData = explode(';', file_get_contents($userFile));
    $log[] = "User data: " . json_encode($userData);
    $storedToken = $userData[1] ?? '';
    
    if ($token !== $storedToken) {
        throw new Exception('Unauthorized');
    }

    $log[] = "User authorized";
}

function createScreenShareRoom() {
    $userFile = getUserFile();
    authorizeUser($userFile);
    
    $videoServer = VIDEO_SERVERS[array_rand(VIDEO_SERVERS)];
    $controlServer = CONTROL_SERVERS[array_rand(CONTROL_SERVERS)];
    $roomId = generateRandomString(8);
    
    $userData = explode(';', file_get_contents($userFile));
    $userData[2] = 'active';
    $userData[3] = $roomId;
    $userData[4] = $videoServer;
    $userData[5] = $controlServer;
    file_put_contents($userFile, implode(';', $userData));
    
    $turnCredentials = generateTurnCredentials(TURN_SHARED_SECRET, TURN_EXPIRE);

    return [
        'videoServer' => $videoServer,
        'controlServer' => $controlServer,
        'turnCredentials' => $turnCredentials,
        'roomId' => $roomId
    ];
}

function iAmOnline() {
    $userFile = getUserFile();
    authorizeUser($userFile);

    // Set user online
    touch($userFile, time());

    return ['success' => true];
}

function doesAnyoneWantToSeeMyScreen() {
    $userFile = getUserFile();
    authorizeUser($userFile);
    
    $email = validateEmail($_GET['email']);
    $requests = [];
    $currentTime = time();
    $thirtyMinutesAgo = $currentTime - (30 * 60);
    
    $pattern = STORAGE_PATH . '/requests/' . str_replace(['@', '.'], ['_', '_'], $email) . '.*.txt';
    foreach (glob($pattern) as $requestFile) {
        $requestData = explode(',', file_get_contents($requestFile));
        
        $requestTime = intval($requestData[1]);
        $status = $requestData[2] ?? '';
        $accessToken = $requestData[4] ?? '';
        if ($status === 'request_open' && $requestTime >= $thirtyMinutesAgo) {
            $requestId = basename($requestFile);
            $requestId = substr($requestId, strpos($requestId, '.') + 1, -4);
            $requests[] = [
                'name' => $requestData[0],
                'requestId' => $requestId,
                'timestamp' => $requestTime,
                'accessToken' => $accessToken
            ];
        } else if ($requestTime < $thirtyMinutesAgo && file_exists($requestFile)) {
            unlink($requestFile);
        }
    }
    
    usort($requests, function($a, $b) {
        return $b['timestamp'] - $a['timestamp'];
    });
    
    array_walk($requests, function(&$request) {
        unset($request['timestamp']);
    });
    
    return $requests;
}

function generateTurnCredentials($secret = 'test123', $expiry = 8640000) {
    $time = time();
    $username = $time + $expiry;
    $credential = base64_encode(hash_hmac('sha1', $username, $secret, true));
    
    return [
        'username' => (string)$username,
        'credential' => $credential
    ];
}

function showMeYourScreen() {
    if (isset($_GET['code'])) {
        $email = getTempData($_GET['code']);
    } else {
        $email = validateEmail($_GET['email']);
    }
    $name = validateName($_GET['name'] ?? '');
    $requestId = validateRequestId($_GET['requestId'] ?? '');
    $accessToken = $_GET['access_token'] ?? '';
    $lang = validateLang($_GET['lang'] ?? '');
    $init = isset($_GET['init']) && $_GET['init'] === '1';
    
    $userFile = getUserFilename($email);
    if (!file_exists($userFile)) {
        $token = generateRandomString(16);
        $userData = implode(';', [$email, $token, 'offline', '', '', '', time()]);
        file_put_contents($userFile, $userData);
    }
    
    // Get user data and status
    $userData = explode(';', file_get_contents($userFile));
    $lastSeen = filemtime($userFile);
    $userStatus = $lastSeen < (time() - OFFLINE_TIMEOUT) ? 'offline' : 'online';
    $requestFile = getRequestFilename($email, $requestId);
    
    // If init is true, delete the request file
    if ($init && file_exists($requestFile)) {
        unlink($requestFile);
    }

    // If request doesn't exist, create it
    if (!file_exists($requestFile)) {
        // Cleanup old requests
        $pattern = STORAGE_PATH . '/requests/' . str_replace(['@', '.'], ['_', '_'], $email) . '.*.txt';
        foreach (glob($pattern) as $existingRequestFile) {
            $requestData = explode(',', file_get_contents($existingRequestFile));
            $timestamp = intval($requestData[1]);
            if (time() - $timestamp > 3600) {
                unlink($existingRequestFile);
            }
        }
        
        // Create new request
        file_put_contents($requestFile, implode(',', [$name, time(), 'request_open', '', $accessToken]));
    }

    $response = [
        'user_status' => $userStatus,
        'last_seen' => $lastSeen,
    ];

    // Check request status
    if (file_exists($requestFile)) {
        $requestData = explode(',', file_get_contents($requestFile));
        $response['contents'] = file_get_contents($requestFile);
        $timestamp = intval($requestData[1]);
        $status = $requestData[2];

        if (!isset($requestData[4]) || $requestData[4] !== $accessToken) {
            $response['debug'] = 'access token saved';
            $requestData[4] = $accessToken;
            file_put_contents($requestFile, implode(',', $requestData));
        }

        switch ($status) {
            case 'request_accepted':
                $response['status'] = 'request_accepted';
                //$response['jwt'] = generateJWT($name, $userData[3]);
                $response['roomId'] = $userData[3];
                $response['videoServer'] = $userData[4];
                $response['controlServer'] = $userData[5];
                $response['turnCredentials'] = generateTurnCredentials(TURN_SHARED_SECRET, TURN_EXPIRE);
                break;
            case 'request_denied':
                $response['status'] = 'request_denied';
                break;
            case 'request_open':
            default:
                $response['status'] = 'request_open';
                $response['requestId'] = $requestId;

                // if request is not accepted in time or user seems to be offline
                if (time() - $timestamp > REQUEST_TIMEOUT || $userStatus == 'offline') {
                    $token = $userData[1];
                    // Update status to not answered and send email
                    if (!isset($requestData[3]) || $requestData[3] !== 'email_sent') {
                        require_once __DIR__.'/helper/EmailHelper.php';
                        
                        $emailHelper = new EmailHelper();
                        $shareLink = "https://".APP_DOMAIN."/?share=".base64_encode("email=$email&token=$token");
                        if ($emailHelper->sendShareRequest($email, $name, $shareLink)) {
                            $requestData[3] = 'email_sent';
                            file_put_contents($requestFile, implode(',', $requestData));
                        }
                    }
                    
                    // user seems to be offline
                    if ($userStatus == 'offline') {
                        $response['status'] = 'request_notified';
                    }
                    else {
                        $response['status'] = 'request_not_answered';
                        $response['user_status'] = 'away';
                    }
                }
                break;
        }
    }
    
    return $response;
}

function getUserStatus($userFile) {
    if (!file_exists($userFile)) {
        return 'unknown';
    }
    
    $lastModified = filemtime($userFile);
    $thirtyMinutesAgo = time() - (30 * 60);
    
    if ($lastModified < $thirtyMinutesAgo) {
        // Update file with offline status and last seen timestamp
        $userData = explode(';', file_get_contents($userFile));
        $userData[2] = 'offline';
        if (!isset($userData[6])) {
            $userData[6] = $lastModified;
        }
        file_put_contents($userFile, implode(';', $userData));
        return 'offline';
    }
    
    return explode(';', file_get_contents($userFile))[2];
}

function handleIfAllowedToSeeMyScreen($requestStatus) {
    $userFile = getUserFile();
    authorizeUser($userFile);
    
    $email = validateEmail($_GET['email']);
    $requestId = validateRequestId($_GET['requestId'] ?? '');
    $requestFile = getRequestFilename($email, $requestId);
    if (!file_exists($requestFile)) {
        throw new Exception('Request not found');
    }
    
    $requestData = explode(',', file_get_contents($requestFile));
    $requestData[2] = $requestStatus;
    file_put_contents($requestFile, implode(',', $requestData));
    return ['success' => true];
}

function registerMyEmail() {
    $email = validateEmail($_GET['email']);
    $target = ($_GET['target'] ?? '') === 'app' ? 'app' : 'web';
    
    $userFile = getUserFilename($email);
    
    if (file_exists($userFile)) {
        // User already exists, get existing token
        $userData = explode(';', file_get_contents($userFile));
        $token = $userData[1];
    } else {
        // New user, generate token
        $token = generateRandomString(16);
        $userData = implode(';', [$email, $token, 'offline', '', '', '', time()]);
        file_put_contents($userFile, $userData);
    }
    
    require_once __DIR__.'/helper/EmailHelper.php';

    $emailHelper = new EmailHelper();
    $registrationLink = "https://".APP_DOMAIN."/?login=".base64_encode("email=$email&token=$token&target=$target");
    $emailHelper->sendRegistrationConfirmation($email, $registrationLink);

    return ['success' => true];
}

function registerPushToken() {
    $uuid = $_GET['uuid'];
    $pushToken = $_GET['token'];
    $pushFile = getPushFilename($uuid);
    file_put_contents($pushFile, $pushToken);
    return ['success' => true];
}

function sendPushNotification() {
    $userFile = getUserFile();
    authorizeUser($userFile);
    
    $uuid = $_GET['uuid'];
    $pushFile = getPushFilename($uuid);
    if (!file_exists($pushFile)) {
        throw new Exception('Push token not found');
    }

    require_once __DIR__.'/send.php';

    $notification = $_GET['notification'];
    $notification = json_decode($notification, true);

    $title = $notification['title'];
    $message = $notification['message'];
    $image = array_key_exists('image', $notification) ? $notification['image'] : null;
    $data = array_key_exists('data', $notification) ? $notification['data'] : [];
    $pushToken = file_get_contents($pushFile);
    sendMessage($pushToken, $title, $message, $image, $data);

    return ['success' => true];
}

function saveTempData($data) {
    if (empty($data)) {
        throw new Exception('No data provided');
    }
    
    // Check data size limit (100KB)
    if (strlen($data) > 102400) {
        throw new Exception('Data exceeds maximum size limit of 100KB');
    }
    
    // Clean up old temp files
    $oneDayAgo = time() - (24 * 60 * 60);
    $pattern = STORAGE_PATH . '/tempdata/*.txt';
    foreach (glob($pattern) as $tempFile) {
        if (filemtime($tempFile) < $oneDayAgo) {
            unlink($tempFile);
        }
    }
    
    // Generate a unique code
    $attempts = 0;
    $maxAttempts = 10;
    $code = '';
    
    do {
        $code = generateSafeRandomCode(8);
        $tempFile = getTempDataFilename($code);
        $attempts++;
    } while (file_exists($tempFile) && $attempts < $maxAttempts);
    
    if ($attempts >= $maxAttempts) {
        throw new Exception('Failed to generate a unique code');
    }
    
    // Save the data
    file_put_contents($tempFile, $data);
    
    return ['code' => $code];
}

function getTempData($code) {
    if (empty($code) || !preg_match('/^[a-zA-Z0-9]{8}$/', $code)) {
        throw new Exception('Invalid code format');
    }
    
    $tempFile = getTempDataFilename($code);
    if (!file_exists($tempFile)) {
        throw new Exception('Code not found or expired');
    }
    
    $data = file_get_contents($tempFile);
    
    // Delete the file after successful retrieval
    unlink($tempFile);
    
    return ['data' => $data];
}

// Route requests with error handling
try {
    $action = $_GET['action'] ?? '';
    $data = $_POST['data'] ?? $_GET['data'] ?? '';
    $code = $_GET['code'] ?? '';
    // TODO: retrieve GET and POST data here and pass into functions, to reduce dependency coupling
    switch ($action) {
        case 'createScreenShareRoom':
            $out = createScreenShareRoom();
            break;
        case 'showMeYourScreen':
            $out = showMeYourScreen();
            break;
        case 'iAmOnline':
            $out = iAmOnline();
            break;
        case 'doesAnyoneWantToSeeMyScreen':
            $out = doesAnyoneWantToSeeMyScreen();
            break;
        case 'youAreAllowedToSeeMyScreen':
            $out = handleIfAllowedToSeeMyScreen('request_accepted');
            break;
        case 'youAreNotAllowedToSeeMyScreen':
            $out = handleIfAllowedToSeeMyScreen('request_denied');
            break;
        case 'registerMyEmail':
            $out = registerMyEmail();
            break;
        case 'registerPushToken':
            $out = registerPushToken();
            break;
        case 'sendPushNotification':
            $out = sendPushNotification();
            break;
        case 'saveTempData':
            $out = saveTempData($data);
            break;
        case 'getTempData':
            $out = getTempData($code);
            break;
        default:
            die(json_encode(['error' => 'Invalid action']));
    }
} catch (Exception $e) {
    $message = $e->getMessage();
    http_response_code($message === 'Unauthorized' ? 401 : 400);
    $out['error'] = $message;
}

register_shutdown_function(function($out, $log) {
    if (ENABLE_LOGGING) {   
        $out['log'] = $log;
    }
    echo json_encode($out);
}, $out, $log);
