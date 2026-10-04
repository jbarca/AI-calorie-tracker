/**
 * Downloads the public photos that `dataset.json` lists with a `source` URL into eval/photos/,
 * scaled down to at most 1024 px on the long edge and saved as JPEG, as the app uploads them.
 * Photos already in eval/photos/ are left alone, so it is safe to re-run. Entries without a
 * `source` (your own photos) are skipped. Free: it never calls the Anthropic API.
 *
 *   deno task --config supabase/functions/analyze-meal/deno.json eval:fetch
 */
import { Jimp } from 'jimp';
import { Dataset } from './dataset.ts';

const EVAL_DIR = new URL('./', import.meta.url);
const PHOTOS_URL = new URL('photos/', EVAL_DIR);
const LONG_EDGE = 1024;
const CONCURRENCY = 8;

/** Fetches one photo and returns it as a JPEG no larger than LONG_EDGE on either side. */
async function download(source: string): Promise<Uint8Array> {
  const res = await fetch(source);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const image = await Jimp.read(await res.arrayBuffer());
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

async function main() {
  const dataset = Dataset.parse(
    JSON.parse(await Deno.readTextFile(new URL('dataset.json', EVAL_DIR))),
  );
  await Deno.mkdir(PHOTOS_URL, { recursive: true });

  const todo = [];
  for (const entry of dataset) {
    if (!entry.source) continue;
    if (!entry.image.endsWith('.jpg'))
      throw new Error(`${entry.image}: sourced photos must be .jpg`);
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
          await Deno.writeFile(new URL(entry.image, PHOTOS_URL), await download(entry.source!));
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
