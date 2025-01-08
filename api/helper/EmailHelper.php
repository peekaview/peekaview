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
        $response = $this->getResponse($socket);
        if (!$this->checkResponse($response, '220')) {
            error_log("SMTP Error: Invalid greeting: " . $response);
            return false;
        }
        
        // Send EHLO
        if (!$this->checkResponse($this->sendCommand($socket, "EHLO " . $this->smtpHost), '250')) {
            error_log("SMTP Error: EHLO failed");
            return false;
        }
        
        // Start TLS
        if (!$this->checkResponse($this->sendCommand($socket, "STARTTLS"), '220')) {
            error_log("SMTP Error: STARTTLS failed");
            return false;
        }
        
        if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            error_log("SMTP Error: TLS negotiation failed");
            return false;
        }
        
        // Send EHLO again after TLS
        if (!$this->checkResponse($this->sendCommand($socket, "EHLO " . $this->smtpHost), '250')) {
            error_log("SMTP Error: Second EHLO failed");
            return false;
        }
        
        // Authentication
        if (!$this->checkResponse($this->sendCommand($socket, "AUTH LOGIN"), '334')) {
            error_log("SMTP Error: AUTH LOGIN failed");
            return false;
        }
        if (!$this->checkResponse($this->sendCommand($socket, base64_encode($this->smtpUser)), '334')) {
            error_log("SMTP Error: Username rejected");
            return false;
        }
        if (!$this->checkResponse($this->sendCommand($socket, base64_encode($this->smtpPass)), '235')) {
            error_log("SMTP Error: Authentication failed");
            return false;
        }
        
        // Send email
        if (!$this->checkResponse($this->sendCommand($socket, "MAIL FROM:<{$this->fromEmail}>"), '250')) {
            error_log("SMTP Error: MAIL FROM rejected");
            return false;
        }
        if (!$this->checkResponse($this->sendCommand($socket, "RCPT TO:<$to>"), '250')) {
            error_log("SMTP Error: RCPT TO rejected");
            return false;
        }
        if (!$this->checkResponse($this->sendCommand($socket, "DATA"), '354')) {
            error_log("SMTP Error: DATA command failed");
            return false;
        }
        
        // Send headers and message
        $fullMessage = $headers;
        $fullMessage .= "\r\n";
        $fullMessage .= $message;
        
        if (!$this->checkResponse($this->sendCommand($socket, $fullMessage . "\r\n."), '250')) {
            error_log("SMTP Error: Message content rejected");
            return false;
        }
        
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
    
    private function checkResponse($response, $expectedCode) {
        $code = substr($response, 0, 3);
        return $code === $expectedCode;
    }
    
    private function sendEmail($to, $subject, $htmlContent, $textContent) {
        $boundary = md5(time());
        
        // Headers
        $headers = "Date: " . date("r") . "\r\n";
        $headers .= "Message-ID: <" . time() . rand(1000, 9999) . "@" . $_SERVER['HTTP_HOST'] . ">\r\n";
        $headers .= "MIME-Version: 1.0\r\n";
        $headers .= "From: {$this->fromName} <{$this->fromEmail}>\r\n";
        $headers .= "Reply-To: {$this->fromEmail}\r\n";
        $headers .= "To: <$to>\r\n";
        $headers .= "Subject: $subject\r\n";
        $headers .= "Content-Type: multipart/alternative; boundary=\"$boundary\"\r\n";
        
        // Message
        $message = "This is a multi-part message in MIME format.\r\n\r\n";
        $message .= "--{$boundary}\r\n";
        $message .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $message .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
        $message .= $textContent . "\r\n\r\n";
        $message .= "--{$boundary}\r\n";
        $message .= "Content-Type: text/html; charset=UTF-8\r\n";
        $message .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
        $message .= $htmlContent . "\r\n\r\n";
        $message .= "--{$boundary}--\r\n";

        return $this->sendSMTP($to, $subject, $message, $headers);
    }
    
    public function sendShareRequest($email, $requesterName, $shareLink) {
        $subject = "=?UTF-8?B?" . base64_encode("$requesterName möchte Ihren Bildschirm sehen") . "?=";
        
        $htmlContent = <<<HTML
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
        <h2 style="color: #333;">Bildschirmfreigabe-Anfrage</h2>
        <p>Hallo,</p>
        <p><strong>{$requesterName}</strong> möchte Ihren Bildschirm über PeekaView sehen.</p>
        <p><a href="{$shareLink}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Bildschirm freigeben</a></p>
        <p>Oder nutzen Sie diesen Link: {$shareLink}</p>
        <div style="margin-top: 30px; font-size: 12px; color: #666;">
            <p>Dies ist eine automatische E-Mail. Bitte nicht antworten.</p>
        </div>
    </div>
</body>
</html>
HTML;

        $textContent = <<<TEXT
Bildschirmfreigabe-Anfrage

Hallo,

{$requesterName} möchte Ihren Bildschirm über PeekaView sehen.

Nutzen Sie diesen Link zur Freigabe: {$shareLink}

Dies ist eine automatische E-Mail. Bitte nicht antworten.
TEXT;

        return $this->sendEmail($email, $subject, $htmlContent, $textContent);
    }
    
    public function sendRegistrationConfirmation($email, $confirmLink) {
        $subject = "=?UTF-8?B?" . base64_encode("Bestätigen Sie Ihre Registrierung") . "?=";
        
        $htmlContent = <<<HTML
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
        <h2 style="color: #333;">Registrierung bestätigen</h2>
        <p>Hallo und willkommen bei PeekaView,</p>
        <p>vielen Dank für Ihre Registrierung. Bitte bestätigen Sie Ihre E-Mail-Adresse:</p>
        <p><a href="{$confirmLink}" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 5px;">E-Mail bestätigen</a></p>
        <p>Oder nutzen Sie diesen Link: {$confirmLink}</p>
        <div style="margin-top: 30px; font-size: 12px; color: #666;">
            <p>Dies ist eine automatische E-Mail. Bitte nicht antworten.</p>
        </div>
    </div>
</body>
</html>
HTML;

        $textContent = <<<TEXT
Registrierung bestätigen

Hallo und willkommen bei PeekaView,

vielen Dank für Ihre Registrierung. Bitte bestätigen Sie Ihre E-Mail-Adresse über diesen Link:

{$confirmLink}

Dies ist eine automatische E-Mail. Bitte nicht antworten.
TEXT;

        return $this->sendEmail($email, $subject, $htmlContent, $textContent);
    }
}
