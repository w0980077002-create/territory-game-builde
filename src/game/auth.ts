import { useState, useEffect, useCallback } from 'react';
import { isSupabaseConfigured, supabase } from './supabase';
import { getTelegramInitData, initTelegramWebApp, getTelegramUser } from './telegram';

export interface AuthUser {
  id: string;
  telegramId: number | null;
  photoUrl: string | null;
  displayName: string;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'guest'; error?: string }
  | { status: 'authenticated'; user: AuthUser };

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
const LOCAL_AUTH_KEY = 'territory_local_auth_v1';

function readLocalAuth(): AuthUser | null {
  try {
    const raw = localStorage.getItem(LOCAL_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed?.id || !parsed.displayName) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalAuth(user: AuthUser | null) {
  try {
    if (user) localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify(user));
    else localStorage.removeItem(LOCAL_AUTH_KEY);
  } catch {
    // Ignore local storage failures; the game can still run in memory.
  }
}

async function profileFor(userId: string, fallbackName: string): Promise<AuthUser> {
  const { data } = await supabase
    .from('players')
    .select('telegram_id, photo_url, display_name')
    .eq('id', userId)
    .maybeSingle();
  return {
    id: userId,
    telegramId: data?.telegram_id ?? null,
    photoUrl: data?.photo_url ?? null,
    displayName: data?.display_name || fallbackName,
  };
}

async function telegramSignIn(initData: string): Promise<string | null> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/telegram-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ initData }),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  if (!data?.access_token || !data?.refresh_token) return null;
  const { error } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  return error ? null : (data.user?.id as string);
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  const restore = useCallback(async () => {
    const tgUser = getTelegramUser();
    const initData = getTelegramInitData();

    if (!isSupabaseConfigured) {
      const local = readLocalAuth();
      if (local) {
        if (tgUser && local.telegramId && local.telegramId !== tgUser.id) {
          writeLocalAuth(null);
        } else {
          setAuthState({ status: 'authenticated', user: local });
          return;
        }
      }
      setAuthState({ status: 'guest' });
      return;
    }

    const { data } = await supabase.auth.getSession();
    const session = data.session;

    if (tgUser && initData) {
      const tgName = tgUser.first_name || tgUser.username || 'Герой';
      if (session) {
        const profile = await profileFor(session.user.id, tgName);
        if (profile.telegramId === tgUser.id) {
          setAuthState({ status: 'authenticated', user: profile });
          return;
        }
      }
      const userId = await telegramSignIn(initData);
      if (userId) {
        setAuthState({ status: 'authenticated', user: await profileFor(userId, tgName) });
        return;
      }
    }

    if (session) {
      setAuthState({ status: 'authenticated', user: await profileFor(session.user.id, 'Герой') });
      return;
    }

    setAuthState({ status: 'guest' });
  }, []);

  const startAsGuest = useCallback(async (heroName: string) => {
    const name = heroName.trim().slice(0, 20) || 'Герой';

    if (!isSupabaseConfigured) {
      const tgUser = getTelegramUser();
      const user: AuthUser = {
        id: tgUser ? `telegram:${tgUser.id}` : `local:${crypto.randomUUID()}`,
        telegramId: tgUser?.id ?? null,
        photoUrl: tgUser?.photo_url ?? null,
        displayName: tgUser ? (tgUser.first_name || tgUser.username || name) : name,
      };
      writeLocalAuth(user);
      setAuthState({ status: 'authenticated', user });
      return;
    }

    setAuthState({ status: 'loading' });
    const email = `guest_${crypto.randomUUID()}@territory.game`;
    const password = `${crypto.randomUUID()}Aa1!`;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error || !data.user || !data.session) {
      setAuthState({ status: 'guest', error: 'Не удалось создать героя. Попробуй ещё раз.' });
      return;
    }
    setAuthState({
      status: 'authenticated',
      user: { id: data.user.id, telegramId: null, photoUrl: null, displayName: name },
    });
  }, []);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut();
    writeLocalAuth(null);
    setAuthState({ status: 'guest' });
  }, []);

  useEffect(() => {
    initTelegramWebApp();
    restore().catch(() => setAuthState({ status: 'guest', error: 'Нет связи с сервером' }));
  }, [restore]);

  return { authState, startAsGuest, signOut };
}
