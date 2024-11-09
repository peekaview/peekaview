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
    die(json_encode(['error' => $errstr]));
}
set_error_handler('handleError');

// Validate required environment variables
foreach (['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'APP_DOMAIN', 'FROM_EMAIL', 'FROM_NAME', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'] as $required) {
    if (!getenv($required)) {
        die(json_encode(['error' => "Missing required environment variable: $required"]));
    }
}

define('LIVEKIT_API_KEY', getenv('LIVEKIT_API_KEY'));
define('LIVEKIT_API_SECRET', getenv('LIVEKIT_API_SECRET'));
define('APP_DOMAIN', getenv('APP_DOMAIN'));
define('CONTROL_SERVERS', array_filter(array_map('trim', explode(',', getenv('CONTROL_SERVERS')))));
define('VIDEO_SERVERS', array_filter(array_map('trim', explode(',', getenv('VIDEO_SERVERS')))));
define('STORAGE_PATH', '/storage');
define('REQUEST_TIMEOUT', 20); // seconds
define('OFFLINE_TIMEOUT', 120); // seconds


// Input validation functions
function validateEmail($email) {
    $email = filter_var(trim($email), FILTER_VALIDATE_EMAIL);
    if (!$email) {
        throw new InvalidArgumentException('Invalid email format');
    }
    return strtolower($email);
}

function validateToken($token) {
    $token = preg_replace('/[^a-zA-Z0-9]/', '', $token);
    if (strlen($token) !== 16) {
        throw new InvalidArgumentException('Invalid token format');
    }
    return $token;
}

function validateRequestId($requestId) {
    $requestId = preg_replace('/[^a-zA-Z0-9]/', '', $requestId);
    if (strlen($requestId) !== 8) {
        throw new InvalidArgumentException('Invalid request ID format');
    }
    return $requestId;
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
if (!file_exists(STORAGE_PATH . '/requests')) {
    mkdir(STORAGE_PATH . '/requests', 0777, true);
}

function generateJWT($email, $roomId) {
    // Header
    $header = [
        'alg' => 'HS256',
        'typ' => 'JWT'
    ];
    
    // Payload
    $payload = [
        'iss' => LIVEKIT_API_KEY,
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
    $signature = hash_hmac('sha256', $unsignedToken, LIVEKIT_API_SECRET, true);
    $signatureEncoded = rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');
    
    // Combine all parts
    return "$headerEncoded.$payloadEncoded.$signatureEncoded";
}

function generateRandomString($length = 10) {
    return substr(str_shuffle(str_repeat($x='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 
        ceil($length/strlen($x)))), 1, $length);
}

function getEmailFilename($email) {
    return STORAGE_PATH . '/users/' . str_replace(['@', '.'], ['_', '_'], $email) . '.txt';
}

function getRequestFilename($email, $requestId) {
    return STORAGE_PATH . '/requests/' . str_replace(['@', '.'], ['_', '_'], $email) . '.' . $requestId . '.txt';
}

function createScreenShareRoom() {
    try {
        $email = validateEmail($_GET['email'] ?? '');
        $token = validateToken($_GET['token'] ?? '');
        
        $userFile = getEmailFilename($email);
        if (!file_exists($userFile)) {
            throw new Exception('User not found');
        }
        
        $userData = explode(';', file_get_contents($userFile));
        $storedToken = $userData[1] ?? '';
        
        if ($token !== $storedToken) {
            throw new Exception('Unauthorized');
        }
        
        $videoServer = VIDEO_SERVERS[array_rand(VIDEO_SERVERS)];
        $controlServer = CONTROL_SERVERS[array_rand(CONTROL_SERVERS)];
        $roomId = generateRandomString(8);
        $jwt = generateJWT($email, $roomId);
        
        $userData[2] = 'active';
        $userData[3] = $roomId;
        $userData[4] = $videoServer;
        $userData[5] = $controlServer;
        file_put_contents($userFile, implode(';', $userData));
        
        echo json_encode([
            'jwt' => $jwt,
            'videoServer' => $videoServer,
            'controlServer' => $controlServer,
            'roomId' => $roomId
        ]);
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
    }
}


function doesAnyoneWantToSeeMyScreen() {
    try {
        $email = validateEmail($_GET['email'] ?? '');
        $token = validateToken($_GET['token'] ?? '');
        
        $userFile = getEmailFilename($email);
        if (!file_exists($userFile)) {
            throw new Exception('User not found');
        }
        
        $userData = explode(';', file_get_contents($userFile));
        $storedToken = $userData[1] ?? '';
        
        if ($token !== $storedToken) {
            throw new Exception('Unauthorized');
        }
        
        // Set user online
        touch($userFile,time());
        
        $requests = [];
        $currentTime = time();
        $thirtyMinutesAgo = $currentTime - (30 * 60);
        
        $pattern = STORAGE_PATH . '/requests/' . str_replace(['@', '.'], ['_', '_'], $email) . '.*.txt';
        foreach (glob($pattern) as $requestFile) {
            $requestData = explode(',', file_get_contents($requestFile));
            
            $requestTime = intval($requestData[1]);
            if ($requestData[2] === 'request_open' && $requestTime >= $thirtyMinutesAgo) {
                $requestId = basename($requestFile);
                $requestId = substr($requestId, strpos($requestId, '.') + 1, -4);
                $requests[] = [
                    'name' => $requestData[0],
                    'request_id' => $requestId,
                    'timestamp' => $requestTime
                ];
            } else if ($requestTime < $thirtyMinutesAgo) {
                unlink($requestFile);
            }
        }
        
        usort($requests, function($a, $b) {
            return $b['timestamp'] - $a['timestamp'];
        });
        
        array_walk($requests, function(&$request) {
            unset($request['timestamp']);
        });
        
        echo json_encode($requests);
        
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

function showMeYourScreen() {
    try {
        $email = validateEmail($_GET['email'] ?? '');
        $name = validateName($_GET['name'] ?? '');
        $requestId = validateRequestId($_GET['request_id'] ?? '');
        
        $userFile = getEmailFilename($email);
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
            file_put_contents($requestFile, implode(',', [$name, time(), 'request_open']));
        }
        
        // Check request status
        if (file_exists($requestFile)) {
            $requestData = explode(',', file_get_contents($requestFile));
            $timestamp = intval($requestData[1]);
            $status = $requestData[2];
            
            // if request is not accepted in time or user seems to be offline
            if ($status === 'request_open' && time() - $timestamp > REQUEST_TIMEOUT || $status === 'request_open' && $userStatus == 'offline') {
                
                $token = $userData[1];
                // Update status to not answered and send email
                if (!isset($requestData[3]) || $requestData[3] !== 'email_sent') {
                    require_once __DIR__.'/helper/EmailHelper.php';
                    $emailHelper = new EmailHelper();
                    $shareLink = "https://".APP_DOMAIN."/?action=share&email=$email&token=$token&v=".base64_encode("action=share&email=$email&token=$token");
                    if ($emailHelper->sendShareRequest($email, $name, $shareLink)) {
                        $requestData[3] = 'email_sent';
                        file_put_contents($requestFile, implode(',', $requestData));
                    }
                }
                
                // user seems to be offline
                if ($userStatus == 'offline') {
                    echo json_encode([
                        'status' => 'request_notified',
                        'message' => "$email ist leider gerade offline<br>Wir haben den Benutzer per Email benachrichtigt",
                        'user_status' => $userStatus,
                        'last_seen' => $lastSeen,
                    ]);
                    return;
                } else {
                    echo json_encode([
                        'status' => 'request_not_answered',
                        'message' => "$email hat nicht rechtzeitig geantwortet<br>Wir haben den Benutzer per Email benachrichtigt",
                        'user_status' => 'away',
                        'last_seen' => $lastSeen
                    ]);
                    return;
                }
            }
            
            if ($status === 'request_accepted') {
                echo json_encode([
                    'status' => 'request_accepted',
                    'jwt' => generateJWT($name, $userData[3]),
                    'roomId' => $userData[3],
                    'videoServer' => $userData[4],
                    'controlServer' => $userData[5],
                    'user_status' => $userStatus,
                    'last_seen' => $lastSeen
                ]);
                return;
            }
        }
        
        echo json_encode([
            'status' => 'request_open',
            'request_id' => $requestId,
            'user_status' => $userStatus,
            'last_seen' => $lastSeen,
        ]);
        
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
    }
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

function setUserOnline($email) {
    $userFile = getEmailFilename($email);
    touch($userFile);
    /*if (file_exists($userFile)) {
        $userData = explode(';', file_get_contents($userFile));
        $userData[2] = 'online';
        $userData[6] = time(); // Update last seen timestamp
        file_put_contents($userFile, implode(';', $userData));
    }*/
}

function youAreAllowedToSeeMyScreen() {
    try {
        $email = validateEmail($_GET['email'] ?? '');
        $token = validateToken($_GET['token'] ?? '');
        $requestId = validateRequestId($_GET['request_id'] ?? '');
        
        $userFile = getEmailFilename($email);
        if (!file_exists($userFile)) {
            throw new Exception('User not found');
        }
        
        $userData = explode(';', file_get_contents($userFile));
        $storedToken = $userData[1] ?? '';
        
        if ($token !== $storedToken) {
            throw new Exception('Unauthorized');
        }
        
        $requestFile = getRequestFilename($email, $requestId);
        if (file_exists($requestFile)) {
            $requestData = explode(',', file_get_contents($requestFile));
            $requestData[2] = 'request_accepted';
            file_put_contents($requestFile, implode(',', $requestData));
            echo json_encode(['success' => true]);
        } else {
            throw new Exception('Request not found');
        }
        
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

function youAreNotAllowedToSeeMyScreen() {
    try {
        $email = validateEmail($_GET['email'] ?? '');
        $token = validateToken($_GET['token'] ?? '');
        $requestId = validateRequestId($_GET['request_id'] ?? '');
        
        $userFile = getEmailFilename($email);
        if (!file_exists($userFile)) {
            throw new Exception('User not found');
        }
        
        $userData = explode(';', file_get_contents($userFile));
        $storedToken = $userData[1] ?? '';
        
        if ($token !== $storedToken) {
            throw new Exception('Unauthorized');
        }
        
        $requestFile = getRequestFilename($email, $requestId);
        if (file_exists($requestFile)) {
            $requestData = explode(',', file_get_contents($requestFile));
            $requestData[2] = 'request_denied';
            file_put_contents($requestFile, implode(',', $requestData));
            echo json_encode(['success' => true]);
        } else {
            throw new Exception('Request not found');
        }
        
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

function registerMyEmail() {
    try {
        $email = validateEmail($_GET['email'] ?? '');
        
        $userFile = getEmailFilename($email);
        if (!file_exists($userFile)) {
            $token = generateRandomString(16);
            $userData = implode(';', [$email, $token, 'offline', '', '', '', time()]);
            file_put_contents($userFile, $userData);
            
            require_once __DIR__.'/helper/EmailHelper.php';
            $emailHelper = new EmailHelper();
            $registrationLink = "https://".APP_DOMAIN."/?action=register&email=$email&token=$token&v=".base64_encode("action=register&email=$email&token=$token");
            $emailHelper->sendRegistrationConfirmation($email, $registrationLink);

            echo json_encode([
                'success' => true
            ]);
            return;
        }
        
        // User already exists
        echo json_encode([
            'success' => false,
            'error' => 'Email already registered'
        ]);
        
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => $e->getMessage()
        ]);
    }
}


// Route requests with error handling
try {
    $action = $_GET['action'] ?? '';
    switch ($action) {
        case 'createScreenShareRoom':
            createScreenShareRoom();
            break;
        case 'showMeYourScreen':
            showMeYourScreen();
            break;
        case 'doesAnyoneWantToSeeMyScreen':
            doesAnyoneWantToSeeMyScreen();
            break;
        case 'youAreAllowedToSeeMyScreen':
            youAreAllowedToSeeMyScreen();
            break;
        case 'youAreNotAllowedToSeeMyScreen':
            youAreNotAllowedToSeeMyScreen();
            break;
        case 'registerMyEmail':
            registerMyEmail();
            break;
        default:
            die(json_encode(['error' => 'Invalid action']));
    }
} catch (Exception $e) {
    die(json_encode(['error' => $e->getMessage()]));
}