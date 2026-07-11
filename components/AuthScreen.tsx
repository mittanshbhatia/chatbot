import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type Props = {
  onAuthenticated: (session: Session) => void;
};

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const trackUser = useCallback(async (accessToken: string) => {
    await fetch('/api/auth/track-user', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) onAuthenticated(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) onAuthenticated(session);
    });
    return () => sub.subscription.unsubscribe();
  }, [onAuthenticated]);

  const submit = useCallback(async () => {
    setError(null);
    setInfo(null);
    if (!isSupabaseConfigured()) {
      setError('Supabase is not configured on this deployment.');
      return;
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || password.length < 6) {
      setError('Use a valid email and a password of at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: { full_name: name.trim() || trimmedEmail.split('@')[0] },
          },
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          await trackUser(data.session.access_token);
          onAuthenticated(data.session);
          return;
        }
        setInfo('Check your email to confirm your account, then sign in.');
        setMode('signin');
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (signInError) throw signInError;
        if (!data.session) throw new Error('No session returned');
        await trackUser(data.session.access_token);
        onAuthenticated(data.session);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }, [email, password, name, mode, onAuthenticated, trackUser]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
      <Text style={styles.subtitle}>
        Accounts are stored in Supabase. Text chat lives in SQL; media goes to Storage.
      </Text>

      {mode === 'signup' ? (
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Display name"
          placeholderTextColor="#7a8a94"
          autoCapitalize="words"
        />
      ) : null}

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor="#7a8a94"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor="#7a8a94"
        secureTextEntry
        autoComplete={mode === 'signin' ? 'password' : 'new-password'}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {info ? <Text style={styles.info}>{info}</Text> : null}

      <Pressable
        onPress={() => {
          void submit();
        }}
        disabled={busy}
        style={({ pressed }) => [styles.button, busy && styles.disabled, pressed && styles.pressed]}
      >
        {busy ? (
          <ActivityIndicator color="#f4fbfc" />
        ) : (
          <Text style={styles.buttonLabel}>{mode === 'signin' ? 'Sign in' : 'Sign up'}</Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => {
          setError(null);
          setInfo(null);
          setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
        }}
        style={styles.switch}
      >
        <Text style={styles.switchLabel}>
          {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: 12,
    padding: 22,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c9d8dd',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0b2a33',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#4d6670',
    marginBottom: 4,
  },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#b7c9cf',
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#132830',
    backgroundColor: '#f7fbfc',
  },
  button: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#0f5c6b',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonLabel: {
    color: '#f4fbfc',
    fontWeight: '700',
    fontSize: 15,
  },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.88 },
  switch: { paddingVertical: 8, alignItems: 'center' },
  switchLabel: { color: '#0f5c6b', fontSize: 14, fontWeight: '600' },
  error: { color: '#9b1c1c', fontSize: 13 },
  info: { color: '#0f5c6b', fontSize: 13 },
});
