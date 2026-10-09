import { useEffect, useState } from 'react';
import { Coins, Percent, Receipt } from 'lucide-react';
import { adminCall, type Settings } from '@/admin/api';
import { Empty, ErrorLine, Loading, Panel, Switch, fmtDate, type Confirm } from '@/admin/ui';

interface Donation {
  id: string;
  player_id: string;
  red_gems: number;
  amount_usd: number;
  created_at: string;
  players: { telegram_id: number | null; display_name: string } | null;
}

export function FinanceTab({ confirm }: { confirm: Confirm }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [donations, setDonations] = useState<Donation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminCall<{ settings: Settings }>('stats').then((r) => setSettings(r.settings)).catch((e: Error) => setError(e.message));
    adminCall<{ donations: Donation[] }>('donations').then((r) => setDonations(r.donations)).catch((e: Error) => setError(e.message));
  }, []);

  const toggle = (key: 'shop_sale' | 'gold_x2', label: string) => {
    if (!settings) return;
    const value = !settings[key];
    confirm(`${value ? 'Включить' : 'Выключить'}: ${label}`, async () => {
      const r = await adminCall<{ settings: Settings }>('set_setting', { key, value });
      setSettings(r.settings);
      return `${label}: ${value ? 'включено' : 'выключено'}`;
    });
  };

  return (
    <div className="space-y-4">
      <ErrorLine text={error} />
      <Panel title="Акции и рейты" icon={<Percent className="w-4 h-4" />}>
        {!settings ? <Loading /> : (
          <div className="space-y-2">
            <Switch label="Акция в Лавке −20%" hint="Все товары в Лавке дешевле на 20%. Игроки видят значок «−20%»." on={settings.shop_sale} tone="red" onToggle={() => toggle('shop_sale', 'Акция в Лавке')} />
            <Switch label="X2 Золото в боях" hint="Монеты за победы в походе удваиваются." on={settings.gold_x2} tone="amber" onToggle={() => toggle('gold_x2', 'X2 Золото в боях')} />
          </div>
        )}
      </Panel>

      <Panel title="Донаты" icon={<Receipt className="w-4 h-4" />}>
        {!donations ? <Loading /> : donations.length === 0 ? (
          <Empty text="Покупок красных алмазов за деньги пока нет. Они появятся здесь после подключения оплаты." />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-800">
                  <th className="py-2 px-1 font-medium">Дата</th>
                  <th className="py-2 px-1 font-medium">ID игрока</th>
                  <th className="py-2 px-1 font-medium text-right">Красные алмазы ($)</th>
                </tr>
              </thead>
              <tbody>
                {donations.map((d) => (
                  <tr key={d.id} className="border-b border-slate-800/60">
                    <td className="py-2 px-1 text-slate-300 whitespace-nowrap">{fmtDate(d.created_at)}</td>
                    <td className="py-2 px-1 text-slate-100">
                      <span className="block truncate max-w-[120px]">{d.players?.display_name ?? '—'}</span>
                      <span className="text-[10px] text-slate-500">TG {d.players?.telegram_id ?? '—'}</span>
                    </td>
                    <td className="py-2 px-1 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-rose-300 font-semibold"><img src="/red-gem.webp" alt="" className="w-4 h-4" />{d.red_gems}</span>
                      <span className="block text-emerald-300"><Coins className="inline w-3 h-3 mr-0.5" />${Number(d.amount_usd).toFixed(2)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
