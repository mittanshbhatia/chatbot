import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

let admin: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return admin;
}

export async function userFromBearer(authHeader: string | undefined): Promise<User> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing Authorization bearer token'), { status: 401 });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw Object.assign(new Error('Invalid or expired session'), { status: 401 });
  }
  return data.user;
}

export type AppUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  provider: string | null;
  login_count: number | null;
};

function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /Could not find the table|relation .* does not exist/i.test(error.message ?? '')
  );
}

/** Upsert into this project's `profiles` table (linked to auth.users). */
export async function trackLoginUser(input: {
  id: string;
  email: string;
  name?: string | null;
  provider: string;
}): Promise<AppUserRow> {
  const supabase = getServiceSupabase();
  const email = input.email.toLowerCase().trim();
  const fallback: AppUserRow = {
    id: input.id,
    email,
    display_name: input.name ?? email.split('@')[0],
    provider: input.provider,
    login_count: 1,
  };

  const { data: existing, error: findError } = await supabase
    .from('profiles')
    .select('id, email, display_name, provider, login_count')
    .eq('id', input.id)
    .maybeSingle();

  if (findError) {
    if (isMissingRelation(findError)) return fallback;
    throw findError;
  }

  if (existing) {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        email,
        display_name: input.name ?? existing.display_name,
        provider: input.provider,
        last_login: new Date().toISOString(),
        login_count: (existing.login_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, email, display_name, provider, login_count')
      .single();
    if (error) {
      if (isMissingRelation(error)) return fallback;
      throw error;
    }
    return data as AppUserRow;
  }

  const { data, error } = await supabase
    .from('profiles')
    .insert({
      id: input.id,
      email,
      display_name: input.name ?? email.split('@')[0],
      provider: input.provider,
      last_login: new Date().toISOString(),
      login_count: 1,
    })
    .select('id, email, display_name, provider, login_count')
    .single();

  if (error) {
    if (isMissingRelation(error)) return fallback;
    throw error;
  }
  return data as AppUserRow;
}

export async function resolveAppUser(authUser: User): Promise<AppUserRow> {
  if (!authUser.email) {
    throw Object.assign(new Error('Authenticated user has no email'), { status: 400 });
  }
  return trackLoginUser({
    id: authUser.id,
    email: authUser.email,
    name: (authUser.user_metadata?.full_name as string | undefined) ?? authUser.email.split('@')[0],
    provider: (authUser.app_metadata?.provider as string | undefined) ?? 'email',
  });
}
