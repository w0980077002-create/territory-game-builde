import type { ReactNode } from 'react';
import { Ban, Wrench } from 'lucide-react';
import { useLanguage } from '@/game/i18n';

function ServiceScreen({ icon, title, text, tone }: { icon: ReactNode; title: string; text: string; tone: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-6" style={{ background: 'var(--color-bg)' }}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.10),transparent_65%)] pointer-events-none" />
      <div className="relative max-w-sm w-full card text-center py-10 animate-fade-in">
        <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-5 ${tone}`}>{icon}</div>
        <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
        <p className="text-sm text-gray-400 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

export function MaintenanceScreen() {
  const { language } = useLanguage();
  return (
    <ServiceScreen
      icon={<Wrench className="w-8 h-8 text-white animate-pulse" />}
      tone="bg-gradient-to-br from-amber-400 to-amber-700"
      title={language === 'en' ? 'Maintenance in progress' : 'Идут технические работы'}
      text={language === 'en' ? 'We are improving the game. Please come back later — your progress is safe.' : 'Мы улучшаем игру. Пожалуйста, зайдите немного позже — ваш прогресс в безопасности.'}
    />
  );
}

export function BannedScreen() {
  const { language } = useLanguage();
  return (
    <ServiceScreen
      icon={<Ban className="w-8 h-8 text-white" />}
      tone="bg-gradient-to-br from-red-500 to-red-800"
      title={language === 'en' ? 'Account suspended' : 'Аккаунт заблокирован'}
      text={language === 'en' ? 'Your account has been suspended by the administrators for violating the game rules.' : 'Ваш аккаунт заблокирован администрацией за нарушение правил игры.'}
    />
  );
}
