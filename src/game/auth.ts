import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const TELEGRAM_LOGIN_ERROR =
  'Не удалось проверить Telegram. Закрой игру и открой снова через бота. Прогресс сохранён.';

async function profileFor(userId: string, fallbackName: string): Promise<AuthUser> {
  const { data, error } = await supabase
    .from('players')
    .select('telegram_id, photo_url, display_name')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) throw new Error('Player profile unavailable');
  return {
    id: userId,
    telegramId: data.telegram_id ?? null,
    photoUrl: data.photo_url ?? null,
    displayName: data.display_name || fallbackName,
  };
}

/** The Edge Function MUST verify Telegram initData using the bot token server-side. */
async function telegramSignIn(initData: string): Promise<AuthUser | null> {
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/telegram-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ initData }),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  if (typeof payload?.access_token !== 'string' ||
      typeof payload?.refresh_token !== 'string') return null;

  const { data, error } = await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });
  if (error || !data.user) return null;

  // The Auth user ID comes from a verified Supabase session, not an untrusted response field.
  const profile = await profileFor(data.user.id, 'Герой');
  if (profile.telegramId === null) return null;
  return profile;
}

// Telegram iOS WebViews can lose their persisted Supabase session while the
// React game is still mounted. A PATCH made with the anon key then returns 401.
// Restore the verified session BEFORE saving, never by trusting Telegram's
// unsigned initDataUnsafe fields or by creating an anonymous character.
const sessionRecovery = new Map<string, Promise<boolean>>();

export function ensurePlayerSession(playerId: string): Promise<boolean> {
  const existing = sessionRecovery.get(playerId);
  if (existing) return existing;

  const task = (async (): Promise<boolean> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user.id === playerId) {
        if (session.expires_at && session.expires_at > Math.floor(Date.now() / 1000) + 30) {
          return true;
        }
        // A valid refresh token can recover without another Telegram login.
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session?.user.id === playerId) return true;
      }
      // No usable Supabase session: revalidate Telegram initData server-side.
      // The returned authenticated account must match the loaded hero.
      const initData = getTelegramInitData();
      if (!initData) return false;
      const verified = await telegramSignIn(initData);
      return verified?.id === playerId;
    } catch (error) {
      console.error('Unable to restore player save session:', error);
      return false;
    }
  })();

  sessionRecovery.set(playerId, task);
  void task.finally(() => {
    if (sessionRecovery.get(playerId) === task) sessionRecovery.delete(playerId);
  });
  return task;
}

export async function linkTelegram(initData: string): Promise<{ success: boolean; error?: string; code?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Нет активной сессии' };
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/link-telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ initData }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (payload?.error === 'telegram_already_linked') {
        return {
          success: false,
          error: 'Этот Telegram уже привязан к другому персонажу',
          code: 'telegram_already_linked',
        };
      }
      if (payload?.error === 'invalid_init_data') {
        return {
          success: false,
          error: 'Данные Telegram устарели. Закрой игру и открой заново через бота',
        };
      }
      return { success: false, error: 'Не удалось привязать Telegram. Прогресс не удалён.' };
    }
    return { success: payload?.success === true };
  } catch {
    return { success: false, error: 'Нет связи с сервером. Попробуй позже' };
  }
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  const restore = useCallback(async () => {
    const initData = getTelegramInitData();
    const telegramUser = getTelegramUser();
    const { data: { session } } = await supabase.auth.getSession();

    if (initData) {
      const fallbackName = telegramUser?.first_name || telegramUser?.username || 'Герой';
      if (session) {
        const profile = await profileFor(session.user.id, fallbackName);
        if (profile.telegramId === null) {
          // Migrate only the currently authenticated old guest account.
          // The Edge Function verifies initData AND the Supabase session.
          const result = await linkTelegram(initData);
          if (result.success) {
            const linked = await profileFor(session.user.id, fallbackName);
            if (linked.telegramId !== null) {
              setAuthState({ status: 'authenticated', user: linked });
              return;
            }
          }
          if (!result.success && result.code !== 'telegram_already_linked') {
            // A failed migration must not fall through to new-account creation.
            setAuthState({ status: 'guest', error: TELEGRAM_LOGIN_ERROR });
            return;
          }
          // Linking may have been blocked because this Telegram is already linked
          // to another character. Try its verified login rather than showing
          // the wrong cached character or silently making a duplicate guest.
        }
      }
      const telegramProfile = await telegramSignIn(initData);
      if (telegramProfile) {
        setAuthState({ status: 'authenticated', user: telegramProfile });
        return;
      }
      // Never fall back to an unrelated cached Supabase session if Telegram
      // authentication failed; this would display another player's character.
      setAuthState({ status: 'guest', error: TELEGRAM_LOGIN_ERROR });
      return;
    }

    if (session) {
      setAuthState({
        status: 'authenticated',
        user: await profileFor(session.user.id, 'Герой'),
      });
      return;
    }
    setAuthState({ status: 'guest' });
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setAuthState({ status: 'guest' });
  }, []);

  useEffect(() => {
    initTelegramWebApp();
    restore().catch(() => setAuthState({ status: 'guest', error: TELEGRAM_LOGIN_ERROR }));
  }, [restore]);

  return { authState, signOut };
}
