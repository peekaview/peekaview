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
