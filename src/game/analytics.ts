const ANALYTICS_URL = 'https://eu.i.posthog.com/i/v0/e/';
const SESSION_KEY = 'territory_analytics_session_v1';
const PROJECT_TOKEN = 'phc_C53PmJMEtNSmHTj5aJi6VYXtZzZHTi2obKFkAt5Zkq8t';

// Counts browser sessions, not registered players; Supabase stays the source of truth.
// No Telegram identity, player ID, game state, URL or account details are transmitted.
export function captureGameOpen(): void {
  if (!import.meta.env.PROD || !globalThis.crypto?.randomUUID) return;

  let sessionId: string;
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    sessionId = saved && /^[0-9a-f-]{36}$/i.test(saved) ? saved : crypto.randomUUID();
    if (sessionId !== saved) sessionStorage.setItem(SESSION_KEY, sessionId);
  } catch {
    sessionId = crypto.randomUUID();
  }

  const event = {
    api_key: PROJECT_TOKEN,
    event: 'territory_app_open',
    distinct_id: `territory_session_${sessionId}`,
    properties: {
      $process_person_profile: false,
      source: 'territory_web_client',
    },
  };

  // Best-effort telemetry must never delay login, saving or the game UI.
  void fetch(ANALYTICS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    mode: 'cors',
    credentials: 'omit',
    keepalive: true,
    body: JSON.stringify(event),
  }).catch(() => undefined);
}
