import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { MealAnalysis } from '@calorie/shared';
import { buildUserText, SYSTEM_PROMPT } from './prompt.ts';
import type { ImageMediaType } from './image.ts';

type BetaMessage = Anthropic.Beta.BetaMessage;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

export const MODEL = 'claude-opus-5-5';
export const MAX_TOKENS = 16000;
/** Server-side refusal fallbacks, `"default"` scalar form (this exact header pairs with it). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

/**
 * The slice of the Anthropic client this module uses. A real `Anthropic` instance satisfies
 * it; tests pass a fake.
 */
export interface MessagesClient {
  beta: {
    messages: {
      create(params: CreateParams, options?: Anthropic.RequestOptions): PromiseLike<BetaMessage>;
    };
  };
}

export type AnalyzeInput =
  | { kind: 'image'; mediaType: ImageMediaType; base64: string; hint?: string }
  | { kind: 'text'; text: string };

export interface AnalyzeOptions {
  effort?: Effort;
}

/**
 * Outcome of one Claude call. API/transport failures are not represented here: they are
 * thrown as the SDK's typed errors and mapped to HTTP statuses by errors.ts.
 * `model` is always the model that actually served the response (`response.model`), which
 * differs from MODEL when a server-side fallback ran.
 */
export type AnalyzeOutcome =
  | { kind: 'ok'; analysis: MealAnalysis; model: string; message: BetaMessage }
  | { kind: 'refused'; category: string | null; model: string; message: BetaMessage }
  | { kind: 'truncated'; model: string; message: BetaMessage }
  | { kind: 'invalid_output'; error: string; model: string; message: BetaMessage };

// Built once: the JSON schema sent as output_config.format, derived from the shared Zod schema.
const OUTPUT_FORMAT = betaZodOutputFormat(MealAnalysis);

export function buildRequest(input: AnalyzeInput, options: AnalyzeOptions = {}): CreateParams {
  const content: ContentBlockParam[] = [];
  if (input.kind === 'image') {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: input.mediaType, data: input.base64 },
    });
    content.push({ type: 'text', text: buildUserText({ kind: 'image', hint: input.hint }) });
  } else {
    content.push({ type: 'text', text: buildUserText({ kind: 'text', text: input.text }) });
  }

  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // No `thinking` param: Opus 5.5 always runs adaptive thinking; effort is the control.
    output_config: {
      effort: options.effort ?? 'medium',
      format: { type: OUTPUT_FORMAT.type, schema: OUTPUT_FORMAT.schema },
    },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  };
}

/**
 * Calls Claude and turns the response into an AnalyzeOutcome.
 *
 * Uses `beta.messages.create` (not `.parse`) so stop_reason is checked before any parsing:
 * the parse helper validates every text block eagerly and throws on a max_tokens-truncated
 * body, which would hide the stop_reason. The output is then validated here with the same
 * shared Zod schema the format was built from.
 */
export async function analyzeWithClaude(
  client: MessagesClient,
  input: AnalyzeInput,
  options: AnalyzeOptions = {},
): Promise<AnalyzeOutcome> {
  const message = await client.beta.messages.create(buildRequest(input, options));
  const model = message.model;

  // Branch on stop_reason before reading content. stop_details is informational only.
  if (message.stop_reason === 'refusal') {
    return { kind: 'refused', category: message.stop_details?.category ?? null, model, message };
  }
  if (
    message.stop_reason === 'max_tokens' ||
    message.stop_reason === 'model_context_window_exceeded'
  ) {
    return { kind: 'truncated', model, message };
  }

  const text = finalText(message);
  if (!text) {
    return {
      kind: 'invalid_output',
      error: `no text output (stop_reason: ${message.stop_reason})`,
      model,
      message,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { kind: 'invalid_output', error: `output is not JSON: ${String(err)}`, model, message };
  }
  const parsed = MealAnalysis.safeParse(json);
  if (!parsed.success) {
    return { kind: 'invalid_output', error: parsed.error.message, model, message };
  }
  return { kind: 'ok', analysis: parsed.data, model, message };
}

/**
 * Text of the final answer: the text blocks after the last `fallback` block (if a fallback
 * ran, anything before it belongs to the model that declined). Thinking blocks are skipped.
 */
function finalText(message: BetaMessage): string {
  const lastFallback = message.content.findLastIndex((block) => block.type === 'fallback');
  return message.content
    .slice(lastFallback + 1)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
}
