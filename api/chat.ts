import type { VercelRequest, VercelResponse } from '@vercel/node';
import { mediaKindFromMime, storageStrategyFor } from '../../lib/media';
import {
  appendMessages,
  getOrCreateConversation,
  loadMessages,
  uploadMediaObject,
} from '../../lib/server/chatStore';
import { getServiceSupabase, resolveAppUser, userFromBearer } from '../../lib/server/supabase';

type ChatRole = 'user' | 'assistant' | 'system';

type IncomingMessage = {
  role: ChatRole;
  content: string;
};

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const MAX_MESSAGES = 24;
const MAX_CONTENT_LENGTH = 4000;

function isIncomingMessage(value: unknown): value is IncomingMessage {
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

  try {
    const authUser = await userFromBearer(req.headers.authorization);
    const appUser = await resolveAppUser(authUser);
    const supabase = getServiceSupabase();

    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!incoming || incoming.length === 0 || !incoming.every(isIncomingMessage)) {
      return res.status(400).json({ error: 'Expected messages: { role, content }[]' });
    }

    const conversation = await getOrCreateConversation(
      supabase,
      appUser.id,
      typeof req.body?.conversationId === 'string' ? req.body.conversationId : null,
    );

    const latestUser = [...incoming].reverse().find((m) => m.role === 'user');
    if (!latestUser) {
      return res.status(400).json({ error: 'Need a user message' });
    }

    let userContent = latestUser.content.trim();
    let contentType: 'text' | 'image' | 'audio' | 'video' | 'file' | 'mixed' = 'text';
    let mediaBucket: string | null = null;
    let mediaPath: string | null = null;
    let mediaMime: string | null = null;

    const attachment = req.body?.attachment as
      | { fileName?: string; mimeType?: string; base64?: string }
      | undefined;

    if (attachment?.base64 && attachment.mimeType && attachment.fileName) {
      const kind = mediaKindFromMime(attachment.mimeType);
      if (storageStrategyFor(kind) === 'storage') {
        const buffer = Buffer.from(attachment.base64, 'base64');
        const uploaded = await uploadMediaObject(
          supabase,
          appUser.id,
          attachment.fileName,
          buffer,
          attachment.mimeType,
        );
        mediaBucket = uploaded.bucket;
        mediaPath = uploaded.path;
        mediaMime = uploaded.mime;
        contentType = kind === 'text' ? 'mixed' : kind;
        userContent = `${userContent}\n\n[Attached ${kind}: ${uploaded.path}]`;
      }
    }

    const history = await loadMessages(supabase, appUser.id, conversation.id);
    const openaiMessages = [
      {
        role: 'system' as const,
        content:
          'You are Chatbot, a helpful assistant in an Expo mobile/web app backed by Supabase. Be concise, friendly, and clear.',
      },
      ...history.slice(-MAX_MESSAGES).map((m) => ({
        role: m.role as ChatRole,
        content: (m.content ?? '').trim() || `[${m.content_type} attachment]`,
      })),
      { role: 'user' as const, content: userContent },
    ];

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server is missing OPENAI_API_KEY' });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: openaiMessages,
        temperature: 0.7,
      }),
    });

    const data = (await openaiRes.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };

    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json({
        error: data.error?.message ?? 'OpenAI request failed',
      });
    }

    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(502).json({ error: 'Empty response from OpenAI' });
    }

    await appendMessages(supabase, appUser.id, conversation.id, [
      {
        role: 'user',
        content: latestUser.content.trim(),
        content_type: contentType,
        media_bucket: mediaBucket,
        media_path: mediaPath,
        media_mime: mediaMime,
      },
      {
        role: 'assistant',
        content: reply,
        content_type: 'text',
      },
    ]);

    return res.status(200).json({
      reply,
      conversationId: conversation.id,
      storage: conversation.via,
      userId: appUser.id,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Chat failed';
    return res.status(status).json({ error: message });
  }
}
