import { Component, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  language: 'ru' | 'en';
  onBack: () => void;
};

type State = { failed: boolean };

/**
 * Recover the navigation when a lazy-loaded screen fails, for example when
 * Telegram kept an old tab open during a new GitHub Pages deployment.
 * Never reload automatically: the current player may have an unsaved action.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    const en = this.props.language === 'en';
    return (
      <div role="alert" className="mx-auto mt-8 max-w-xs rounded-2xl border border-amber-500/40 bg-[#241b15] p-5 text-center text-amber-50">
        <h2 className="text-lg font-bold">{en ? 'Section unavailable' : 'Раздел пока не открылся'}</h2>
        <p className="mt-2 text-sm leading-relaxed text-amber-100/80">
          {en
            ? 'Check the connection. If the game was just updated, reopen it in Telegram after your progress has been saved.'
            : 'Проверь связь. Если игра только что обновилась, открой её заново в Telegram после сохранения прогресса.'}
        </p>
        <button type="button" className="mt-4 min-h-11 w-full rounded-xl border border-amber-300/50 bg-amber-500/20 px-4 font-semibold"
          onClick={this.props.onBack}>
          {en ? 'Back to city' : 'Вернуться в город'}
        </button>
      </div>
    );
  }
}
