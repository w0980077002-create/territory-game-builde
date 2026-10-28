import {supabase} from '../supabase';
import {createProgressionClient} from './index';

/** Bind durable operations to the authenticated account, including after restart. */
export async function authenticatedProgressionClient() {
  const {data: {user}, error} = await supabase.auth.getUser();
  if (error || !user?.id) throw new Error('progression_login_required');
  if (typeof localStorage === 'undefined') throw new Error('progression_storage_unavailable');
  const userId = user.id;
  return createProgressionClient(async (name, args) => {
    const {data: {user: current}, error: authError} = await supabase.auth.getUser();
    if (authError || current?.id !== userId) throw new Error('progression_account_changed');
    return supabase.rpc(name, args);
  }, localStorage, userId);
}
