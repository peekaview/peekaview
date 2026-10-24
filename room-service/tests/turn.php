<?php
// TURN credentials: coturn's use-auth-secret scheme, nothing without configuration.
declare(strict_types=1);
require dirname(__DIR__).'/Rooms.php';
use PeekaView\Rooms;
function check(bool $ok, string $what): void { if (!$ok) { fwrite(STDERR, "FAIL: $what\n"); exit(1); } }
$servers = Rooms::turnServers('turn:t.example:3478?transport=udp, turns:t.example:5349?transport=tcp, http://evil', 'geheim', 1000);
check(count($servers) === 1, 'one server entry');
check($servers[0]['urls'] === ['turn:t.example:3478?transport=udp', 'turns:t.example:5349?transport=tcp'], 'only turn:/turns: URLs');
check($servers[0]['username'] === (1000 + Rooms::TURN_TTL).':peekaview', 'username is expiry:peekaview');
check($servers[0]['credential'] === base64_encode(hash_hmac('sha1', $servers[0]['username'], 'geheim', true)), 'HMAC-SHA1 credential');
check(Rooms::turnServers('', 'geheim', 1000) === [] && Rooms::turnServers('turn:t.example:3478', '', 1000) === [], 'empty without URLs or secret');
echo "turn ok\n";
