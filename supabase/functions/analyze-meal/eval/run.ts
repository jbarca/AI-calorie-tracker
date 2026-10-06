/**
 * Accuracy eval for analyze-meal: runs the exact Claude request the function sends
 * (`analyzeWithClaude`) over labelled photos and reports MAPE, bias, the ±20% hit rate and
 * non-food accuracy. It calls the real Anthropic API and costs money, so it refuses to run
 * without `--yes`. Never run in CI; `deno test` does not execute this file. See README.md.
 *
 *   deno task --config supabase/functions/analyze-meal/deno.json eval [--limit N] --yes
 */
import Anthropic from '@anthropic-ai/sdk';
import { encodeBase64 } from '@std/encoding/base64';
import { analyzeWithClaude, EFFORT_LEVELS, MODEL } from '../claude.ts';
import { detectImageType, MAX_IMAGE_BYTES } from '../image.ts';
import { Dataset, duplicateImages, type Entry } from './dataset.ts';
import {
  type EvalRow,
  formatReport,
  sampleAcrossCategories,
  summarize,
  totalTokens,
} from './metrics.ts';

const EVAL_DIR = new URL('./', import.meta.url);
const DATASET_URL = new URL('dataset.json', EVAL_DIR);
/** Optional, gitignored labels for your own photos; appended to dataset.json. */
const LOCAL_DATASET_URL = new URL('dataset.local.json', EVAL_DIR);
const PHOTOS_URL = new URL('photos/', EVAL_DIR);
const RESULTS_URL = new URL('results/', EVAL_DIR);

function parseArgs(args: string[]): { yes: boolean; limit: number | null } {
  let yes = false;
  let limit: number | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--yes') yes = true;
    else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const raw = arg === '--limit' ? args[++i] : arg.slice('--limit='.length);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        fail(`--limit needs a positive integer, got ${raw}`);
      }
      limit = n;
    } else fail(`unknown argument: ${arg}`);
  }
  return { yes, limit };
}

function fail(message: string): never {
  console.error(`eval: ${message}`);
  Deno.exit(1);
}

async function readDataset(url: URL, name: string, required: boolean): Promise<Entry[]> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(url);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      if (!required) return [];
      fail(`eval/${name} not found. Restore it with \`git restore ${name}\`.`);
    }
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    fail(`eval/${name} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = Dataset.safeParse(json);
  if (!parsed.success) {
    fail(`eval/${name} is invalid:\n${parsed.error.message}`);
  }
  return parsed.data;
}

async function loadDataset(): Promise<Entry[]> {
  const entries = [
    ...(await readDataset(DATASET_URL, 'dataset.json', true)),
    ...(await readDataset(LOCAL_DATASET_URL, 'dataset.local.json', false)),
  ];
  for (const entry of entries) {
    if ((entry.is_food ?? true) && entry.true_kcal <= 0) {
      fail(`${entry.image}: food photos need true_kcal > 0 (set is_food: false for non-food)`);
    }
  }
  const dupes = duplicateImages(entries);
  if (dupes.length > 0) {
    fail(`these images are listed more than once: ${dupes.join(', ')}`);
  }
  return entries;
}

async function evaluate(client: Anthropic, entry: Entry, effort: string): Promise<EvalRow> {
  const expected_is_food = entry.is_food ?? true;
  const base = {
    image: entry.image,
    category: entry.category,
    true_kcal: entry.true_kcal,
    expected_is_food,
    predicted_kcal: null,
    predicted_is_food: null,
    tokens: 0,
    model: null,
  };
  const started = Date.now();
  try {
    const bytes = await Deno.readFile(new URL(entry.image, PHOTOS_URL));
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`image is over ${MAX_IMAGE_BYTES} bytes`);
    }
    const mediaType = detectImageType(bytes, entry.image);
    if (mediaType === null || mediaType === 'image/heic') {
      throw new Error(`unsupported image type (${mediaType ?? 'unknown'}); use JPEG, PNG or WebP`);
    }
    const out = await analyzeWithClaude(
      client,
      { kind: 'image', mediaType, base64: encodeBase64(bytes) },
      { effort: effort as (typeof EFFORT_LEVELS)[number] },
    );
    const common = {
      ...base,
      outcome: out.kind,
      tokens: totalTokens(out.message.usage),
      latency_ms: Date.now() - started,
      model: out.model,
    };
    if (out.kind === 'ok') {
      return {
        ...common,
        predicted_kcal: out.analysis.total_kcal,
        predicted_is_food: out.analysis.is_food,
      };
    }
    return {
      ...common,
      error: out.kind === 'invalid_output' ? out.error : undefined,
    };
  } catch (err) {
    return {
      ...base,
      outcome: 'error',
      latency_ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const { yes, limit } = parseArgs(Deno.args);
  const effort = Deno.env.get('ANALYZE_EFFORT') ?? 'medium';
  if (!(EFFORT_LEVELS as readonly string[]).includes(effort)) {
    fail(`ANALYZE_EFFORT must be one of ${EFFORT_LEVELS.join(', ')}, got ${effort}`);
  }

  const dataset = await loadDataset();
  const entries = limit === null ? dataset : sampleAcrossCategories(dataset, limit);
  if (entries.length === 0) fail('the eval dataset has no entries.');

  // Fail on missing photos before anything is spent.
  const missing: string[] = [];
  for (const entry of entries) {
    try {
      await Deno.stat(new URL(entry.image, PHOTOS_URL));
    } catch {
      missing.push(entry.image);
    }
  }
  if (missing.length > 0) {
    fail(`missing photos in eval/photos/: ${missing.join(', ')}`);
  }

  console.log(
    `${entries.length} image(s) from eval/dataset.json -> ${MODEL}, effort ${effort}.\n` +
      `This makes ${entries.length} real Anthropic API call(s) and costs money.`,
  );
  if (!yes) fail('refusing to call the API without --yes.');

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) fail('ANTHROPIC_API_KEY is not set.');
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });

  const rows: EvalRow[] = [];
  for (const [i, entry] of entries.entries()) {
    const row = await evaluate(client, entry, effort);
    console.log(
      `[${i + 1}/${entries.length}] ${row.image}: ${row.outcome}` +
        (row.predicted_kcal === null ? '' : ` ${Math.round(row.predicted_kcal)} kcal`) +
        (row.error ? ` (${row.error})` : ''),
    );
    rows.push(row);
  }

  const summary = summarize(rows);
  console.log(`\n${formatReport(rows, summary)}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await Deno.mkdir(RESULTS_URL, { recursive: true });
  const outUrl = new URL(`${timestamp}.json`, RESULTS_URL);
  await Deno.writeTextFile(
    outUrl,
    JSON.stringify({ timestamp, model: MODEL, effort, summary, rows }, null, 2) + '\n',
  );
  console.log(`\nWrote ${outUrl.pathname}`);
}

if (import.meta.main) {
  await main();
}
