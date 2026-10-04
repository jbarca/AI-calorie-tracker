// Shared fakes for the analyze-meal tests. Never calls the real Anthropic API.
import type Anthropic from '@anthropic-ai/sdk';
import type { MessagesClient } from './claude.ts';

type BetaMessage = Anthropic.Beta.BetaMessage;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export const VALID_ANALYSIS = {
  is_food: true,
  items: [
    {
      name: 'grilled chicken breast',
      portion_desc: '1 palm-sized fillet',
      estimated_grams: 120,
      kcal: 198,
      protein_g: 37,
      carbs_g: 0,
      fat_g: 4.3,
      confidence: 'medium',
    },
    {
      name: 'white rice',
      portion_desc: '1 cup',
      estimated_grams: 158,
      kcal: 205,
      protein_g: 4.3,
      carbs_g: 44.5,
      fat_g: 0.4,
      confidence: 'high',
    },
  ],
  total_kcal: 403,
  notes: 'Assumed no oil on the chicken.',
};

export const NON_FOOD_ANALYSIS = {
  is_food: false,
  items: [],
  total_kcal: 0,
  notes: 'The photo shows a cat on a sofa, not food.',
};

/** A minimal BetaMessage; only the fields this function reads are meaningful. */
export function fakeMessage(overrides: Partial<BetaMessage> = {}): BetaMessage {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1500, output_tokens: 300 },
    ...overrides,
  } as unknown as BetaMessage;
}

/** A message whose final text block is `JSON.stringify(output)` (or `output` if a string). */
export function textMessage(output: unknown, overrides: Partial<BetaMessage> = {}): BetaMessage {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  return fakeMessage({
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text, citations: null },
    ] as unknown as BetaMessage['content'],
    ...overrides,
  });
}

/** Fake client: records each request and returns (or throws) the queued response. */
export class FakeAnthropic implements MessagesClient {
  calls: CreateParams[] = [];
  constructor(private respond: (params: CreateParams) => BetaMessage | Promise<BetaMessage>) {}
  beta = {
    messages: {
      create: (params: CreateParams): Promise<BetaMessage> => {
        this.calls.push(params);
        return Promise.resolve().then(() => this.respond(params));
      },
    },
  };
}
