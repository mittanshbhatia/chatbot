import type { SupabaseClient } from '@supabase/supabase-js';
import { MEDIA_BUCKET, type MediaKind } from '../media';

export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string | null;
  content_type: MediaKind | 'mixed';
  media_bucket?: string | null;
  media_path?: string | null;
  media_mime?: string | null;
  created_at?: string;
};

type ConversationRow = {
  id: string;
  user_id: string;
  title: string | null;
};

async function sqlAvailable(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from('conversations').select('id').limit(1);
  return !error;
}

async function readContextFile(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<{ title?: string; messages: StoredMessage[] }> {
  const path = `context/${userId}/${conversationId}.json`;
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) return { messages: [] };
  const text = await data.text();
  try {
    return JSON.parse(text) as { title?: string; messages: StoredMessage[] };
  } catch {
    return { messages: [] };
  }
}

async function writeContextFile(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  payload: { title?: string; messages: StoredMessage[] },
) {
  const path = `context/${userId}/${conversationId}.json`;
  const body = JSON.stringify(payload);
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, {
    contentType: 'application/json',
    upsert: true,
  });
  if (error) throw error;
}

export async function getOrCreateConversation(
  supabase: SupabaseClient,
  userId: string,
  conversationId?: string | null,
): Promise<{ id: string; via: 'sql' | 'storage' }> {
  const useSql = await sqlAvailable(supabase);

  if (useSql) {
    if (conversationId) {
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();
      if (data?.id) return { id: data.id, via: 'sql' };
    }

    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: userId, title: 'Chat' })
      .select('id')
      .single();
    if (error) throw error;
    return { id: (data as ConversationRow).id, via: 'sql' };
  }

  const id = conversationId || crypto.randomUUID();
  const existing = await readContextFile(supabase, userId, id);
  if (!existing.messages.length) {
    await writeContextFile(supabase, userId, id, { title: 'Chat', messages: [] });
  }
  return { id, via: 'storage' };
}

export async function loadMessages(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<StoredMessage[]> {
  if (await sqlAvailable(supabase)) {
    const { data, error } = await supabase
      .from('messages')
      .select('id, role, content, content_type, media_bucket, media_path, media_mime, created_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as StoredMessage[];
  }
  const file = await readContextFile(supabase, userId, conversationId);
  return file.messages;
}

export async function appendMessages(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  messages: Omit<StoredMessage, 'id'>[],
): Promise<void> {
  if (await sqlAvailable(supabase)) {
    const rows = messages.map((m) => ({
      conversation_id: conversationId,
      user_id: userId,
      role: m.role,
      content_type: m.content_type,
      content: m.content,
      media_bucket: m.media_bucket ?? null,
      media_path: m.media_path ?? null,
      media_mime: m.media_mime ?? null,
      metadata: {},
    }));
    const { error } = await supabase.from('messages').insert(rows);
    if (error) throw error;
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    return;
  }

  const current = await readContextFile(supabase, userId, conversationId);
  const next = [
    ...current.messages,
    ...messages.map((m) => ({
      ...m,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    })),
  ];
  await writeContextFile(supabase, userId, conversationId, {
    title: current.title ?? 'Chat',
    messages: next,
  });
}

export async function uploadMediaObject(
  supabase: SupabaseClient,
  userId: string,
  fileName: string,
  bytes: Buffer | ArrayBuffer | Blob | string,
  mime: string,
): Promise<{ bucket: string; path: string; mime: string }> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `media/${userId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (error) throw error;
  return { bucket: MEDIA_BUCKET, path, mime };
}
