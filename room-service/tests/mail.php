<?php
// Only used as sendmail_path by the local HTTP integration test. Never sends real mail.
$folder=getenv('PEEKAVIEW_TEST_MAILBOX');
if(!$folder) exit(1);
file_put_contents($folder.'/'.bin2hex(random_bytes(8)).'.txt',file_get_contents('php://stdin'));
