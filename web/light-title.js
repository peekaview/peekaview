// "Bildschirmfreigabe light": the picked window's title, read from its title bar (Tesseract, in
// this browser – nothing leaves it). While the window stays where it is, its title is read now and
// then; a new one (another tab, another document) is added to the ones known. When the window is
// gone from its place – moved, maximized, minimized and brought back – the title bars on the
// screen are read and the window found again by a title it had.

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js'
const TITLE_HEIGHT = 40 // points read below a window's top (a title bar, or the middle of a toolbar)
const SIDE = 70 // points left out on the left (the three buttons)

let reader = null

function loadScript() {
  if (window.Tesseract) return Promise.resolve()
  return new Promise((done, fail) => {
    const script = document.createElement('script')
    script.src = TESSERACT
    script.onload = done
    script.onerror = () => fail(new Error('Tesseract not loaded'))
    document.head.append(script)
  })
}

/** The text in a picture (a canvas): read by Tesseract, German and English. */
export async function readText(canvas) {
  reader ??= (async () => {
    await loadScript()
    const worker = await window.Tesseract.createWorker(['deu', 'eng'], 1, { logger: () => {} })
    // (words scattered over a bar, not a page)
    await worker.setParameters({ tessedit_pageseg_mode: '11' })
    return worker
  })().catch((err) => {
    reader = null
    throw err
  })
  const worker = await reader
  const { data } = await worker.recognize(canvas)
  return (data.text ?? '').replace(/\s+/g, ' ').trim()
}

/** A window's title bar as a picture to read: enlarged where the screen is not sharp (1×). */
export function titleBar(source, rect, scale = 1) {
  const x = rect.x + Math.round(SIDE * scale)
  const width = Math.max(16, rect.width - Math.round(SIDE * scale) - Math.round(12 * scale))
  const height = Math.max(12, Math.min(Math.round(TITLE_HEIGHT * scale), Math.round(rect.height * 0.3)))
  const k = scale < 2 ? 2 : 1
  const canvas = document.createElement('canvas')
  canvas.width = width * k
  canvas.height = height * k
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, x, rect.y, width, height, 0, 0, width * k, height * k)
  return readable(canvas)
}

/**
 * Made easy to read: grey, its contrast stretched, dark text on light ground (Tesseract reads that
 * best – a dark title bar, or white on colour, is turned around).
 */
function readable(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data
  const n = px.length / 4
  const gray = new Float32Array(n)
  for (let i = 0; i < n; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]
  // the ground is what most of the bar is: brighter or darker than its middle
  const sorted = Float32Array.from(gray).sort()
  const low = sorted[Math.floor(n * 0.02)]
  const high = sorted[Math.floor(n * 0.98)]
  const ground = sorted[Math.floor(n / 2)]
  const invert = ground < (low + high) / 2
  const span = Math.max(1, high - low)
  for (let i = 0; i < n; i++) {
    let v = Math.min(255, Math.max(0, ((gray[i] - low) / span) * 255))
    if (invert) v = 255 - v
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v
    px[i * 4 + 3] = 255
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

/** The words of a title that count: letters and digits, at least three of them. */
export function words(text) {
  return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []))]
}

/**
 * How sure two titles read are the same: the share of the shorter one's words found in the other
 * (reading may miss or garble a word), 0..1. Nothing to compare: 0.
 */
export function sameTitle(a, b) {
  const A = words(a)
  const B = new Set(words(b))
  if (!A.length || !B.size) return 0
  const shorter = A.length <= B.size ? A : [...B]
  const other = A.length <= B.size ? B : new Set(A)
  const hits = shorter.filter((w) => other.has(w) || [...other].some((o) => close(w, o))).length
  // one short word alone says little
  if (hits < 2 && shorter.join('').length < 8) return 0
  return hits / shorter.length
}

// one letter wrong, missing or too many (reading errors)
function close(a, b) {
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}
