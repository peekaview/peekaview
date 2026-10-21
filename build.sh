#!/usr/bin/env bash
# Builds the PeekaView desktop app for macOS and installs it to /Applications.
#
#   ./build.sh            release build (viewer site over Nostr), install, start
#   ./build.sh --debug    debug build (viewer site http://localhost:8090 for local tests)
#   ./build.sh --no-open  install without starting it
#
# macOS ties granted permissions (screen recording, accessibility) to the app's signature.
# Set PEEKAVIEW_SIGN_IDENTITY to a signing identity from your keychain (see
# `security find-identity -v -p codesigning`) so they survive rebuilds; without it the app is
# signed ad hoc and macOS may ask again after each build.
set -euo pipefail

cd "$(dirname "$0")"

profile=release
open_app=1
for arg in "$@"; do
  case "$arg" in
    --debug) profile=debug ;;
    --no-open) open_app=0 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unbekannte Option: $arg" >&2; exit 1 ;;
  esac
done

[[ "$(uname)" == "Darwin" ]] || { echo "build.sh baut die macOS-App – bitte auf einem Mac ausführen." >&2; exit 1; }
command -v cargo >/dev/null || { echo "Rust fehlt: https://rustup.rs" >&2; exit 1; }
command -v npx >/dev/null || { echo "Node.js (npx) fehlt: brew install node" >&2; exit 1; }

echo "▸ Baue PeekaView ($profile) …"
args=(build --bundles app)
[[ $profile == debug ]] && args+=(--debug)
(cd client && npx --yes @tauri-apps/cli@2 "${args[@]}")

app="target/$profile/bundle/macos/PeekaView.app"
[[ -d "$app" ]] || { echo "Build fehlgeschlagen: $app fehlt" >&2; exit 1; }

if [[ -n "${PEEKAVIEW_SIGN_IDENTITY:-}" ]]; then
  echo "▸ Signiere mit: $PEEKAVIEW_SIGN_IDENTITY"
  codesign --force --deep --sign "$PEEKAVIEW_SIGN_IDENTITY" "$app"
fi

echo "▸ Installiere nach /Applications …"
# a running PeekaView is quit first (a running share stops)
if pgrep -x peekaview >/dev/null; then
  osascript -e 'tell application "PeekaView" to quit' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x peekaview >/dev/null || break; sleep 0.5; done
  pkill -x peekaview 2>/dev/null || true
fi
rm -rf /Applications/PeekaView.app
ditto "$app" /Applications/PeekaView.app
# peekaview:// links (join links from the viewer website) go to this copy
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/PeekaView.app || true

echo "✓ PeekaView ist installiert: /Applications/PeekaView.app"
if [[ $open_app == 1 ]]; then
  open /Applications/PeekaView.app
fi
