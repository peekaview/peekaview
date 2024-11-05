<?php
// Neue Datei: email_helper.php

class EmailHelper {
    private $fromEmail = 'noreply@peekaview.de';
    private $fromName = 'Peekaview';
    
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

        // Email headers
        $headers = array(
            'MIME-Version: 1.0',
            'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
            'From: ' . $this->fromName . ' <' . $this->fromEmail . '>',
            'Reply-To: ' . $this->fromEmail,
            'X-Mailer: PHP/' . phpversion()
        );

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

        // Send email
        $success = @mail($email, $subject, $message, implode("\r\n", $headers));
        
        if (!$success) {
            error_log("Failed to send email to $email: " . @error_get_last()['message']);
        }
        
        return $success;
    }
}
