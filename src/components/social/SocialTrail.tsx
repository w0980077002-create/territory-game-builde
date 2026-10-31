import { useLanguage } from '@/game/i18n';

/** Navigation only: all three destinations are existing real game screens. */
export type SocialDestination = 'friends' | 'clan' | 'quests';

const routes: { id: SocialDestination; icon: string; ru: string; en: string }[] = [
  { id: 'friends', icon: 'ic-invite.webp', ru: 'Друзья', en: 'Friends' },
  { id: 'clan', icon: 'nav-clan.webp', ru: 'Клан', en: 'Clan' },
  { id: 'quests', icon: 'ic-quests.webp', ru: 'Задания', en: 'Quests' },
];

export function SocialTrail({ active, onNavigate, detail }: {
  active: SocialDestination;
  onNavigate: (destination: SocialDestination) => void;
  detail?: string;
}) {
  const { language } = useLanguage();
  const en = language === 'en';
  return (
    <nav aria-label={en ? 'Social journey' : 'Путь союзников'} data-testid="social-journey"
      className="rounded-2xl border-2 border-[#c39554] bg-gradient-to-b from-[#704628] via-[#432818] to-[#26170f] p-2.5 shadow-[inset_0_1px_0_#ffe2a466,0_4px_12px_#10080377]">
      <div className="mb-2 flex min-w-0 items-center gap-2 px-1">
        <img src={import.meta.env.BASE_URL + 'nav-clan.webp'} alt="" className="h-8 w-8 shrink-0 object-contain" />
        <div className="min-w-0">
          <p className="text-sm font-black text-amber-100">{en ? 'Allies of the hero' : 'Союзники героя'}</p>
          <p className="text-[11px] leading-snug text-amber-100/75">
            {detail || (en ? 'Invite, join forces, complete real quests' : 'Приглашай, объединяйся, выполняй задания')}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {routes.map(route => (
          <button key={route.id} type="button"
            aria-current={route.id === active ? 'page' : undefined}
            disabled={route.id === active}
            onClick={() => onNavigate(route.id)}
            className={`flex min-h-12 min-w-0 items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-[11px] font-black leading-tight transition-colors disabled:cursor-default ${route.id === active
              ? 'border-yellow-200 bg-gradient-to-b from-yellow-300 to-amber-600 text-[#40230e]'
              : 'border-[#b78a4c] bg-[#2d2018] text-amber-100 active:bg-[#644126]'}`}>
            <img src={import.meta.env.BASE_URL + route.icon} alt="" className="h-6 w-6 shrink-0 object-contain" />
            <span className="min-w-0 break-words">{en ? route.en : route.ru}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
