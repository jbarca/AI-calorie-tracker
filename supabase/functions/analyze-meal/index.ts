// Supabase Edge Function: analyze-meal. See README.md (repo root) for serve/deploy steps.
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { EFFORT_LEVELS } from './claude.ts';
import { CORS_HEADERS, createHandler } from './handler.ts';

const Env = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  // Injected by the Supabase runtime (and by `supabase functions serve`).
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SCAN_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(30),
  ANALYZE_EFFORT: z.enum(EFFORT_LEVELS).default('medium'),
});

function buildHandler(): (req: Request) => Promise<Response> {
  const parsed = Env.safeParse(Deno.env.toObject());
  if (!parsed.success) {
    // Log which variables are wrong (never their values) and fail every request loudly.
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    console.error(`analyze-meal misconfigured; check env vars: ${fields}`);
    return () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'misconfigured', message: 'Server misconfigured.' }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }),
      );
  }
  const env = parsed.data;
  const authOptions = { persistSession: false, autoRefreshToken: false };

  return createHandler({
    // The key comes from the function's env only. One SDK retry, and a timeout under the
    // Edge Function wall-clock limit.
    anthropic: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 }),
    createUserClient: (authHeader) =>
      createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: authOptions,
      }),
    createAdminClient: () =>
      createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: authOptions }),
    config: { rateLimitPerHour: env.SCAN_RATE_LIMIT_PER_HOUR, effort: env.ANALYZE_EFFORT },
  });
}

Deno.serve(buildHandler());
