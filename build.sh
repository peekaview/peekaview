#!/usr/bin/env bash
# Local build with the keychain identity "ltdev", verified install to /Applications.
# ./build.sh [--debug] [--no-open] [Tauri build options]
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

open_app=1
build_args=(--ci)
has_bundle=0
for arg in "$@"; do
  case "$arg" in
    --no-open) open_app=0 ;;
    --bundles|-b|--bundles=*|-b?*) has_bundle=1; build_args+=("$arg") ;;
    *) build_args+=("$arg") ;;
  esac
done

for tool in pnpm cargo rustc; do
  command -v "$tool" >/dev/null || { printf 'Fehler: %s fehlt im PATH.\n' "$tool" >&2; exit 1; }
done
pnpm_version="$(pnpm --version)"
[[ "${pnpm_version%%.*}" -ge 11 ]] || { echo 'Fehler: pnpm >= 11 erforderlich.' >&2; exit 1; }

if [[ "$(uname -s)" == Darwin ]]; then
  [[ "$has_bundle" == 1 ]] || build_args+=(--bundles app)
  # Include self-signed identities: security's -v filter excludes local certificates.
  identity="$(security find-identity -p codesigning | awk '$3 == "\"ltdev\"" && !seen[$2]++ { print $2 }')"
  [[ "$identity" =~ ^[[:xdigit:]]{40}$ ]] || {
    echo 'Fehler: Genau eine Codesignatur-Identität "ltdev" mit privatem Schlüssel im Schlüsselbund erforderlich.' >&2
    exit 1
  }
  export APPLE_SIGNING_IDENTITY="$identity"
fi

[[ "$(uname -s)" == Darwin ]] || { echo 'Dieser Build benötigt macOS.' >&2; exit 1; }
(cd client && pnpm dlx @tauri-apps/cli@2.12.4 build "${build_args[@]}" -- --locked)

[[ "$(uname -s)" == Darwin ]] || exit 0

profile=release
target="${CARGO_BUILD_TARGET:-}"
for ((i=0; i<${#build_args[@]}; i++)); do
  case "${build_args[$i]}" in
    --target|-t) i=$((i+1)); target="${build_args[$i]}" ;;
    --target=*) target="${build_args[$i]#*=}" ;;
    -t?*) target="${build_args[$i]#-t}" ;;
    --debug|-d) profile=debug ;;
    --no-bundle|--help|-h|--version|-V) exit 0 ;;
    --) break ;;
  esac
done
app="${CARGO_TARGET_DIR:-target}${target:+/$target}/$profile/bundle/macos/PeekaView.app"
dest="/Applications/PeekaView.app"
[[ -d "$app" ]] || { printf 'Fehler: App-Bundle fehlt: %s\n' "$app" >&2; exit 1; }
# Verify the seal, signing identity and microphone access before replacing anything.
requirement="certificate leaf = H\"$identity\" and entitlement[\"com.apple.security.device.audio-input\"] exists"
codesign --verify --deep --strict -R="$requirement" "$app"

stage="$(mktemp -d /Applications/.PeekaView.XXXXXX)"
cleanup() {
  if [[ -d "$stage/previous.app" && ! -e "$dest" ]]; then mv -- "$stage/previous.app" "$dest"; fi
  rm -rf -- "$stage"
}
trap cleanup EXIT
ditto "$app" "$stage/PeekaView.app"
codesign --verify --deep --strict -R="$requirement" "$stage/PeekaView.app"

if pgrep -x 'peekaview' >/dev/null; then
  osascript -e 'tell application id "de.limtec.peekaview" to quit'
  for _ in {1..20}; do
    pgrep -x 'peekaview' >/dev/null || break
    sleep 0.5
  done
  if pgrep -x 'peekaview' >/dev/null; then
    echo 'Fehler: PeekaView läuft noch. Offene Arbeit sichern und die App beenden; die installierte Version wurde nicht ersetzt.' >&2
    exit 1
  fi
fi
[[ ! -e "$dest" ]] || mv -- "$dest" "$stage/previous.app"
mv -- "$stage/PeekaView.app" "$dest"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$dest"
printf 'Installiert und mit ltdev signiert: %s\n' "$dest"
if [[ "$open_app" == 1 ]]; then open "$dest"; fi
