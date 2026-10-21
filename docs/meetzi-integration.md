# Integrating PeekaView into meetzi

Goal: in a meetzi room, someone shares a window or screen with the PeekaView desktop client. All participants see it in a new room pane, and their meetzi name and a stable color label their cursor. Depending on what the sharer allows, they can point, draw or remote control. Audio stays with meetzi (LiveKit); PeekaView's own voice chat is switched off.

PeekaView needs **no server of its own**:
- The connection is set up over Nostr relays, end-to-end encrypted with a room secret.
- Picture, pointer and input then flow peer-to-peer (WebRTC).
- meetzi only decides **who gets the room secret**, and can hand out TURN credentials for strict networks.

Paths refer to the meetzi repository (commit `02e63ec`).

## Overview

```
meetzi collab ── room secret (per meetzi room) ──▶ only participants of that room
      │                                                   │
      │ "Mit PeekaView teilen"                            │ PeekaView pane
      ▼                                                   ▼
peekaview://share?room=<secret>&ice=…        <PeekaViewer room={secret} name color voice={false} />
      │                                                   │
      └──────── encrypted setup via Nostr relays ─────────┘
      └════════════ WebRTC peer-to-peer (video, data) ════┘
```

| Value | Source in meetzi | Notes |
|---|---|---|
| Room secret | Random 128 bit per meetzi room (base64url, 22 chars), kept by collab | Only delivered to participants of the room. Breakouts get their own secret. |
| Name | `entry.me.displayName` | Self-declared towards PeekaView; meetzi has authenticated the participant. |
| Color | `peerColor(roomSessionId)` from `@peekaview/viewer` | meetzi has no participant colors so far. The same function can color avatars or chat. |
| Who may share | Only participants that may publish (`mediaPermission(...).canPublish`) see the button | — |

## 1. Room secret in `apps/collab`

- Create the secret lazily per room, e.g. next to the other runtime state in `apps/collab/src/runtime.ts`: `crypto.randomBytes(16).toString("base64url")`.
- Hand it out through an authenticated route modeled on `media-token` (`apps/collab/src/app.ts:465` → `rooms.ts:167`):

```ts
// apps/collab/src/rooms.ts
async peekaview(token: string, roomId: string) {
  const { runtime, claims } = await this.authorize(token);
  if (runtime.roomId !== roomId) throw new RoomError(403, "ASSIGNMENT_MISMATCH", "Room authorization does not match.");
  const session = runtime.authorizeParticipant(claims);
  return {
    room: runtime.peekaviewSecret(),             // 22 chars, base64url
    color: peerColor(session.id),
    // optional: short-lived TURN credentials (coturn use-auth-secret), see step 4
    ice: this.config.turn ? turnCredentials(this.config.turn, session.id) : undefined,
  };
}

// apps/collab/src/app.ts
app.post("/rooms/:id/peekaview", { config: { roomAuth: "room" } }, async (request) => {
  const { id } = paramsSchema.parse(request.params);
  return peekaviewResponseSchema.parse(await rooms.peekaview(bearer(request), id));
});
```

- **Rotating the secret:** when someone is removed from the room, rotate the secret. New connections then need the new one; already running peer connections are not affected.

## 2. Room pane in `apps/web`

1. Add `"peekaview"` to `RoomPane` plus its order and weights in `apps/web/src/rooms/layout.ts:1-6`.
2. Add label and menu label in `apps/web/src/rooms/panes.tsx:42`.
3. In `apps/web/src/rooms/meeting.tsx`:
   - header view button around `:409`
   - children map around `:528`
   - gating / `showView` around `:269-288`
4. Strings via `useExtracted()`, then `pnpm translate`.

```tsx
// apps/web/src/rooms/peekaview.tsx
"use client";
import { useEffect, useState } from "react";
import { PeekaViewer } from "@peekaview/viewer/react";

export function PeekaViewPane({ connection, entry }: { connection: RoomConnection; entry: JoinResponse }) {
  const [access, setAccess] = useState<{ room: string; color: string }>();
  useEffect(() => {
    fetch(`${entry.connect.roomService}/rooms/${connection.roomId}/peekaview`, {
      method: "POST",
      headers: { authorization: `Bearer ${entry.tokens.collab}` },
    })
      .then((r) => r.json())
      .then(setAccess);
  }, [connection.roomId, entry]);

  if (!access) return null;
  return <PeekaViewer room={access.room} name={entry.me.displayName} color={access.color} voice={false} />;
}
```

## 3. "Mit PeekaView teilen" button

Only for participants who may publish, next to the existing screen-share button (`meeting.tsx:144-154`):

```ts
async function shareWithPeekaView() {
  const { room, color, ice } = await fetchPeekaview();
  const link = new URL("peekaview://share");
  link.search = new URLSearchParams({
    room,
    name: entry.me.displayName,
    color,
    ...(ice ? { ice: JSON.stringify(ice) } : {}),
  }).toString();
  window.location.href = link.toString();
}
```

- **What the desktop client does:**
  1. It opens the picker with an invitation note.
  2. The person picks a screen or window.
  3. Participants waiting in the pane get the picture immediately.
- **If the client is not installed:** the link does nothing. Show a download hint after about 2 s without `blur`.

## 4. Strict networks: TURN (optional)

Peer-to-peer fails in a share of networks: symmetric NAT on both sides, or corporate firewalls without UDP. For those, run a coturn with `use-auth-secret`; the one from the v1 setup works.

- collab derives **short-lived credentials** per session:

  ```ts
  import { createHmac } from "node:crypto";

  function turnCredentials({ urls, secret }: { urls: string[]; secret: string }, label: string) {
    const username = `${Math.floor(Date.now() / 1000) + 8 * 3600}:${label}`;
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    return [{ urls: ["stun:stun.l.google.com:19302"] }, { urls, username, credential }];
  }
  ```

- The presenter gets them through the deep link (`ice`). It passes them on to its viewers inside the encrypted signaling. The secret never reaches a browser.
- Without TURN, affected viewers get a clear message after 15 s.

## 5. CSP

The viewer opens WebSocket connections to the Nostr relays. In `packages/ui/src/proxy.ts:13`, add their origins to `connect-src`, e.g. via a new server env `PEEKAVIEW_RELAYS`:
- default: `wss://nos.lol wss://relay.primal.net wss://relay.snort.social wss://nostr.mom wss://relay.damus.io`
- or your own relay, passed to the viewer as `relays={[…]}`

Nothing else is needed:
- WebRTC itself is not restricted by CSP.
- Video plays in a `<video>` element from a `MediaStream`.
- Styles are constructable stylesheets, so they work with the nonce-only `style-src`.

## 6. Security in the meetzi setup

- **Content:** only holders of the room secret can take part in the setup. Content is end-to-end encrypted, and relays see only metadata (IP addresses, timing).
- **Who may present:** the standalone share link also pins the presenter key. In this flow the pane only gets the secret, so every participant who has it could act as presenter.
- **Stricter variant:** if that matters, the desktop client can report its public key to collab after starting. The pane then gets `room = "<secret>.<key>"` and verifies every presenter message.
- **Removing participants:** rotate the secret when removing someone (see step 1).
