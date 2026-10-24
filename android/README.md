# PeekaView für Android

Eine App für zwei Dinge:

- **Zuschauen** – der Viewer der Website, in der App gebündelt (WebView). Raumlinks öffnen sich
  direkt in der App (`peekaview://join?room=…`; die Website schickt sie dorthin, Android-Browser
  über einen Intent). Zeigen, Malen, Steuern per Touch, Zwischenablage, Sprechen.
- **Bildschirm teilen** – das Handy als Host, mit demselben Protokoll wie die Desktop-App
  (Nostr-Signalisierung, Zulassen von Zuschauern, WebRTC). Zuschauer schauen im Browser, in der
  Desktop-App oder in einer anderen Android-App zu. Wahlweise mit Androids Aufnahmebestätigung
  und dem Bedienungshilfen-Dienst oder über lokal gekoppeltes ADB (ab Android 11).

Teilen-Links zeigen immer auf `https://peekaview.de/#…`, auch bei älteren gespeicherten
Website-Einstellungen. Der Viewer ist dort statisch gehostet; Nostr dient weiterhin der
Verbindungsanbahnung und WebRTC überträgt Bildschirm und Eingaben.

## Bauen

Voraussetzungen: JDK 17, Android SDK (Plattform 35, Build-Tools 35).

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Die Viewer-Dateien kommen beim Bauen aus `../web` (Task `copyWeb`).
Der Task `shellServer` lädt den offiziellen scrcpy-Server 5.0.1 mit festgelegter SHA-256-Prüfsumme
von GitHub und bündelt ihn in der APK. Auf dem Handy wird kein Code heruntergeladen.

## Lokale ADB-Fernsteuerung

1. In PeekaView **Handy fernsteuern & Apps starten** wählen, die gewünschten Apps auswählen
   und **Freigabe starten** tippen. PeekaView richtet die Verbindung bei Bedarf automatisch ein.
   Name, App-Auswahl und laufendes Gespräch bleiben dabei erhalten. **Abbrechen** verwirft den Start.
2. Falls Android noch eingerichtet werden muss, öffnet PeekaView die Entwickleroptionen.
   Erlaube zunächst Benachrichtigungen: Dort wird der Code eingegeben, während Androids Dialog offen bleibt.
   Falls nötig:
   Unter **Über das Telefon** / **Softwareinformationen** siebenmal auf **Build-Nummer** tippen und
   die Geräte-PIN bestätigen. Dann unter **System → Entwickleroptionen** **Debugging über WLAN**
   einschalten; das Handy muss mit WLAN verbunden sein. Androids WLAN-Abfrage bestätigen.
   Im eigenen, vertrauenswürdigen WLAN **In diesem Netzwerk immer zulassen** wählen, damit
   Android die Zustimmung für dieses WLAN speichert.
3. **Gerät über einen Kopplungscode koppeln** öffnen und den Dialog offen lassen. Die Benachrichtigungen
   vom oberen Rand herunterziehen, bei PeekaView **Code eingeben** wählen, die sechs Ziffern
   eingeben und absenden. Kein Computer, keine geteilte Ansicht und keine Porteingabe nötig.
4. PeekaView erkennt den Kopplungs- und Verbindungsport dieses Handys automatisch, prüft die
   gespeicherte Identität und beendet den Einrichtungsdienst nach Erfolg. Bereits gekoppelte
   Geräte werden ohne erneute Code-Eingabe verbunden. Der Code wird nicht gespeichert.
5. Sobald der Helfer bereitsteht, schließt PeekaView die von ihm geöffneten Entwickleroptionen
   und setzt die angeforderte Freigabe automatisch fort, ohne zweiten Start-Klick.
   Mit **Nur ausgewählte Apps zeigen** bleiben andere Apps für Zuschauer schwarz (Android 14 oder neuer).
   Ist noch kein Helfer aktiv, erkennt PeekaView den aktuellen ADB-Port, startet den Helfer und
   schließt anschließend sämtliche ADB-Verbindungen. Der Helfer schaltet WLAN-Debugging aus.
   Zuschauer wie bisher zulassen oder per PIN beitreten lassen.
6. Unter **Zuschauer dürfen → Steuern** können Zuschauer tippen, wischen, scrollen, Text
   einschließlich Unicode eingeben, Text einfügen, Navigationstasten bedienen und die angebotenen
   Apps starten. **Freigabe beenden** oder **Beenden** in der Freigabe-Benachrichtigung stoppt
   die Bildschirmaufnahme. Der Helfer bleibt für weitere Freigaben bereit. **Helfer beenden**
   in der separaten Bereitschafts-Benachrichtigung beendet auch den Helfer.

Solange **Helfer aktiv** angezeigt wird, brauchen weitere Freigaben kein ADB und kein WLAN-Debugging.
WLAN-Wechsel und ein abgeschaltetes WLAN beenden die lokale Fernsteuerung nicht. Die Verbindung
zum entfernten Zuschauer braucht weiterhin Internet; ein Netzwechsel kann diese Verbindung
vorübergehend unterbrechen. Es wird kein anderes WLAN automatisch als Debugging-Netz freigegeben.

Nach **Helfer beenden**, einem Handy-Neustart oder wenn Android den App-/Helferprozess beendet,
muss WLAN-Debugging für den Helfer erneut eingeschaltet werden. **Freigabe starten** führt bei Bedarf
direkt durch diesen Schritt. Die Kopplung bleibt erhalten,
bis sie in Android widerrufen oder PeekaView deinstalliert wird. Ein neuer Kopplungscode ist
beim WLAN-Wechsel allein nicht nötig. Für die erneute Aktivierung in einem neuen WLAN verlangt
Android dessen Zustimmung. **In diesem Netzwerk immer zulassen** speichert diese Zustimmung für
das jeweilige WLAN. Siehe [Androids Anleitung](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi).

**Probleme bei der Erkennung?** Zuerst WLAN und den Debugging-Schalter prüfen und die Einrichtung
erneut starten. Der Assistent endet bei Abbruch oder nach fünf Minuten. Android-Schalter,
Geräte-PIN und Kopplungscode müssen vom Nutzer bestätigt werden; die App aktiviert Debugging
nicht selbst. Wenn das Netzwerk mDNS blockiert, kann unter **Probleme bei der Erkennung? Manuell
einrichten** ausdrücklich der manuelle Weg gewählt werden: PeekaView und Einstellungen in
geteilter Ansicht öffnen, Kopplungsport und Code aus dem offenen Dialog eingeben. Nur wenn die
automatische Verbindung ebenfalls nicht funktioniert, **Verbindungsport selbst festlegen**
wählen und den separaten Port von der WLAN-Debugging-Hauptseite eintragen.

Die Erkennung akzeptiert nur Adressen eigener Netzwerkschnittstellen. Verbindungen und Kopplung
gehen weiterhin ausschließlich an **127.0.0.1**, nicht an andere Geräte im WLAN.

Es wird ausschließlich der **echte Handybildschirm (Display 0)** gespiegelt. Apps starten auf
diesem Bildschirm; lokale und entfernte Bedienung betreffen dieselbe Oberfläche. Es werden keine
separaten App-Displays angelegt und weder Auflösung noch Größe des Handybildschirms verändert.
Unter **Apps auswählen** können Apps auch während einer Freigabe an- und abgewählt werden;
Raum und Videospur bleiben bestehen. **Nur ausgewählte Apps zeigen** begrenzt das Bild auf die
sichtbaren Fenster dieser Apps. Andere Apps, fremde Einblendungen und der Sperrbildschirm bleiben
schwarz; geschützte Inhalte werden weiterhin ausgeblendet. Apps mit einer gemeinsamen Android-UID
können nicht einzeln ausgewählt werden. Hintergrund-Apps erhalten keine virtuellen Fenster.
Ist der Schalter aus, wird der gesamte Handybildschirm geteilt und die Auswahl bestimmt nur die
Startknöpfe. Die Auswahl ist keine Zugriffssperre für andere Apps bei der Fernsteuerung.

Die App-Filterung benötigt Android 14 oder neuer und den Shell-Helfer. Androids Compositor nimmt
nur die ausgewählten App-UIDs auf; ein ungefiltertes Bild wird in diesem Modus nicht übertragen.
Unabhängige, mit der Auswahlversion markierte JPEG-Bilder erlauben sofortiges Verwerfen alter
Auswahlversionen. Der Modus liefert bis zu 15 Bilder pro Sekunde bei maximal 1600 Pixeln Kantenlänge;
die gesamte Bildschirmfreigabe verwendet weiterhin die hardwaregestützte H.264-Aufnahme. Bei einem
Filterfehler endet die Freigabe mit einer Fehlermeldung.
Texteingabe und Einfügen nutzen die Android-Zwischenablage und ersetzen deren Textinhalt.

Die Kopplung nutzt einen nicht exportierbaren RSA-Schlüssel im AndroidKeyStore. ADB ist nur
für den Start des eigenständigen Prozesses als Android-Benutzer `shell` nötig. Danach verbindet
sich der Helfer ausschließlich mit dem TLS-1.3-Endpunkt der App an **127.0.0.1**. Der Helfer
prüft das gepinnte App-Zertifikat; die App verlangt für jeden Kanal einen zufälligen
256-Bit-Sitzungsschlüssel. Die Startdaten liegen kurzzeitig in einer shell-eigenen Datei mit
Modus `0600`, werden vom Helfer gelöscht und stehen weder in Prozessargumenten noch in Logs.
Nach dem Start bleibt der Sitzungsschlüssel nur im Speicher. Bild und Eingaben gehen über diese direkte lokale
Verbindung; es wird weder ein ADB-Port offen gehalten noch ein Helfer-Port im WLAN angeboten.

Der Helfer erzeugt pro Freigabe einen scrcpy-Prozess für Display 0. Nach Ende der Freigabe
werden dessen Bild-/Steuerkanäle und Prozess geschlossen. Der Bereitschaftsdienst prüft die
Lebensdauer des Helfers; App-Ende, **Helfer beenden** oder eine verlorene Manager-Verbindung
beenden auch dessen Aufnahmeprozess. Die App fordert keine pauschale Shell-Befehlsausführung
über die lokale Verbindung an.

Bildschirmaufnahme und Eingaben benötigen in diesem Modus weder MediaProjection-Zustimmung
noch einen aktivierten Bedienungshilfen-Dienst. Bei Fehlern endet die Freigabe mit einer
Fehlermeldung. Der normale Aufnahmemodus bleibt separat auswählbar. Freigabe und Helfer werden
nur durch den Nutzer aktiviert; es gibt keinen automatischen Start nach einem Neustart.
Die Android-Gerätesperre wird nicht umgangen; geschützte Bildschirminhalte bleiben geschützt.

Implementierung und Protokoll: [scrcpy](https://github.com/Genymobile/scrcpy/tree/v5.0.1),
[LibADB](https://github.com/MuntashirAkon/libadb-android/tree/3.1.1).
Die Apache-2.0-Lizenz des scrcpy-Servers liegt unter `app/src/main/assets/licenses/scrcpy.txt`.
Der ADB-Modus verwendet einen Foreground Service vom Typ `specialUse` mit beschriebenem
Anwendungsfall im Manifest, da die Aufnahme durch den Shell-Prozess statt über MediaProjection
läuft; eine Store-Veröffentlichung muss diesen Service-Typ entsprechend deklarieren.

## Tests

```bash
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -e class de.limtec.peekaview.ShellIntegrationTest \
  -e adbPort VERBINDUNGSPORT de.limtec.peekaview.test/androidx.test.runner.AndroidJUnitRunner
```

Der Gerätetest benötigt ein entsperrtes, bereits mit PeekaView gekoppeltes Handy. Er prüft
Bildinhalt des physischen Displays, Touch, Unicode, Tastenkombinationen, App-Start, Navigation,
Drehung und frische Frames. Die temporäre Test-Activity ist nur in Debug-Builds enthalten.
Die ursprüngliche Dreheinstellung wird wiederhergestellt. Ohne Port werden diese Tests übersprungen.
Mit `-e switchWifi true` wird zusätzlich die WLAN-Funkverbindung während der Aufnahme getrennt
und wieder eingeschaltet. `-e targetWifi ZIEL_SSID -e originalWifi AUSGANGS_SSID` wechselt über
Androids WLAN-Oberfläche zu einem bereits gespeicherten, erreichbaren zweiten WLAN und prüft
anschließend Frames, Eingaben und App-Starts mit demselben Helfer-PID. Beide WLANs müssen ohne
Passworteingabe auswählbar sein; der Test stellt das Ausgangsnetz wieder her.

Der Lebensdauer-Test prüft außerdem die Wiederverwendung ohne neue ADB-Verbindung:

```bash
adb shell am instrument -w -e class de.limtec.peekaview.ShellHelperIntegrationTest \
  -e helperTest true de.limtec.peekaview.test/androidx.test.runner.AndroidJUnitRunner
```

Er benötigt beim Start WLAN-Debugging und die gespeicherte Kopplung. Er prüft zwei aufeinanderfolgende
Aufnahmen mit demselben Helfer ohne neue ADB-Verbindung, das automatische Abschalten von
WLAN-Debugging und die Erreichbarkeit bei ausgeschaltetem WLAN. Danach werden die
ursprünglichen WLAN-/Debugging-Schalter wiederhergestellt.

Die automatische Rückkehr aus den Entwickleroptionen und das Fortsetzen der Freigabe prüft:

```bash
adb shell am instrument -w \
  -e class 'de.limtec.peekaview.ShellHelperIntegrationTest#shareStartsHelperImplicitlyAndContinuesAfterSettings' \
  -e implicitShareTest true -e nestedSettingsTest true \
  de.limtec.peekaview.test/androidx.test.runner.AndroidJUnitRunner
```

Das Handy muss entsperrt und bereits gekoppelt sein. Ohne `nestedSettingsTest` wird die
Hauptseite geprüft, mit der Option die Unterseite „Debugging über WLAN“ (deutsche/englische
Android-Einstellungen). Der Test stellt die Einstellungen wieder her und beendet seine Freigaben.

Die automatische Erkennung und Wiederverbindung lassen sich ohne Portargument prüfen:

```bash
adb shell am instrument -w -e class de.limtec.peekaview.AdbSetupIntegrationTest \
  -e adbSetup true de.limtec.peekaview.test/androidx.test.runner.AndroidJUnitRunner
```

Der separate Test `pairsThroughNotificationWhileSystemCodeDialogRemainsOpen` benötigt ausdrücklich
`-e adbPairUi true` und einen geöffneten Android-Code-Dialog ohne aktive PeekaView-Autorisierung.
Er liest den Code nur im Speicher, sendet ihn über die echte Benachrichtigungsaktion und prüft
Kopplung, automatische Verbindung, unveränderte KeyStore-Identität sowie das Ende des Assistenten.

Der App-Filtertest benötigt Android 14 oder neuer und ein entsperrtes USB-Gerät. Er beendet
laufende Freigaben; vor dem APK-Update müssen Nutzer der Unterbrechung zustimmen. Eine
WLAN-ADB-Kopplung ist dafür nicht nötig; der Test startet den Helfer über die USB-Shell und
ändert den WLAN-Debugging-Schalter nicht.

```bash
adb shell am instrument -w -e class de.limtec.peekaview.AppSharingIntegrationTest \
  -e appSharingTest true de.limtec.peekaview.test/androidx.test.runner.AndroidJUnitRunner
```

Er prüft zwei getrennte App-UIDs, leere und geänderte Auswahl, geschützte Fenster, fremde Overlays,
wiederholte Aufnahmen sowie echte WebRTC-Frames über dieselbe Videospur bei Auswahl- und
Moduswechseln. Die rote Gegenprobe läuft ausschließlich in der Test-APK. Ihre Overlay-Freigabe
wird zurückgesetzt, App-Einstellungen werden wiederhergestellt. Die Browserprüfung der
Android-Auswahl läuft mit `node --test tests/android-app-selection.browser.test.mjs` vom Repo-Root.

## Noch offen

- Die gemeinsame Zwischenablage bietet ein teilendes Handy nicht an (Zuschauen geht mit ihr).
- Sprechen beim Teilen: das Handy reicht Sprache zwischen Zuschauern weiter, spricht aber nicht selbst.
- Text tippen im normalen Aufnahmemodus ohne ADB (Tasten wie Zurück/Home gehen).
- System-Zwischenablage vom Handy in den Viewer kopieren; ADB unterstützt aktuell Texteingabe
  und Einfügen vom Viewer, keine Übernahme von Bildern oder Dateien in andere Apps.
