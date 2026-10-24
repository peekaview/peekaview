<?php
declare(strict_types=1);
require dirname(__DIR__).'/Rooms.php';
use PeekaView\Rooms;
use PeekaView\Problem;

$checks=0;$outbox=[];$failMail=false;$db=new PDO('sqlite::memory:');
function check(bool $ok,string $message):void {global $checks;++$checks;if(!$ok)throw new RuntimeException($message);}
function denied(callable $run,int $status):void {try{$run();throw new RuntimeException('Expected denial');}catch(Problem $e){check($e->status===$status,$e->getMessage());}}
$mail=function($to,$subject,$body)use(&$outbox,&$failMail){
    if($failMail)throw new Problem(503,'Mailversand fehlgeschlagen.');
    preg_match('/invite=([^&\s]+)/',$body,$m);$outbox[]=['to'=>$to,'token'=>$m[1],'body'=>$body];
};
$service=new Rooms($db,$mail,'https://peekaview.de');
$api='https://rooms.example.test/api.php';
$request=['email'=>'owner@example.test','next_action'=>'contact','contact_email'=>'Friend@Example.test','_api'=>$api];
$service->requestDevice($request);
$link=$outbox[0]['token'];
check(count($outbox)===1 && $outbox[0]['to']==='owner@example.test','Only the owner receives mail before verification');
check(str_contains($outbox[0]['body'],'friend@example.test'),'Confirmation mail explains which invitation will be sent');
check(str_contains($outbox[0]['body'],'auf dem Gerät, das du hinzufügen möchtest'),'Confirmation mail explicitly says which device must open the link');
check($service->preview($link)['contact_email']==='friend@example.test','Recipient is stored with the verification link');
$opening=['invitation'=>$link,'handoff'=>str_repeat('a',32)];
check($service->desktopOpening($opening,false)===['opened'=>false],'An unopened desktop link has no receipt');
check($db->query('SELECT COUNT(*) FROM desktop_openings')->fetchColumn()===0,'Status checks create no receipts');
check($service->desktopOpening($opening,true)===['opened'=>true],'Desktop acknowledges this browser opening attempt');
check($service->desktopOpening([...$opening,'handoff'=>str_repeat('b',32)],false)===['opened'=>false],'Another tab or attempt cannot reuse the receipt');
check($service->desktopOpening([...$opening,'invitation'=>'another-link'],false)===['opened'=>false],'Receipt is bound to its invitation');
check(count($outbox)===1 && $db->query('SELECT COUNT(*) FROM devices')->fetchColumn()===0,'Desktop acknowledgement neither confirms a device nor sends mail');
denied(fn()=>$service->desktopOpening([...$opening,'handoff'=>'bad'],true),400);
denied(fn()=>$service->desktopOpening([...$opening,'invitation'=>'invalid'],true),410);
$db->exec('UPDATE desktop_openings SET expires=0');
check($service->desktopOpening($opening,false)===['opened'=>false],'Old receipts expire');
$service->desktopOpening($opening,true);
$service->preview($link);
check(count($outbox)===1,'Link previews do not send the invitation');
$body=['invitation'=>$link,'name'=>'Other browser','platform'=>'browser','_api'=>$api,'contact_email'=>'attacker@example.test'];
$accepted=$service->accept($body,null);
check($service->desktopOpening($opening,false)===['opened'=>true],'Opening receipt survives device acceptance so the browser can finish polling');
denied(fn()=>$service->desktopOpening($opening,true),410);
check(count($outbox)===2 && $outbox[1]['to']==='friend@example.test','Confirmation sends to the stored recipient without another form');
check($accepted['invited_email']==='friend@example.test' && $accepted['next_action']===null,'Result completes the invitation action');
check($service->preview($outbox[1]['token'])['sender_email']==='owner@example.test','Invitation comes from the verified owner');
denied(fn()=>$service->desktopOpening(['invitation'=>$outbox[1]['token'],'handoff'=>str_repeat('c',32)],true),400);
check($service->state($accepted['device'])['invitations'][0]['email']==='friend@example.test','Pending invitation is visible after verification');
denied(fn()=>$service->accept($body,null),410);
check(count($outbox)===2,'Replaying a used link sends no duplicate mail');
$service->accept(['invitation'=>$outbox[1]['token'],'name'=>'Friend','platform'=>'android'],null);
check($service->state($accepted['device'])['contacts'][0]['email']==='friend@example.test','Recipient acceptance creates the normal contact');
denied(fn()=>$service->requestDevice([...$request,'contact_email'=>'not-an-email']),400);
denied(fn()=>$service->requestDevice([...$request,'contact_email'=>'OWNER@example.test']),400);
denied(fn()=>$service->requestDevice([...$request,'next_action'=>'login']),400);

$service->requestDevice([...$request,'email'=>'retry@example.test','contact_email'=>'recipient@example.test']);
$retry=['invitation'=>end($outbox)['token'],'name'=>'Retry','platform'=>'desktop','_api'=>$api];
$before=count($outbox);$devices=$db->query('SELECT COUNT(*) FROM devices')->fetchColumn();
$failMail=true;
denied(fn()=>$service->accept($retry,null),503);
check(count($outbox)===$before,'Failed delivery does not claim a sent invitation');
check($db->query('SELECT COUNT(*) FROM devices')->fetchColumn()===$devices,'Failed delivery rolls back device registration');
check($service->preview($retry['invitation'])['contact_email']==='recipient@example.test','Failed delivery keeps the original confirmation usable');
$failMail=false;
$service->accept($retry,null);
check(count($outbox)===$before+1 && end($outbox)['to']==='recipient@example.test','Retry sends the remembered invitation once');
denied(fn()=>$service->accept($retry,null),410);

$service->requestDevice([...$request,'email'=>'expired@example.test','contact_email'=>'never@example.test']);
$expired=end($outbox)['token'];$before=count($outbox);
$db->prepare('UPDATE invitations SET expires=0 WHERE hash=?')->execute([hash('sha256',$expired)]);
denied(fn()=>$service->accept(['invitation'=>$expired,'name'=>'Expired','platform'=>'browser','_api'=>$api],null),410);
check(count($outbox)===$before,'Expired verification never sends an invitation');

$service->requestDevice(['email'=>'legacy@example.test','next_action'=>'contact','_api'=>$api]);
$legacy=end($outbox)['token'];
$db->exec('ALTER TABLE invitations DROP COLUMN contact_email; PRAGMA user_version=2');
$service=new Rooms($db,$mail,'https://peekaview.de');
check((int)$db->query('PRAGMA user_version')->fetchColumn()===4,'Existing databases migrate to the current profile schema');
check($service->device($accepted['token'])===$accepted['device'],'Migration preserves existing logins');
$before=count($outbox);
$old=$service->accept(['invitation'=>$legacy,'name'=>'Legacy','platform'=>'browser'],null);
check($old['next_action']==='contact' && $old['invited_email']===null && count($outbox)===$before,'Old verification links retain their existing behavior');
echo "$checks Prüfungen für vorgemerkte Einladungen erfolgreich.\n";
