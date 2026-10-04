/** Long edge (px) photos are resized to before upload: plenty for food recognition, ~150-300 KB. */
export const UPLOAD_LONG_EDGE = 1024;

/**
 * The resize to apply so the image's long edge is at most `maxEdge`, preserving aspect ratio
 * (only the constrained side is returned). Null when the image is already small enough.
 */
export function resizeForLongEdge(
  width: number,
  height: number,
  maxEdge: number = UPLOAD_LONG_EDGE,
): { width: number } | { height: number } | null {
  if (!(width > 0 && height > 0) || Math.max(width, height) <= maxEdge) return null;
  return width >= height ? { width: maxEdge } : { height: maxEdge };
}
