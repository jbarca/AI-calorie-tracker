import { resizeForLongEdge, UPLOAD_LONG_EDGE } from '@calorie/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export const UPLOAD_JPEG_QUALITY = 0.7;

export type PreparedPhoto = {
  /** Local file URI of the resized JPEG (for previews). */
  uri: string;
  /** Base64 of the JPEG bytes (for the Storage upload). */
  base64: string;
  width: number;
  height: number;
};

/**
 * Resizes a photo so its long edge is at most ~1024 px and re-encodes it as JPEG (quality 0.7).
 * Re-encoding also converts HEIC/PNG gallery picks to JPEG, which the analyze function needs.
 */
export async function prepareMealPhoto(uri: string): Promise<PreparedPhoto> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const resize = resizeForLongEdge(original.width, original.height, UPLOAD_LONG_EDGE);
  const image = resize
    ? await ImageManipulator.manipulate(original).resize(resize).renderAsync()
    : original;
  const saved = await image.saveAsync({
    compress: UPLOAD_JPEG_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!saved.base64) throw new Error('Could not encode the photo.');
  return { uri: saved.uri, base64: saved.base64, width: saved.width, height: saved.height };
}
