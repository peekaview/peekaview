# PeekaView

Screen sharing with **pointing, drawing, remote control, voice and session recording**, peer-to-peer and without a server of its own.

- Sharing goes through the **native desktop client** (Rust/Tauri), a small toolbar at the top of the screen.
  - **Bildschirmfreigabe light** (`share.html`) shares straight from a browser as a low-barrier extra. It covers only a small part: watching, pointing and drawing (see below).
- Watching only needs a **browser**: either a **static website** or the embeddable module / React component.

```
 Desktop client (Rust/Tauri)                                                  Browser (static page)
 ┌──────────────────────────────┐   WebRTC, end-to-end encrypted, direct    ┌──────────────────────┐
 │ SCK · WGC → HW H.264         │═══ video track ═══════════════════════════▶│ <video> (HW decode)  │
 │ hub: peers, modes, routing   │◀══ data channel: pointer, ink, input ════▶│ point · draw · control│
 │ overlay · input guard · rec. │◀══ voice (mesh) ══════════════════════════▶│ voice                │
 └──────────────┬───────────────┘                                            └──────────┬───────────┘
                │      connection setup only (encrypted, a few KB):                     │
                └─────────────▶  public Nostr relays  ◀─────────────────────────────────┘
                     STUN for direct connections · TURN from the PeekaView service for strict firewalls
```

## The viewer site

Share links always point to `https://peekaview.de/#…`, including development builds and saved links.
The static viewer is deployed to Cloudflare by `.github/workflows/viewer.yml`.
The fragment keeps the room secret and presenter identity; Nostr is still used for signaling,
and screen, audio and clipboard data travel over WebRTC.

## Layout

| Path | What |
|---|---|
| `client/src-tauri/` | Desktop client: capture, encoder, P2P hub (`p2p/`), overlay, input guard, recording |
| `web/` | Static viewer site (`index.html`) and npm package `@peekaview/viewer`: `mountViewer()`, `/react`, Nostr signaling (`signal.js`), voice |
| `web/desktop/` | UI of the desktop client in the same design |
| `web/share.html`, `web/share-helper.html` | Bildschirmfreigabe light: sharing from the browser (`light-host.js`), picking a window from the screen and following it (`light-windows.js`, `light-pick.js`, `light-crop.js`, `light-track.js`, `light-title.js`), still pictures (`light-capture.js`, `light-locate.js`) and the helper window (`light-geometry.js`) |
| `android/` | Android app: watching (bundled viewer) and sharing the phone's screen – see `android/README.md` |
| `build.sh` | Builds the macOS app and installs it to `/Applications` |
| `docs/meetzi-integration.md` | How to embed PeekaView into meetzi |

## How the connection works

**The link**
- A share link looks like `https://<viewer-site>/#<room secret>.<presenter key>`.
- Everything after `#` stays in the browser and never reaches the web server.
- The **room secret** (128 bit) addresses the room and encrypts the connection setup.
- The **presenter key** pins who may act as presenter.

**Signaling over Nostr**
- Participants find each other through public Nostr relays (configurable).
- Messages are ephemeral events: relays don't store them.
- Each one is AES-256-GCM encrypted with a key derived from the room secret.
- Viewers sign with a key of their own (kept per tab, so a reload need not be let in again); the presenter signs with the key from the link.
- Viewers accept presenter messages only with a valid signature of that key, so somebody who only knows the room secret cannot pose as the presenter.
- A viewer's id on the channel is its public key: the presenter (desktop and Android) only takes messages whose `from` is the key that signed them. Somebody who knows the link cannot speak for a viewer who was let in.
- Calls over contacts get their room secret from the contacts server, so whoever runs that server could in principle join the connection setup.

**After that, everything is P2P**
- WebRTC runs as a star around the presenter: a video track and a data channel per viewer.
- Voice runs as a mesh between participants, with the presenter forwarding its signaling.
- ICE candidates trickle as soon as they are found. From opening the link to the first picture takes **about 0.5–0.8 s**, measured over public relays.
- WebRTC is end-to-end encrypted (DTLS-SRTP). The presenter does what a server would otherwise do: participant list, colors, routing by mode.

**Firewalls**
- STUN usually gets a direct connection.
- Where it does not, a TURN server relays the encrypted traffic. Typical cases are symmetric NAT on both sides or corporate firewalls blocking UDP.
- Nobody sets up a TURN server: the presenter fetches short-lived credentials from the PeekaView service (`room-service`, `?action=turn`). It derives them from the `static-auth-secret` of a coturn with `use-auth-secret`, which only the service knows; no secret is in the apps or on the website. An integration can still hand over ready-made credentials.
- The presenter passes them to the viewers inside the encrypted signaling.
- If a viewer still cannot connect, they get a message after 15 s and the presenter a hint in the toolbar; both keep trying.

**Who gets in**
- Every viewer has to be **let in by the presenter**. The toolbar shows each request with "Zulassen" or "Ablehnen", and "Alle zulassen" when several are waiting.
- Until then the viewer sees "Warte, bis die teilende Person dich hereinlässt …".
- Viewers who were let in come back by themselves after a page reload or a restart of the app.
- **Link beibehalten** (in the picker) keeps the same link for every share, e.g. for regular meetings. People who know it still have to be let in.

**What relays and others can see**
- Relays see IP addresses, timing and a pseudonymous room hash. They do not see content, names or IP candidates; those are encrypted.
- Anybody with the link can ask to join; the presenter decides.
- Viewer names and colors are self-declared.
- Inside an integration (e.g. meetzi), the integration decides who gets the room secret.

## Roles and permissions

The presenter chooses what viewers may do:

| Mode | Viewers can … |
|---|---|
| **Ansehen** | watch |
| **Zeigen & Malen** | move their own colored, labelled cursor, send pings, draw fading strokes |
| **Steuern** | additionally use mouse, wheel and keyboard (clipboard text is typed) |

Everybody can join the **voice chat** from the microphone button. The label next to each cursor shows level bars while that person speaks, and a crossed-out microphone while their microphone is off.

Cursors and strokes appear for every viewer. They also appear on the presenter's desktop in a click-through overlay that never shows up in captures.

**Sharing several windows**
- In the picker, click several windows to share them together, up to six. A screen is always shared on its own.
- **Separate pictures:** each window is its own video stream with its own red frame. Pointing, drawing and control always refer to one window.
- **Windows may hang over the edges:** in the viewer and, when the viewer arranges them, on the presenter's screen. A part always stays reachable, and on macOS the title bar stays below the menu bar.
- **Viewer layout:** viewers get a small window manager, only in their browser. They can move windows, scale them proportionally, minimize, maximize and arrange them side by side. The dock lists all windows for switching between them. The presenter's windows stay as they are.
- **Covered windows:** a shared window that is completely covered on the presenter's screen is shown greyed out and marked "verdeckt".
- **Sharp pictures:** pictures are never enlarged beyond one video pixel per screen pixel, so text stays sharp. They only get smaller when the browser window is too small.
- **Best size:** the badge of each red frame has a button that resizes the window on the presenter's screen to the room the viewers have. The picture then needs no scaling.
- **Windows can change while sharing:** joining or leaving windows never interrupt the connection. Every connection carries one video track per slot.

**Sharing a single window**
- **Picture:** only that window is captured, together with its own dialogs, sheets and menus. Other windows of the same app (e.g. other Finder windows, the Finder desktop) and other apps' windows never show, even when they lie on top of it.
  - macOS: ScreenCaptureKit, the window's area with only its app in the filter.
  - Windows: Windows.Graphics.Capture for the window; dialogs are separate windows there and are not part of the picture yet.
- **Input:** lands only **inside the window** and only where it is **not covered**. The window may lie in the background.
  - A click goes through only where the shared window is the topmost window at that spot, or a dialog or menu of the same app. Clicks never land on other apps' windows or on PeekaView's own windows.
  - Drags are clamped to the window.
  - Keystrokes go through only while it has the focus. A viewer's click into the window gives it the focus.
  - Shortcuts that switch apps are dropped.
  - A dropped click or keystroke tells the viewer why.
  - Viewers see a "Steuerung pausiert" hint while the window is covered completely.
- **macOS limitation:** macOS blocks synthetic keystrokes while any password field is focused ("Secure Input").

## Desktop client

- **Toolbar**
  - Can be moved with the grip on its left and folded down to a small handle. The viewer's toolbar stays at the top and can be folded; shared windows initially fit below it and can be moved underneath it without scrolling.
  - Idle: Teilen (opens a picker with thumbnails) · settings · quit.
  - While sharing: copy link · switch source · mode · viewers · microphone · Sitzung aufzeichnen · stop.
  - The selected source has a red frame on the desktop.
- **Restarts:** after macOS restarts the app for a permission, the share continues automatically. It keeps the same room, the same link and the same mode, and viewers reconnect on their own.
- **Permissions:** a checklist shows what is granted and what the requested feature needs. Screen recording is required for sharing; accessibility is requested for remote control. Viewer-only launches do not request host permissions.
  - A small helper stays on top, takes focus when opened, and follows the System Settings window, even before screen recording is authorized.
  - Once all permissions are granted, it closes the System Settings window only if PeekaView opened that window; an already open window is preserved.
  - System colors and a large draggable app icon match the Settings UI. When both permissions are needed, accessibility comes first and screen recording last.
  - The share picker stays hidden until mandatory permissions and restoration are complete. A permission restart restores the selected tab, sources, room and running share even after a long visit to Settings.
  - It guides each action: hold the marked app icon, drag it into the app list in the marked System Settings window, release, then enable PeekaView. The click-through marker follows the settings window; a cancelled drag can be retried, and an app already in the list can skip straight to its switch.
- **Missing accessibility during a share:** if remote control finds the permission missing, the presenter is asked right away and the viewer gets a hint.
- **Settings**
  - viewer website address
  - Nostr relays
  - transcription: local Apple speech recognition or an OpenAI key, optionally from `.env`

## Permanent links and remote access

PeekaView keeps running in the tray / menu bar. Ending a share or closing the toolbar (×) only hides it, and a click on the tray icon brings it back. You quit PeekaView from the tray menu. Its menu offers:
- **Letzten Link beibehalten:** every share reuses the last link.
- **Zuschauer dürfen Fenster anordnen** (Optionen): in Zeigen and Steuern, viewers see a **mirror of this screen**. The shared windows sit where they are, at the same relative size and in the same stacking order. The window manager then acts on the real windows on this screen.
  - Resizing a window resizes it here, so it shows 1:1 for them.
  - Moving a window, or arranging all side by side, moves the windows to the same relative place on their screen.
  - Picking a window (click or dock) brings it to the front here – in Zeigen and Steuern always, also without this option, and so does starting to point or draw on a window that is covered here.
- **Sprache aktiv / Transkript aktiv:** the voice channel and the local transcript of a share.
- **Festen Link kopieren:** copies one of the permanent links.
- **Einstellungen … / Kontakte … / Transkripte …:** settings with the permanent links, contacts and calls, saved transcripts.

**Permanent links** (*feste Links*) never change unless you renew them. You can have as many as you like, each with:
- **PIN (optional):** viewers wait for approval as usual, and below that they get a PIN field. If you are not at your desk, they can come in with the PIN instead.
  - The PIN never travels: the viewer answers a one-time challenge with HMAC(PBKDF2(PIN)).
  - After 5 wrong tries a viewer is turned away. After 20 wrong tries in 10 minutes the PIN is locked for everybody.
  - Only the PBKDF2 key is stored.
- **Fernzugriff:** the link waits for viewers even while nothing is shared. A viewer who is let in (or knows the PIN) gets:
  - a session in that room with remote control on;
  - the room's chosen **applications** in the dock, marked as such, and **Gesamter Desktop** if enabled.
  - Starting one launches it on this computer, or brings it forward if it runs already, and shares its window. The session ends a minute after the last viewer left.

Sharing from the picker can also go into a permanent link ("Fester Link: …").

## Shared clipboard

Everybody in the session, the presenter included, can open a small **Zwischenablage** panel and drag it anywhere.
- **Adding items:** drop files there or paste text and images with your usual shortcut. Each item gets a preview: a thumbnail for images and PDFs, the beginning for text, a file icon otherwise.
- **Using items:** hover an item to copy it to your own clipboard or save it as a file.
  - Browsers can only put text and images on the clipboard; other files are saved instead.
  - The presenter copies files as real files.
- **Size:** up to 100 MB per file. Uploads and downloads show an animated progress ring.
- **Where items live:** they travel over a separate data channel, so a big transfer never slows down pointers or input. The presenter keeps them until the share ends.

**Copy & paste under remote control** (⌘ or Ctrl + C, X, V, everybody with their own shortcuts, also between Mac and Windows) works without emulating keystrokes:
- **Paste:** the viewer's clipboard content (text with formatting, images or files) is put on the presenter's real clipboard. Then the presenter's own paste shortcut is pressed. Nothing gets swallowed, keyboard layouts don't matter (no y/z mix-up), and long texts arrive in full.
- **Copy and cut:** the presenter's own copy shortcut is pressed in the shared window, and the result lands on the viewer's clipboard. Copied files show up in the shared clipboard.

## Session recording

**Transkript aktiv** in the tray menu starts a self-contained HTML report automatically with
each share and saves it to `~/Documents/PeekaView/`. The toolbar's record button controls the
same persistent switch.
- **Screenshots:** a screenshot of the shared source on every click or ping (position marked) and after text entry. Keystrokes themselves are never stored.
- **Transcript:** the conversation, placed under the matching screenshot.
  - macOS: on-device Apple speech recognition.
  - Otherwise: OpenAI `gpt-4o-transcribe`.

Viewers see that the session is being recorded.

**Transkripte …** in the tray menu opens an archive with dated thumbnails, newest first.
New reports retain their contact or group identity and can be filtered by that conversation.
Older reports remain available without an inferred association. Link-only shares are grouped by
their room as “Freigabe per Link”; room secrets and access tokens are never stored in the report.
Each report opens in its own PeekaView window. Existing HTML reports appear in the same archive.
**Sprache aktiv** controls voice chat for the entire share: both microphone buttons are hidden
when it is off. Microphones start muted; muting preserves incoming audio for listening and
transcription. A transcript never opens a separate microphone behind the mute control.

## Performance

**macOS**
- ScreenCaptureKit delivers GPU frames with zero copy.
- VideoToolbox **hardware H.264** encodes them (Constrained Baseline, which every browser negotiates).
- The resulting samples go straight into the WebRTC track. Only changed frames are sent.
- Browsers request keyframes with PLI. The viewer forwards these over the data channel, and the presenter answers with a fresh keyframe.

**Adapting to viewers and network** (all platforms unless noted)
- **Only changes are encoded:** a frame identical to the previous one is skipped. On macOS a fingerprint of its brightness plane decides, in about 0.5 ms. A still window costs about 1 frame/s instead of 30.
- **No more pixels than shown:** each viewer reports how large it displays each window. The presenter captures at the largest of these sizes, never above full size. A window nobody displays (minimized everywhere, viewer tab in the background) is not encoded at all.
- **Bitrate follows the network:** viewers report packet loss and round trip every second. The worst one decides:
  - on loss or a growing round trip the bitrate drops by a quarter (down to 10 %);
  - otherwise it climbs back gently.
  - Windows: the Media Foundation encoder takes the new bitrate live.
- **Low latency:** VideoToolbox runs in its low-latency rate-control mode, and the capture queue holds 3 frames. Viewers play frames as soon as they are decoded (`jitterBufferTarget = 0`).
- **Statistics:** **Alt+Shift+S** in the viewer shows per window:
  - here: size, fps, bitrate, decode time, buffer;
  - at the presenter: size, fps, bitrate, encoder time, target bitrate, reduction;
  - plus round trip and loss.
- **Signaling stays light:** viewers repeat their hello at growing gaps, and the start page checks rooms at most once a minute. Public relays throttle chatty clients; relay.damus.io banned us for a while during testing.

**Windows**
- Windows.Graphics.Capture delivers the window or screen as a GPU texture (no yellow border, no cursor).
- The D3D11 video processor converts it to NV12 and scales it on the GPU.
- The **Media Foundation H.264 encoder** takes the texture directly. That is the hardware encoder of the GPU vendor: Intel Quick Sync, NVIDIA NVENC or AMD AMF.
- Settings: Constrained Baseline, CBR, low latency, keyframes on request.
- Without a hardware encoder, Microsoft's software MFT takes over.
- Type-checked, but not yet run on real Windows hardware.

**Linux:** software encoder (openh264) for now. The planned path is Wayland only: the ScreenCast portal with PipeWire, the RemoteDesktop portal for input, and VA-API for encoding.

Each viewer gets its own upstream from the presenter. That suits support and team sessions; for large audiences an SFU would be the next step.

## Running it

Serve the viewer site with any static server. In production, use HTTPS and `Cache-Control: no-cache` for `.js`.

The public viewer at [peekaview.de](https://peekaview.de) is deployed by the
[`viewer` GitHub workflow](.github/workflows/viewer.yml) to Cloudflare Pages.
See [deployment setup and local checks](deploy/README.md).

```bash
python3 -m http.server -d web 8090
```

Build the desktop client as an app bundle:

```bash
cd client && npx @tauri-apps/cli@2 build --debug --bundles app
```

On a Mac, `./build.sh` builds the release app and installs it to `/Applications` (`--debug` for a test build).
The script requires the local keychain identity "ltdev" (certificate and private key), signs the complete
bundle and verifies its signature before replacing the installed app. Use `--no-open` to install without
launching it. Missing signing identity or build errors leave the installed version intact.

CI (`.github/workflows/client.yml`) runs the unit tests and builds Windows, macOS and Linux bundles. It runs **only on demand** (Actions → "desktop client" → Run workflow), because every run builds on three platforms.

Run the unit tests: VideoToolbox encoder, TURN credentials, report helpers.

```bash
cargo test -p peekaview
```

The live tests need screen recording permission and network:

```bash
cargo test -p peekaview -- --ignored
```

For development, a debug build can start a share by itself:

```bash
PEEKAVIEW_DEV_SHARE=screen:<id> PEEKAVIEW_DEV_MODE=draw ./target/debug/peekaview
```

Debug builds are signed ad hoc, so macOS asks for permissions again after each build. A stable signing identity avoids that.

## The viewer's start page

The viewer site opens with a small start page:
- **Rooms:** the room of the opened link, preselected, plus the last ten **permanent rooms** this browser joined.
- **Per room:** its name, the presenter as `user@computer`, when it was last used ("Zuletzt: gestern, 14:20") and whether it is **online** right now.
- **Tags:** whether the link is **permanent** or **temporary** (one share only), whether it has a **PIN**, and whether it offers **remote access**.
- **Online check:** a "ping" over the room's encrypted signaling. The presenter's signed answer creates no join request.
- **Connecting:** a big **Verbinden** button joins the selected room; an online room can be joined directly.

## Bildschirmfreigabe light (sharing from the browser)

`share.html` on peekaview.de shares a screen, window or tab straight from the browser, without PeekaView Desktop. The start page offers it below the desktop download, never instead of it.
- **Same protocol as the desktop host** (`light-host.js`): Nostr signaling with a fresh room key, the normal link, "Zulassen"/"Ablehnen" for every viewer, one WebRTC connection per viewer (picture as slot 0, the `pv` data channel). Viewers need nothing new.
- **What works:** the modes **Zusehen** and **Zeigen & Malen**, the participant list, the **shared clipboard** (`light-clip.js`: the desktop protocol over a `pvfile` channel per viewer; the presenter's tab holds the items in memory – 100 MB each, 500 MB and 40 items in all – until the share ends; the presenter opens it with "Gemeinsame Zwischenablage" in the tab, the small window or the window "Freigabe läuft"), TURN credentials from the service (only for the origin peekaview.de).
- **What does not:** remote control (browsers cannot inject input), voice, recording, several windows. The state says `light: true` (and `clipboard: true`: older browser shares had no clipboard, the viewer hides it for them). The viewer then shows "Steuern" greyed out and explains it on click and once when joining.
- **Saying so:** the start page, the share page before and during the share, and its end screen say in one short, calm line that steering, voice and more need PeekaView Desktop, and link to `download.html`.

**Always on top (Chrome, Edge).** (Firefox, which has begun to offer such windows too, keeps everything in the one small window.) While sharing, what is always there – the link with "Link kopieren", the shared clipboard, "Freigabe beenden" – sits in a footer of its own, below a line, always in the same place (in the tab at the end of the card; in small windows at the window's bottom, link and clipboard side by side, the rest above it scrolling when there is more). Small windows (this one and the popup) show only the essentials – "Freigabe läuft · Anna schaut zu", join requests, "Link kopieren", "Freigabe beenden"; who watches is said by name in the line on top ("Freigabe läuft · Anna und Ben schauen zu"), another window is a link, "Anderes Fenster wählen". In small windows the footer also holds what viewers may, as a compact switch with the desktop app's icons ("Zusehen", "Zeigen & Malen", "Steuern" greyed – only with the desktop app, as its tooltip and a click on it say), and the buttons look as in the desktop app's toolbar (quiet with a fine edge, "Beenden" reddish). A join request lights up as a window found does, pulsing until answered (a still red edge with `prefers-reduced-motion`), in the tab, both windows and the helper. The tab says in a large box: "Lass diesen Tab bitte offen." The window "Freigabe läuft" is a Picture-in-Picture document window (`light-pip.js`), floating above every program. While it is open, the small window itself is made as small as it goes (160 × 100) and hidden behind it, following it when it is moved or resized.
- As everywhere, "Bildschirm teilen" opens the small window (`share.html?panel`), where the window to share is picked; its click on "Dieses Fenster zeigen" opens the always-on-top window, which belongs to it then, and the running controls move into it. The small window shrinks and says to stay open (the always-on-top one closes with it); the tab may be closed.
- It is only as tall as its controls. A drawing shows in their place as a preview (`light-mini.js`: the spot enlarged, the stroke drawn again, a map of the screen; while viewers move their mice, the part shown follows them calmly – it stays put while they move in its inner 65 % and moves on, softly and just enough, when one comes near its edge, and from then on glides slowly on (a few seconds) until the pointer is in its middle, even when it rests (`keepInView`, `calmFollow` in `light-geometry.js`); it grows to hold several, within the picture; a pointer at rest for 2 s fades out and is no longer followed), with "Groß anzeigen", "Am Fenster zeigen"; afterwards the controls come back – the window keeps its size.
- "Groß anzeigen" makes it as large as the browser allows and shows nothing but the drawing, sharp at that size; meanwhile no new pictures go out (it lies over the screen). "Wieder klein" opens it anew, small, at the browser's own place for it (`preferInitialWindowPlacement`): it cannot be moved, and shrunk it would stay in the middle of the screen. Both only in a click: a Picture-in-Picture window never resizes, moves or reopens by itself (Chrome: "requires user activation").
- "Am Fenster zeigen" opens a helper window over the very spot, which closes again afterwards.

**Firefox, Safari: cut out on a canvas.** There is no MediaStreamTrackProcessor, so the part is cut out on a canvas (`CanvasCropper`: the screen plays in a hidden video, the part is drawn into a canvas at 30 frames a second, paced by a worker, and `canvas.captureStream()` goes out; the same checks on each picture, pause and blurred picture). A browser that does not say what was picked (`displaySurface`) has picked the whole screen when the picture has the screen's shape.

**The small window "Freigabe läuft".** "Bildschirm teilen" asks for the screen right in its click, in the tab (a window opened by it may not ask without a click of its own). What was picked is checked in the tab first: a single window or tab is turned away there, with what to pick instead, and no small window opens at all. Only then does it open `share.html?panel`, a small popup "Freigabe läuft". Where the click is spent by then (the browser lets a click open windows for about 5 s, Safari not after asking at all; `navigator.userActivation`), the window is not even tried: the tab says the screen is picked and shows one more button, "Freigabe starten", which opens it (and "Abbrechen", which lets go of the screen). The tab hands over what was picked; the popup does the rest. The capture belongs to the tab: it says in a large box to stay open (closing it ends the share). When the share ends – "Beenden", the browser's own "Freigabe beenden", the tab closed – the popup closes by itself, with the always-on-top window and the helper; "Freigabe beendet" and "Noch einmal teilen" show in the tab (or the start page's dialog). Where the hand-over fails (the dialog cancelled), the popup's own button "Bildschirm auswählen" asks again.
- The popup opens in the bottom right corner of the browser window, on its screen, and stays on the screen it is on: every place is reckoned from that screen (Firefox – its fingerprinting protection, `ScreenAvailToResolution`, on in private windows and seen in normal ones, too – reports a screen's usable area from the corner 0,0, wherever the screen is; `usableArea` in `light-geometry.js` makes it whole). Firefox also keeps a window moved by the page (`moveTo` and `moveBy` alike) inside that area, which lies on the first screen – a second screen's window cannot be moved at all, and knowing its true place would not help: there the popup is never moved, only sized (`movesWindows`/`placeWindow`), opens as high above the bottom as it gets while sharing and always reaches down to the bottom (it cannot be moved down later), and shows a drawing without jumping to its spot: the part around it, fitted into the window – following the viewers' pointers as the preview does (1:1 under the window it would be the window's own old picture).
- Picking the window happens in it: it grows to the middle of the screen for that, and shrinks back to its corner afterwards, as tall as its content.
- In the corner: who watches, "Zulassen"/"Ablehnen", what viewers may do (Zusehen, Zeigen & Malen, Steuern only with the desktop app), copy the link, another window, stop. Closing it ends the share.
- It is the helper, too: the helper page runs embedded in it (`share-helper.html` in an iframe, moving the popup) and lays each drawing over its spot, then the popup goes back to its corner.
- Popups blocked: everything stays in the tab, with the helper in a window of its own.

**Picking a window from the whole screen.** Only the whole screen is taken: browsers cannot be told to offer nothing else (Chrome and Edge only preselect it), so a single window or tab picked in their dialog is stopped at once and the page says to pick "Gesamter Bildschirm" (Firefox, which may not say what was picked: a picture of the screen's shape is the screen).
- The presenter shares the whole screen. The share page then shows a picture of it with the windows found outlined (`light-windows.js`: long straight edges joined at corners, each rectangle scored by how much of its four sides are edges). A click picks a window; clicking again on the same spot picks the next smaller one, and a drag draws a part by hand.
- **Windows by their title bars** (`findWindows`): small marks that stand out from their surroundings are collected over the whole picture; three equally spaced round ones of one size are a Mac's buttons (a disc or a ring, coloured on the active window, grey on the others; a longer row of dots – colours, pages – is none), an "✕" with a "□" to its left is a Windows title bar. From there the window's top and side borders are followed as far as they go; where two borders end at different places, the one that is a line across the window counts, and an overlapping window's edge (it does not reach up to the title bar) is no border. A part of the screen without such buttons – a panel, the content of a window – is no window of its own; it can still be drawn by hand. Checked on screenshots of macOS (light, dark, Sequoia, newer) and Windows 11 (light, dark).
- The window the presenter just worked in is recognized for sure by the coloured buttons of its title bar (red, yellow, green; `trafficLights`), its top and left borders followed from there (`windowOfLights`), and picked right away. A click prefers windows with a title bar over frames.
- For beginners: while the browser asks what to share, a small card shows beside its dialog where to click (`light-help.js`), headed in large red letters "Wähle „Gesamter Bildschirm“", that choice marked (pulsing) in the drawn dialog, and "Welches Fenster deine Zuschauer sehen, suchst du danach aus." below; there is no line under the button any more (Safari, without a card: one short line) – Firefox: first the warning that it works only in a limited way there, with Chrome recommended; its panel below the address bar drawn as on a Mac or on Windows ("Gesamter Bildschirm" or "Bildschirm 1/2", then "Erlauben"; on a Mac a word on the system's screen recording permission); Chrome and Edge: their dialog's tab "Gesamter Bildschirm", the screen, "Teilen". It is part of the page, not a window of its own (Firefox lets one click open only one window – the small one). Safari asks differently: no card. The picker shows what to do in a short looping animation (a window dragged onto the shared screen, clicked into, lighting up, its picture in the small window with a check mark; still with `prefers-reduced-motion`) and asks to click once into the window to show (it becomes active) – no need to come back: while the small window is in the background, the screen is looked through whenever anything on it changed (in front: only when a quarter changed). That window is then picked, lights up (a short red glow) (on a Mac by its coloured buttons, elsewhere the largest window found) and shown as a small picture – all in the small window, which stays small. There is no list: another window is picked by activating it. Only "Bereich selbst einzeichnen" makes the small window large, with the whole screen to draw a part in; such a part stays where it is and is not followed (no checks, no blurred picture). No debug output in the small window: with ?debug the findings go to the local test server.
- The picker's picture is fetched every 1.5 s, but the windows are looked for again only when at least a quarter of it changed (a 64 × 36 copy compared) – or right after switching to another program, when the window worked in is to be recognized.
- The picture comes from a moment the share page was in the background: in front, it would cover the windows. The page asks to switch to the window and back once.
- Viewers get only that part. It is cut out of each frame right here, before encoding (`light-crop.js`: MediaStreamTrackProcessor, a `VideoFrame` with a smaller visible rectangle, MediaStreamTrackGenerator). That needs no timers, so it keeps going in a background tab. Whatever lies over the window is part of the picture, and the page says so.
- The part's place is known, so drawings land on it without any search. "Anderes Fenster wählen" changes it while sharing (or the whole screen).
- The picked window is snapped onto its real edges at full resolution (the frames are found on a 640 px copy), so nothing beside it is shared.
- A moved window is noticed on the very next picture: each frame's title bar strip is compared right in the video's way (`light-crop.js` reads only that strip with `VideoFrame.copyTo`; no timers, which Chrome slows down for a window in the background). Until the window is found again, frames are held back – viewers keep the last right picture instead of what lies there now. The search itself also runs about three times a second and right before each still picture, so the cut-out moves along and a drawing appears where the window is now (`light-track.js`).
  - It goes by the window's **title bar**: that stays the same while the content scrolls or changes, and an inactive one differs only in contrast, which the comparison (normalized cross-correlation, tile by tile) does not mind.
  - Places to check: its old place, frames of the same size, and where its own picture fits best on a small copy. The title bar decides, to the pixel. A plain title bar falls back to the window's own picture; a changed one (another document) is taken anew once the window is found otherwise.
  - Resized: each frame's check also looks at the right and bottom borders, so a window made larger or smaller is noticed right away. Found by its top left corner, its borders are checked and the new size taken from its buttons or the frame there; its title bar is taken anew.
  - Its **titles** are read from the title bar with Tesseract (`light-title.js`, tesseract.js 6.0.1 from jsDelivr, loaded only for this, reading in the browser): every few seconds while it stays, at once when its title bar changed (another tab, another document); up to eight are kept. Gone from its place, the title bars of the windows on the screen are read and the window is taken back by a title it had (most of its words, one letter may be misread). Without Tesseract (blocked, offline) it is followed by the title bar's picture only.
- **Covered:** a quarter or more of the window under another one (or the share page) counts as not to be seen – also when it seems to have taken another shape because a corner of it is hidden. Told by its borders: what is missing of them at a corner spans the covered part (`light-track.js covered`), checked on each picture (on a canvas every third) and on each find.
- Not to be seen (moved away, covered by the share page, closed, partly off the screen): viewers get **the last right picture blurred, with "Fenster gerade nicht verfügbar – bei {Name}"** over it, instead of what lies there now. The share page says "Wechsle zu deinem Fenster", and after about 3 s in the background that the window is no longer at its place.

**Showing where viewers point and draw.** A point is shown right away, a stroke once it is finished ("Anna malt gerade …" meanwhile). The share page takes a still picture when the point or stroke starts, so it shows what they drew on (`light-capture.js`).
- **The helper** (`share-helper.html`, inside the small window) lays the drawing over the very spot on the screen: it jumps there, grows to fit the stroke and shows the still picture 1:1 under itself like a pane of glass, with the stroke drawn again on top. The presenter can draw and point into it, too; viewers see that with the presenter's name.
  - While it shows a drawing, no new pictures go out (`Cropper.paused`, Chrome and Edge): it lies over the window, so viewers would see the drawing twice. They keep the last picture until it is back in its corner.
  - It comes to each point and stroke by itself and goes back to its corner after 3.5 s (point) or 6 s (stroke). On top only while the browser is the active app: macOS never lets an app in the background bring its windows to the front, so it stays behind the app the presenter works in.
  - **Notifications:** while the presenter is in another program (the small window not in focus), each point and stroke also brings a system notification ("Anna hat etwas gemalt"). A click on it makes the browser the active app: the small window comes to the front and shows the drawing again at its spot. The permission is asked before the share, quietly, beside "Bildschirm teilen": a checkbox "Benachrichtigen, wenn jemand etwas zeigt oder malt – optional" (its click asks the browser; blocked: where to allow it). Not while sharing. (Chrome, Edge: none – the always-on-top window shows drawings.)
- **Position:** normalized picture coordinates × screen size + the screen's corner (`light-geometry.js`). After moving, the helper reads where the browser actually put it and lays the picture under it accordingly.

**What browsers allow** (tested in Chromium with fake pictures; Firefox and Safari not yet on real machines):

| | Chrome, Edge | Firefox | Safari |
|---|---|---|---|
| Moving and resizing the helper | yes (popups only, inside the screen) | yes, unless `dom.disable_window_move_resize` | yes (popups only) |
| Screen corner | estimated from `availLeft`/`availTop` (on a Mac minus about 25 px menu bar); exact with the "window management" permission if already granted (`getScreenDetails`, never requested) | exact (`screen.left`/`top`) | estimated |
| Still picture | `ImageCapture.grabFrame()` | a playing `<video>` | a playing `<video>` |

- A shared **whole screen** maps to positions directly, but only the screen the helper is on (same aspect ratio as the picture).
- A shared **window or tab** can be anywhere: browsers never tell where. The share page therefore asks for one more click, on "Gesamter Bildschirm".
  - That second picture stays in the presenter's browser; viewers still get only the window.
  - For each still picture the page looks for the window's picture in the screen's picture (`light-locate.js`): normalized cross-correlation on small grayscale copies, refined on larger ones.
    - The two pictures need not have the same resolution (Retina, Chrome's own limits): sizes from a quarter to three times are tried.
    - The window's edge (shadow, rounded corners) and its title bar are left out. A window that is not the active one looks different there.
    - That takes about 0.1–0.2 s and finds the window to a pixel, also after it was moved or when something covers part of it.
  - The helper then shows the window's still picture over its place, with the desktop around it.
  - Not to be seen on the screen (minimized, covered, another screen): the share page says so, with "Anderen Bildschirm wählen".
    - Only while the presenter is elsewhere. While the share page lies in front (right after picking the screen, say), the browser may well cover the window, so the page only asks to switch to it.
    - It keeps looking every 2.5 s while the page is in the background, and the message goes away by itself once the window is found.
    - `share.html?debug` (and the console) show how each search went, including the best score when nothing was found.
- Without that click ("Später"), when the window is not found (minimized, covered) and for another monitor, the helper shows the whole picture in the middle of the screen.
- When the whole screen is shared, the small window "Freigabe läuft" is part of the picture: viewers see it, too. With a window picked from it, only where it lies over that window.
- Popup blockers let windows through only right in a click. Phones and tablets cannot share from the browser at all, so the start page does not offer it there.
- Closing or reloading the share page ends the share.

## Embedding the viewer

```js
import { mountViewer, peerColor } from '@peekaview/viewer'

const viewer = mountViewer(element, {
  room: '<secret>.<presenterKey>',   // the "#…" part of a share link (or just the secret)
  name: 'Anna',
  color: peerColor(sessionId),
  voice: true,                       // built-in voice chat; off if the host app has audio
  relays: ['wss://relay.example.com'], // optional, default: public relays
  onStatus: (s) => {},               // connecting | waiting | admission | denied | loading | live | paused | blocked | error
})
viewer.destroy()
```

React:

```jsx
import { PeekaViewer } from '@peekaview/viewer/react'

<PeekaViewer room={room} name={me.name} color={me.color} voice={false} />
```

An integration can open the desktop client prepared for its room. The person still picks what to share.

```
peekaview://share?room=<secret>&name=Anna&color=%23ef4444&ice=<json>&relays=<json>&site=<viewer site>
```

## Not done yet / next steps

- Windows: test on real hardware (Intel, NVIDIA, AMD; DPI scaling; input guard).
- Linux: Wayland portals (ScreenCast, RemoteDesktop) and VA-API.
- Popup menus of a shared *window* are separate OS windows. Viewers don't see them, and clicks on them are refused.
- Code signing / notarization, auto-update.
