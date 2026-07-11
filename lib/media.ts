export type MediaKind = 'text' | 'image' | 'audio' | 'video' | 'file';

export function mediaKindFromMime(mime: string | undefined | null): MediaKind {
  if (!mime) return 'file';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('text/')) return 'text';
  return 'file';
}

/** Text + JSON metadata → SQL. Binary payloads → Storage (S3-compatible). */
export function storageStrategyFor(kind: MediaKind): 'sql' | 'storage' {
  return kind === 'text' ? 'sql' : 'storage';
}

export const MEDIA_BUCKET = 'chatbot-media';
