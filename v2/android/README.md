# PeekaView für Android

Eine App für zwei Dinge:

- **Zuschauen** – der Viewer der Website, in der App gebündelt (WebView). Raumlinks öffnen sich
  direkt in der App (`peekaview://join?room=…`; die Website schickt sie dorthin, Android-Browser
  über einen Intent). Zeigen, Malen, Steuern per Touch, Zwischenablage, Sprechen.
- **Bildschirm teilen** – das Handy als Host, mit demselben Protokoll wie die Desktop-App
  (Nostr-Signalisierung, Zulassen von Zuschauern, WebRTC). Zuschauer schauen im Browser, in der
  Desktop-App oder in einer anderen Android-App zu. Steuern geht über den Bedienungshilfen-Dienst
  „PeekaView Fernsteuerung“, den man einmalig in den Android-Einstellungen einschaltet.

Für Links, die im Browser funktionieren, trägt man beim Teilen die Zuschauer-Website ein (die
Adresse, die PeekaView am Computer unter Einstellungen zeigt). Ohne sie öffnet sich der Link nur
in einer PeekaView-App.

## Bauen

Voraussetzungen: JDK 17, Android SDK (Plattform 35, Build-Tools 35).

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Die Viewer-Dateien kommen beim Bauen aus `../web` (Task `copyWeb`).

## Noch offen

- Die gemeinsame Zwischenablage bietet ein teilendes Handy nicht an (Zuschauen geht mit ihr).
- Sprechen beim Teilen: das Handy reicht Sprache zwischen Zuschauern weiter, spricht aber nicht selbst.
- Text tippen per Fernsteuerung (Tasten wie Zurück/Home gehen).
