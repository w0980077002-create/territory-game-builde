import { useState } from 'react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { useLanguage } from '@/game/i18n';
import { getFollowerArt } from '@/game/combatArt';
import {
  FOLLOWER_TEMPLATES, followerTrainingCost, MAX_FOLLOWER_LEVEL,
  selectedFollower, selectFollower, trainFollower,
} from '@/game/followers';

/** Inventory companions tab: existing training/selection, one active in PvE, never Arena. */
export function FollowersPanel() {
  const { language } = useLanguage();
  const en = language === 'en';
  const state = useStore(useGame);
  const active = selectedFollower(state);
  const [note, setNote] = useState('');

  const choose = (id: string) => {
    const result = selectFollower(useGame.get(), id);
    if (result) { useGame.set(result); setNote(en ? 'Companion selected' : 'Спутник выбран'); }
  };

  const train = (id: string) => {
    let succeeded = false;
    useGame.set((current) => {
      const next = trainFollower(current, id);
      succeeded = next !== null;
      return next ?? current;
    });
    setNote(succeeded ? (en ? 'Training completed' : 'Тренировка завершена') : (en ? 'Not enough materials, gold or hero level' : 'Не хватает золота, материалов или уровня героя'));
  };

  return (
    <div className="card space-y-3" data-testid="followers-panel">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold text-amber-200 text-sm">{en ? 'Companion camp' : 'Лагерь спутников'}</h3>
        <span className="text-[10px] px-2 py-1 rounded-full border border-teal-500/40 text-teal-200 bg-teal-900/20">
          {en ? '1 active / PvE only' : '1 активный / только PvE'}
        </span>
      </div>
      {active ? (
        <div className="flex items-center gap-3 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-600/15 to-violet-700/15 p-3">
          <img src={getFollowerArt(active.id)} alt="" className="w-20 h-24 shrink-0 object-contain object-bottom" loading="lazy" />
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold text-emerald-300 uppercase">{en ? 'Your active companion' : 'Твой активный последователь'}</span>
            <p className="text-base font-bold text-amber-100">{en
              ? (FOLLOWER_TEMPLATES.find((f) => f.id === active.id)?.nameEn ?? active.name)
              : active.name}</p>
            <p className="text-xs text-sky-200 mt-1">{en ? 'Level' : 'Уровень'} {active.level}</p>
            <p className="text-xs text-gray-300 mt-1">⚔️ {active.attack} · 🛡️ {active.defense}</p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-gray-300">
          {en ? 'Your first companion unlocks at hero level 3.' : 'Первый последователь откроется на 3 уровне героя.'}
        </div>
      )}
      <p className="text-xs text-slate-300">{en
        ? 'Unlock allies as your hero levels up. Train with gold and forge materials. Only one companion can assist in battles.'
        : 'Открывай спутников с ростом уровня героя. Обучай за золото и материалы кузницы. В бою помогает только один.'}</p>
      <div className="space-y-2">
        {FOLLOWER_TEMPLATES.map((template) => {
          const follower = state.followers.find((f) => f.id === template.id);
          if (!follower) return null;
          const unlocked = follower.unlocked;
          const selected = active?.id === follower.id;
          const maxed = follower.level >= state.player.level || follower.level >= MAX_FOLLOWER_LEVEL;
          const price = followerTrainingCost(follower.level);
          const canTrain = unlocked && !maxed && state.player.gold >= price.gold && state.forgeMaterials >= price.materials;
          return (
            <div key={follower.id} className={`rounded-xl border p-3 ${selected ? 'border-amber-400/60 bg-amber-500/10' : 'border-white/10 bg-black/20'}`}>
              <div className="flex items-start gap-2">
                <img src={getFollowerArt(template.id)} alt="" loading="lazy" className="h-20 w-16 shrink-0 object-contain object-bottom" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-white">{en ? template.nameEn : template.name}</p>
                    {selected && <span className="text-[10px] rounded-md bg-amber-400/20 px-1.5 py-0.5 text-amber-200">{en ? 'ACTIVE' : 'В БОЮ'}</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{en ? template.descriptionEn : template.description}</p>
                  <p className="text-[11px] text-sky-200 mt-1">{unlocked
                    ? `${en ? 'Level' : 'Уровень'} ${follower.level} · ⚔️ ${follower.attack} · 🛡️ ${follower.defense}`
                    : `${en ? 'Unlocks at hero level' : 'Откроется на уровне героя'} ${template.unlockLevel}`}</p>
                </div>
              </div>
              {unlocked && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button type="button" onClick={() => choose(follower.id)} disabled={selected}
                    className="h-9 rounded-lg bg-teal-700/30 border border-teal-400/30 text-xs font-bold text-teal-100 disabled:opacity-40">
                    {selected ? (en ? 'Selected' : 'Выбран') : (en ? 'Choose' : 'Выбрать')}
                  </button>
                  <button type="button" onClick={() => train(follower.id)} disabled={!canTrain}
                    className="h-9 rounded-lg bg-amber-700/20 border border-amber-400/30 text-[11px] font-bold text-amber-100 disabled:opacity-40">
                    {maxed ? (en ? 'Level cap' : 'Лимит уровня') : `${en ? 'Train' : 'Обучить'} · 🪙${price.gold} 🔩${price.materials}`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {note && <p role="status" className="text-xs text-amber-200">{note}</p>}
      <p className="text-[10px] text-slate-500">{en
        ? 'Follower bonuses work in PvE only. Arena remains balanced separately.'
        : 'Бонусы спутников действуют только в Походе и Испытаниях, не на Арене.'}</p>
    </div>
  );
}
