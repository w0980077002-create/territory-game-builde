import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { LanguageProvider } from '@/game/i18n';
import { captureGameOpen, captureGameEvent } from '@/game/analytics';

const AdminApp = lazy(() => import('@/admin/AdminApp').then((m) => ({ default: m.AdminApp })));
// Owner-only visual lab: no auth, saves, rewards or game-state writes.
// A hash route lets GitHub Pages serve this test without changing live navigation.
const IdleCombatPreview = lazy(() => import('@/components/idlePreview/IdleCombatPreview').then((m) => ({ default: m.IdleCombatPreview })));
const isIdlePreview = window.location.hash === '#idle-preview';
const isAdminRoute =
  window.location.pathname.replace(/\/+$/, '') === '/admin' ||
  window.location.hash === '#admin' ||
  new URLSearchParams(window.location.search).has('admin');

if (!isAdminRoute && !isIdlePreview) {
  captureGameOpen();
  // One generic, anonymous failure signal per session view. Never send
  // exception text, stack traces, URLs, session data or player identifiers.
  let errorCaptured = false;
  const noteError = () => {
    if (errorCaptured) return;
    errorCaptured = true;
    captureGameEvent('territory_client_error');
  };
  window.addEventListener('error', noteError);
  window.addEventListener('unhandledrejection', noteError);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdminRoute ? (
      <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
        <AdminApp />
      </Suspense>
    ) : isIdlePreview ? (
      <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
        <IdleCombatPreview />
      </Suspense>
    ) : (
      <LanguageProvider><App /></LanguageProvider>
    )}
  </StrictMode>
);
