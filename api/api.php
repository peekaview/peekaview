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
foreach (['APP_DOMAIN', 'FROM_EMAIL', 'FROM_NAME', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'TURN_SHARED_SECRET'] as $required) {
    if (!getenv($required)) {
        die(json_encode(['error' => "Missing required environment variable: $required"]));
    }
}

define('TURN_SHARED_SECRET', getenv('TURN_SHARED_SECRET'));
define('TURN_EXPIRE', 8640000);
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
            http_response_code(401);
            echo json_encode(['error' => 'Unauthorized']);
            return;
        }
        
        $videoServer = VIDEO_SERVERS[array_rand(VIDEO_SERVERS)];
        $controlServer = CONTROL_SERVERS[array_rand(CONTROL_SERVERS)];
        $roomId = generateRandomString(8);
        
        $userData[2] = 'active';
        $userData[3] = $roomId;
        $userData[4] = $videoServer;
        $userData[5] = $controlServer;
        file_put_contents($userFile, implode(';', $userData));
        
        $turnCredentials = generateTurnCredentials(TURN_SHARED_SECRET, TURN_EXPIRE);

        echo json_encode([
            'videoServer' => $videoServer,
            'controlServer' => $controlServer,
            'turnCredentials' => $turnCredentials,
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
            http_response_code(401);
            echo json_encode(['error' => 'Unauthorized']);
            return;
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
    try {
        $email = validateEmail($_GET['email'] ?? '');
        $name = validateName($_GET['name'] ?? '');
        $requestId = validateRequestId($_GET['request_id'] ?? '');
        $lang = validateLang($_GET['lang'] ?? '');
        $init = isset($_GET['init']) && $_GET['init'] === '1';
        
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
        
        // If init is true, delete the request file
        if ($init) {
            @unlink($requestFile);
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
            file_put_contents($requestFile, implode(',', [$name, time(), 'request_open']));
        }
        
        // Check request status
        if (file_exists($requestFile)) {
            $requestData = explode(',', file_get_contents($requestFile));
            $timestamp = intval($requestData[1]);
            $status = $requestData[2];
            
            // if request is not accepted in time or user seems to be offline
            if ($status === 'request_open' && time() - $timestamp > REQUEST_TIMEOUT || $status === 'request_open' && $userStatus == 'offline' || $status === 'request_denied') {
                
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
                    echo json_encode([
                        'status' => 'request_notified',
                        'message' => "$email ist leider gerade offline<br>Wir haben den Benutzer per Email benachrichtigt",
                        'user_status' => $userStatus,
                        'last_seen' => $lastSeen,
                    ]);
                    return;
                } elseif ($status === 'request_denied') {
                    echo json_encode([
                        'status' => 'request_denied',
                        'message' => "$email hat die Anfrage abgelehnt",
                        'user_status' => $userStatus,
                        'last_seen' => $lastSeen
                    ]);
                    return;
                }
                else {
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
                $turnCredentials = generateTurnCredentials(TURN_SHARED_SECRET, TURN_EXPIRE);

                echo json_encode([
                    'status' => 'request_accepted',
                    //'jwt' => generateJWT($name, $userData[3]),
                    'roomId' => $userData[3],
                    'videoServer' => $userData[4],
                    'controlServer' => $userData[5],
                    'turnCredentials' => $turnCredentials,
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

function handleIfAllowedToSeeMyScreen($requestStatus) {
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
            http_response_code(401);
            echo json_encode(['error' => 'Unauthorized']);
            return;
        }
        
        $requestFile = getRequestFilename($email, $requestId);
        if (file_exists($requestFile)) {
            $requestData = explode(',', file_get_contents($requestFile));
            $requestData[2] = $requestStatus;
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
        $target = ($_GET['target'] ?? '') === 'app' ? 'app' : 'web';
        
        $userFile = getEmailFilename($email);

        $token = generateRandomString(16);
        $userData = implode(';', [$email, $token, 'offline', '', '', '', time()]);
        file_put_contents($userFile, $userData);
        
        require_once __DIR__.'/helper/EmailHelper.php';
        $emailHelper = new EmailHelper();
        $registrationLink = "https://".APP_DOMAIN."/?login=".base64_encode("email=$email&token=$token&target=$target");
        $emailHelper->sendRegistrationConfirmation($email, $registrationLink);

        echo json_encode([
            'success' => true
        ]);
        return;
        
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
            handleIfAllowedToSeeMyScreen('request_accepted');
            break;
        case 'youAreNotAllowedToSeeMyScreen':
            handleIfAllowedToSeeMyScreen('request_denied');
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