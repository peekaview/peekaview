<?php
// Optional .env beside this file, outside public/. Process environment takes precedence.
$file=__DIR__.'/.env';
if(is_file($file)) {
    $values=parse_ini_file($file,false,INI_SCANNER_RAW);
    if($values===false) throw new RuntimeException('Ungültige .env-Datei.');
    foreach($values as $key=>$value) {
        if(str_starts_with($key,'PEEKAVIEW_') && getenv($key)===false) putenv($key.'='.$value);
    }
}
