import type { VercelRequest, VercelResponse } from '@vercel/node';
import { resolveAppUser, userFromBearer } from '../_lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authUser = await userFromBearer(req.headers.authorization);
    const appUser = await resolveAppUser(authUser);
    return res.status(200).json({
      user: {
        id: appUser.id,
        email: appUser.email,
        name: appUser.display_name,
        provider: appUser.provider,
        login_count: appUser.login_count,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Failed to track user';
    return res.status(status).json({ error: message });
  }
}
