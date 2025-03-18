<?php

require __DIR__ . '/vendor/autoload.php';

use Kreait\Firebase\Factory;
use Kreait\Firebase\Messaging\CloudMessage;
use Kreait\Firebase\Messaging\Notification;

// Initialize Firebase
$factory = (new Factory)->withServiceAccount(STORAGE_PATH . '/serviceAccountKey.json');
$messaging = $factory->createMessaging();

/**
 * Sends a Firebase Cloud Message to a specific device
 * 
 * @param string $title The notification title
 * @param string $message The notification message
 * @param string $token The device token
 * @return void
 */
function sendMessage($title, $message, $token) {
    global $messaging;
    
    try {
        $notification = Notification::create($title, $message);
        
        $message = CloudMessage::withTarget('token', $token)
            ->withNotification($notification);
            
        $response = $messaging->send($message);
        echo "Message sent to " . $token . " " . json_encode($response) . "\n";
    } catch (Exception $e) {
        echo "Error sending message to " . $token . " " . $e->getMessage() . "\n";
    }
}