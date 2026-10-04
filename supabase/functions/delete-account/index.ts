// Supabase Edge Function: delete-account. See README.md (repo root) for serve/deploy steps.
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CORS_HEADERS, createHandler } from './handler.ts';

const Env = z.object({
  // Injected by the Supabase runtime (and by `supabase functions serve`).
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

function buildHandler(): (req: Request) => Promise<Response> {
  const parsed = Env.safeParse(Deno.env.toObject());
  if (!parsed.success) {
    // Log which variables are wrong (never their values) and fail every request loudly.
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    console.error(`delete-account misconfigured; check env vars: ${fields}`);
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
    createUserClient: (authHeader) =>
      createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: authOptions,
      }),
    createAdminClient: () =>
      createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: authOptions }),
  });
}

Deno.serve(buildHandler());
