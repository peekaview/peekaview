<?php
declare(strict_types=1);

require dirname(__DIR__) . '/Rooms.php';
require dirname(__DIR__) . '/vendor/autoload.php';

use PeekaView\Problem;
use PeekaView\Rooms;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Vary: Origin');

try {
    require dirname(__DIR__).'/config.php';
    $site = rtrim(getenv('PEEKAVIEW_SITE') ?: 'https://peekaview.de','/');
    $api = getenv('PEEKAVIEW_API_URL');
    if (!$api) throw new RuntimeException('PEEKAVIEW_API_URL fehlt.');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = array_filter(array_map('trim',explode(',',getenv('PEEKAVIEW_ORIGINS') ?: "$site,tauri://localhost,http://tauri.localhost,https://tauri.localhost,https://appassets.androidplatform.net")));
    if ($origin !== '') {
        if (!in_array($origin,$allowed,true)) throw new Problem(403,'Diese Website darf den Raumdienst nicht verwenden.');
        header('Access-Control-Allow-Origin: '.$origin);
        header('Access-Control-Allow-Headers: Authorization, Content-Type');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    }
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
    if (!in_array($_SERVER['REQUEST_METHOD'],['GET','POST'],true)) throw new Problem(405,'Methode nicht erlaubt.');
    $path = getenv('PEEKAVIEW_DATA_DIR') ?: dirname(__DIR__).'/data';
    if (!is_dir($path) && !mkdir($path,0700,true)) throw new RuntimeException('Datenverzeichnis kann nicht angelegt werden.');
    umask(0077);
    $service = new Rooms(new PDO('sqlite:'.$path.'/rooms.sqlite'), static function(string $to,string $subject,string $text): void {
        $from = getenv('PEEKAVIEW_MAIL_FROM');
        if (!$from || !filter_var($from,FILTER_VALIDATE_EMAIL)) throw new RuntimeException('PEEKAVIEW_MAIL_FROM fehlt oder ist ungültig.');
        if (!mail($to,mb_encode_mimeheader($subject,'UTF-8'),$text,['From'=>$from,'Content-Type'=>'text/plain; charset=UTF-8'])) throw new Problem(503,'Die Einladung konnte nicht per E-Mail versendet werden.');
    },$site);
    $action = $_GET['action'] ?? 'config';
    $body = [];
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''),'application/json')) throw new Problem(415,'JSON erforderlich.');
        $raw = file_get_contents('php://input',false,null,0,16385);
        if (strlen($raw)>16384) throw new Problem(413,'Anfrage zu groß.');
        $body = json_decode($raw,true,32,JSON_THROW_ON_ERROR);
        if (!is_array($body)) throw new Problem(400,'Ungültige Anfrage.');
    }
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $token = str_starts_with($authorization,'Bearer ') ? substr($authorization,7) : '';
    $device = $token !== '' ? $service->device($token) : null;
    if ($action === 'config' && $_SERVER['REQUEST_METHOD'] === 'GET') {
        $result=['vapidPublicKey'=>getenv('PEEKAVIEW_VAPID_PUBLIC_KEY') ?: null];
    } elseif ($action === 'turn' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        // short-lived TURN credentials for a presenter (coturn use-auth-secret): nobody has to
        // set up a TURN server, and the secret never leaves this server
        $service->limit('turn:'.($_SERVER['REMOTE_ADDR'] ?? ''),120,3600);
        $result=['iceServers'=>Rooms::turnServers(getenv('PEEKAVIEW_TURN_URLS') ?: '',getenv('PEEKAVIEW_TURN_SECRET') ?: '',time())];
    } elseif ($action === 'invitation/preview' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $service->limit('preview:'.($_SERVER['REMOTE_ADDR'] ?? ''),60,60);
        $result=$service->preview((string)($body['invitation'] ?? ''));
    } elseif ($action === 'device/request' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $service->limit('mail-ip:'.($_SERVER['REMOTE_ADDR'] ?? ''),15,3600);
        $result=$service->requestDevice([...$body,'_api'=>$api]);
    } elseif (in_array($action,['invitation/opened','invitation/open-status'],true) && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $service->limit('desktop-open:'.($_SERVER['REMOTE_ADDR'] ?? ''),120,60);
        $result=$service->desktopOpening($body,$action==='invitation/opened');
    } elseif ($action === 'invitation/accept' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $service->limit('accept:'.($_SERVER['REMOTE_ADDR'] ?? ''),30,60);
        $result=$service->accept([...$body,'_api'=>$api],$device);
    } else {
        if (!$device) throw new Problem(401,'Bitte bestätige zuerst dieses Gerät per E-Mail.');
        if ($action === 'state' && $_SERVER['REQUEST_METHOD'] === 'GET') {
            $version=(int)($_GET['v'] ?? 1);
            if (!in_array($version,[1,2],true)) throw new Problem(400,'Unbekannte API-Version.');
            $result=$service->state($device,$version);
        }
        elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $result=$service->mutate($device,(string)$action,[...$body,'_api'=>$api]);
        } else throw new Problem(405,'Methode nicht erlaubt.');
    }
    $notify=$result['notify_call'] ?? (in_array($action,['calls/start','calls/direct'],true) && !empty($result['ring']) ? $result['id'] : null);
    $targets=$notify ? $service->pushTargets($notify,$result['notify_device'] ?? null,!empty($result['notify_joined'])) : [];
    if (!empty($result['answered_call'])) {
        $notify=$result['answered_call'];
        $targets=[...$targets,...$service->pushTargets($notify,null,false,$result['answered_email'])];
    }
    if ($notify) {
        if ($targets) {
            $public=getenv('PEEKAVIEW_VAPID_PUBLIC_KEY'); $private=getenv('PEEKAVIEW_VAPID_PRIVATE_KEY'); $subject=getenv('PEEKAVIEW_VAPID_SUBJECT');
            if (!$public || !$private || !$subject) throw new RuntimeException('VAPID-Konfiguration für Web Push fehlt.');
            $push=new WebPush(['VAPID'=>['subject'=>$subject,'publicKey'=>$public,'privateKey'=>$private]],['TTL'=>45,'urgency'=>'high'],new \GuzzleHttp\Client(['timeout'=>5,'allow_redirects'=>false]));
            $push->setReuseVAPIDHeaders(true);
            foreach ($targets as $target) {
                $subscription=Subscription::create(json_decode($target['subscription'],true,flags:JSON_THROW_ON_ERROR));
                // Older workers ignore control messages because these have no call field.
                $payload=!empty($target['answered']) ? ['answered_call'=>$notify] : ['call'=>$notify,'caller'=>$target['caller_name'],'admitted'=>!empty($result['notify_joined'])];
                $report=$push->sendOneNotification($subscription,json_encode([...$payload,'api'=>$api,'expires'=>time()+45],JSON_THROW_ON_ERROR));
                if ($report->isSubscriptionExpired()) $service->removePush($target['device']);
                elseif (!$report->isSuccess()) error_log('PeekaView: Push-Zustellung fehlgeschlagen: '.$report->getResponse()?->getStatusCode());
            }
        }
    }
    echo json_encode($result,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE);
} catch (Problem $e) {
    http_response_code($e->status); echo json_encode(['error'=>$e->getMessage()]);
} catch (JsonException $e) {
    http_response_code(400); echo json_encode(['error'=>'Ungültiges JSON.']);
} catch (Throwable $e) {
    error_log('PeekaView room service: '.$e->getMessage());
    http_response_code(500); echo json_encode(['error'=>'Der Raumdienst ist nicht einsatzbereit. Bitte die Serverkonfiguration prüfen.']);
}
