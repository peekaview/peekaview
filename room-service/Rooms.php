<?php
declare(strict_types=1);

namespace PeekaView;

use PDO;
use RuntimeException;

final class Problem extends RuntimeException
{
    public function __construct(public readonly int $status, string $message) { parent::__construct($message); }
}

/** People share a verified email identity; authentication and capture permissions stay per device. */
final class Rooms
{
    public function __construct(private PDO $db, private \Closure $mail, private string $site)
    {
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        $db->exec(<<<SQL
          CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, seen INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL REFERENCES devices(id));
          CREATE TABLE IF NOT EXISTS members(room TEXT REFERENCES rooms(id) ON DELETE CASCADE, device TEXT REFERENCES devices(id), PRIMARY KEY(room, device));
          CREATE TABLE IF NOT EXISTS direct_rooms(room TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE, first TEXT NOT NULL REFERENCES devices(id), second TEXT NOT NULL REFERENCES devices(id), UNIQUE(first,second));
          CREATE TABLE IF NOT EXISTS group_settings(room TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE, pin_hash TEXT, version TEXT);
          CREATE TABLE IF NOT EXISTS group_access(room TEXT REFERENCES rooms(id) ON DELETE CASCADE, device TEXT REFERENCES devices(id), enabled INTEGER NOT NULL, PRIMARY KEY(room,device));
          CREATE TABLE IF NOT EXISTS pin_calls(call TEXT PRIMARY KEY REFERENCES calls(id), version TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, room TEXT REFERENCES rooms(id) ON DELETE CASCADE, email TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER, created INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS desktop_openings(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, room TEXT NOT NULL REFERENCES rooms(id), caller TEXT NOT NULL REFERENCES devices(id), created INTEGER NOT NULL, secret TEXT NOT NULL, ended INTEGER);
          CREATE UNIQUE INDEX IF NOT EXISTS active_room_call ON calls(room) WHERE ended IS NULL;
          CREATE TABLE IF NOT EXISTS call_members(voice_id INTEGER PRIMARY KEY AUTOINCREMENT, call TEXT NOT NULL REFERENCES calls(id), device TEXT NOT NULL REFERENCES devices(id), status TEXT NOT NULL, voice INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL, stream TEXT, UNIQUE(call, device));
          CREATE TABLE IF NOT EXISTS push(device TEXT PRIMARY KEY REFERENCES devices(id), subscription TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, start INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS contacts(first TEXT REFERENCES people(id), second TEXT REFERENCES people(id), PRIMARY KEY(first,second));
          CREATE TABLE IF NOT EXISTS person_direct_rooms(room TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE, first TEXT REFERENCES people(id), second TEXT REFERENCES people(id), UNIQUE(first,second));
          CREATE TABLE IF NOT EXISTS room_people(room TEXT REFERENCES rooms(id) ON DELETE CASCADE, person TEXT REFERENCES people(id), PRIMARY KEY(room,person));
          SQL);
        if ((int)$db->query('PRAGMA user_version')->fetchColumn()<2) {
            $db->exec('BEGIN IMMEDIATE');
            try {
                $columns=array_column($this->rows('PRAGMA table_info(invitations)'),'name');
                foreach (['sender'=>'TEXT REFERENCES devices(id)','next_action'=>'TEXT'] as $column=>$type) {
                    if (!in_array($column,$columns,true)) $db->exec("ALTER TABLE invitations ADD COLUMN $column $type");
                }
                $db->exec('UPDATE invitations SET sender=(SELECT owner FROM rooms WHERE rooms.id=invitations.room) WHERE sender IS NULL AND room IS NOT NULL');
                // Existing confirmed devices and memberships become people without changing their tokens.
                $db->exec("INSERT OR IGNORE INTO people(id,email,name) SELECT lower(hex(randomblob(8))),email,substr(email,1,instr(email,'@')-1) FROM devices GROUP BY email");
                $db->exec('INSERT OR IGNORE INTO person_direct_rooms(room,first,second) SELECT r.room,min(a.id,b.id),max(a.id,b.id) FROM direct_rooms r JOIN devices da ON da.id=r.first JOIN devices db ON db.id=r.second JOIN people a ON a.email=da.email JOIN people b ON b.email=db.email WHERE a.id<>b.id');
                $db->exec('INSERT OR IGNORE INTO room_people(room,person) SELECT m.room,p.id FROM members m JOIN devices d ON d.id=m.device JOIN people p ON p.email=d.email WHERE NOT EXISTS(SELECT 1 FROM direct_rooms r WHERE r.room=m.room) AND NOT EXISTS(SELECT 1 FROM person_direct_rooms r WHERE r.room=m.room)');
                foreach ($this->rows('SELECT room,person FROM room_people') as $membership) $this->addPerson($membership['room'],$membership['person'],true);
                $db->exec('PRAGMA user_version=2');
                $db->exec('COMMIT');
            } catch (\Throwable $e) {$db->exec('ROLLBACK');throw $e;}
        }
        if ((int)$db->query('PRAGMA user_version')->fetchColumn()<3) {
            $db->exec('BEGIN IMMEDIATE');
            try {
                if (!in_array('contact_email',array_column($this->rows('PRAGMA table_info(invitations)'),'name'),true)) $db->exec('ALTER TABLE invitations ADD COLUMN contact_email TEXT');
                $db->exec('PRAGMA user_version=3');
                $db->exec('COMMIT');
            } catch (\Throwable $e) {$db->exec('ROLLBACK');throw $e;}
        }
        if ((int)$db->query('PRAGMA user_version')->fetchColumn()<4) {
            // A profile must retain its groups even after its last device signs out.
            $db->exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
            try {
                $owner=array_values(array_filter($this->rows('PRAGMA foreign_key_list(rooms)'),fn($key)=>$key['from']==='owner'))[0] ?? null;
                if (($owner['table'] ?? '')!=='people') {
                    $db->exec('CREATE TABLE new_rooms(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner TEXT NOT NULL REFERENCES people(id))');
                    $db->exec('INSERT INTO new_rooms SELECT r.id,r.name,p.id FROM rooms r JOIN devices d ON d.id=r.owner JOIN people p ON p.email=d.email');
                    if ($db->query('SELECT COUNT(*) FROM new_rooms')->fetchColumn()!==$db->query('SELECT COUNT(*) FROM rooms')->fetchColumn()) throw new RuntimeException('Gruppen konnten keinem Profil zugeordnet werden.');
                    $db->exec('DROP TABLE rooms; ALTER TABLE new_rooms RENAME TO rooms');
                }
                if ($this->rows('PRAGMA foreign_key_check')) throw new RuntimeException('Ungültige Verknüpfung bei der Gruppenmigration.');
                $db->exec('PRAGMA user_version=4; COMMIT');
            } catch (\Throwable $e) {$db->exec('ROLLBACK');throw $e;}
            finally {$db->exec('PRAGMA foreign_keys=ON');}
        }
    }

    private function rows(string $sql, array $args = []): array
    {
        $q = $this->db->prepare($sql); $q->execute($args);
        return $q->fetchAll(PDO::FETCH_ASSOC);
    }
    private function run(string $sql, array $args = []): void { $q = $this->db->prepare($sql); $q->execute($args); }
    private static function id(): string { return bin2hex(random_bytes(8)); }
    private static function secret(): string { return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='); }
    private static function text(array $body, string $key, int $max = 80): string
    {
        $v = trim((string)($body[$key] ?? ''));
        if ($v === '' || strlen($v) > $max || preg_match('/[\x00-\x1f]/', $v)) throw new Problem(400, "Ungültiges Feld: $key");
        return $v;
    }
    public function limit(string $key, int $max, int $seconds): void
    {
        $this->run('INSERT INTO limits(key,count,start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN start < ? THEN 1 ELSE count+1 END, start=CASE WHEN start < ? THEN excluded.start ELSE start END', [$key, time(), time()-$seconds, time()-$seconds]);
        if ((int)$this->rows('SELECT count FROM limits WHERE key=?', [$key])[0]['count'] > $max) throw new Problem(429, 'Zu viele Versuche. Bitte später erneut versuchen.');
    }
    public function device(string $token): array
    {
        $d = $this->rows('SELECT id,email,name,platform FROM devices WHERE token_hash=?', [hash('sha256', $token)])[0] ?? null;
        if (!$d) throw new Problem(401, 'Dieses Gerät ist noch nicht bestätigt.');
        return $d;
    }
    private function member(array $d, string $room, bool $owner = false): array
    {
        $r = $this->rows('SELECT r.* FROM rooms r JOIN members m ON m.room=r.id WHERE r.id=? AND m.device=?', [$room, $d['id']])[0] ?? null;
        if (!$r || ($owner && !$this->owns($d,$r))) throw new Problem(403, 'Keine Berechtigung für diesen Raum.');
        if ($owner && $this->isDirect($room)) throw new Problem(403, 'Ein Kontaktgespräch gehört zu zwei Personen.');
        return $r;
    }
    private function owns(array $d,array $room): bool { return $room['owner']===$this->person($d)['id']; }
    private function person(array $d): array { return $this->rows('SELECT id,email,name FROM people WHERE email=?',[$d['email']])[0]; }
    private function isDirect(string $room): bool
    {
        return (bool)$this->rows('SELECT room FROM direct_rooms WHERE room=? UNION SELECT room FROM person_direct_rooms WHERE room=?',[$room,$room]);
    }
    private function knownPeople(array $d): array
    {
        $me=$this->person($d)['id'];
        return $this->rows('SELECT p.id,p.email,p.name, (SELECT MAX(c.created) FROM calls c JOIN person_direct_rooms r ON r.room=c.room WHERE (r.first=? AND r.second=p.id) OR (r.second=? AND r.first=p.id)) AS last_used FROM people p WHERE p.id<>? AND (EXISTS(SELECT 1 FROM contacts c WHERE (c.first=? AND c.second=p.id) OR (c.second=? AND c.first=p.id)) OR EXISTS(SELECT 1 FROM room_people a JOIN room_people b ON b.room=a.room WHERE a.person=? AND b.person=p.id) OR EXISTS(SELECT 1 FROM person_direct_rooms r WHERE (r.first=? AND r.second=p.id) OR (r.second=? AND r.first=p.id))) ORDER BY last_used DESC,p.name,p.email',[$me,$me,$me,$me,$me,$me,$me,$me]);
    }
    private function knownPerson(array $d, string $id): array
    {
        foreach ($this->knownPeople($d) as $p) if ($p['id']===$id) return $p;
        throw new Problem(403,'Dieser Kontakt ist noch nicht bestätigt.');
    }
    private function addPerson(string $room, string $person, bool $approval=false): ?string
    {
        $this->run('INSERT OR IGNORE INTO room_people(room,person) VALUES(?,?)',[$room,$person]);
        $call=null;
        foreach ($this->rows('SELECT d.id FROM devices d JOIN people p ON p.email=d.email WHERE p.id=?',[$person]) as $device) $call=$this->addMember($room,$device['id'],$approval) ?? $call;
        return $call;
    }
    private function directRoom(array $d, string $person): string
    {
        $other=$this->knownPerson($d,$person);
        $pair=[$this->person($d)['id'],$other['id']]; sort($pair);
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            $room=$this->rows('SELECT room FROM person_direct_rooms WHERE first=? AND second=?', $pair)[0]['room'] ?? null;
            if (!$room) {
                $room=self::id();
                $this->run('INSERT INTO rooms(id,name,owner) VALUES(?,?,?)', [$room,'Kontaktgespräch',$this->person($d)['id']]);
                $this->run('INSERT INTO person_direct_rooms(room,first,second) VALUES(?,?,?)', [$room,...$pair]);
            }
            foreach ($pair as $id) $this->addPerson($room,$id);
            $this->db->exec('COMMIT'); return $room;
        } catch (\Throwable $e) { $this->db->exec('ROLLBACK'); throw $e; }
    }
    private function call(array $d, string $id, bool $joined = false): array
    {
        $c = $this->rows('SELECT c.*,m.status FROM calls c JOIN call_members m ON m.call=c.id JOIN members r ON r.room=c.room AND r.device=m.device WHERE c.id=? AND m.device=? AND c.ended IS NULL', [$id, $d['id']])[0] ?? null;
        if (!$c || ($joined && $c['status'] !== 'joined')) throw new Problem(403, 'Du bist diesem Anruf nicht beigetreten.');
        return $c;
    }
    private function expire(): void
    {
        $this->run("UPDATE call_members SET status='left',voice=0,stream=NULL WHERE status='joined' AND seen < ?", [time()-50]);
        $this->run("UPDATE call_members SET status='missed' WHERE status='ringing' AND seen < ?", [time()-45]);
        $this->run("UPDATE call_members SET status='rejected' WHERE status='requested' AND seen < ?", [time()-300]);
        $this->run("UPDATE calls SET ended=? WHERE ended IS NULL AND NOT EXISTS(SELECT 1 FROM call_members m WHERE m.call=calls.id AND m.status='joined')", [time()]);
        $this->run('DELETE FROM limits WHERE start < ?', [time()-86400]);
    }
    public function requestDevice(array $body): array
    {
        $contact=null;
        if (isset($body['contact_email'])) {
            $contact=strtolower(self::text($body,'contact_email',254));
            if (!filter_var($contact,FILTER_VALIDATE_EMAIL) || ($body['next_action'] ?? '')!=='contact') throw new Problem(400,'Bitte eine gültige E-Mail-Adresse der eingeladenen Person eingeben.');
            if ($contact===strtolower(trim((string)($body['email'] ?? '')))) throw new Problem(400,'Du kannst dich nicht selbst als Kontakt einladen.');
        }
        return $this->invite(null,$body,null,$contact);
    }
    private function addMember(string $room, string $device, bool $approval = false): ?string
    {
        if ($this->rows('SELECT device FROM members WHERE room=? AND device=?',[$room,$device])) return null;
        $this->run('INSERT INTO members(room,device) VALUES(?,?)',[$room,$device]);
        $call=$this->rows("SELECT c.id FROM calls c WHERE c.room=? AND c.ended IS NULL AND EXISTS(SELECT 1 FROM call_members m WHERE m.call=c.id AND m.status='joined' AND m.seen>=?)",[$room,time()-50])[0]['id'] ?? null;
        if ($call) $this->run('INSERT INTO call_members(call,device,status,seen) VALUES(?,?,?,?)',[$call,$device,$approval?'requested':'ringing',time()]);
        return $call;
    }
    private function invite(?string $room, array $body, ?array $sender=null, ?string $contact=null): array
    {
        $email = strtolower(self::text($body, 'email', 254));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new Problem(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
        $this->limit('mail:'.$email, 5, 3600);
        $token = self::secret(); $id = self::id();
        $next=$body['next_action'] ?? null;
        if ($next!==null && !in_array($next,['contact','group','login'],true)) throw new Problem(400,'Ungültiges Einladungsziel.');
        if ($sender && $room===null && $sender['email']===$email) throw new Problem(400,'Du kannst dich nicht selbst als Kontakt einladen.');
        $this->run('INSERT INTO invitations(id,hash,room,email,expires,created,sender,next_action,contact_email) VALUES(?,?,?,?,?,?,?,?,?)', [$id, hash('sha256',$token), $room, $email, time()+86400, time(),$sender['id'] ?? null,$next,$contact]);
        $url = $this->site . '/fixed-rooms.html#' . http_build_query(['invite'=>$token, 'api'=>$body['_api']]);
        $name = $room ? $this->rows('SELECT name FROM rooms WHERE id=?', [$room])[0]['name'] : 'PeekaView';
        $from=$sender ? $this->person($sender) : null;
        $subject=$room ? "PeekaView: Einladung zu „{$name}“" : ($from ? "PeekaView: {$from['name']} möchte dich als Kontakt hinzufügen" : 'PeekaView: E-Mail-Adresse bestätigen');
        $message=$room ? "{$from['email']} lädt dich zur Gruppe „{$name}“ ein." : ($from ? "{$from['email']} möchte dich als Kontakt hinzufügen. Danach könnt ihr euch direkt anrufen." : 'Bestätige deine E-Mail-Adresse, damit dich deine Kontakte anrufen können.');
        if ($contact) $message="Bestätige deine E-Mail-Adresse, um $contact als Kontakt einzuladen. Nach deiner Bestätigung versenden wir die Einladung automatisch.";
        try { ($this->mail)($email, $subject, "$message\n\nWichtig: Öffne diesen Bestätigungslink auf dem Gerät, das du hinzufügen möchtest. Erst die Bestätigung auf diesem Gerät verbindet es mit deinem Account:\n$url\n\nDer Link gilt 24 Stunden und kann für ein Gerät verwendet werden."); }
        catch (\Throwable $e) { $this->run('DELETE FROM invitations WHERE id=?', [$id]); throw $e; }
        return ['sent'=>true];
    }
    public function preview(string $token): array
    {
        $i = $this->rows('SELECT i.email,i.room,r.name,i.next_action,i.contact_email,d.email AS sender_email,p.name AS sender_name FROM invitations i LEFT JOIN rooms r ON r.id=i.room LEFT JOIN devices d ON d.id=i.sender LEFT JOIN people p ON p.email=d.email WHERE i.hash=? AND i.used IS NULL AND i.expires>?', [hash('sha256',$token),time()])[0] ?? null;
        if (!$i) throw new Problem(410, 'Dieser Bestätigungslink ist abgelaufen oder wurde bereits verwendet.');
        $i['kind']=$i['room'] ? 'group' : ($i['sender_email'] ? 'contact' : 'device');
        return $i;
    }
    public function desktopOpening(array $body, bool $opened): array
    {
        $token=self::text($body,'invitation',100);
        $handoff=self::text($body,'handoff',32);
        if (!preg_match('/^[a-f0-9]{32}$/D',$handoff)) throw new Problem(400,'Ungültige Desktop-Anfrage.');
        $key=hash('sha256',$token.':'.$handoff);
        $this->run('DELETE FROM desktop_openings WHERE expires<=?',[time()]);
        if ($opened) {
            if ($this->preview($token)['kind']!=='device') throw new Problem(400,'Dieser Link bestätigt kein Gerät.');
            // This receipt only updates the browser UI. Device acceptance remains a separate action.
            $this->run('INSERT INTO desktop_openings(hash,expires) VALUES(?,?) ON CONFLICT(hash) DO UPDATE SET expires=excluded.expires',[$key,time()+120]);
        }
        return ['opened'=>(bool)$this->rows('SELECT hash FROM desktop_openings WHERE hash=?',[$key])];
    }
    public function accept(array $body, ?array $existing): array
    {
        $token = self::text($body, 'invitation', 100);
        $name = self::text($body, 'name'); $platform = self::text($body, 'platform', 20);
        if (!in_array($platform, ['browser','desktop','android'], true)) throw new Problem(400, 'Unbekannter Gerätetyp.');
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            $invite = $this->preview($token);
            if ($existing && $existing['email'] !== $invite['email']) throw new Problem(403, 'Die Einladung gehört zu einer anderen E-Mail-Adresse.');
            $id = $existing['id'] ?? self::id(); $auth = null;
            if (!$existing) {
                $auth = self::secret();
                $this->run('INSERT INTO devices(id,email,name,platform,token_hash,seen) VALUES(?,?,?,?,?,?)', [$id,$invite['email'],$name,$platform,hash('sha256',$auth),time()]);
            }
            $this->run('INSERT OR IGNORE INTO people(id,email,name) VALUES(?,?,?)',[self::id(),$invite['email'],explode('@',$invite['email'])[0]]);
            $person=$this->rows('SELECT id FROM people WHERE email=?',[$invite['email']])[0]['id'];
            if ($invite['kind']==='contact') {
                $pair=[$person,$this->rows('SELECT id FROM people WHERE email=?',[$invite['sender_email']])[0]['id']];sort($pair);
                $this->run('INSERT OR IGNORE INTO contacts(first,second) VALUES(?,?)',$pair);
            }
            $requested=$invite['room'] ? $this->addPerson($invite['room'],$person,true) : null;
            // A new, email-confirmed device inherits memberships, never another device's capture policy.
            foreach ($this->rows('SELECT room FROM room_people WHERE person=?',[$person]) as $membership) $this->addMember($membership['room'],$id,true);
            if ($invite['contact_email']) $this->invite(null,['email'=>$invite['contact_email'],'_api'=>$body['_api']],['id'=>$id,'email'=>$invite['email']]);
            $this->run('UPDATE invitations SET used=? WHERE hash=?', [time(),hash('sha256',$token)]);
            $this->db->exec('COMMIT');
            return ['token'=>$auth, 'device'=>['id'=>$id,'email'=>$invite['email'],'name'=>$existing['name'] ?? $name,'platform'=>$existing['platform'] ?? $platform], 'request_call'=>$requested,'next_action'=>$invite['contact_email'] ? null : $invite['next_action'],'invited_email'=>$invite['contact_email']];
        } catch (\Throwable $e) { $this->db->exec('ROLLBACK'); throw $e; }
    }
    public function state(array $d,int $version=2): array
    {
        $this->expire();
        $rooms = $this->rows('SELECT r.*, (SELECT MAX(c.created) FROM calls c JOIN call_members cm ON cm.call=c.id WHERE c.room=r.id AND cm.device=?) AS last_used FROM rooms r JOIN members m ON r.id=m.room WHERE m.device=? AND NOT EXISTS(SELECT 1 FROM direct_rooms dr WHERE dr.room=r.id) AND NOT EXISTS(SELECT 1 FROM person_direct_rooms dr WHERE dr.room=r.id) ORDER BY last_used DESC,r.name,r.id', [$d['id'],$d['id']]);
        foreach ($rooms as &$r) {
            $r['can_manage']=$this->owns($d,$r);
            $policy=$this->rows('SELECT pin_hash FROM group_settings WHERE room=?',[$r['id']])[0] ?? [];
            $r['pin']=!empty($policy['pin_hash']);
            $r['unattended']=!empty($this->rows('SELECT enabled FROM group_access WHERE room=? AND device=?',[$r['id'],$d['id']])[0]['enabled']);
            $r['pin_required']=(bool)$this->rows('SELECT device FROM group_access WHERE room=? AND enabled=1 LIMIT 1',[$r['id']]);
            $r['participants'] = $this->rows('SELECT d.id,d.email,d.name,d.platform FROM devices d JOIN members m ON m.device=d.id WHERE m.room=? ORDER BY d.email,d.name', [$r['id']]);
            $r['people']=$this->roomPeople($r['id']);
            $r['invitations'] = $r['can_manage'] ? $this->rows('SELECT id,email FROM invitations WHERE room=? AND used IS NULL AND expires>?', [$r['id'],time()]) : [];
            $r['active_call'] = $this->rows('SELECT id FROM calls WHERE room=? AND ended IS NULL', [$r['id']])[0]['id'] ?? null;
        }
        unset($r);
        $contacts=$this->knownPeople($d);
        foreach ($contacts as &$contact) $contact['devices']=$this->rows('SELECT id,name,platform FROM devices WHERE email=? ORDER BY name,id',[$contact['email']]);
        unset($contact);
        $calls = $this->rows("SELECT c.id,c.room,c.created,c.secret,c.caller,r.owner,r.name,p.name AS caller_name,m.status,m.voice_id FROM calls c JOIN rooms r ON r.id=c.room JOIN devices d ON d.id=c.caller JOIN people p ON p.email=d.email JOIN call_members m ON m.call=c.id JOIN members a ON a.room=c.room AND a.device=m.device WHERE m.device=? AND c.ended IS NULL AND m.status IN ('joined','ringing','requested','rejected')", [$d['id']]);
        foreach ($calls as &$c) {
            $c['can_manage']=$c['status']==='joined' && ($c['caller']===$d['id'] || $this->owns($d,$c));
            $c['requests']=$c['can_manage'] ? $this->rows("SELECT d.id,d.email,d.name,d.platform,p.id AS person_id,p.name AS person_name FROM call_members m JOIN devices d ON d.id=m.device JOIN people p ON p.email=d.email WHERE m.call=? AND m.status='requested' ORDER BY m.seen,d.id",[$c['id']]) : [];
            $c['pin']=!empty($this->rows('SELECT pin_hash FROM group_settings WHERE room=?',[$c['room']])[0]['pin_hash']);
            $c['unattended_allowed']=$this->autoAllowed($d,$c);
            $contact=$this->rows('SELECT d.email,d.name FROM direct_rooms dr JOIN members m ON m.room=dr.room JOIN devices d ON d.id=m.device WHERE dr.room=? AND d.id<>?', [$c['room'],$d['id']])[0] ?? null;
            $personRoom=$this->rows('SELECT p.id,p.email,p.name FROM person_direct_rooms r JOIN people p ON p.id=CASE WHEN r.first=? THEN r.second ELSE r.first END WHERE r.room=?',[$this->person($d)['id'],$c['room']])[0] ?? null;
            $c['kind']=($personRoom || $contact) ? 'contact' : 'group';
            if ($personRoom) {$c['name']=$personRoom['name'];$c['contact_id']=$personRoom['id'];}
            elseif ($contact) $c['name']=$contact['email'];
            if ($c['status'] === 'joined') {
                $c['participants'] = $this->rows("SELECT m.device AS id,m.voice_id,m.voice,m.stream,d.name,d.email,d.platform,p.id AS person_id,p.name AS person_name FROM call_members m JOIN devices d ON d.id=m.device JOIN people p ON p.email=d.email WHERE m.call=? AND m.status='joined'", [$c['id']]);
            } else { unset($c['secret']); $c['participants'] = []; }
        }
        // Explicit v1 serialization keeps already-published clients usable during the rollout.
        if ($version===1) {
            $devices=[];
            foreach ($contacts as $person) foreach ($person['devices'] as $device) $devices[]=[...$device,'email'=>$person['email'],'last_used'=>$person['last_used']];
            $contacts=$devices;
        }
        $person=$this->person($d);
        $person['devices']=$this->rows('SELECT id,name,platform FROM devices WHERE email=? ORDER BY name,id',[$d['email']]);
        return ['device'=>$d, 'person'=>$person, 'contacts'=>$contacts, 'rooms'=>$rooms, 'calls'=>$calls, 'invitations'=>$this->rows('SELECT DISTINCT i.email FROM invitations i JOIN devices sender ON sender.id=i.sender WHERE sender.email=? AND i.room IS NULL AND i.used IS NULL AND i.expires>? ORDER BY i.created DESC',[$d['email'],time()])];
    }
    private function roomPeople(string $room): array
    {
        $people=$this->rows('SELECT p.id,p.email,p.name FROM room_people r JOIN people p ON p.id=r.person WHERE r.room=? ORDER BY p.name,p.email',[$room]);
        foreach ($people as &$person) $person['devices']=$this->rows('SELECT d.id,d.name,d.platform FROM members m JOIN devices d ON d.id=m.device WHERE m.room=? AND d.email=? ORDER BY d.name,d.id',[$room,$person['email']]);
        return $people;
    }
    private function silenceOtherDevices(array $d,string $call): void
    {
        $this->run("UPDATE call_members SET status='answered',voice=0,stream=NULL WHERE call=? AND device<>? AND status='ringing' AND device IN (SELECT id FROM devices WHERE email=?) AND NOT EXISTS(SELECT 1 FROM group_access a JOIN calls c ON c.room=a.room WHERE c.id=call_members.call AND a.device=call_members.device AND a.enabled=1)",[$call,$d['id'],$d['email']]);
    }
    private function autoAllowed(array $d, array $call): bool
    {
        if (!in_array($call['status'],['ringing','joined'],true)) return false;
        return (bool)$this->rows('SELECT a.device FROM group_access a JOIN group_settings s ON s.room=a.room JOIN pin_calls p ON p.call=? AND p.version=s.version WHERE a.room=? AND a.device=? AND a.enabled=1 AND s.pin_hash IS NOT NULL',[$call['id'],$call['room'],$d['id']]);
    }
    private function requirePin(array $d, string $room, array $body): ?string
    {
        $policy=$this->rows('SELECT pin_hash,version FROM group_settings WHERE room=?',[$room])[0] ?? [];
        if (empty($policy['pin_hash'])) return null;
        $this->limit('pin:'.$room.':'.$d['id'],6,60);
        $pin=$body['pin'] ?? '';
        if (!is_string($pin) || strlen($pin)>512 || !password_verify($pin,$policy['pin_hash'])) throw new Problem(403,'Die Gruppen-PIN ist falsch.');
        return $policy['version'];
    }
    private function deleteCalls(string $where, array $args): void
    {
        $this->run("DELETE FROM pin_calls WHERE call IN (SELECT id FROM calls WHERE $where)",$args);
        $this->run("DELETE FROM call_members WHERE call IN (SELECT id FROM calls WHERE $where)",$args);
        $this->run("DELETE FROM calls WHERE $where",$args);
    }
    private function removeDevice(array $d): void
    {
        // Previously admitted devices know the call secret: end that call for everyone.
        foreach ($this->rows("SELECT id FROM calls WHERE ended IS NULL AND id IN (SELECT call FROM call_members WHERE device=? AND status='joined')",[$d['id']]) as $call) {
            $this->run('UPDATE calls SET ended=? WHERE id=?',[time(),$call['id']]);
            $this->run("UPDATE call_members SET status='left',voice=0,stream=NULL WHERE call=?",[$call['id']]);
        }
        $this->deleteCalls('caller=?',[$d['id']]);
        $this->run('DELETE FROM call_members WHERE device=?',[$d['id']]);
        $this->run('DELETE FROM group_access WHERE device=?',[$d['id']]);
        $this->run('DELETE FROM push WHERE device=?',[$d['id']]);
        $this->run('DELETE FROM members WHERE device=?',[$d['id']]);
        $this->run('DELETE FROM direct_rooms WHERE first=? OR second=?',[$d['id'],$d['id']]);
        $replacement=$this->rows('SELECT id FROM devices WHERE email=? AND id<>? ORDER BY id LIMIT 1',[$d['email'],$d['id']])[0]['id'] ?? null;
        if ($replacement) $this->run('UPDATE invitations SET sender=? WHERE sender=?',[$replacement,$d['id']]);
        else $this->run('DELETE FROM invitations WHERE sender=?',[$d['id']]);
        $this->run('DELETE FROM limits WHERE key=? OR key LIKE ?',['call:'.$d['id'],'pin:%:'.$d['id']]);
        $this->run('DELETE FROM devices WHERE id=?',[$d['id']]);
    }
    private function accountAction(array $d, string $action, array $b): array
    {
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            if ($action==='profile/delete') {
                if (strtolower(trim((string)($b['email'] ?? '')))!==$d['email']) throw new Problem(400,'Gib zum Löschen deine E-Mail-Adresse ein.');
                $person=$this->person($d)['id'];
                foreach ($this->rows('SELECT id FROM rooms WHERE owner=? UNION SELECT room AS id FROM person_direct_rooms WHERE first=? OR second=?',[$person,$person,$person]) as $room) {
                    $this->deleteCalls('room=?',[$room['id']]);
                    $this->run('DELETE FROM rooms WHERE id=?',[$room['id']]);
                }
                $this->run('DELETE FROM invitations WHERE email=? OR contact_email=?',[$d['email'],$d['email']]);
                foreach ($this->rows('SELECT id,email FROM devices WHERE email=?',[$d['email']]) as $own) $this->removeDevice($own);
                $this->run('DELETE FROM contacts WHERE first=? OR second=?',[$person,$person]);
                $this->run('DELETE FROM room_people WHERE person=?',[$person]);
                $this->run('DELETE FROM people WHERE id=?',[$person]);
                $this->run('DELETE FROM limits WHERE key=?',['mail:'.$d['email']]);
            } else {
                $id=$action==='session/logout' ? $d['id'] : self::text($b,'device',16);
                $own=$this->rows('SELECT id,email FROM devices WHERE id=? AND email=?',[$id,$d['email']])[0] ?? null;
                if (!$own) throw new Problem(403,'Du kannst nur eigene Geräte entfernen.');
                $this->removeDevice($own);
            }
            $this->db->exec('COMMIT');
            return ['ok'=>true];
        } catch (\Throwable $e) {$this->db->exec('ROLLBACK');throw $e;}
    }
    public function mutate(array $d, string $action, array $b): array
    {
        if (in_array($action,['session/logout','devices/remove','profile/delete'],true)) return $this->accountAction($d,$action,$b);
        if ($action==='contacts/invite') return $this->invite(null,$b,$d);
        if ($action==='rooms/add-contact') {
            $room=self::text($b,'room',16);$this->member($d,$room,true);
            $person=$this->knownPerson($d,self::text($b,'person',16));
            $this->db->exec('BEGIN IMMEDIATE');
            try {$call=$this->addPerson($room,$person['id']);$this->db->exec('COMMIT');}
            catch (\Throwable $e) {$this->db->exec('ROLLBACK');throw $e;}
            return ['added'=>true,'notify_call'=>$call];
        }
        if ($action==='rooms/settings') {
            $room=self::text($b,'room',16);$this->member($d,$room,true);
            $old=$this->rows('SELECT pin_hash,version FROM group_settings WHERE room=?',[$room])[0] ?? [];
            $hash=$old['pin_hash'] ?? null;$version=$old['version'] ?? null;
            if (!empty($b['pin_enabled'])) {
                $pin=$b['pin'] ?? '';
                if (!is_string($pin) || ($pin!=='' && (mb_strlen($pin)<6 || mb_strlen($pin)>128 || preg_match('/[\x00-\x1f]/',$pin)))) throw new Problem(400,'Die PIN braucht mindestens 6 und höchstens 128 Zeichen.');
                if ($pin!=='') {$hash=password_hash($pin,PASSWORD_ARGON2ID);$version=self::id();}
                if (!$hash) throw new Problem(400,'Bitte eine PIN mit mindestens 6 Zeichen festlegen.');
            } else {
                $hash=null;$version=null;
            }
            $this->db->exec('BEGIN IMMEDIATE');
            try {
                if (!$hash && $this->rows('SELECT device FROM group_access WHERE room=? AND enabled=1 LIMIT 1',[$room])) throw new Problem(400,'Unbeaufsichtigter Zugriff benötigt eine PIN.');
                $this->run('INSERT INTO group_settings(room,pin_hash,version) VALUES(?,?,?) ON CONFLICT(room) DO UPDATE SET pin_hash=excluded.pin_hash,version=excluded.version',[$room,$hash,$version]);
                if (($old['version'] ?? null)!==$version) {
                    $this->run("UPDATE call_members SET status='left',voice=0,stream=NULL WHERE call IN (SELECT id FROM calls WHERE room=? AND ended IS NULL)",[$room]);
                    $this->run('UPDATE calls SET ended=? WHERE room=? AND ended IS NULL',[time(),$room]);
                }
                $this->db->exec('COMMIT');
            } catch (\Throwable $e) {$this->db->exec('ROLLBACK');throw $e;}
            return ['saved'=>true];
        }
        if ($action==='rooms/access') {
            $room=self::text($b,'room',16);$this->member($d,$room);
            if ($this->isDirect($room)) throw new Problem(403,'Diese Einstellung gehört zu einer Gruppe.');
            if (!is_bool($b['unattended'] ?? null)) throw new Problem(400,'Ungültige Zugriffseinstellung.');
            $this->db->exec('BEGIN IMMEDIATE');
            try {
                if ($b['unattended'] && empty($this->rows('SELECT pin_hash FROM group_settings WHERE room=?',[$room])[0]['pin_hash'])) throw new Problem(400,'Unbeaufsichtigter Zugriff benötigt eine PIN mit mindestens 6 Zeichen.');
                $this->run('INSERT INTO group_access(room,device,enabled) VALUES(?,?,?) ON CONFLICT(room,device) DO UPDATE SET enabled=excluded.enabled',[$room,$d['id'],(int)$b['unattended']]);
                $this->db->exec('COMMIT');
            } catch (\Throwable $e) {$this->db->exec('ROLLBACK');throw $e;}
            return ['saved'=>true];
        }
        if ($action === 'rooms/create') {
            $name = self::text($b,'name'); $id = self::id();
            $people=$b['people'] ?? [];
            if (!is_array($people) || !array_is_list($people) || count($people)>64) throw new Problem(400,'Ungültige Kontaktauswahl.');
            foreach ($people as $person) {if (!is_string($person)) throw new Problem(400,'Ungültiger Kontakt.');$this->knownPerson($d,$person);}
            $this->db->beginTransaction();
            try {
                $this->run('INSERT INTO rooms(id,name,owner) VALUES(?,?,?)',[$id,$name,$this->person($d)['id']]);
                $this->addPerson($id,$this->person($d)['id']);
                foreach (array_unique($people) as $person) $this->addPerson($id,$person);
                $this->db->commit();
            }
            catch (\Throwable $e) { $this->db->rollBack(); throw $e; }
            return ['id'=>$id];
        }
        if ($action === 'rooms/invite' || $action === 'rooms/add-device') {
            $room = self::text($b,'room',16); $this->member($d,$room,true);
            if ($action === 'rooms/invite') return $this->invite($room,$b,$d);
            $device = self::text($b,'device',16);
            $known = $this->rows('SELECT b.device FROM members a JOIN members b ON a.room=b.room WHERE a.device=? AND b.device=?',[$d['id'],$device]);
            if (!$known) throw new Problem(403,'Nur bereits gemeinsam bestätigte Geräte können hinzugefügt werden.');
            $this->db->exec('BEGIN IMMEDIATE');
            try { $person=$this->rows('SELECT p.id FROM people p JOIN devices d ON d.email=p.email WHERE d.id=?',[$device])[0]['id'];$notify=$this->addPerson($room,$person);$this->db->exec('COMMIT'); }
            catch (\Throwable $e) { $this->db->exec('ROLLBACK');throw $e; }
            return ['added'=>true,'notify_call'=>$notify,'notify_device'=>$device];
        }
        if ($action === 'calls/direct') {
            $person=$b['person'] ?? null;
            if ($person===null) {
                $device=self::text($b,'device',16);
                $person=$this->rows('SELECT p.id FROM people p JOIN devices d ON d.email=p.email WHERE d.id=?',[$device])[0]['id'] ?? '';
            }
            $b['room']=$this->directRoom($d,(string)$person);
            $action='calls/start';
        }
        if ($action === 'calls/start') {
            $room = self::text($b,'room',16); $this->member($d,$room);
            $version=$this->requirePin($d,$room,$b);
            $this->expire(); $this->limit('call:'.$d['id'],20,60);
            $this->db->exec('BEGIN IMMEDIATE');
            try {
                if (($this->rows('SELECT version FROM group_settings WHERE room=?',[$room])[0]['version'] ?? null)!==$version) throw new Problem(403,'Die Gruppen-PIN wurde geändert. Bitte erneut eingeben.');
                $id = $this->rows('SELECT id FROM calls WHERE room=? AND ended IS NULL',[$room])[0]['id'] ?? null;
                $fresh = !$id;
                if ($id && $this->rows("SELECT device FROM call_members WHERE call=? AND device=? AND status IN ('requested','rejected')",[$id,$d['id']])) throw new Problem(403,'Die Aufnahme in die aktuelle Freigabe muss zuerst bestätigt werden.');
                if ($id && $this->isDirect($room) && $this->rows("SELECT m.device FROM call_members m JOIN devices other ON other.id=m.device WHERE m.call=? AND m.status='joined' AND other.email=? AND m.device<>?",[$id,$d['email'],$d['id']])) throw new Problem(409,'Du nimmst bereits auf einem anderen Gerät teil.');
                if ($fresh) {
                    $id=self::id(); $this->run('INSERT INTO calls(id,room,caller,created,secret) VALUES(?,?,?,?,?)',[$id,$room,$d['id'],time(),self::secret()]);
                    if ($version) $this->run('INSERT INTO pin_calls(call,version) VALUES(?,?)',[$id,$version]);
                    $this->run("INSERT INTO call_members(call,device,status,seen) SELECT ?,device,'ringing',? FROM members WHERE room=?",[$id,time(),$room]);
                }
                $this->run("INSERT OR IGNORE INTO call_members(call,device,status,seen) VALUES(?,?,'ringing',?)",[$id,$d['id'],time()]);
                $this->run("UPDATE call_members SET status='joined',seen=? WHERE call=? AND device=?",[time(),$id,$d['id']]);
                $this->silenceOtherDevices($d,$id);
                $this->db->exec('COMMIT'); return ['id'=>$id,'ring'=>$fresh];
            } catch (\Throwable $e) { $this->db->exec('ROLLBACK'); throw $e; }
        }
        if (str_starts_with($action,'calls/')) {
            $id=self::text($b,'call',16); $this->expire(); $c=$this->call($d,$id);
            if ($action==='calls/admit') {
                $this->call($d,$id,true);
                $room=$this->member($d,$c['room']);
                if ($c['caller']!==$d['id'] && !$this->owns($d,$room)) throw new Problem(403,'Nur der Anrufer oder Gruppenersteller darf Teilnehmer aufnehmen.');
                $device=self::text($b,'device',16);
                if (!is_bool($b['allow'] ?? null)) throw new Problem(400,'Ungültige Entscheidung.');
                $q=$this->db->prepare("UPDATE call_members SET status=?,seen=? WHERE call=? AND device=? AND status='requested'");
                $q->execute([$b['allow']?'joined':'rejected',time(),$id,$device]);
                if (!$q->rowCount()) throw new Problem(409,'Diese Beitrittsanfrage ist nicht mehr offen.');
                return ['ok'=>true,'notify_call'=>$b['allow']?$id:null,'notify_device'=>$device,'notify_joined'=>$b['allow']];
            }
            if ($action==='calls/join' || $action==='calls/auto-join') {
                $version=$action==='calls/join' ? $this->requirePin($d,$c['room'],$b) : null;
                $this->db->exec('BEGIN IMMEDIATE');
                try {
                    $c=$this->call($d,$id);
                    if (in_array($c['status'],['requested','rejected'],true)) throw new Problem(403,'Die Aufnahme in die aktuelle Freigabe muss zuerst bestätigt werden.');
                    if ($action==='calls/auto-join') {
                        if ($c['status']!=='ringing' || !$this->autoAllowed($d,$c)) throw new Problem(403,'Unbeaufsichtigter Zugriff ist für diesen Anruf nicht erlaubt.');
                    } elseif (($this->rows('SELECT version FROM group_settings WHERE room=?',[$c['room']])[0]['version'] ?? null)!==$version) throw new Problem(403,'Die Gruppen-PIN wurde geändert. Bitte erneut eingeben.');
                    if ($this->isDirect($c['room']) && $this->rows("SELECT m.device FROM call_members m JOIN devices other ON other.id=m.device WHERE m.call=? AND m.status='joined' AND other.email=? AND m.device<>?",[$id,$d['email'],$d['id']])) throw new Problem(409,'Du nimmst bereits auf einem anderen Gerät teil.');
                    $this->run("UPDATE call_members SET status='joined',seen=?,voice=0,stream=NULL WHERE call=? AND device=?",[time(),$id,$d['id']]);
                    $this->silenceOtherDevices($d,$id);
                    $this->db->exec('COMMIT');
                } catch (\Throwable $e) {$this->db->exec('ROLLBACK');throw $e;}
                return ['ok'=>true,'answered_call'=>$id,'answered_email'=>$d['email']];
            }
            if ($action === 'calls/decline' || $action === 'calls/leave') {
                $status = ['calls/decline'=>'declined','calls/leave'=>'left'][$action];
                if (in_array($c['status'],['requested','rejected'],true)) $status='rejected';
                $this->run('UPDATE call_members SET status=?,seen=?,voice=0,stream=NULL WHERE call=? AND device=?',[$status,time(),$id,$d['id']]);
                return ['ok'=>true];
            }
            $this->call($d,$id,true);
            if ($action === 'calls/heartbeat') {
                $this->run('UPDATE call_members SET seen=? WHERE call=? AND device=?',[time(),$id,$d['id']]);
                return ['ok'=>true];
            }
            if ($action === 'calls/stream') {
                $stream=$b['stream'] ?? null;
                if ($stream !== null && !preg_match('/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/D',$stream)) throw new Problem(400,'Ungültige Freigabe.');
                if ($stream===null) {
                    $previous=self::text($b,'previous',200);
                    $this->run('UPDATE call_members SET stream=NULL WHERE call=? AND device=? AND stream=?',[$id,$d['id'],$previous]);
                } else $this->run('UPDATE call_members SET stream=?,seen=? WHERE call=? AND device=?',[$stream,time(),$id,$d['id']]);
                return ['ok'=>true];
            }
            if ($action === 'calls/voice') {
                $this->run('UPDATE call_members SET voice=?,seen=? WHERE call=? AND device=?',[!empty($b['on'])?1:0,time(),$id,$d['id']]);
                return ['ok'=>true];
            }
        }
        if ($action === 'push/save') {
            $sub=$b['subscription'] ?? [];
            if (!is_array($sub) || !self::pushEndpoint($sub['endpoint'] ?? '') || empty($sub['keys']['p256dh']) || empty($sub['keys']['auth']) || strlen(json_encode($sub))>4096) throw new Problem(400,'Ungültiges Push-Abonnement.');
            $public=base64_decode(strtr($sub['keys']['p256dh'],'-_','+/'),true);
            $auth=base64_decode(strtr($sub['keys']['auth'],'-_','+/'),true);
            if($public===false || strlen($public)!==65 || $public[0]!=="\x04" || $auth===false || strlen($auth)!==16) throw new Problem(400,'Ungültige Push-Schlüssel.');
            $der=hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200').$public;
            if(!@openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der),64,"\n")."-----END PUBLIC KEY-----\n")) throw new Problem(400,'Ungültiger Push-Geräteschlüssel.');
            $sub['contentEncoding']='aes128gcm';
            $this->run('INSERT INTO push(device,subscription) VALUES(?,?) ON CONFLICT(device) DO UPDATE SET subscription=excluded.subscription',[$d['id'],json_encode($sub)]);
            return ['ok'=>true];
        }
        throw new Problem(404,'Unbekannte Aktion.');
    }
    /** The application must never turn a push subscription into an arbitrary HTTP request. */
    public static function pushEndpoint(string $url): bool
    {
        $u=parse_url($url); $host=strtolower($u['host'] ?? '');
        return ($u['scheme'] ?? '') === 'https' && !isset($u['user']) && !isset($u['pass']) && !isset($u['port'])
            && ($host === 'fcm.googleapis.com' || $host === 'updates.push.services.mozilla.com' || $host === 'web.push.apple.com' || str_ends_with($host,'.notify.windows.com'));
    }
    public function pushTargets(string $call, ?string $device = null, bool $joined = false, ?string $answeredEmail=null): array
    {
        return $this->rows("SELECT p.device,p.subscription,person.name AS caller_name,m.status='answered' AS answered FROM push p JOIN call_members m ON m.device=p.device JOIN calls c ON c.id=m.call JOIN devices d ON d.id=c.caller JOIN people person ON person.email=d.email WHERE m.call=? AND m.status=?".($device ? ' AND p.device=?' : '').($answeredEmail ? ' AND p.device IN (SELECT id FROM devices WHERE email=?)' : ''),[$call,$answeredEmail?'answered':($joined?'joined':'ringing'),...($device?[$device]:[]),...($answeredEmail?[$answeredEmail]:[])]);
    }
    public function removePush(string $device): void { $this->run('DELETE FROM push WHERE device=?',[$device]); }
}
