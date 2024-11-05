<?php
// Neue Datei: email_helper.php

class EmailHelper {
    private $fromEmail;
    private $fromName;
    private $smtpHost;
    private $smtpPort;
    private $smtpUser;
    private $smtpPass;
    
    public function __construct() {
        $this->fromEmail = getenv('FROM_EMAIL');
        $this->fromName = getenv('FROM_NAME');
        $this->smtpHost = getenv('SMTP_HOST');
        $this->smtpPort = getenv('SMTP_PORT');
        $this->smtpUser = getenv('SMTP_USER');
        $this->smtpPass = getenv('SMTP_PASS');
    }
    
    private function sendSMTP($to, $subject, $message, $headers) {
        $errno = 0;
        $errstr = '';
        
        // Connect to SMTP server
        $socket = fsockopen($this->smtpHost, $this->smtpPort, $errno, $errstr, 30);
        if (!$socket) {
            error_log("SMTP Connection Failed: $errstr ($errno)");
            return false;
        }
        
        // Read server greeting
        $this->getResponse($socket);
        
        // Send EHLO
        $this->sendCommand($socket, "EHLO " . $_SERVER['SERVER_NAME']);
        
        // Start TLS
        $this->sendCommand($socket, "STARTTLS");
        stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
        
        // Send EHLO again after TLS
        $this->sendCommand($socket, "EHLO " . $_SERVER['SERVER_NAME']);
        
        // Authentication
        $this->sendCommand($socket, "AUTH LOGIN");
        $this->sendCommand($socket, base64_encode($this->smtpUser));
        $this->sendCommand($socket, base64_encode($this->smtpPass));
        
        // Send email
        $this->sendCommand($socket, "MAIL FROM:<{$this->fromEmail}>");
        $this->sendCommand($socket, "RCPT TO:<$to>");
        $this->sendCommand($socket, "DATA");
        
        // Send headers and message
        $this->sendCommand($socket, $headers . "\r\n" . $message . "\r\n.");
        
        // Close connection
        $this->sendCommand($socket, "QUIT");
        fclose($socket);
        
        return true;
    }
    
    private function sendCommand($socket, $command) {
        fwrite($socket, $command . "\r\n");
        return $this->getResponse($socket);
    }
    
    private function getResponse($socket) {
        $response = '';
        while ($str = fgets($socket, 515)) {
            $response .= $str;
            if (substr($str, 3, 1) == ' ') break;
        }
        return $response;
    }
    
    public function sendShareRequest($email, $requesterName, $shareLink) {
        $subject = "=?UTF-8?B?" . base64_encode("$requesterName möchte Ihren Bildschirm sehen") . "?=";
        
        // HTML Email Body
        $htmlMessage = <<<HTML
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
        <h2 style="color: #333;">Bildschirmfreigabe-Anfrage</h2>
        <p>Hallo,</p>
        <p><strong>{$requesterName}</strong> möchte Ihren Bildschirm sehen.</p>
        <p>Um die Anfrage zu akzeptieren und Ihren Bildschirm freizugeben, klicken Sie bitte auf den folgenden Link:</p>
        <p>
            <a href="{$shareLink}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">
                Bildschirm freigeben
            </a>
        </p>
        <p>Oder kopieren Sie diesen Link in Ihren Browser:</p>
        <p style="word-break: break-all;">{$shareLink}</p>
        <div style="margin-top: 30px; font-size: 12px; color: #666;">
            <p>Dies ist eine automatisch generierte E-Mail. Bitte antworten Sie nicht darauf.</p>
            <p>Falls Sie diese Anfrage nicht erwartet haben, können Sie diese E-Mail ignorieren.</p>
        </div>
    </div>
</body>
</html>
HTML;

        // Plain text version
        $textMessage = <<<TEXT
Bildschirmfreigabe-Anfrage

Hallo,

{$requesterName} möchte Ihren Bildschirm sehen.

Um die Anfrage zu akzeptieren und Ihren Bildschirm freizugeben, öffnen Sie bitte den folgenden Link in Ihrem Browser:

{$shareLink}

Falls Sie diese Anfrage nicht erwartet haben, können Sie diese E-Mail ignorieren.

Dies ist eine automatisch generierte E-Mail. Bitte antworten Sie nicht darauf.
TEXT;

        // Generate a boundary
        $boundary = md5(time());

        // Prepare headers differently for SMTP
        $headers = "MIME-Version: 1.0\r\n";
        $headers .= "From: {$this->fromName} <{$this->fromEmail}>\r\n";
        $headers .= "Reply-To: {$this->fromEmail}\r\n";
        $headers .= "Subject: =?UTF-8?B?" . base64_encode("$requesterName möchte Ihren Bildschirm sehen") . "?=\r\n";
        $headers .= "Content-Type: multipart/alternative; boundary=\"$boundary\"\r\n";
        
        // Email body with both HTML and plain text
        $message = <<<EMAIL
--{$boundary}
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit

{$textMessage}

--{$boundary}
Content-Type: text/html; charset=UTF-8
Content-Transfer-Encoding: 8bit

{$htmlMessage}

--{$boundary}--
EMAIL;

        // Use SMTP instead of mail()
        $success = $this->sendSMTP($email, $subject, $message, $headers);
        
        if (!$success) {
            error_log("Failed to send email to $email");
        }
        
        return $success;
    }
}
