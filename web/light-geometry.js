// Where on the presenter's screen a point of the shared picture is – for the helper window of
// "Bildschirmfreigabe light", which jumps there when somebody points or draws.
//
// Browsers say little about screens, so this is an estimate:
//   - A shared *screen* (displaySurface "monitor") maps to screen coordinates directly. A shared
//     window is found on the screen by its picture (light-locate.js) when the presenter also
//     picked the whole screen; otherwise – and for a tab – the helper shows the whole picture in
//     the middle instead.
//   - The shared screen is assumed to be the one the helper window is on; when the picture's
//     aspect ratio does not match that screen, it is another one (several monitors).
//   - The screen's own corner: Firefox has screen.left/top; Chrome only has it with the
//     "window management" permission (getScreenDetails), which we use only when it is granted
//     already. Otherwise availLeft/availTop – the usable area, which on a Mac starts below the
//     menu bar (about 25 px, more on Macs with a notch).
//   - Coordinates are CSS pixels; the picture (track settings) is in device pixels.

const MAC_MENU_BAR = 25
const MAC_MENU_BAR_MAX = 44 // taller than any menu bar (notch: 37–38), shorter than menu bar and Dock

/** The shared screen in screen coordinates (CSS px): {left, top, width, height}. */
export function monitorRect(screen, { mac = false, details = null } = {}) {
  if (details && Number.isFinite(details.left) && Number.isFinite(details.top)) {
    return { left: details.left, top: details.top, width: details.width ?? screen.width, height: details.height ?? screen.height }
  }
  const left = Number.isFinite(screen.left) ? screen.left : Number.isFinite(screen.availLeft) ? screen.availLeft : 0
  let top = Number.isFinite(screen.top) ? screen.top : null
  if (top == null) {
    const availTop = Number.isFinite(screen.availTop) ? screen.availTop : 0
    // macOS: the usable area starts below the menu bar – which is all that is missing when the
    // Dock is on another screen (or hidden); otherwise it is about 25 px
    const missing = screen.height - screen.availHeight
    top = mac && missing > 0 ? availTop - (missing <= MAC_MENU_BAR_MAX ? missing : Math.min(MAC_MENU_BAR, missing)) : availTop
  }
  return { left, top, width: screen.width, height: screen.height }
}

/**
 * The usable part of the screen a window is on (CSS px): {left, top, width, height}. Firefox gives
 * availLeft/availTop of a second screen counted from that screen's own corner (left 2560, availLeft
 * 0) – made whole here: a window placed by them would land on the first screen.
 */
export function usableArea(screen) {
  const left = Number.isFinite(screen.left) ? screen.left : null
  const top = Number.isFinite(screen.top) ? screen.top : null
  let x = Number.isFinite(screen.availLeft) ? screen.availLeft : (left ?? 0)
  let y = Number.isFinite(screen.availTop) ? screen.availTop : (top ?? 0)
  if (left != null && (x < left || x >= left + screen.width)) x += left
  if (top != null && (y < top || y >= top + screen.height)) y += top
  return { left: x, top: y, width: screen.availWidth ?? screen.width, height: screen.availHeight ?? screen.height }
}

/**
 * Whether a page can move its window on this screen. Not in Firefox on a second screen: it keeps a
 * moved window inside the usable area as it counts it (from that screen's own corner) – which is
 * on the first screen. There a window can only change its size.
 */
export function movesWindows(screen) {
  const outside = (avail, start, size) => Number.isFinite(start) && Number.isFinite(avail) && (avail < start || avail >= start + size)
  return !outside(screen.availLeft, screen.left, screen.width) && !outside(screen.availTop, screen.top, screen.height)
}

/**
 * Puts a window at {left, top, width, height} (outer, CSS px). Where it cannot be moved
 * (movesWindows): only its size changes, as far as there is room right of and below it.
 */
export function placeWindow(win, { left, top, width, height }) {
  try {
    if (movesWindows(win.screen)) {
      win.resizeTo(Math.round(width), Math.round(height))
      win.moveTo(Math.round(left), Math.round(top))
      return
    }
    const area = usableArea(win.screen)
    const w = Math.max(240, Math.min(width, area.left + area.width - win.screenX - 8))
    const h = Math.max(240, Math.min(height, area.top + area.height - win.screenY - 8))
    win.resizeTo(Math.round(w), Math.round(h))
  } catch {}
}

/** Whether a picture of this size can be the given screen (same aspect ratio, 2 % tolerance). */
export function matchesScreen(video, monitor) {
  if (!video?.width || !video?.height || !monitor.width || !monitor.height) return false
  return Math.abs(video.width / video.height - monitor.width / monitor.height) < 0.02 * (monitor.width / monitor.height)
}

/** A point of the picture (0..1) in screen coordinates; `picture`: where the picture lies. */
export function toScreen(point, picture) {
  return { x: picture.left + clamp01(point.x) * picture.width, y: picture.top + clamp01(point.y) * picture.height }
}

/** Where a found window (0..1 of the screen's picture, see light-locate.js) lies on the screen. */
export function windowRect(found, monitor) {
  return { left: monitor.left + found.x * monitor.width, top: monitor.top + found.y * monitor.height, width: found.w * monitor.width, height: found.h * monitor.height }
}

/**
 * The area (screen coordinates) a helper of `size` should cover so that the point of the
 * picture lies in its middle – moved inside `bounds` (the screen) where it would stick out.
 */
export function spotRect(point, picture, size, bounds = picture) {
  const w = Math.min(size.width, bounds.width)
  const h = Math.min(size.height, bounds.height)
  const p = toScreen(point, picture)
  return {
    left: Math.round(clampTo(p.x - w / 2, bounds.left, bounds.left + bounds.width - w)),
    top: Math.round(clampTo(p.y - h / 2, bounds.top, bounds.top + bounds.height - h)),
    width: Math.round(w),
    height: Math.round(h),
  }
}

/**
 * Where the whole shared picture (lying at `picture`, screen coordinates) is inside the helper's
 * content area that actually sits at `content` – laid under it 1:1, so the helper looks like a
 * pane of glass over that spot.
 */
export function stageInContent(content, picture) {
  return { left: picture.left - content.left, top: picture.top - content.top, width: picture.width, height: picture.height }
}

/** The part of the picture (0..1) the helper's content shows. */
export function visiblePart(content, picture) {
  return {
    x: (content.left - picture.left) / picture.width,
    y: (content.top - picture.top) / picture.height,
    w: content.width / picture.width,
    h: content.height / picture.height,
  }
}

/** The bounding box (0..1) of a stroke's points [[x, y], …]. */
export function bounds(points) {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Whether a point (0..1) lies inside a part, at least `margin` (share of the part) from its edges. */
export function inside(point, part, margin = 0.1) {
  const mx = part.w * margin
  const my = part.h * margin
  return point.x >= part.x + mx && point.x <= part.x + part.w - mx && point.y >= part.y + my && point.y <= part.y + part.h - my
}

/** A picture of `video` size fitted into `box` (both {width, height}), centered. */
export function fit(video, box) {
  const scale = Math.min(box.width / video.width, box.height / video.height)
  const width = video.width * scale
  const height = video.height * scale
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height }
}

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5)
const clampTo = (v, min, max) => Math.max(min, Math.min(max, v))

/**
 * The part of a picture to show (pixels {x, y, w, h}) so that the points lie in its inner part:
 * it stays put while they move there, and moves – just enough – when one comes near its edge. Large
 * enough for all of them (never smaller than min), in the given shape, within the picture.
 * @param cur the part shown now
 * @param points [{x, y}] in picture pixels
 */
export function keepInView(cur, points, { minW, minH, width, height, aspect = null, inner = 0.65 }) {
  if (!points.length) return cur
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  let w = Math.max(minW, (x1 - x0) / inner)
  let h = Math.max(minH, (y1 - y0) / inner)
  const shape = () => {
    if (!aspect) return
    if (w / h > aspect) h = w / aspect
    else w = h * aspect
  }
  shape()
  if (w > width || h > height) {
    const k = Math.min(width / w, height / h)
    w *= k
    h *= k
  }
  // (about the same size: kept, no breathing)
  if (Math.abs(w - cur.w) < cur.w * 0.05 && Math.abs(h - cur.h) < cur.h * 0.05) {
    w = cur.w
    h = cur.h
  }
  let cx = cur.x + cur.w / 2
  let cy = cur.y + cur.h / 2
  const hx = (w * inner) / 2
  const hy = (h * inner) / 2
  if (x1 > cx + hx) cx = x1 - hx
  if (x0 < cx - hx) cx = x0 + hx
  if (y1 > cy + hy) cy = y1 - hy
  if (y0 < cy - hy) cy = y0 + hy
  return {
    x: Math.max(0, Math.min(width - w, cx - w / 2)),
    y: Math.max(0, Math.min(height - h, cy - h / 2)),
    w,
    h,
  }
}

/** The part (same size) with the points' middle in its middle, within the picture. */
export function centerOn(cur, points, { width, height }) {
  if (!points.length) return cur
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return { ...cur, x: Math.max(0, Math.min(width - cur.w, cx - cur.w / 2)), y: Math.max(0, Math.min(height - cur.h, cy - cur.h / 2)) }
}

// how calmly the part shown follows the viewers' pointers (calmFollow)
export const CALM = {
  inner: 0.8, // still while the pointer is in this middle part …
  push: 0.72, // … moved on, once it leaves it, so far that it is this far in (not again at once)
  tremble: 0.015, // a pointer moved less than this (of the part's width) has not moved
  handover: 1000, // ms: another pointer is followed only once the one followed has rested this long
  rest: 1500, // ms: after being moved on, it glides to the middle only once the pointer rests this long …
  glide: 2600, // ms: … slowly
}

/**
 * Where the part shown goes, a step at a time (calmly). It follows one pointer – the one moved last;
 * another takes over only once that one has rested a moment – and keeps its size. Still while that
 * pointer is in its inner part or only trembles; on, just enough (and a little more), when it leaves
 * that; and once it has rested a while after that, a slow glide until it is in the middle.
 * `state` keeps {goal, lead, anchors, centering, gliding} between steps.
 * @param points [{id, x, y}] in picture pixels (the pointers moved lately)
 * @param dt ms since the last step
 */
export function calmFollow(state, cur, points, dt, { width, height }, calm = CALM) {
  const now = (state.now = (state.now ?? 0) + dt)
  const goal = state.goal ?? cur
  const anchors = (state.anchors ??= new Map())
  // (trembling is no moving: a pointer counts where it was last moved to, by more than a little)
  const tremble = goal.w * calm.tremble
  for (const [i, p] of points.entries()) {
    const id = p.id ?? i
    const a = anchors.get(id)
    if (!a || Math.hypot(p.x - a.x, p.y - a.y) > tremble) anchors.set(id, { x: p.x, y: p.y, moved: now })
  }
  const here = new Set(points.map((p, i) => p.id ?? i))
  // (the one followed: kept while it moves; gone or resting – the one moved last)
  const lead = anchors.get(state.lead)
  if (!here.has(state.lead) || now - lead.moved > calm.handover) {
    let best = null
    for (const id of here) if (!best || anchors.get(id).moved > anchors.get(best).moved) best = id
    if (best != null && (!here.has(state.lead) || anchors.get(best).moved > lead.moved)) state.lead = best
  }
  for (const id of anchors.keys()) if (!here.has(id) && id !== state.lead) anchors.delete(id)
  const p = anchors.get(state.lead)
  if (!p) return goal
  const opts = { minW: goal.w, minH: goal.h, width, height }
  let next = goal
  if (here.has(state.lead)) {
    next = keepInView(goal, [p], { ...opts, inner: calm.inner })
    if (next !== goal && (Math.abs(next.x - goal.x) > 0.5 || Math.abs(next.y - goal.y) > 0.5)) {
      next = keepInView(goal, [p], { ...opts, inner: calm.push })
      state.centering = true
    } else next = goal
  }
  // resting a while after being moved on: slowly to the middle (stopped while it moves again)
  state.gliding = !!state.centering && now - p.moved >= calm.rest
  if (state.gliding) {
    const c = centerOn(next, [p], opts)
    const k = 1 - Math.exp(-dt / calm.glide)
    next = { ...next, x: next.x + (c.x - next.x) * k, y: next.y + (c.y - next.y) * k }
    if (Math.abs(c.x - next.x) < 0.5 && Math.abs(c.y - next.y) < 0.5) state.centering = state.gliding = false
  }
  return (state.goal = next)
}
