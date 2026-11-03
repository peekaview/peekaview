// Where on the presenter's screen a point of the shared picture is – for the helper window of
// "Bildschirmfreigabe light", which jumps there when somebody points or draws.
//
// Browsers say little about screens, so this is an estimate:
//   - Only a shared *screen* (displaySurface "monitor") maps to screen coordinates. A window or
//     a tab can be anywhere – the helper then shows the whole picture in the middle instead.
//   - The shared screen is assumed to be the one the helper window is on; when the picture's
//     aspect ratio does not match that screen, it is another one (several monitors).
//   - The screen's own corner: Firefox has screen.left/top; Chrome only has it with the
//     "window management" permission (getScreenDetails), which we use only when it is granted
//     already. Otherwise availLeft/availTop – the usable area, which on a Mac starts below the
//     menu bar (about 25 px, more on Macs with a notch).
//   - Coordinates are CSS pixels; the picture (track settings) is in device pixels.

const MAC_MENU_BAR = 25

/** The shared screen in screen coordinates (CSS px): {left, top, width, height}. */
export function monitorRect(screen, { mac = false, details = null } = {}) {
  if (details && Number.isFinite(details.left) && Number.isFinite(details.top)) {
    return { left: details.left, top: details.top, width: details.width ?? screen.width, height: details.height ?? screen.height }
  }
  const left = Number.isFinite(screen.left) ? screen.left : Number.isFinite(screen.availLeft) ? screen.availLeft : 0
  let top = Number.isFinite(screen.top) ? screen.top : null
  if (top == null) {
    const availTop = Number.isFinite(screen.availTop) ? screen.availTop : 0
    // macOS: the usable area starts below the menu bar
    top = mac && screen.availHeight < screen.height ? availTop - Math.min(MAC_MENU_BAR, screen.height - screen.availHeight) : availTop
  }
  return { left, top, width: screen.width, height: screen.height }
}

/** Whether a picture of this size can be the given screen (same aspect ratio, 2 % tolerance). */
export function matchesScreen(video, monitor) {
  if (!video?.width || !video?.height || !monitor.width || !monitor.height) return false
  return Math.abs(video.width / video.height - monitor.width / monitor.height) < 0.02 * (monitor.width / monitor.height)
}

/** A point of the picture (0..1) in screen coordinates. */
export function toScreen(point, monitor) {
  return { x: monitor.left + clamp01(point.x) * monitor.width, y: monitor.top + clamp01(point.y) * monitor.height }
}

/**
 * The area (screen coordinates) a helper of `size` should cover so that the point lies in its
 * middle – moved inside the screen where it would stick out.
 */
export function spotRect(point, monitor, size) {
  const w = Math.min(size.width, monitor.width)
  const h = Math.min(size.height, monitor.height)
  const p = toScreen(point, monitor)
  return {
    left: Math.round(clampTo(p.x - w / 2, monitor.left, monitor.left + monitor.width - w)),
    top: Math.round(clampTo(p.y - h / 2, monitor.top, monitor.top + monitor.height - h)),
    width: Math.round(w),
    height: Math.round(h),
  }
}

/**
 * Where the whole shared screen lies inside the helper's content area that actually sits at
 * `content` (screen coordinates) – the picture is laid under it 1:1, so the helper looks like a
 * pane of glass over that spot.
 */
export function stageInContent(content, monitor) {
  return { left: monitor.left - content.left, top: monitor.top - content.top, width: monitor.width, height: monitor.height }
}

/** The part of the picture (0..1) the helper's content shows. */
export function visiblePart(content, monitor) {
  return {
    x: (content.left - monitor.left) / monitor.width,
    y: (content.top - monitor.top) / monitor.height,
    w: content.width / monitor.width,
    h: content.height / monitor.height,
  }
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
