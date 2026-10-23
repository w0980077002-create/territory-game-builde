// Privacy-preserving, best-effort product events. Never attach Telegram IDs,
// account identifiers, messages, currencies, URLs, or gameplay state.
const ANALYTICS_URL = 'https://eu.i.posthog.com/i/v0/e/';
const SESSION_KEY = 'territory_analytics_session_v1';
const PROJECT_TOKEN = 'phc_C53PmJMEtNSmHTj5aJi6VYXtZzZHTi2obKFkAt5Zkq8t';
const EVENT_NAMES = new Set([
  'territory_app_open', 'territory_screen_open', 'territory_battle_open',
  'territory_hall_game_open', 'territory_hall_ticket_claim',
  'territory_hall_no_tickets', 'territory_hall_round_start',
  'territory_hall_round_end', 'territory_newcomer_fight_click',
  'territory_pve_fight_start', 'territory_pve_fight_end',
  'territory_referral_share_click', 'territory_referral_link_copy',
  'territory_referral_reward_claim', 'territory_profession_unlock',
  'territory_craft_completed', 'territory_shop_purchase', 'territory_salvage_completed',
  'territory_arena_fight_start', 'territory_quest_claim', 'territory_client_error',
  'territory_screen_dwell',
]);
const SCREENS = new Set([
  'city','inventory','hero','battle','map','games','clan','shop',
  'forge','arena','leaderboard','quests','hall-play',
  'professions','auction','friends',
]);
const MODES = new Set(['campaign','trial','duel','team','chaos','monopoly','treasury','dice','tower','targets','wheel']);

// One anonymous session per webview tab. Distinct IDs never contain player IDs.
function sessionId(): string | null {
  if (!import.meta.env.PROD || !globalThis.crypto?.randomUUID) return null;
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

type GameEvent = 'territory_screen_open' | 'territory_battle_open'
  | 'territory_hall_game_open' | 'territory_hall_ticket_claim'
  | 'territory_hall_no_tickets' | 'territory_hall_round_start'
  | 'territory_hall_round_end' | 'territory_newcomer_fight_click'
  | 'territory_pve_fight_start' | 'territory_pve_fight_end'
  | 'territory_referral_share_click' | 'territory_referral_link_copy'
  | 'territory_referral_reward_claim' | 'territory_profession_unlock'
  | 'territory_craft_completed' | 'territory_shop_purchase' | 'territory_salvage_completed'
  | 'territory_arena_fight_start' | 'territory_quest_claim' | 'territory_client_error'
  | 'territory_screen_dwell';
type GameEventProps = {
  screen?: string;
  mode?: string;
  outcome?: 'won' | 'lost' | 'error' | 'success';
  duration?: 'under_10s' | '10_60s' | 'over_60s';
};

// Only allow enumerated event names and enumerated public properties.
export function captureGameEvent(name: GameEvent, details: GameEventProps = {}): void {
  if (!EVENT_NAMES.has(name)) return;
  const properties: Record<string, string | boolean> = {
    $process_person_profile: false,
    source: 'territory_web_client',
  };
  if (details.screen && SCREENS.has(details.screen)) properties.screen = details.screen;
  if (details.mode && MODES.has(details.mode)) properties.mode = details.mode;
  if (details.outcome && ['won', 'lost', 'error', 'success'].includes(details.outcome)) {
    properties.outcome = details.outcome;
  }
  if (details.duration && ['under_10s', '10_60s', 'over_60s'].includes(details.duration)) {
    properties.duration = details.duration;
  }
  sendEvent(name, properties);
}

function sendEvent(event: string, properties: Record<string, string | boolean>): void {
  const id = sessionId();
  if (!id || !EVENT_NAMES.has(event)) return;
  // Events must never block UI, login, the save queue or critical requests.
  try {
    void fetch(ANALYTICS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      mode: 'cors',
      credentials: 'omit',
      keepalive: false,
      body: JSON.stringify({
        api_key: PROJECT_TOKEN,
        event,
        distinct_id: `territory_session_${id}`,
        properties,
      }),
    }).catch(() => undefined);
  } catch { /* Telemetry is optional, especially in Telegram WebView. */ }
}

export function captureGameOpen(): void {
  sendEvent('territory_app_open', { $process_person_profile: false, source: 'territory_web_client' });
}
