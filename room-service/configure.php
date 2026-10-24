<?php
declare(strict_types=1);
require __DIR__.'/vendor/autoload.php';
if(!in_array('argon2id',password_algos(),true)){fwrite(STDERR,"PHP mit Argon2id-Unterstützung für Gruppen-PINs erforderlich.\n");exit(1);}
$args=getopt('',['api-url:','from:']);
$api=$args['api-url'] ?? ''; $from=$args['from'] ?? '';
if(!filter_var($api,FILTER_VALIDATE_URL) || parse_url($api,PHP_URL_SCHEME)!=='https' || !filter_var($from,FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR,"Aufruf: php configure.php --api-url=https://DEIN-WEBSPACE/rooms/public/api.php --from=einladungen@example.org\n");exit(1);
}
if(is_file(__DIR__.'/.env')) {fwrite(STDERR,".env existiert bereits; vorhandene Push-Schlüssel dürfen nicht ersetzt werden.\n");exit(1);}
$keys=Minishlink\WebPush\VAPID::createVapidKeys();
umask(0077);
$contents="PEEKAVIEW_API_URL=$api\nPEEKAVIEW_SITE=https://peekaview.de\nPEEKAVIEW_MAIL_FROM=$from\nPEEKAVIEW_VAPID_SUBJECT=mailto:$from\nPEEKAVIEW_VAPID_PUBLIC_KEY={$keys['publicKey']}\nPEEKAVIEW_VAPID_PRIVATE_KEY={$keys['privateKey']}\n";
if(file_put_contents(__DIR__.'/.env',$contents,LOCK_EX)===false) throw new RuntimeException('.env konnte nicht angelegt werden.');
echo ".env mit Web-Push-Schlüsseln angelegt. Private Schlüssel bleiben in dieser Datei; nicht veröffentlichen.\n";
