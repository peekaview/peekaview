# PeekaView v2

Screen sharing with **pointing, drawing, remote control, voice and session recording**, peer-to-peer and without a server of its own.

- Sharing always goes through the **native desktop client** (Rust/Tauri), a small toolbar at the top of the screen.
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
                     STUN for direct connections · optional own TURN (coturn) for strict firewalls
```

## The viewer site comes over Nostr

Share links point to `https://<npub>.nsite.lol/#…`, not to a web server of our own.
- **Publishing:** the desktop client carries the viewer site and publishes it itself as an **nsite** (NIP-5A), under a key of its own:
  - the files go to public Blossom servers, addressed by their SHA-256;
  - a signed manifest (kind 15128) maps each path to its hash;
  - its server list (10063) and relay list (10002) let gateways find everything.
- **When:** again whenever the bundled site changes, and otherwise once a week.
- **Serving:** any nsite gateway serves the same files and checks their hashes. The gateway is the https origin of the page, so it is trusted like any web host.
- **Cleanup:** after each new version, files of earlier versions are deleted from the Blossom servers.
- **Own site:** an address entered under Einstellungen → Zuschauer-Website (e.g. your own static hosting) replaces the nsite. The nsite is then taken down: its files are deleted, and its manifest gets a NIP-09 deletion event.
- **Development builds:** they never publish. Links point to `http://localhost:8090` (`python3 -m http.server -d web 8090`), and a site published by an earlier test is taken down.
- **No room data on Blossom:** only the viewer site lives on the Blossom servers. Room keys, picture, sound and clipboard files never pass through them.

## Layout

| Path | What |
|---|---|
| `client/src-tauri/` | Desktop client: capture, encoder, P2P hub (`p2p/`), overlay, input guard, recording |
| `web/` | Static viewer site (`index.html`) and npm package `@peekaview/viewer`: `mountViewer()`, `/react`, Nostr signaling (`signal.js`), voice |
| `web/desktop/` | UI of the desktop client in the same design |
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
- Participants sign with throw-away keys; the presenter signs with the key from the link.
- Viewers accept presenter messages only with a valid signature of that key, so somebody who only knows the room secret cannot pose as the presenter.

**After that, everything is P2P**
- WebRTC runs as a star around the presenter: a video track and a data channel per viewer.
- Voice runs as a mesh between participants, with the presenter forwarding its signaling.
- ICE candidates trickle as soon as they are found. From opening the link to the first picture takes **about 0.5–0.8 s**, measured over public relays.
- WebRTC is end-to-end encrypted (DTLS-SRTP). The presenter does what a server would otherwise do: participant list, colors, routing by mode.

**Firewalls**
- STUN usually gets a direct connection.
- Where it does not, a TURN server relays the encrypted traffic. Typical cases are symmetric NAT on both sides or corporate firewalls blocking UDP.
- TURN is optional; an existing coturn with `use-auth-secret` works, for example the one from v1.
- The **TURN secret only lives in the desktop client** (settings), or an integration hands over ready-made credentials.
- From it the client derives short-lived credentials for each session and passes them to the viewers inside the encrypted signaling. The website never contains a secret.
- If a viewer cannot connect, they get a clear message after 15 s saying that a TURN server is needed.

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
  - Can be moved with the grip on its left and folded down to a small handle. The viewer's toolbar can do the same.
  - Idle: Teilen (opens a picker with thumbnails) · settings · quit.
  - While sharing: copy link · switch source · mode · viewers · microphone · Sitzung aufzeichnen · stop.
  - The selected source has a red frame on the desktop.
- **Restarts:** after macOS restarts the app for a permission, the share continues automatically. It keeps the same room, the same link and the same mode, and viewers reconnect on their own.
- **Permissions:** screen recording and accessibility (remote control) are granted in one go.
  - A small helper sticks to the System Settings window and follows it.
  - It opens the pane of each missing permission in turn, accessibility first and screen recording last, because only that one needs a restart of the app.
  - It shows the progress, offers the app icon to drag into the list, and explains the rest with an animation instead of text.
- **Missing accessibility during a share:** if remote control finds the permission missing, the presenter is asked right away and the viewer gets a hint.
- **Settings**
  - viewer website address
  - Nostr relays
  - TURN servers and TURN secret
  - transcription: local Apple speech recognition or an OpenAI key, optionally from `.env`

## Permanent room links and remote access

PeekaView keeps running in the tray / menu bar. Ending a share or closing the toolbar (×) only hides it, and a click on the tray icon brings it back. You quit PeekaView from the tray menu. Its menu offers:
- **Raumlink beibehalten:** every share reuses the last link.
- **Resize/Anordnen erlauben:** with remote control on, viewers see a **mirror of this screen**. The shared windows sit where they are, at the same relative size and in the same stacking order. The window manager then acts on the real windows on this screen.
  - Resizing a window resizes it here, so it shows 1:1 for them.
  - Moving a window, or arranging all side by side, moves the windows to the same relative place on their screen.
  - Picking a window (click or dock) brings it to the front here.
- **Raumlink kopieren:** copies the link of one of the permanent rooms.
- **Raumlinks & Remote-Zugriff …:** opens the room manager.

**Permanent room links** never change unless you renew them. You can have as many as you like, each with:
- **PIN (optional):** viewers wait for approval as usual, and below that they get a PIN field. If you are not at your desk, they can come in with the PIN instead.
  - The PIN never travels: the viewer answers a one-time challenge with HMAC(PBKDF2(PIN)).
  - After 5 wrong tries a viewer is turned away. After 20 wrong tries in 10 minutes the PIN is locked for everybody.
  - Only the PBKDF2 key is stored.
- **Remote-Zugriff:** the room waits for viewers even while nothing is shared. A viewer who is let in (or knows the PIN) gets:
  - a session in that room with remote control on;
  - the room's chosen **applications** in the dock, marked as such, and **Gesamter Desktop** if enabled.
  - Starting one launches it on this computer, or brings it forward if it runs already, and shares its window. The session ends a minute after the last viewer left.

Sharing from the picker can also go into a permanent room ("Raum: …").

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

**Sitzung aufzeichnen** writes a self-contained HTML report to `~/Documents/PeekaView/`:
- **Screenshots:** a screenshot of the shared source on every click or ping (position marked) and after text entry. Keystrokes themselves are never stored.
- **Transcript:** the conversation, placed under the matching screenshot.
  - macOS: on-device Apple speech recognition.
  - Otherwise: OpenAI `gpt-4o-transcribe`.

Viewers see that the session is being recorded.

## Performance

**macOS**
- ScreenCaptureKit delivers GPU frames with zero copy.
- VideoToolbox **hardware H.264** encodes them (Constrained Baseline, which every browser negotiates).
- The resulting samples go straight into the WebRTC track. Only changed frames are sent.
- Browsers request keyframes with PLI. The viewer forwards these over the data channel, and the presenter answers with a fresh keyframe.

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

```bash
python3 -m http.server -d web 8090
```

Build the desktop client as an app bundle:

```bash
cd client && npx @tauri-apps/cli@2 build --debug --bundles app
```

CI (`.github/workflows/v2-client.yml`) runs the unit tests and builds Windows, macOS and Linux bundles. It runs **only on demand** (Actions → "v2 desktop client" → Run workflow), because every run builds on three platforms.

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
- Bandwidth adaptation (congestion feedback → encoder bitrate).
- Code signing / notarization, auto-update.
