import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';
import * as DocumentPicker from 'expo-document-picker';
import { AuthScreen } from './components/AuthScreen';
import { mediaKindFromMime } from './lib/media';
import { supabase } from './lib/supabase';

type Role = 'user' | 'bot';

type Message = {
  id: string;
  role: Role;
  text: string;
};

type Attachment = {
  fileName: string;
  mimeType: string;
  base64: string;
};

const WELCOME: Message = {
  id: 'welcome',
  role: 'bot',
  text: "Hi — I'm Chatbot. Sign in is required so your account is saved in Supabase.",
};

const CHAT_API_URL = process.env.EXPO_PUBLIC_CHAT_API_URL ?? '/api/chat';

async function fileToBase64(uri: string): Promise<string> {
  const res = await fetch(uri);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

async function askOpenAI(
  history: Message[],
  userText: string,
  accessToken: string,
  conversationId: string | null,
  attachment?: Attachment | null,
): Promise<{ reply: string; conversationId: string }> {
  const messages = [
    ...history
      .filter((m) => m.id !== 'welcome')
      .map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.text,
      })),
    { role: 'user' as const, content: userText },
  ];

  const res = await fetch(CHAT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messages,
      conversationId,
      attachment: attachment ?? undefined,
    }),
  });

  const data = (await res.json()) as {
    reply?: string;
    conversationId?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  if (!data.reply || !data.conversationId) {
    throw new Error('Empty reply from server');
  }
  return { reply: data.reply, conversationId: data.conversationId };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  const onAuthenticated = useCallback((next: Session) => {
    setSession(next);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setMessages([WELCOME]);
    setConversationId(null);
    setAttachment(null);
  }, []);

  const pickAttachment = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? 'application/octet-stream';
    const base64 = await fileToBase64(asset.uri);
    setAttachment({
      fileName: asset.name,
      mimeType,
      base64,
    });
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !attachment) || sending || !session?.access_token) return;

    const displayText = attachment
      ? `${text || '(attachment)'} [${mediaKindFromMime(attachment.mimeType)}: ${attachment.fileName}]`
      : text;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: displayText,
    };

    const historySnapshot = messages;
    const attachmentSnapshot = attachment;
    setDraft('');
    setAttachment(null);
    setSending(true);
    setMessages((prev) => [...prev, userMsg]);

    try {
      const { reply, conversationId: nextConversationId } = await askOpenAI(
        historySnapshot,
        text || `Please review the attached ${mediaKindFromMime(attachmentSnapshot!.mimeType)}.`,
        session.access_token,
        conversationId,
        attachmentSnapshot,
      );
      setConversationId(nextConversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          role: 'bot',
          text: reply,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong talking to OpenAI.';
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'bot',
          text: `Sorry — ${message}`,
        },
      ]);
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [draft, sending, messages, session, conversationId, attachment]);

  if (!session) {
    return (
      <View style={styles.root}>
        <StatusBar style="dark" />
        <SafeAreaView style={[styles.safe, styles.authSafe]}>
          <Text style={styles.brand}>Chatbot</Text>
          <Text style={styles.tagline}>Supabase auth · SQL text · Storage media</Text>
          <AuthScreen onAuthenticated={onAuthenticated} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.brand}>Chatbot</Text>
            <Text style={styles.tagline}>{session.user.email}</Text>
          </View>
          <Pressable onPress={() => void signOut()} style={styles.signOut}>
            <Text style={styles.signOutLabel}>Sign out</Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.bubble,
                  item.role === 'user' ? styles.bubbleUser : styles.bubbleBot,
                ]}
              >
                <Text
                  style={[
                    styles.bubbleText,
                    item.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextBot,
                  ]}
                >
                  {item.text}
                </Text>
              </View>
            )}
          />

          {attachment ? (
            <Text style={styles.attachHint}>
              Attached {mediaKindFromMime(attachment.mimeType)}: {attachment.fileName}
            </Text>
          ) : null}

          <View style={styles.composer}>
            <Pressable
              onPress={() => void pickAttachment()}
              style={styles.attach}
              accessibilityRole="button"
              accessibilityLabel="Attach file"
            >
              <Text style={styles.attachLabel}>+</Text>
            </Pressable>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={sending ? 'Thinking…' : 'Message Chatbot…'}
              placeholderTextColor="#7a8a94"
              multiline
              maxLength={2000}
              onSubmitEditing={() => {
                void send();
              }}
              blurOnSubmit={false}
              returnKeyType="send"
              editable={!sending}
            />
            <Pressable
              onPress={() => {
                void send();
              }}
              disabled={(!draft.trim() && !attachment) || sending}
              style={({ pressed }) => [
                styles.send,
                ((!draft.trim() && !attachment) || sending) && styles.sendDisabled,
                pressed && styles.sendPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              <Text style={styles.sendLabel}>{sending ? '…' : 'Send'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#e8f2f4',
  },
  safe: {
    flex: 1,
  },
  authSafe: {
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 14,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 20 : 8,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#c5d6db',
    backgroundColor: 'rgba(232, 242, 244, 0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  brand: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: '#0b2a33',
    fontFamily: Platform.select({
      ios: 'Avenir Next',
      android: 'sans-serif-medium',
      web: 'Georgia, "Times New Roman", serif',
      default: undefined,
    }),
  },
  tagline: {
    marginTop: 2,
    fontSize: 13,
    color: '#4d6670',
    letterSpacing: 0.2,
  },
  signOut: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#d9e8ec',
  },
  signOutLabel: {
    color: '#0f5c6b',
    fontWeight: '700',
    fontSize: 13,
  },
  body: {
    flex: 1,
  },
  list: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 10,
    flexGrow: 1,
  },
  bubble: {
    maxWidth: '86%',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 18,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#0f5c6b',
    borderBottomRightRadius: 6,
  },
  bubbleBot: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c9d8dd',
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
  },
  bubbleTextUser: {
    color: '#f4fbfc',
  },
  bubbleTextBot: {
    color: '#132830',
  },
  attachHint: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    color: '#4d6670',
    fontSize: 12,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#c5d6db',
    backgroundColor: '#f4fafb',
  },
  attach: {
    height: 44,
    width: 44,
    borderRadius: 14,
    backgroundColor: '#d9e8ec',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachLabel: {
    fontSize: 24,
    color: '#0f5c6b',
    fontWeight: '600',
    marginTop: -2,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 12 : 10,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#b7c9cf',
    fontSize: 16,
    color: '#132830',
    outlineStyle: 'none' as unknown as undefined,
  },
  send: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: '#0f5c6b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendPressed: {
    opacity: 0.88,
  },
  sendDisabled: {
    opacity: 0.45,
  },
  sendLabel: {
    color: '#f4fbfc',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
