import { NextResponse } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

const TurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.string().optional(),
});

const BodySchema = z.object({
  transcript: z.array(TurnSchema).min(1).max(80),
  cognitive_flags: z.record(z.string(), z.unknown()).optional().nullable(),
});

const SYSTEM_PROMPT = `You are a clinical scribe summarising a patient's daily voice check-in for their neurologist.

Audience: a doctor monitoring a patient for Parkinson's / dementia progression. They have 30 seconds to skim.

Output format (markdown, no headings beyond what's listed):

**Overall:** one sentence on mood + how the patient sounded today.

**Reported symptoms / changes:** bullet list. Include sleep, medication adherence (esp. levodopa on/off), pain, stiffness, tremor, mood, stress, caffeine, anything else the patient volunteered. Skip categories the patient didn't mention.

**Cognitive probes:** one line per probe attempted (word recall, verbal fluency, orientation). State the probe + the patient's response in their own words + a brief judgement (e.g. "recalled 2/3 words", "named 8 animals in 30s — within normal range").

**Flags for clinician:** bullet list of anything worth a follow-up. Empty list = "None."

Rules:
- Do not diagnose. Do not use the words Parkinson's or dementia.
- Quote the patient directly when content matters; don't paraphrase symptom descriptions.
- If the transcript is too short or the patient barely engaged, say so plainly.
- Keep total length under 180 words.`;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const { transcript, cognitive_flags } = parsed.data;

  const transcriptText = transcript
    .map((t) => `${t.role.toUpperCase()}: ${t.content.trim()}`)
    .join('\n');

  const flagsText = cognitive_flags && Object.keys(cognitive_flags).length > 0
    ? `\n\nDetected cognitive flags (auto-extracted, may be noisy):\n${JSON.stringify(cognitive_flags, null, 2)}`
    : '';

  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Transcript of today's check-in:\n\n${transcriptText}${flagsText}\n\nSummarise per the rules above.`,
      },
    ],
  });

  const text = resp.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return NextResponse.json({ summary: text });
}
