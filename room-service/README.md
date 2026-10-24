# PeekaView-Raumdienst für PHP-Webspace

Eine PHP-API mit einer lokalen SQLite-Datei für Kontakte, Gruppen, bestätigte
Geräte, einmalige E-Mail-Einladungen und Web-Push-Anrufe. Bildschirm und Ton
bleiben Peer-to-Peer; der Dienst speichert keine Aufnahmen oder Transkripte.

## Einrichten

1. Aktuelles PHP 8.5 (mindestens 8.5.12) mit PDO SQLite, OpenSSL, mbstring, Argon2id und
   funktionierendem `mail()` des Webspaces bereitstellen.
2. Dieses Verzeichnis inklusive `vendor/` nach
   `/home/w18287/web/peekaview/.service/` hochladen. Damit liegen auch SQLite,
   Konfiguration und Schlüssel vollständig unter `web/peekaview`.
   Die beiliegende `.htaccess` sperrt die internen Dateien bei Apache;
   nginx ohne Apache benötigt eine entsprechende Zugriffssperre für `/.service/`.
   Unter `/home/w18287/web/peekaview/api.php` liegt nur dieser Einstieg:

   ```php
   <?php
   require __DIR__ . '/.service/public/api.php';
   ```

   Auch `public/.htaccess` neben diesen Einstieg kopieren. `CGIPassAuth On` reicht den
   Bearer-Anmeldeheader an PHP-CGI/FastCGI weiter; ohne diese Einstellung erscheint ein
   bereits per E-Mail bestätigtes Gerät bei nachfolgenden API-Aufrufen als unangemeldet.

3. Im Verzeichnis `.service/` einmal ausführen:

   ```sh
   php85 configure.php --api-url=https://peekaview.devxpert.de/api.php --from=info@peekaview.de
   ```

   Das erzeugt `.env` mit den VAPID-Schlüsseln. Die Absenderadresse muss für den
   Mailversand des Webspaces zugelassen sein. Bestehende Push-Schlüssel bleiben
   bei Updates erhalten.
4. `data/` muss durch PHP anlegbar und beschreibbar sein. `rooms.sqlite` entsteht
   beim ersten API-Aufruf automatisch. Die Datenbank enthält E-Mail-Adressen,
   Gerätezuordnungen und Raummitgliedschaften; sie darf nicht herunterladbar sein.
5. Vor der Nutzung prüfen: `https://peekaview.devxpert.de/api.php?action=config`
   muss antworten; `/.service/.env`, `/.service/data/rooms.sqlite` und
   `/.service/Rooms.php` müssen HTTP 403 oder 404 liefern.
6. Unter **Kontakte → Person einladen** zuerst die Adresse der eingeladenen Person
   eingeben. Falls nötig, danach die eigene Adresse bestätigen; die vorgemerkte
   Einladung wird anschließend automatisch versendet. **Neue Gruppe** benötigt
   ebenfalls einmal die eigene E-Mail-Bestätigung. Weitere Geräte öffnen ihre Kontakte über **Anmelden**
   mit derselben E-Mail-Adresse. Ein eigener Server wird unter **Erweitert** eingerichtet.

`PEEKAVIEW_SITE` ist die Adresse des Viewers mit `fixed-rooms.html` und
`room-sw.js`. Standard: `https://peekaview.de`. Die aktualisierten Viewer-Dateien
müssen vor Einladungen veröffentlicht sein. Alternativ den öffentlichen Viewer
aus `deploy/dist/` selbst hosten und `PEEKAVIEW_SITE` entsprechend setzen.
`PEEKAVIEW_ORIGINS` kann bei eigener Viewer-Domain um die exakte Origin ergänzt
werden (kommasepariert; Desktop und Android benötigen zusätzlich ihre in
`public/api.php` aufgeführten lokalen Origins).

## Verhalten

- Per Link teilen und als Gast zuschauen benötigt keine E-Mail-Adresse. Erst eine
  dauerhafte Verbindung, eine Gruppe oder die Anmeldung auf einem weiteren Gerät
  benötigt die E-Mail-Bestätigung. Der Bestätigungslink setzt die begonnene Aktion fort.
- Kontakte sind Personen mit einer bestätigten E-Mail-Adresse. Direkte Einladungen
  verbinden zwei Personen ohne sichtbare Gruppe. Geräte erscheinen nur in Details.
  Weitere bestätigte Geräte übernehmen Kontakte und Gruppen, behalten aber eigene
  Anmeldeschlüssel und keine Aufnahme- oder Fernzugriffsrechte anderer Geräte.
- Einladungen gelten einmalig für 24 Stunden. Vorschau und Linkscanner verbrauchen
  sie nicht; die ausdrückliche Annahme bestätigt die E-Mail und verbindet das Gerät.
- Gruppenersteller können von ihren bestätigten Geräten aus Kontakte hinzufügen
  oder per E-Mail einladen. Beim Erstellen können bestehende Kontakte ausgewählt werden.
- Kontaktanrufe klingeln auf den Geräten der Person. Das erste Annehmen beendet
  das Klingeln auf den anderen Geräten. Explizit für unbeaufsichtigten Zugriff
  eingerichtete Gruppengeräte bleiben unabhängig erreichbar.
  Kontakte und Gruppen zeigen jeweils die letzten fünf Einträge, erweiterbar.
- Neue Teilnehmer und neue Geräte erhalten bei laufenden Freigaben erst nach
  Zulassung Gesprächsschlüssel und Bildinhalte.
- Die SQLite-Erweiterung übernimmt vorhandene Geräte und Gruppen ohne Tokenwechsel.
  `state&v=2` liefert Personen mit `devices` in den Details. Ohne Versionsparameter
  bleibt die bisher veröffentlichte Geräteantwort erhalten, damit ältere Clients
  während der Veröffentlichung verwendbar bleiben.
- Gruppen-PINs haben mindestens sechs Zeichen und werden ausschließlich als
  Argon2id-Hash gespeichert. Ein PIN-Wechsel beendet laufende Gruppenanrufe.
  Unbeaufsichtigter Zugriff gilt je Gerät und benötigt eine Gruppen-PIN sowie
  eine dort ausdrücklich gespeicherte Auswahl erlaubter Bildschirme/Anwendungen.
  Der Anrufer muss die PIN eingeben; andere Geräte werden dadurch nicht aktiviert.
  Desktop bietet nur die ausgewählten Ziele zum Starten an. Android benötigt
  den bereits eingerichteten Shell-Helfer und einen im Vordergrund aktivierten
  Bereitschaftsdienst; App-Auswahl ohne ganzen Bildschirm benötigt Android 14+.
- Direkt hinzugefügte Kontakte klingeln bei einem laufenden Gruppenanruf mit eigener
  Klingelfrist. Bereits vorhandene Geräte werden dabei nicht erneut angerufen.
  Bei einem neu per Einladungslink bestätigten Gerät müssen Anrufer oder
  Gruppenersteller zuerst die Aufnahme in den aktuellen Anruf bestätigen.
  Bis dahin gibt die API weder Gesprächsschlüssel noch Freigaben heraus. Nach der
  Zulassung öffnet sich das Gespräch ohne eine zweite Annahme. Das Mikrofon bleibt
  aus, der eigene Bildschirm wird erst nach ausdrücklicher Auswahl geteilt.
  Die Aufnahmefrage ist fünf Minuten offen; eine Ablehnung gilt für diesen Anruf.
- Ein Raum hat jeweils einen laufenden Anruf. Alle anderen Geräte klingeln bis
  zu 45 Sekunden. Annahme gibt erst den Gesprächszugang frei; der eigene Bildschirm
  wird auf Desktop/Android erst nach Auswahl und OS-Freigabe übertragen.
- Desktop ist erreichbar, solange PeekaView im Tray läuft. Android aktiviert
  Hintergrundanrufe ausdrücklich über den Knopf und eine dauerhafte, abschaltbare
  Benachrichtigung. Bei einer laufenden Freigabe wird die Raumverbindung unabhängig
  davon überwacht.
- Browser speichern ihre Raumliste und den Zugang dieses Browserprofils lokal.
  Für Anrufe bei geschlossener Seite muss der Benutzer Web Push erlauben. Die
  Benachrichtigung öffnet die Seite zur Annahme. Vollständig beendete Browser,
  deaktivierte Systembenachrichtigungen und Energiesparregeln können die Zustellung
  verhindern. Auf iPhone/iPad ist dafür eine installierte Web-App erforderlich.
- Raumanrufe haben einen gemeinsamen Sprachkanal; Mikrofone starten stumm.
  Bildschirmfreigaben verwenden diesen Kanal gemeinsam, statt den Ton zu verdoppeln.

Keine externen Datenbank-, Mail- oder Push-Abonnements und kein dauerhaft laufender
PHP-Prozess sind erforderlich. Web Push verwendet die Push-Dienste der Browser.
VAPID-Schlüssel und SMTP-Konfiguration gehören ausschließlich in `.env` bzw.
Prozess-Umgebungsvariablen; die Datenbank speichert Gerätezugänge nur gehasht.

## Entwickeln und prüfen

```sh
composer install --no-interaction
php tests/rooms.php
php tests/people.php
php tests/invitations.php
php tests/account.php
node tests/http.mjs
```

Die HTTP-Tests starten PHP auf einem freien lokalen Port, verwenden eine temporäre SQLite-Datei
und ersetzen ausschließlich im Test `sendmail_path`. Sie versenden keine echten
E-Mails. Web-Push-Tests verwenden einen lokalen HTTP-Mock und erzeugte Testschlüssel.

Zum Ausliefern zuerst `composer install --no-dev --classmap-authoritative` ausführen;
`vendor/` wird mit hochgeladen, sodass Composer auf dem Webspace nicht nötig ist.
Bei Updates `.env` und `data/` erhalten. Räume und Geräte aus einem Backup stets
zusammen mit den ursprünglichen VAPID-Schlüsseln wiederherstellen.
