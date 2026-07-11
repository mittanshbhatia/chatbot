import type { VercelRequest, VercelResponse } from '@vercel/node';

type ChatRole = 'user' | 'assistant' | 'system';

type ChatMessage = {
  role: ChatRole;
  content: string;
};

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const MAX_MESSAGES = 24;
const MAX_CONTENT_LENGTH = 4000;

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const msg = value as Record<string, unknown>;
  return (
    (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') &&
    typeof msg.content === 'string' &&
    msg.content.trim().length > 0 &&
    msg.content.length <= MAX_CONTENT_LENGTH
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing OPENAI_API_KEY' });
  }

  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : null;
  if (!incoming || incoming.length === 0 || !incoming.every(isChatMessage)) {
    return res.status(400).json({ error: 'Expected messages: { role, content }[]' });
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are Chatbot, a helpful assistant in an Expo mobile/web app. Be concise, friendly, and clear.',
    },
    ...incoming.slice(-MAX_MESSAGES).map((m: ChatMessage) => ({
      role: m.role,
      content: m.content.trim(),
    })),
  ];

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.7,
      }),
    });

    const data = (await openaiRes.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };

    if (!openaiRes.ok) {
      const message = data.error?.message ?? 'OpenAI request failed';
      return res.status(openaiRes.status).json({ error: message });
    }

    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(502).json({ error: 'Empty response from OpenAI' });
    }

    return res.status(200).json({ reply });
  } catch {
    return res.status(502).json({ error: 'Failed to reach OpenAI' });
  }
}
