/** Image types Claude accepts that the `meal-photos` bucket also allows. */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Claude API limit per base64 image is 5 MB; the app resizes to ~1024px, so this is a guard. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type DetectedImage = ImageMediaType | 'image/heic' | null;

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Detect from magic bytes; null when unrecognised. */
export function sniffImageType(bytes: Uint8Array): DetectedImage {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 4) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  // ISO-BMFF: [size:4]['ftyp'][major brand:4]
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(bytes, 8, 12))) {
    return 'image/heic';
  }
  return null;
}

function typeFromExtension(path: string): DetectedImage {
  const ext = path.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
    case 'heif':
      return 'image/heic';
    default:
      return null;
  }
}

/**
 * Media type of a stored photo. The bytes win over the extension (a `.jpg` path may hold a
 * HEIC the client failed to convert); the extension is only a fallback for unknown bytes.
 */
export function detectImageType(bytes: Uint8Array, path: string): DetectedImage {
  return sniffImageType(bytes) ?? typeFromExtension(path);
}
