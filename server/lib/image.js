// image.js — raster image sniffing.
//
// The request's Content-Type header is never trusted: the accepted type is
// decided from magic bytes. SVG is deliberately NOT accepted (it is a document,
// not a raster image), and neither is anything unrecognised.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // hard 2 MiB body limit

export const IMAGE_TYPES = Object.freeze({
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
});

function startsWith(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Identify a raster image from its leading bytes.
 * Returns { key, type, ext } or null when the buffer is not JPEG/PNG/WebP.
 */
export function sniffImage(buf) {
  if (!buf || buf.length < 3) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { key: "jpeg", type: IMAGE_TYPES.jpeg, ext: "jpg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { key: "png", type: IMAGE_TYPES.png, ext: "png" };
  }
  // WebP: "RIFF" .... "WEBP"
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    return { key: "webp", type: IMAGE_TYPES.webp, ext: "webp" };
  }
  return null;
}
