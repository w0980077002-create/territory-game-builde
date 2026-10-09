import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BarChart3, CheckCircle2, Crown, Eye, EyeOff, Gamepad2, Lock, LogOut, Mail, ShieldAlert, Trophy, Wallet, XCircle } from 'lucide-react';
import { adminLogin, clearAdminToken, getAdminToken } from '@/admin/api';
import { ConfirmDialog, ErrorLine, inputCls, type Confirm } from '@/admin/ui';
import { DashboardTab } from '@/admin/tabs/DashboardTab';
import { PlayersTab } from '@/admin/tabs/PlayersTab';
import { MailTab } from '@/admin/tabs/MailTab';
import { FinanceTab } from '@/admin/tabs/FinanceTab';
import { TopTab } from '@/admin/tabs/TopTab';

const TABS = [
  { id: 'main', label: 'Главная & Управление', icon: BarChart3 },
  { id: 'players', label: 'Игроки & Anti-cheat', icon: ShieldAlert },
  { id: 'mail', label: 'Почта & Рассылки', icon: Mail },
  { id: 'finance', label: 'Финансы & Лавка', icon: Wallet },
  { id: 'top', label: 'Топ-100', icon: Trophy },
] as const;

type TabId = (typeof TABS)[number]['id'];

function LoginForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminLogin(username.trim(), password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.12),transparent_60%)] pointer-events-none" />
      <form onSubmit={submit} className="relative w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur p-6 shadow-2xl animate-[fadeIn_.3s_ease-out]">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center shadow-lg shadow-sky-900/50">
          <Crown className="w-7 h-7 text-white" />
        </div>
        <h1 className="mt-4 text-center text-xl font-bold text-white">Панель администратора</h1>
        <p className="mt-1 text-center text-xs text-slate-400">Территория · доступ только для владельца</p>
        <div className="mt-6 space-y-3">
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">Логин</span>
            <input className={inputCls} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">Пароль</span>
            <span className="relative block">
              <input className={`${inputCls} pr-11`} type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-0 top-0 h-11 w-11 flex items-center justify-center text-slate-400 hover:text-white" aria-label="Показать пароль">
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </span>
          </label>
          <ErrorLine text={error} />
          <button disabled={busy || !username || !password} className="w-full h-12 rounded-xl bg-gradient-to-b from-sky-500 to-sky-700 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2 transition">
            <Lock className="w-4 h-4" /> {busy ? 'Проверка...' : 'Войти'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface Pending { question: string; action: () => Promise<string> }
interface Toast { ok: boolean; text: string }

export function AdminApp() {
  const [authed, setAuthed] = useState(() => !!getAdminToken());
  const [tab, setTab] = useState<TabId>('main');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    document.title = 'Админ-панель · Территория';
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const confirm: Confirm = useCallback((question, action) => setPending({ question, action }), []);

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      setToast({ ok: true, text: await pending.action() });
    } catch (e) {
      setToast({ ok: false, text: (e as Error).message });
      if (!getAdminToken()) setAuthed(false);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  if (!authed) return <LoginForm onDone={() => setAuthed(true)} />;

  const logout = () => {
    clearAdminToken();
    setAuthed(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center"><Crown className="w-4 h-4 text-white" /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-bold leading-tight">Админ-панель</span>
            <span className="block text-[11px] text-slate-400 leading-tight">owner</span>
          </span>
          <a href="/" className="h-9 px-3 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white hover:border-slate-500 flex items-center gap-1.5 transition-colors">
            <Gamepad2 className="w-4 h-4" /> <span className="hidden sm:inline">В игру</span>
          </a>
          <button onClick={logout} className="h-9 px-3 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-red-300 hover:border-red-500/50 flex items-center gap-1.5 transition-colors">
            <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Выйти</span>
          </button>
        </div>
        <nav className="max-w-3xl mx-auto px-2 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative shrink-0 h-11 px-3 flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${active ? 'text-sky-300' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <t.icon className="w-4 h-4" /> {t.label}
                <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-sky-400 transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />
              </button>
            );
          })}
        </nav>
      </header>

      <main key={tab} className="max-w-3xl mx-auto px-4 py-4 pb-24 animate-[fadeIn_.25s_ease-out]">
        {tab === 'main' && <DashboardTab confirm={confirm} />}
        {tab === 'players' && <PlayersTab confirm={confirm} />}
        {tab === 'mail' && <MailTab confirm={confirm} />}
        {tab === 'finance' && <FinanceTab confirm={confirm} />}
        {tab === 'top' && <TopTab />}
      </main>

      {pending && <ConfirmDialog question={pending.question} busy={busy} onYes={run} onNo={() => setPending(null)} />}

      {toast && (
        <div className="fixed bottom-4 inset-x-4 z-50 flex justify-center pointer-events-none">
          <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${toast.ok ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200' : 'border-red-500/40 bg-red-950/90 text-red-200'}`}>
            {toast.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
