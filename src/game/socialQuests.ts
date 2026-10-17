import { supabase } from './supabase';
import { getTelegramWebApp } from './telegram';
import { useGame } from './actions';
import { saveCloudSave, saveTokens, walletVersions, saveBlocked } from './cloud';
import { validSaveToken } from './saveToken';
import { validEconomySnapshot } from './economyInvariant';
import { safeWalletVersion, walletMatchesVersion } from './walletVersion';

export type SocialTask = 'chat' | 'news';
export type SocialStatus = Record<SocialTask, boolean>;
export const SOCIAL_LINKS: Record<SocialTask, string> = {
  chat: 'https://t.me/Territory_Chat',
  news: 'https://t.me/TerritoryNews',
};

export function openSocialLink(task: SocialTask) {
  const url = SOCIAL_LINKS[task];
  const tg = getTelegramWebApp();
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

async function call(body: Record<string, unknown>): Promise<Record<string, any>> {
  const { data, error } = await supabase.functions.invoke('social-quests', { body });
  if (error) {
    let code = 'service_unavailable';
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (ctx?.json) {
      try {
        const detail = await ctx.json();
        if (detail && typeof detail === 'object' && typeof (detail as { error?: unknown }).error === 'string')
          code = (detail as { error: string }).error;
      } catch { /* keep generic error */ }
    }
    throw new Error(code);
  }
  if (!data || typeof data !== 'object' || typeof data.error === 'string')
    throw new Error(typeof data?.error === 'string' ? data.error : 'service_unavailable');
  return data as Record<string, any>;
}

export async function socialStatus(): Promise<SocialStatus> {
  const data = await call({ action: 'status' });
  if (typeof data.claimed?.chat !== 'boolean' || typeof data.claimed?.news !== 'boolean')
    throw new Error('status_invalid');
  return { chat: data.claimed.chat, news: data.claimed.news };
}

/** Never use claimQuest here: membership and receipt are verified by the server. */
export async function claimSocial(userId: string, task: SocialTask): Promise<void> {
  const snapshot = useGame.get();
  if (!await saveCloudSave(userId, snapshot) || useGame.get() !== snapshot)
    throw new Error('reload_required');
  const expected = saveTokens.get(userId);
  if (!validSaveToken(expected) || saveBlocked.has(userId)) throw new Error('reload_required');
  const response = await call({ action: 'claim', task, expected });
  const receipt = response.receipt;
  if (!receipt || receipt.success !== true || receipt.task !== task
    || receipt.gold !== 150 || receipt.stones !== 3 || !validSaveToken(receipt.updated_at)
    || !validEconomySnapshot(receipt.game_state)) throw new Error('invalid_receipt');
  const wallet = safeWalletVersion(
    { gold: receipt.wallet_gold, gems: receipt.wallet_gems }, receipt.game_state.player);
  if (!walletMatchesVersion(wallet, receipt.game_state.player)) throw new Error('wallet_mismatch');
  saveTokens.set(userId, receipt.updated_at);
  walletVersions.set(userId, wallet);
  saveBlocked.delete(userId);
  if (useGame.get() !== snapshot) {
    window.location.reload();
    throw new Error('reload_required');
  }
  useGame.set(receipt.game_state);
}
