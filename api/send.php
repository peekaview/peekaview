<?php

require __DIR__ . '/vendor/autoload.php';

use Kreait\Firebase\Factory;
use Kreait\Firebase\Messaging\CloudMessage;
use Kreait\Firebase\Messaging\Notification;

// Define storage path if not already defined
if (!defined('STORAGE_PATH')) {
    define('STORAGE_PATH', '/storage');
}

/**
 * Sends a Firebase Cloud Message to a specific device
 * 
 * @param string $title The notification title
 * @param string $message The notification message
 * @param string $token The device token
 * @return void
 */
function sendMessage($token, $title, $message, $image = null, $data = []) {
    // Initialize Firebase
    try {
        $factory = (new Factory)->withServiceAccount(STORAGE_PATH . '/serviceAccountKey.json');
        $messaging = $factory->createMessaging();
    } catch (Exception $e) {
        error_log("Firebase initialization failed: " . $e->getMessage());
        $messaging = null;
    }
    
    if ($messaging === null) {
        error_log("Firebase messaging not initialized");
        return;
    }
    
    try {
        $notification = Notification::create($title, $message, $image);
        
        $message = CloudMessage::withTarget('token', $token)
            ->withNotification($notification)
            ->withData($data);
            
        $response = $messaging->send($message);
        error_log("Message sent to " . $token . " " . json_encode($response) . "\n");
    } catch (Exception $e) {
        error_log("Error sending message to " . $token . " " . $e->getMessage() . "\n");
    }
}