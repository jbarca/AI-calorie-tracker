/**
 * Downloads the public photos that `dataset.json` lists with a `source` URL into eval/photos/,
 * scaled down to at most 1024 px on the long edge and saved as JPEG, as the app uploads them.
 * Photos already in eval/photos/ are left alone, so it is safe to re-run. Entries without a
 * `source` (your own photos) are skipped. Free: it never calls the Anthropic API.
 *
 *   deno task --config supabase/functions/analyze-meal/deno.json eval:fetch
 */
import { Jimp } from 'jimp';
import { Dataset, duplicateImages } from './dataset.ts';

const EVAL_DIR = new URL('./', import.meta.url);
const PHOTOS_URL = new URL('photos/', EVAL_DIR);
const LONG_EDGE = 1024;
const CONCURRENCY = 8;
const TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;

/** Fetches one photo and returns it as a JPEG no larger than LONG_EDGE on either side. */
async function download(source: string): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(source, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return await toJpeg(await res.arrayBuffer());
      lastError = new Error(`HTTP ${res.status}`);
      if (res.status < 500) break; // a 4xx will not fix itself
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function toJpeg(bytes: ArrayBuffer): Promise<Uint8Array> {
  const image = await Jimp.read(bytes);
  if (Math.max(image.width, image.height) > LONG_EDGE) {
    image.scaleToFit({ w: LONG_EDGE, h: LONG_EDGE });
  }
  return new Uint8Array(await image.getBuffer('image/jpeg', { quality: 85 }));
}

async function exists(url: URL): Promise<boolean> {
  try {
    await Deno.stat(url);
    return true;
  } catch {
    return false;
  }
}

/** Writes via a temp file and a rename, so an interrupted run never leaves a truncated photo. */
async function writeAtomic(url: URL, bytes: Uint8Array): Promise<void> {
  const tmp = new URL(`${url.href}.part`);
  await Deno.writeFile(tmp, bytes);
  await Deno.rename(tmp, url);
}

async function main() {
  const parsed = Dataset.safeParse(
    JSON.parse(await Deno.readTextFile(new URL('dataset.json', EVAL_DIR))),
  );
  if (!parsed.success) {
    console.error(`eval/dataset.json is invalid:\n${parsed.error.message}`);
    Deno.exit(1);
  }
  const dataset = parsed.data;
  const dupes = duplicateImages(dataset);
  if (dupes.length > 0) {
    console.error(`eval/dataset.json lists these images more than once: ${dupes.join(', ')}`);
    Deno.exit(1);
  }
  await Deno.mkdir(PHOTOS_URL, { recursive: true });

  const todo = [];
  for (const entry of dataset) {
    if (!entry.source) continue;
    if (!entry.image.endsWith('.jpg')) {
      throw new Error(`${entry.image}: sourced photos must be .jpg`);
    }
    if (!(await exists(new URL(entry.image, PHOTOS_URL)))) todo.push(entry);
  }
  console.log(`${todo.length} photo(s) to download.`);

  const failed: string[] = [];
  let done = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        try {
          await writeAtomic(new URL(entry.image, PHOTOS_URL), await download(entry.source!));
          console.log(`[${++done}/${todo.length}] ${entry.image}`);
        } catch (err) {
          failed.push(entry.image);
          console.error(`${entry.image}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }),
  );
  if (failed.length > 0) {
    console.error(`\n${failed.length} download(s) failed: ${failed.join(', ')}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
