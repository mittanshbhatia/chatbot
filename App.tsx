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

type Role = 'user' | 'bot';

type Message = {
  id: string;
  role: Role;
  text: string;
};

const WELCOME: Message = {
  id: 'welcome',
  role: 'bot',
  text: "Hi — I'm Chatbot, powered by OpenAI. Ask me anything.",
};

const CHAT_API_URL = process.env.EXPO_PUBLIC_CHAT_API_URL ?? '/api/chat';

async function askOpenAI(history: Message[], userText: string): Promise<string> {
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  const data = (await res.json()) as { reply?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  if (!data.reply) {
    throw new Error('Empty reply from server');
  }
  return data.reply;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
    };

    const historySnapshot = messages;
    setDraft('');
    setSending(true);
    setMessages((prev) => [...prev, userMsg]);

    try {
      const reply = await askOpenAI(historySnapshot, text);
      const botMsg: Message = {
        id: `b-${Date.now()}`,
        role: 'bot',
        text: reply,
      };
      setMessages((prev) => [...prev, botMsg]);
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
  }, [draft, sending, messages]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.brand}>Chatbot</Text>
          <Text style={styles.tagline}>OpenAI · Expo · Vercel</Text>
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

          <View style={styles.composer}>
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
              disabled={!draft.trim() || sending}
              style={({ pressed }) => [
                styles.send,
                (!draft.trim() || sending) && styles.sendDisabled,
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
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 20 : 8,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#c5d6db',
    backgroundColor: 'rgba(232, 242, 244, 0.92)',
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
