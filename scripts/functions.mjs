#!/usr/bin/env node
// Runs `deno test` or `deno check` + `deno lint` for every Edge Function, i.e. every
// supabase/functions/*/deno.json, each with its own config. Fails if any function fails.
//
//   node scripts/functions.mjs test
//   node scripts/functions.mjs check
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS = join(ROOT, 'supabase/functions');
const mode = process.argv[2];
if (mode !== 'test' && mode !== 'check') {
  console.error('usage: node scripts/functions.mjs <test|check>');
  process.exit(2);
}

const functions = readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(FUNCTIONS, d.name, 'deno.json')))
  .map((d) => d.name)
  .sort();

if (functions.length === 0) {
  console.error('No supabase/functions/*/deno.json found.');
  process.exit(1);
}

function deno(args) {
  console.log(`\n$ deno ${args.join(' ')}`);
  const res = spawnSync('deno', args, { cwd: ROOT, stdio: 'inherit' });
  if (res.error) {
    console.error(`failed to run deno: ${res.error.message}`);
    return false;
  }
  return res.status === 0;
}

const failed = [];
for (const name of functions) {
  const dir = `supabase/functions/${name}`;
  const config = `${dir}/deno.json`;
  let ok;
  if (mode === 'test') {
    // Only *_test.ts / *.test.ts files are run; eval/run.ts is never executed here.
    ok = deno(['test', '--config', config, dir]);
  } else {
    // Type-check every .ts file in the function directory (eval/ included), then lint it.
    const files = listTs(join(ROOT, dir)).map((f) => f.slice(ROOT.length + 1));
    ok = deno(['check', '--config', config, ...files]) && deno(['lint', '--config', config, dir]);
  }
  if (!ok) failed.push(name);
}

if (mode === 'check') {
  // The generated shared copy has no deno.json of its own; lint it with the first function's.
  const shared = 'supabase/functions/_shared';
  if (existsSync(join(ROOT, shared))) {
    const config = `supabase/functions/${functions[0]}/deno.json`;
    if (!deno(['lint', '--config', config, shared])) failed.push('_shared');
  }
}

if (failed.length > 0) {
  console.error(`\ndeno ${mode} failed for: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\ndeno ${mode} passed for: ${functions.join(', ')}`);

function listTs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'photos' || entry.name === 'results') {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out.sort();
}
