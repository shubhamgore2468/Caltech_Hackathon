import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

const TurnSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(4000),
    }),
  ).min(1).max(40),
  session_id: z.string().uuid().optional(),
});

const SYSTEM_PROMPT = `You are NeuroTrack, a warm, friendly health assistant doing a brief daily check-in with an older adult.

Tone:
- Conversational, kind, never clinical or alarming.
- Short turns (1-2 sentences). Ask one question at a time.
- Use the patient's own words back to them when you can.

What to cover across the conversation (don't rush, don't ask all at once):
- Mood today (1 simple question).
- Sleep quality last night.
- Medication adherence (have they taken today's meds yet?).
- At least one cognitive probe woven in naturally, choose one:
  (a) Word recall: "I'm going to tell you three words and I'll ask about them in a minute: apple, table, river." Then circle back later in the chat and ask them to repeat.
  (b) Verbal fluency: "In 30 seconds, name as many animals as you can — go!" Acknowledge their answer warmly.
  (c) Orientation: "Just to ground us — what day of the week is it today?"

Rules:
- Never diagnose. Never use the words Parkinson's or dementia.
- If user expresses distress or pain, gently suggest they contact their doctor or caregiver.
- End the conversation after 5-7 user turns with a warm sign-off.
`;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => null);
  const parsed = TurnSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: z.treeifyError(parsed.error) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const client = new Anthropic({ apiKey });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const res = await client.messages.stream({
          model: 'claude-sonnet-4-5',
          max_tokens: 400,
          system: SYSTEM_PROMPT,
          messages: parsed.data.messages,
        });

        for await (const event of res) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(`\n[stream error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
