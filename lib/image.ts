// Pure-TypeScript image inspection (no native modules, so it installs anywhere).
// - Detects JPEG/PNG from magic bytes (the filename and browser-sent type are ignored)
// - Reads width/height
// - Rebuilds the file from an ALLOWLIST of the parts needed to draw the image.
//   Everything else is dropped: EXIF/GPS, XMP, comments, embedded thumbnails,
//   extra images (multi-picture format), and anything appended after the image ends
//   (e.g. the MP4 that "motion photos" attach, or a hidden payload).
// Anything that doesn't parse cleanly is rejected.

export type ImageInfo = { mime: 'image/jpeg' | 'image/png'; ext: 'jpg' | 'png'; width: number; height: number; clean: Buffer }

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// Chunks needed to render a still PNG correctly. Text, EXIF, time, ICC profiles,
// animation and unknown/private chunks are all dropped.
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs'])
const MAX_DIM = 6000

export function inspectImage(buf: Buffer): ImageInfo | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return inspectPng(buf)
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return inspectJpeg(buf)
  return null
}

function inspectPng(buf: Buffer): ImageInfo | null {
  const out: Buffer[] = [PNG_SIG]
  let pos = 8
  let width = 0
  let height = 0
  let sawEnd = false
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.subarray(pos + 4, pos + 8).toString('latin1')
    const end = pos + 12 + len
    if (len > buf.length || end > buf.length || !/^[A-Za-z]{4}$/.test(type)) return null
    if (type === 'IHDR') {
      if (pos !== 8 || len !== 13) return null
      width = buf.readUInt32BE(pos + 8)
      height = buf.readUInt32BE(pos + 12)
    }
    if (PNG_KEEP.has(type)) out.push(buf.subarray(pos, end))
    pos = end
    if (type === 'IEND') {
      sawEnd = true
      break // anything after IEND is discarded
    }
  }
  if (!sawEnd || !okDims(width, height)) return null
  return { mime: 'image/png', ext: 'png', width, height, clean: Buffer.concat(out) }
}

// JPEG segments we keep: frame headers (SOFn), Huffman/arithmetic tables (DHT, DAC),
// quantisation tables (DQT), restart interval (DRI), line count (DNL), and scans
// (SOS + their compressed data). APP0 (JFIF) and APP14 (Adobe colour info) are
// kept only when they are the short, fixed-size headers (no embedded thumbnail).
function keepJpegSegment(marker: number, len: number): boolean {
  if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) return true // SOFn, DHT (C4), DAC (CC)
  if (marker === 0xdb || marker === 0xdd || marker === 0xdc) return true // DQT, DRI, DNL
  if ((marker === 0xe0 || marker === 0xee) && len <= 16) return true // JFIF / Adobe header only
  return false // APP1-APP15 (EXIF, XMP, MPF...), COM, and anything unknown
}

function inspectJpeg(buf: Buffer): ImageInfo | null {
  const out: Buffer[] = [buf.subarray(0, 2)] // SOI
  let pos = 2
  let width = 0
  let height = 0
  let sawScan = false
  let sawEnd = false

  while (pos < buf.length) {
    if (buf[pos] !== 0xff) return null
    while (pos + 1 < buf.length && buf[pos + 1] === 0xff) pos++ // fill bytes before a marker
    const marker = buf[pos + 1]
    if (marker === undefined) return null

    if (marker === 0xd9) {
      out.push(Buffer.from([0xff, 0xd9])) // EOI: stop. Everything after it is dropped.
      sawEnd = true
      break
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      return null // a second SOI, TEM or a stray restart marker outside a scan: reject
    }

    if (pos + 4 > buf.length) return null
    const len = buf.readUInt16BE(pos + 2)
    const end = pos + 2 + len
    if (len < 2 || end > buf.length) return null

    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (len < 8) return null
      height = buf.readUInt16BE(pos + 5)
      width = buf.readUInt16BE(pos + 7)
    }

    if (marker === 0xda) {
      // Start of scan: keep the header, then the compressed data up to the next real
      // marker. Inside the data, 0xFF is always followed by 0x00 (an escaped byte)
      // or a restart marker 0xD0-0xD7; anything else ends the scan. Progressive
      // JPEGs have several scans, and the loop continues to handle them (and drop
      // any metadata placed between them).
      out.push(buf.subarray(pos, end))
      let p = end
      while (p < buf.length) {
        if (buf[p] === 0xff) {
          const n = buf[p + 1]
          if (n === 0x00 || (n !== undefined && n >= 0xd0 && n <= 0xd7)) {
            p += 2
            continue
          }
          break
        }
        p++
      }
      out.push(buf.subarray(end, p))
      sawScan = true
      pos = p
      continue
    }

    if (keepJpegSegment(marker, len)) out.push(buf.subarray(pos, end))
    pos = end
  }

  if (!sawScan || !sawEnd || !okDims(width, height)) return null
  return { mime: 'image/jpeg', ext: 'jpg', width, height, clean: Buffer.concat(out) }
}

function okDims(w: number, h: number): boolean {
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= MAX_DIM && h <= MAX_DIM
}
