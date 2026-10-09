const URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api`;
const TOKEN_KEY = 'territory_admin_token';

const ERRORS: Record<string, string> = {
  invalid_credentials: 'Неверный логин или пароль',
  too_many_attempts: 'Слишком много попыток. Подождите 15 минут',
  unauthorized: 'Сессия истекла, войдите снова',
  not_found: 'Игрок не найден',
  recipient_not_found: 'Получатель не найден',
  empty_payload: 'Не указаны изменения',
  empty_mail: 'Заполните тему и текст письма',
  invalid_number: 'Некорректное число',
};

export class AdminError extends Error {
  constructor(public code: string) {
    super(ERRORS[code] ?? 'Ошибка сервера, попробуйте ещё раз');
  }
}

export function getAdminToken(): string | null {
  const t = localStorage.getItem(TOKEN_KEY);
  if (!t) return null;
  if (Number(t.split('.')[0]) < Date.now()) {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
  return t;
}

export function clearAdminToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AdminError('network');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data !== 'object' || 'error' in data) {
    const code = (data as { error?: string } | null)?.error ?? 'server_error';
    if (code === 'unauthorized') clearAdminToken();
    throw new AdminError(code);
  }
  return data as T;
}

export async function adminLogin(username: string, password: string) {
  const { token } = await call<{ token: string }>({ action: 'login', username, password });
  localStorage.setItem(TOKEN_KEY, token);
}

export function adminCall<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const token = getAdminToken();
  if (!token) return Promise.reject(new AdminError('unauthorized'));
  return call<T>({ ...params, action, token });
}

export async function isVerifiedAdmin(): Promise<boolean> {
  if (!getAdminToken()) return false;
  try {
    await adminCall('verify');
    return true;
  } catch {
    return false;
  }
}

export type Settings = { maintenance: boolean; arena_bots_enabled: boolean; shop_sale: boolean; gold_x2: boolean };

export interface PlayerSummary {
  id: string;
  telegramId: number | null;
  username: string | null;
  name: string;
  level: number;
  banned: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  resources: Record<'gold' | 'gems' | 'redGems' | 'stones' | 'forgeMaterials', number>;
  items: Record<string, number>;
  equipped: Record<string, { name: string; level: number }>;
  reasons?: string[];
}

export interface GrantPayload {
  gold?: number;
  gems?: number;
  redGems?: number;
  stones?: number;
  forgeMaterials?: number;
  items?: Record<string, number>;
  equipLevels?: Record<string, number>;
}

export const RESOURCES: { key: string; label: string; item?: boolean; icon: string }[] = [
  { key: 'gold', label: 'Монеты', icon: '/gold-coin.webp' },
  { key: 'gems', label: 'Синие алмазы', icon: '/blue-gem.webp' },
  { key: 'redGems', label: 'Красные алмазы', icon: '/red-gem.webp' },
  { key: 'stones', label: 'Боевые камни', icon: '/battle-stone.webp' },
  { key: 'shop_stone_5', label: 'Связки камней (x5)', item: true, icon: '/battle-stone.webp' },
  { key: 'forgeMaterials', label: 'Материалы кузницы', icon: '/forge-material.webp' },
  { key: 'shop_potion_hp', label: 'Зелье здоровья', item: true, icon: '/potion-hp.webp' },
  { key: 'shop_potion_hp_large', label: 'Большое зелье здоровья', item: true, icon: '/potion-hp-large.webp' },
  { key: 'shop_elixir_atk', label: 'Эликсир силы', item: true, icon: '/elixir-attack.webp' },
  { key: 'shop_elixir_def', label: 'Эликсир защиты', item: true, icon: '/elixir-defense.webp' },
  { key: 'shop_elixir_crit', label: 'Эликсир крита', item: true, icon: '/elixir-crit.webp' },
  { key: 'shop_arena_time', label: 'Зелье времени', item: true, icon: '/potion-time.webp' },
  { key: 'shop_arena_adrenaline', label: 'Адреналин', item: true, icon: '/potion-adrenaline.webp' },
];

export function payloadFor(key: string, qty: number): GrantPayload {
  const r = RESOURCES.find((x) => x.key === key);
  if (!r) return {};
  return r.item ? { items: { [key]: qty } } : { [key]: qty };
}
