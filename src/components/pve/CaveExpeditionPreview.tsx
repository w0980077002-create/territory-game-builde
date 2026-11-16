import { Sword, Shield, HeartPulse, Wind, Pause, Play, ChevronLeft, ChevronDown, ChevronUp, RefreshCw, Volume2, VolumeX, CircleHelp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BIOMES, caveBoss, type Biome } from '../../game/cavePreviewWorld/catalog';
import { advanceRealtime, choosePortal, portalsFor, DIFFICULTY, difficulty, collectRune, createWorld, drinkPotion, POTIONS, SKILLS, skill, skillBlock, start, type Skill, type World } from '../../game/cavePreviewWorld/engine';
import { readCheckpoint, saveCheckpoint } from '@/game/cavePreviewWorld/checkpoint';
import { ensurePlayerSession } from '@/game/auth';
import { getCavePveStatus, startCavePveRun, finishCavePveRun, type CavePveStatus } from '@/game/caveCloudPve';
import { useCaveSandbox } from '@/game/cave/sandboxStore';
import { equippedItems, loadoutTotals, UMBRA_SLOTS, umbraTemplate, type UmbraSlotId } from '@/game/cave/umbra';
import { gemTotals } from '@/game/cave/gems';
import { CaveUmbraScreen } from './cave/CaveUmbraScreen';
import { CaveFundPanel } from './cave/CavePanels';
import { CaveGemsScreen } from './cave/CaveGemsScreen';
import { setCavePreviewAssets } from './cave/caveShared';
import { Belt, BlessingPanel, Nav, UmbraMosaic, Vitals } from './cavePreview/hud';
import { loadImages, render, runeX, type Images } from './cavePreview/renderer';
import { CaveAudio } from './cavePreview/audio';
import './cavePreview/expedition.css';

const defaultUrl = (path: string) => import.meta.env.BASE_URL + path;
const EN_BIOMES: Record<Biome, string> = { crystal: 'Crystal rift', spore: 'Sunless garden', ember: 'Amber depths', astral: 'Star crypt', forge: 'Heart of the rift' };
interface Props { /** Legacy checkpoint regression fixture only. */ legacyRules?: boolean; assetUrl?: (path: string) => string; onExit?: () => void; onCity?: () => void; language?: string; userId?: string; heroLevel?: number; heroStats?: { maxHp: number; attack: number; defense: number; critChance?: number; critDamage?: number }; onActiveChange?: (active: boolean) => void; onLegacyRecovery?: () => void; /** Offline browser fixture only. */ onWorld?: (world: World) => void }
const HERO_LEVEL = 6;
/** Isolated gameplay, local checkpoint and device-local dark storage. No player APIs. */
export function CaveExpeditionPreview({ assetUrl = defaultUrl, onExit, onCity, onWorld, language = 'ru', legacyRules = false, userId, heroLevel = HERO_LEVEL, heroStats, onActiveChange, onLegacyRecovery }: Props) {
  const componentLive = useRef(true);
  useEffect(() => { componentLive.current = true; return () => { componentLive.current = false; }; }, []);
  const [saved] = useState(() => readCheckpoint(userId));
  const world = useRef<World>(saved?.world ?? {...createWorld(), rules: legacyRules ? 1 : 2}), canvas = useRef<HTMLCanvasElement>(null), art = useRef<Images | null>(null);
  const runId = useRef(saved?.runId ?? crypto.randomUUID());
  const [bank, dispatch] = useCaveSandbox();
  const [panel, setPanel] = useState<string | null>(null), [inventoryTab, setInventoryTab] = useState<'gear' | 'gems'>('gear');
  const [focusSlot, setFocusSlot] = useState<UmbraSlotId | 'wings' | null>(null);
  // The seven elixirs stay functional but never occupy the battle screen by default.
  const [beltOpen, setBeltOpen] = useState(false);
  const panelPause = useRef(false);
  const rune = useRef<HTMLButtonElement>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [notice, setNotice] = useState('');
  const audio = useRef<CaveAudio>();
  const helpState = useRef({ open: false, wasPaused: false });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [help, setHelp] = useState(false), [muted, setMuted] = useState(false);
  const [view, setView] = useState(() => structuredClone(world.current));
  const [cloud, setCloud] = useState<CavePveStatus | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudReload, setCloudReload] = useState(0);
  const [cloudError, setCloudError] = useState('');
  const cloudLock = useRef(false);
  const [confirmedRun, setConfirmedRun] = useState<string | null>(null);
  const en = language === 'en', t = (ru: string, english: string) => en ? english : ru;
  const bossIdentity = caveBoss(view.floor);
  const bossName = en ? bossIdentity.en : bossIdentity.ru;
  const biomeName = (b: Biome) => en ? EN_BIOMES[b] : BIOMES[b].name;
  const ended = view.phase === 'VICTORY' || view.phase === 'DEFEAT', playing = view.phase !== 'LOBBY' && !ended, focused = playing || ended || panel !== null;
  useEffect(() => { onActiveChange?.(playing || (!!userId && ended && confirmedRun !== runId.current)); return () => onActiveChange?.(false); }, [playing, ended, confirmedRun, userId, onActiveChange]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 2600); return () => window.clearTimeout(timer); }, [notice]);
  const names: Record<Skill, string> = { cleave: t('Раскол', 'Cleave'), ward: t('Заслон', 'Ward'), heal: t('Источник', 'Spring'), dodge: t('Уклон', 'Evade') };
  const icons = { cleave: Sword, ward: Shield, heal: HeartPulse, dodge: Wind };
  const hints = { cleave: t('По группе', 'Area strike'), ward: t('Снижает урон', 'Reduce damage'), heal: t('Лечение отряда', 'Party healing'), dodge: t('Избежать удара', 'Evade a hit') };
  useEffect(() => {
    if (panel === null) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.cv-overlay')) return;
      event.preventDefault();
      setPanel(null); world.current.paused = panelPause.current;
      setView(structuredClone(world.current)); saveCheckpoint(world.current, runId.current, userId);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [panel, userId]);
  useEffect(() => {
    let mounted = true;
    setError(''); setReady(false);
    loadImages(assetUrl).then(images => { if (mounted) { art.current = images; setReady(true); } }).catch(() => { if (mounted) setError('art'); });
    return () => { mounted = false; };
  }, [assetUrl, loadAttempt]);
  useEffect(() => { const sound = new CaveAudio(); audio.current = sound; return () => { sound.close(); }; }, []);
  useEffect(() => { world.current.wings = bank.previewWings; }, [bank.previewWings]);
  // First visit: the hero arrives already wearing a full dark set and wings, so all 13 places are alive.
  useEffect(() => {
    if (userId || bank.items.length || Object.keys(bank.loadout).length || bank.ops.includes('starter-kit-wings')) return;
    for (let n = 0; n < 60; n++) {
      const state = dispatch({ type: 'loot', floor: 6 + (n * 7) % 38, boss: true }, `starter-kit-${String(n).padStart(2, '0')}`).state;
      if (UMBRA_SLOTS.every(slot => state.items.some(item => item.slot === slot.id))) break;
    }
    let state = dispatch({ type: 'wings', style: 'astral' }, 'starter-kit-wings').state;
    for (const slot of UMBRA_SLOTS) {
      const best = state.items.filter(item => item.slot === slot.id).sort((a, b) => b.rank - a.rank || b.level - a.level)[0];
      if (best) state = dispatch({ type: 'equip', itemId: best.id }, `starter-kit-equip-${slot.id}`).state;
    }
    // A handful of spare finds stays in the storage; the rest becomes enhancement stones.
    const worn = new Set(Object.values(state.loadout));
    const spare = state.items.filter(item => !worn.has(item.id)).sort((a, b) => b.rank - a.rank || b.level - a.level).slice(9).map(item => item.id);
    if (spare.length) dispatch({ type: 'dismantle', itemIds: spare }, 'starter-kit-tidy');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Before a run starts the HUD already shows the hero as the dark gear makes him.
  useEffect(() => { if (world.current.phase === 'LOBBY') { outfit(world.current); setView(structuredClone(world.current)); } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [bank.items, bank.loadout, bank.sockets, bank.playtestHonor, heroStats?.attack, heroStats?.defense, heroStats?.maxHp, heroStats?.critChance, heroStats?.critDamage]);
  useEffect(() => { setCavePreviewAssets(assetUrl); return () => setCavePreviewAssets(null); }, [assetUrl]);
  // Production bridge is only a tiny progress/stone ledger. All combat stays client-side.
  // An offline demo (no userId) keeps its original behavior and test fixtures.
  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    void (async () => {
      try {
        if (!await ensurePlayerSession(userId)) throw new Error('cave_auth_required');
        const status = await getCavePveStatus();
        if (!mounted) return;
        setCloudError('');
        if (status.legacy_active_session_id) { onLegacyRecovery?.(); return; }
        setCloud(status);
        const w = world.current;
        w.unlockedFloor = status.unlocked_stage;
        if (status.active_run_id && status.active_run_id === runId.current && status.active_floor === w.floor) {
          if (w.phase === 'LOBBY') {
            w.rules = 2; start(w, status.active_floor); outfit(w); w.paused = true;
          }
        } else if (status.active_run_id) {
          setCloudError(t('На другом устройстве остался незавершённый забег. Завершите его здесь перед новой попыткой.', 'Another device has an unfinished run. Close it before starting a new one.'));
        } else if (w.phase === 'LOBBY') {
          w.floor = status.unlocked_stage; outfit(w);
        } else if (!['VICTORY','DEFEAT'].includes(w.phase)) {
          // A local demo checkpoint never authorizes progress without its server run.
          Object.assign(w, createWorld(), { floor: status.unlocked_stage, unlockedFloor: status.unlocked_stage });
          outfit(w);
        }
        setView(structuredClone(w)); saveCheckpoint(w, runId.current, userId);
      } catch {
        if (mounted) setCloudError(t('Не удалось загрузить этажи и Тёмные камни. Прогресс не изменён.', 'Could not load Cave progress and Dark Stones. No progress was changed.'));
      }
    })();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit reload rehydrates the confirmed server floor
  }, [userId, cloudReload]);

  useEffect(() => {
    if (!userId || !cloud || !ended || confirmedRun === runId.current || cloudLock.current) return;
    void settle(view.phase === 'VICTORY');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only one terminal report for this active server run
  }, [userId, cloud, view.phase, confirmedRun]);

  const renderedRunId = runId.current;
  useEffect(() => {
    if (view.phase === 'VICTORY' && (!userId || (!!cloud && confirmedRun === renderedRunId)) && !bank.ops.includes('expedition:' + renderedRunId)) {
      if (view.rules === 2) view.stars.forEach((stars, i) => dispatch({type:'loot', floor:view.floor, boss:false, lootRolls:DIFFICULTY[stars-1].lootRolls}, `floor-section:${renderedRunId}:${i}`));
      dispatch({ type: 'loot', floor: view.floor, boss: true, lootRolls: view.rules === 2 ? Math.max(...view.stars.map(n => DIFFICULTY[n-1].lootRolls)) : 1 }, 'expedition:' + renderedRunId);
    }
  }, [view, dispatch, renderedRunId, bank.ops, userId, cloud, confirmedRun]);
  useEffect(() => {
    if (!focused) return;
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const previous = document.activeElement;
    const siblings = [...document.body.children].filter((node): node is HTMLElement => node instanceof HTMLElement && !node.classList.contains('cx-focus')).map(node => ({ node, inert: node.inert }));
    siblings.forEach(({ node }) => { node.inert = true; });
    canvas.current?.closest('main')?.querySelector('button')?.focus();
    return () => { document.body.style.overflow = old; siblings.forEach(({ node, inert }) => { node.inert = inert; }); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [focused]);
  useEffect(() => {
    if (!ready) return;
    const w = world.current; onWorld?.(w);
    let frame = 0, last = 0, hudAt = 0, savedAt = 0;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const visibility = () => {
      last = 0;
      if (document.hidden && !['LOBBY','VICTORY','DEFEAT'].includes(w.phase)) {
        w.paused = true;
        // Closing a panel/help after returning must not undo the background pause.
        panelPause.current = true;
        helpState.current.wasPaused = true;
        setView(structuredClone(w));
      }
      setStorageOk(saveCheckpoint(w, runId.current, userId));
      audio.current?.tick(w);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.cx-panel')) return;
      if (helpState.current.open) {
        helpState.current.open = false;
        w.paused = helpState.current.wasPaused;
        setHelp(false);
      } else if (!['LOBBY', 'VICTORY', 'DEFEAT'].includes(w.phase)) {
        w.paused = !w.paused;
      } else return;
      event.preventDefault();
      setView(structuredClone(w));
    };
    window.addEventListener('pagehide', visibility); document.addEventListener('visibilitychange', visibility); document.addEventListener('keydown', keyboard);
    const loop = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0; last = now;
      if (!document.hidden) {
        advanceRealtime(w, dt); audio.current?.tick(w);
        const node = canvas.current;
        if (node && art.current) {
          const box = node.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
          const width = Math.round(box.width * ratio), height = Math.round(box.height * ratio);
          if (width && height) {
            if (node.width !== width || node.height !== height) { node.width = width; node.height = height; }
            const context = node.getContext('2d');
            if (context) { context.setTransform(node.width / 430, 0, 0, node.width / 430, 0, 0); render(context, w, art.current, node.height * 430 / node.width, en, motion.matches); }
            // The spark is a real place on the road: its touch target follows the camera every frame.
            if (rune.current) rune.current.style.transform = `translate3d(${(runeX(w) - w.cameraX) / 430 * box.width - 37}px,0,0)`;
          }
        }
        if (now - hudAt > 100) { setView(structuredClone(w)); hudAt = now; }
        if (now - savedAt > 1000) { setStorageOk(saveCheckpoint(w, runId.current, userId)); savedAt = now; }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { saveCheckpoint(w, runId.current, userId); cancelAnimationFrame(frame); window.removeEventListener('pagehide', visibility); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('keydown', keyboard); };
  }, [ready, onWorld, en, userId]);
  function refresh() { setView(structuredClone(world.current)); setStorageOk(saveCheckpoint(world.current, runId.current, userId)); }
  function outfit(w: World) {
    const stats = loadoutTotals(equippedItems(bank.items, bank.loadout)), gems = gemTotals(bank.sockets);
    // Preserve the approved scene units: starter account 100 HP / 20 attack maps to 900 / 30.
    // Gear, forge-set bonuses, growth and critical stats come from the same heroSide as classic PvE.
    w.critChance = Math.max(0, Math.min(100, (heroStats?.critChance ?? 0) + (stats.crit ?? 0) + (gems.crit ?? 0)));
    w.critDamage = Math.max(0, Math.min(10000, (heroStats?.critDamage ?? 50) + (stats.critDamage ?? 0)));
    w.attackBonus = Math.round((heroStats ? heroStats.attack * 1.5 - 30 : 0) + (stats.attack ?? 0) + (gems.attack ?? 0) + 30 * .005 * bank.playtestHonor);
    w.defenseBonus = Math.round((heroStats?.defense ?? 0) + (stats.defense ?? 0) + (gems.defense ?? 0));
    w.wings = bank.previewWings; w.honorBonus = bank.playtestHonor * .005;
    w.maxHp = (heroStats ? heroStats.maxHp * 9 : createWorld().maxHp) + Math.round((stats.hp ?? 0) + (gems.hp ?? 0) + 900 * .008 * bank.playtestHonor); w.hp = w.maxHp;
  }
  async function begin(floor = world.current.floor) {
    if (userId) {
      if (!cloud || cloudLock.current || playing) return;
      if (cloud.legacy_active_session_id) { onLegacyRecovery?.(); return; }
      if (['VICTORY','DEFEAT'].includes(world.current.phase) && confirmedRun !== runId.current) {
        setCloudError(t('Сначала подтвердите результат предыдущего боя.', 'Confirm the preceding fight result first.'));
        return;
      }
      const target = cloud.active_floor ?? floor;
      if (!Number.isInteger(floor) || floor < 1 || floor > cloud.unlocked_stage || floor !== target) {
        setCloudError(t('Этот этаж ещё не открыт для нового забега.', 'This floor cannot be started yet.'));
        return;
      }
      if (!cloud.active_run_id && cloud.dark_stones < 1) {
        setCloudError(t('Для входа нужен один Тёмный камень.', 'One Dark Stone is required to enter.'));
        return;
      }
      // Persist the same UUID before requesting the debit. A timed-out start can
      // be retried without charging another stone. A resumed run costs nothing.
      if (confirmedRun === runId.current) runId.current = crypto.randomUUID();
      const id = cloud.active_run_id ?? runId.current;
      if (cloud.active_run_id && cloud.active_run_id !== runId.current) {
        setCloudError(t('Сначала восстановите незавершённый забег.', 'Recover the unfinished run first.'));
        return;
      }
      if (!cloud.active_run_id) {
        runId.current = id;
        Object.assign(world.current, createWorld(), { floor: target, unlockedFloor: cloud.unlocked_stage });
        outfit(world.current);
        if (!saveCheckpoint(world.current, id, userId)) {
          setCloudError(t('Для надёжного входа нужно хранилище устройства.', 'Device storage is required to enter safely.')); return;
        }
      }
      cloudLock.current = true; setCloudBusy(true); setCloudError('');
      try {
        const result = await startCavePveRun(id, target);
        if (!componentLive.current) return;
        if (result.run_status === 'won' || result.run_status === 'lost') {
          runId.current = crypto.randomUUID(); setCloud(result); refresh();
          setCloudError(t('Эта попытка уже завершена. Начните новый забег.', 'This run has already ended. Start a new run.')); return;
        }
        if (result.active_run_id !== id || result.active_floor !== target) throw new Error('cave_start_unconfirmed');
        setCloud(result);
        world.current.unlockedFloor = result.unlocked_stage;
        setConfirmedRun(null);
        world.current.rules = 2; start(world.current, target); outfit(world.current);
      } catch {
        if (!componentLive.current) return;
        setCloudReload(n => n + 1);
        setCloudError(t('Вход не подтверждён. Повторите с тем же номером попытки — камень второй раз не спишется.', 'Entry is not confirmed. Retry the same run; the Stone will not be charged twice.'));
        return;
      } finally { cloudLock.current = false; setCloudBusy(false); }
    } else {
      world.current.rules = legacyRules ? 1 : 2; start(world.current, floor); runId.current = crypto.randomUUID(); outfit(world.current);
    }
    helpState.current.open = false; setHelp(false); setPanel(null); setNotice('');
    void audio.current?.unlock().catch(() => setMuted(true)); refresh();
  }
  async function settle(won: boolean) {
    if (!userId || !cloud || cloudLock.current) return false;
    if (!saveCheckpoint(world.current, runId.current, userId)) {
      setStorageOk(false); setCloudError(t('Не удалось сохранить итог на устройстве. Освободите место и повторите.', 'Could not store the result on this device. Free space and retry.')); return false;
    }
    cloudLock.current = true; setCloudBusy(true); setCloudError('');
    try {
      const result = await finishCavePveRun(runId.current, won);
      if (!componentLive.current) return false;
      if (!['won','lost'].includes(result.run_status ?? '')) throw new Error('cave_finish_mismatch');
      if (result.run_status !== (won ? 'won' : 'lost')) {
        // A second device may have closed this exact run already. Its first
        // receipt wins; never trap the player or award a contradictory win.
        world.current.phase = 'DEFEAT';
        setNotice(t('Попытка уже завершена на другом устройстве. Подтверждённый итог сохранён.', 'This run already ended on another device. Its confirmed result is preserved.'));
      }
      setCloud(result); setConfirmedRun(runId.current);
      world.current.unlockedFloor = result.unlocked_stage;
      refresh(); return true;
    } catch {
      setCloudError(t('Результат не подтверждён. Повторите сохранение; этаж и камни не будут начислены дважды.', 'Result not confirmed. Retry saving; progress and Stones are idempotent.'));
      return false;
    } finally { cloudLock.current = false; setCloudBusy(false); }
  }
  async function abandonRemoteRun() {
    if (!cloud?.active_run_id || cloudLock.current || !userId) return;
    cloudLock.current = true; setCloudBusy(true);
    try {
      const result = await finishCavePveRun(cloud.active_run_id, false);
      if (!componentLive.current) return;
      setCloud(result); setCloudError('');
      Object.assign(world.current, createWorld(), {floor:result.unlocked_stage,unlockedFloor:result.unlocked_stage});
      outfit(world.current); refresh();
    } catch {
      setCloudError(t('Не удалось завершить старую попытку. Повторите позже.', 'Could not close the old run. Retry later.'));
    } finally { cloudLock.current = false; setCloudBusy(false); }
  }
  async function exit() {
    if (userId && world.current.phase !== 'LOBBY' && confirmedRun !== runId.current) {
      if (world.current.phase !== 'VICTORY') { world.current.phase = 'DEFEAT'; refresh(); }
      if (!await settle(world.current.phase === 'VICTORY')) return;
    }
    runId.current = crypto.randomUUID();
    const {floor, unlockedFloor} = world.current; Object.assign(world.current, createWorld(), {floor, unlockedFloor}); outfit(world.current); helpState.current.open = false; setHelp(false); audio.current?.tick(world.current); refresh(); onExit?.(); }
  function pause() { if (!helpState.current.open) world.current.paused = !world.current.paused; refresh(); }
  function openHelp() {
    if (helpState.current.open) return;
    helpState.current = { open: true, wasPaused: world.current.paused };
    if (playing) world.current.paused = true;
    setHelp(true); refresh();
  }
  function closeHelp() {
    world.current.paused = helpState.current.wasPaused;
    helpState.current.open = false;
    setHelp(false); refresh();
  }
  function navigate(id: string) {
    if (helpState.current.open) {
      world.current.paused = helpState.current.wasPaused;
      helpState.current.open = false;
      setHelp(false);
    }
    if (id === 'games' && userId) setCloudReload(n => n + 1);
    if (id === 'city' && onCity) {
      world.current.paused = playing; refresh(); onCity(); return;
    }
    if (id === 'battle') { if (panel !== null) world.current.paused = panelPause.current; setPanel(null); refresh(); return; }
    if (panel === null) panelPause.current = world.current.paused;
    world.current.paused = true; setPanel(id); refresh();
  }
  function drink(slot: number) {
    if (drinkPotion(world.current, slot)) setNotice(`${en ? POTIONS[slot].en : POTIONS[slot].ru}: ${en ? POTIONS[slot].effectEn : POTIONS[slot].effectRu}`);
    refresh();
  }
  function openGear(slot: UmbraSlotId | 'wings') { setInventoryTab('gear'); setFocusSlot(slot); navigate('inventory'); }
  function toggleSound() { const next = !muted; setMuted(next); audio.current?.mute(next); if (!next) void audio.current?.unlock().catch(() => setMuted(true)); }
  const boss = view.enemies.find(e => e.species === 'boss' && e.hp > 0 && ['BOSS', 'WAVE_SPAWN'].includes(view.phase));
  const warning = boss && boss.impact > view.time;
  const clock = `${Math.floor(view.time / 60)}:${String(Math.floor(view.time % 60)).padStart(2, '0')}`;
  const fighting = ['APPROACH', 'FIGHT', 'BOSS', 'WAVE_SPAWN'].includes(view.phase);
  const stage = view.rules === 2 ? view.stars.length + (view.bossSpawned ? 1 : 0) : view.room * 2 + Math.min(view.wave, view.room === 2 ? 1 : 2);
  const stageLabel = view.bossSpawned ? bossName : view.phase === 'PORTAL_CHOICE' ? t('Развилка', 'Crossroads') : `${t('Волна', 'Wave')} ${view.wave + 1}/${view.rules === 2 ? 3 : view.room === 2 ? 1 : 2}`;
  const travelLabel = view.phase === 'PORTAL_CHOICE' ? t('Выберите арку', 'Choose an arch') : fighting ? (boss ? t('Бой с хозяином Бездны', 'Abyss lord battle') : t('Бой', 'Battle')) : `${t('Путь', 'Road')} · ${biomeName(view.biome)}`;
  const honorReady = heroLevel >= 5 && bank.playtestWins > 0 && bank.playtestHonor === 0;
  // Inside the main game the entrance is a plain doorway: the full cave screen opens once the road begins.
  const doorway = !!onExit && !focused;
  const power = 30 + view.attackBonus;
  const cloudCleared = cloud?.completed_stage ?? 0;
  const cloudFloor = cloud?.unlocked_stage ?? view.unlockedFloor;
  const entryBlocked = !!userId && (!cloud || cloudBusy || !storageOk || (!!cloud.active_run_id && cloud.active_run_id !== runId.current));
  const content = <main className={`cx-demo ${focused ? 'cx-focus' : ''} ${playing ? 'cx-playing' : ''}`} lang={en ? 'en' : 'ru'} style={{ '--cx-wood': `url("${assetUrl('assets/territory/ui/wooden-plaque.webp')}")`, '--cx-planks': `url("${assetUrl('assets/territory/ui/shop/shop-wood-planks.webp')}")`, '--cx-color': BIOMES[view.biome].color } as React.CSSProperties}>
    <div className="cx-stage" data-phase={view.phase} {...(panel !== null ? { inert: '' } : {})}>
      <canvas ref={canvas} role="img" aria-label={t('Отряд движется вправо по пещере', 'The party travels right through the cave')} />
      <header className="cx-header">
        <button aria-label={t('Вернуться ко входу', 'Return to entrance')} onClick={playing ? pause : exit}><ChevronLeft size={20} /></button>
        <div className="cx-chapter">
          <div className="cx-pips" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(i => <i key={i} className={i < stage ? 'done' : i === stage && playing ? 'now' : ''}>{i === 5 ? '☠' : ''}</i>)}</div>
          <strong>{biomeName(view.biome)}</strong>
          <span>{t('Зал', 'Hall')} {view.room + 1}/{view.rules === 2 ? 4 : 3} · {stageLabel} · {t('Этаж','Floor')} {view.floor}{playing ? ` · ${clock}` : ''}</span>
        </div>
        <button aria-label={t('Звук', 'Sound')} aria-pressed={!muted} onClick={toggleSound}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
        <button aria-label={t('Как играть', 'How to play')} onClick={openHelp}><CircleHelp size={17} /></button>
        <button aria-label={t('Настройки', 'Settings')} onClick={() => navigate('settings')}><img src={assetUrl('ic-settings.webp')} alt="" /></button>
        {playing && <button onClick={pause} aria-label={t(view.paused ? 'Возобновить' : 'Пауза', view.paused ? 'Resume' : 'Pause')}>{view.paused ? <Play size={17} /> : <Pause size={17} />}</button>}
      </header>
      {playing && !boss && <div className="cx-road" role="status">{travelLabel} {view.rules === 2 && view.stars.length > 0 && `· ${'★'.repeat(view.stars[view.stars.length - 1]!)} · ${Math.max(0, difficulty(view).count - (view.kills - view.stars.slice(0,-1).reduce((n,s)=>n+8+s,0)))}/${difficulty(view).count}`}</div>}
      {boss && <div className="cx-boss"><strong>{bossName} · {t('Фаза', 'Phase')} {view.bossPhase}/3</strong><div role="meter" aria-label={t('Здоровье босса', 'Boss health')} aria-valuenow={boss.hp} aria-valuemin={0} aria-valuemax={boss.maxHp}><i style={{ width: `${100 * boss.hp / boss.maxHp}%` }} /></div><small>{[t('Пробуждение', 'Awakening'), t('Раскол земли', 'Earth rupture'), t('Ярость Бездны', 'Abyss fury')][view.bossPhase - 1]}</small></div>}
      {warning && <div className={`cx-warning ${boss.heavy ? 'heavy' : ''}`} role="status">{boss.heavy ? [t('⚠ Обвал! Нажмите Заслон', '⚠ Collapse! Use Ward'), t('⚠ Разлом! Нажмите Заслон', '⚠ Rupture! Use Ward'), t('⚠ Дождь осколков! Заслон', '⚠ Shard rain! Use Ward')][view.bossPhase - 1] : t('Удар приближается', 'Incoming strike')}<i style={{ transform: `scaleX(${Math.max(0, (boss.impact - view.time) / (boss.heavy ? 1.45 : .95))})` }} /></div>}
      {(!ready || error) && <div className="cx-overlay"><strong>{error ? t('Не удалось открыть пещеру', 'Could not open the cave') : t('Пробуждаем пещеру…', 'Waking the cave…')}</strong>{error && <button onClick={() => setLoadAttempt(attempt => attempt + 1)}>{t('Повторить загрузку', 'Reload')}</button>}</div>}
      {view.phase === 'LOBBY' && ready && <div className="cx-lobby"><span className="cx-eyebrow">{t('ТЁМНАЯ ПЕЩЕРА', 'DARK CAVE')}</span><h1>{t('За гранью света', 'Beyond the light')}</h1><p>{t('Четыре портала. Выберите риск. Победите Собор.', 'Four portals. Choose your risk. Defeat the Cathedral.')}</p>{userId && cloud && <div className="cx-cloud-progress" role="status"><b>{t('Этаж', 'Floor')} {cloudFloor}/100</b><button onClick={() => navigate('stones')}>◆ {cloud.dark_stones} {t('Тёмных камней', 'Dark Stones')}</button><button onClick={() => navigate('floors')}>{t('Этажи пещеры', 'Cave floors')}</button><button onClick={() => navigate('inventory')}>{t('Снаряжение', 'Equipment')}</button><button onClick={() => navigate('blessing')}>{t('Благословения', 'Blessings')}</button><button onClick={() => navigate('fund')}>{t('Фонд', 'Fund')}</button></div>}<button className="cx-primary" onClick={() => void begin()} disabled={entryBlocked}>{cloudBusy ? t('Проверяем вход…', 'Checking entry…') : t('В путь', 'Set out')} →</button><small>{t('Герой идёт и бьёт сам · умения и зелья за вами', 'The hero travels and strikes · skills and potions are yours')}</small></div>}
      {userId && cloudError && <div className="cx-cloud-alert" role="alert"><p>{cloudError}</p>{cloud?.active_run_id && cloud.active_run_id !== runId.current && <button onClick={() => { if (confirm(t('Это прервёт текущий забег на другом устройстве. Вернуть камень и закрыть попытку?', 'This ends a run on another device. Refund the Stone and close it?'))) void abandonRemoteRun(); }} disabled={cloudBusy}>{t('Закрыть старый забег · вернуть камень', 'Close old run · refund Stone')}</button>}{ended && confirmedRun !== runId.current && <button onClick={() => void settle(view.phase === 'VICTORY')} disabled={cloudBusy}>{t('Повторить сохранение', 'Retry saving result')}</button>}{!cloud && <button onClick={() => { setCloudError(''); setCloudReload(n => n + 1); }}>{t('Повторить загрузку', 'Retry loading')}</button>}</div>}
      {view.phase === 'RUN_RIGHT' && !view.runeCollected && !view.paused && <button ref={rune} className="cx-rune" onClick={() => { collectRune(world.current); refresh(); }} aria-label={t('Собрать искру', 'Collect spark')}><small>+10 ✦</small></button>}
      {view.phase === 'PORTAL_CHOICE' && <div className={`cx-portals ${view.rules === 2 ? 'cx-three-portals' : ''}`} aria-label={t('Выбор портала', 'Portal choice')}>{portalsFor(view).map((p, i) => <button key={i} aria-label={`${biomeName(p.biome)}${view.rules === 2 ? ` · ${i+1} ★` : ''}`} onClick={() => { if (choosePortal(world.current, i)) refresh(); }} style={{ '--portal': view.rules === 2 ? DIFFICULTY[i].color : BIOMES[p.biome].color } as React.CSSProperties}><span className="cx-portal-touch" /><b>{biomeName(p.biome)}</b><small>{view.rules === 2 ? `${DIFFICULTY[i].count} ${t('врагов','foes')} · ${t('Добыча','Loot')} ${'↑'.repeat(i+1)}` : (en ? ['Ranged spores', 'Armoured depths', 'Sails & Cathedral', 'Depths & Cathedral'][view.room * 2 + i] : p.hint)}</small></button>)}</div>}
      {playing && view.phase !== 'PORTAL_CHOICE' && <div className="cx-actions">{(Object.keys(SKILLS) as Skill[]).map(key => {
        const left = Math.max(0, view.cooldown[key] - view.time), cd = Math.ceil(left), Icon = icons[key];
        return <button key={key} className={`cx-skill-${key}`} aria-label={names[key]} title={`${hints[key]} · ${SKILLS[key].cost}✦`} disabled={skillBlock(view, key) !== null} onClick={() => { skill(world.current, key); refresh(); }}
          style={{ '--cd': left / SKILLS[key].cooldown } as React.CSSProperties}>
          <Icon size={15} strokeWidth={2.2} aria-hidden="true" />{cd > 0 && <b className="cx-cooldown">{cd}</b>}
        </button>;
      })}</div>}
      {view.paused && playing && !help && panel === null && <div className="cx-overlay"><strong>{t('Привал', 'Rest stop')}</strong><p>{t('Экспедиция сохранена. Мир ждёт вашего шага.', 'The expedition is saved. The world waits for your step.')}</p><button className="cx-primary" onClick={pause}>{t('Продолжить путь', 'Continue')}</button><button onClick={exit}>{t('К входному порталу', 'Back to entrance')}</button></div>}
      {help && <div className="cx-overlay cx-help"><h2>{t('Путь в глубину', 'Into the depths')}</h2><p>{t('Герой сам идёт вправо и бьёт врагов, которые ждут на дороге. Раскол бьёт группу после замаха. Заслон снижает урон на 85%. Уклон спасает от удара, если нажать перед попаданием. Источник лечит героя и живых спутников.', 'The hero travels right and strikes the foes waiting on the road. Cleave hits a group after the windup. Ward reduces damage by 85%. Use Evade just before contact to avoid a hit. Spring heals the hero and living companions.')}</p><p>{t('Энергия восстанавливается медленно. Авто применяет умения за вас и бережёт запас для защиты. Перед каждым из четырёх участков выберите арку: больше звёзд — сильнее враги и выше шанс ценной добычи. После перезагрузки экспедиция продолжается с того же места.', 'Energy recovers slowly. Auto uses skills for you and keeps a reserve for defence. Choose an arch before each of four sections: more stars mean stronger foes and a better loot chance. After a reload the expedition continues from the same place.')}</p><button onClick={closeHelp}>{t('Понятно', 'Got it')}</button></div>}
      {ended && panel === null && <div className={`cx-result ${view.phase === 'VICTORY' ? 'cx-victory' : ''}`}><span className="cx-result-emblem">{view.phase === 'VICTORY' ? '♛' : '⛨'}</span><span className="cx-eyebrow">{view.phase === 'VICTORY' ? t('ПОБЕДА', 'VICTORY') : t('ПУТЬ ПРЕРВАН', 'DEFEAT')}</span><h1>{view.phase === 'VICTORY' ? t('Бездна отступила', 'The Abyss retreats') : t('Новый шанс ждёт', 'Another chance awaits')}</h1><p>{view.route.map(biomeName).join(' → ')}</p>{userId && <p role="status">{confirmedRun === runId.current ? t('Результат сохранён', 'Result saved') : cloudBusy ? t('Сохраняем результат…', 'Saving result…') : t('Ожидает подтверждения', 'Awaiting confirmation')}</p>}<p>{clock} · {t('враги', 'foes')}: {view.kills} · {t('блоки', 'blocks')}: {view.blocks} · {t('умения', 'skills')}: {view.casts}</p>{view.phase === 'VICTORY' && (!userId || confirmedRun === runId.current) && <div className="cx-loot">{bank.lastLoot?.items.map(item => <div key={item.id}><img src={assetUrl(umbraTemplate(item.templateId)!.art)} alt={t('Добыча', 'Loot')} /><span>{t('ур.', 'Lv.')}{item.level}</span></div>)}</div>}{view.phase === 'VICTORY' && <small>{userId ? t('ТЕСТОВАЯ добыча · только на этом устройстве', 'TEST loot · on this device only') : t('Добыча ждёт в тёмном складе', 'The loot waits in the dark storage')}</small>}{view.phase === 'VICTORY' && <button className="cx-primary" onClick={() => navigate('inventory')}>{t('Открыть добычу', 'Open loot')}</button>}{view.phase === 'VICTORY' && (userId ? (!cloudBusy && !!cloud && !cloud.active_run_id && cloud.unlocked_stage > view.floor) : view.unlockedFloor > view.floor) && <button className="cx-primary" onClick={() => void begin(world.current.floor + 1)}>{t('Следующий этаж', 'Next floor')} →</button>}<button className="cx-primary" disabled={cloudBusy || (!!userId && ended && confirmedRun !== runId.current)} onClick={() => void begin()}>{t('Повторить забег', 'Try again')} ↻</button><button onClick={exit}>{t('К входному порталу', 'Back to entrance')}</button></div>}
    </div>
    {!doorway && <section className="cx-controls" aria-label={t('Панель героя', 'Hero panel')} {...(panel !== null ? { inert: '' } : {})}>
      <button type="button" className="cx-belt-toggle" aria-expanded={beltOpen} aria-controls="cx-elixir-tray" aria-label={beltOpen ? t('Скрыть эликсиры', 'Hide elixirs') : t('Показать эликсиры', 'Show elixirs')} onClick={() => setBeltOpen(open => !open)}>{beltOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
      <Vitals view={view} en={en} level={heroLevel} onStats={() => navigate('hero')} />
      <UmbraMosaic bank={bank} en={en} assetUrl={assetUrl} onOpen={openGear} />
      <div className="cx-control-status">
        <button className="cx-quest" onClick={() => navigate(honorReady ? 'honor' : 'map')} aria-label={t('Цель экспедиции', 'Expedition goal')}>
          <img src={assetUrl('assets/territory/cave-loot/2026-11-06/15-rune-emblem.webp')} alt="" />
          <span><b>{bossName}</b>{honorReady ? <em>{t('Получить награду!', 'Claim reward!')}</em> : <small>{t('Повержено', 'Defeated')} {view.kills}/{view.rules === 2 ? `${view.stars.reduce((n, s) => n + 8 + s, 1) + (4-view.stars.length)*9}${view.stars.length < 4 ? '–' + (view.stars.reduce((n,s)=>n+8+s,1)+(4-view.stars.length)*11) : ''}` : 16}</small>}</span>
        </button>
        <button className="cx-speed" aria-label={t('Скорость', 'Speed')} aria-pressed={view.speed === 2} onClick={() => { world.current.speed = world.current.speed === 1 ? 2 : 1; refresh(); }}><b>x{view.speed}</b></button>
        <button className={view.auto ? 'cx-auto active' : 'cx-auto'} title={t('Автоматически применять умения', 'Use skills automatically')} onClick={() => { world.current.auto = !world.current.auto; refresh(); }} aria-label={t('Авто навыков', 'Auto skills')} aria-pressed={view.auto}><RefreshCw size={21} strokeWidth={2.4} /></button>
        <button className="cx-icon-button" aria-label={t('Почётные звания', 'Honor ranks')} onClick={() => navigate('honor')}><img src={assetUrl('ic-honor.webp')} alt="" />{honorReady && <i />}</button>
        <button className="cx-icon-button" aria-label={t('Благословение', 'Blessing')} onClick={() => navigate('blessing')}><img src={assetUrl('ic-blessing.webp')} alt="" />{bank.blessSlots.some(Boolean) && <i className="on" />}</button>
      </div>
      <div id="cx-elixir-tray" hidden={!beltOpen}>{beltOpen && <Belt world={view} en={en} assetUrl={assetUrl} onDrink={drink} onAuto={() => { world.current.autoPotions = !world.current.autoPotions; refresh(); }} />}</div>
    </section>}
    {!storageOk && <p className="cx-save-note" role="status">{t('Хранилище недоступно — экспедиция только до закрытия страницы.', 'Storage unavailable — this visit only.')}</p>}
    {notice && <button className="cx-receipt" onClick={() => setNotice('')} aria-label={t('Закрыть уведомление', 'Dismiss notification')}>{notice}</button>}
    {panel !== null && <section className="cx-panel" aria-label={t('Раздел', 'Section')}>
      <div className="cx-panel-heading"><b><span className="hp">♥ {Math.ceil(view.hp)}</span><span className="en">✦ {Math.floor(view.energy)}</span><span>{t('Зал', 'Hall')} {view.room + 1}/{view.rules === 2 ? 4 : 3}</span></b><button onClick={() => navigate('battle')}>← {t('В бой', 'To battle')}</button></div>
      {panel === 'fund' ? <CaveFundPanel en={en} clearedDepth={userId ? cloudCleared : Math.max(0, view.unlockedFloor - 1)} />
      : panel === 'stones' ? <div className="cx-camp"><h1>{t('Тёмные камни', 'Dark Stones')}</h1><p>◆ {cloud?.dark_stones ?? '—'}</p><p>{t('5 при первом входе, затем +3 в сутки по UTC. Вход стоит 1 камень. При поражении или выходе камень возвращается один раз.', '5 on first entry, then +3 daily in UTC. Entry costs 1 Stone. Defeat or leaving refunds it once.')}</p></div>
      : panel === 'blessing' ? <BlessingPanel bank={bank} dispatch={dispatch} en={en} assetUrl={assetUrl} onNotice={setNotice} />
      : panel === 'settings' ? <div className="cx-camp"><h1>{t('Настройки', 'Settings')}</h1>
        <div className="cx-toggle-list">
          <button aria-pressed={!muted} onClick={toggleSound}><span>{t('Звук', 'Sound')}</span><b>{muted ? t('ВЫКЛ', 'OFF') : t('ВКЛ', 'ON')}</b></button>
          <button aria-pressed={view.speed === 2} onClick={() => { world.current.speed = world.current.speed === 1 ? 2 : 1; refresh(); }}><span>{t('Скорость', 'Speed')}</span><b>x{view.speed}</b></button>
          <button aria-pressed={view.auto} onClick={() => { world.current.auto = !world.current.auto; refresh(); }}><span>{t('Авто умений', 'Auto skills')}</span><b>{view.auto ? t('ВКЛ', 'ON') : t('ВЫКЛ', 'OFF')}</b></button>
          <button aria-pressed={view.autoPotions} onClick={() => { world.current.autoPotions = !world.current.autoPotions; refresh(); }}><span>{t('Автозелья при HP ниже 35%', 'Auto potions below 35% HP')}</span><b>{view.autoPotions ? t('ВКЛ', 'ON') : t('ВЫКЛ', 'OFF')}</b></button>
        </div>
        <div className="cx-utilities"><button onClick={() => navigate('blessing')}>{t('Благословение', 'Blessing')}</button><button onClick={() => navigate('honor')}>{t('Почётные звания', 'Honor ranks')}</button><button onClick={() => openGear('helmet')}>{t('Тёмное снаряжение', 'Dark gear')}</button><button onClick={() => { setPanel(null); openHelp(); }}>{t('Как играть', 'How to play')}</button></div>
        {playing && <button onClick={() => void exit()}>{t('Завершить забег · вернуть камень', 'End run · refund Stone')}</button>}
      </div>
      : panel === 'honor' ? <div className="cx-camp cx-honor"><h1>{t('Почётные звания', 'Honor ranks')}</h1>
        <div className="cx-honor-rank"><img src={assetUrl('ic-honor.webp')} alt="" /><div><b>{bank.playtestHonor ? t('Страж Бездны', 'Abyss Warden') : t('Странник глубин', 'Wanderer of the Deep')}</b><small>{t('Звание', 'Rank')} {bank.playtestHonor} → {bank.playtestHonor + 1}</small></div></div>
        <p>{t('Атака и защита', 'Attack & defense')}: +{bank.playtestHonor * .5}% → <b>+{(bank.playtestHonor + 1) * .5}%</b><br />{t('Здоровье', 'Health')}: +{(bank.playtestHonor * .8).toFixed(1)}% → <b>+{((bank.playtestHonor + 1) * .8).toFixed(1)}%</b></p>
        <ul className="cx-honor-conditions"><li><span>{t('Уровень героя', 'Hero level')}</span><b>{heroLevel}/{bank.playtestHonor ? 10 : 5} {bank.playtestHonor ? '◇' : '✓'}</b></li><li><span>{t('Пройденные залы', 'Cleared halls')}</span><b>{bank.playtestWins ? 3 : Math.min(3, view.room)}/{bank.playtestHonor ? 5 : 3} {bank.playtestWins && !bank.playtestHonor ? '✓' : '◇'}</b></li><li><span>{t('Собор Бездны повержен', 'Abyss Cathedral defeated')}</span><b>{bank.playtestWins}/{bank.playtestHonor ? 3 : 1} {bank.playtestWins && !bank.playtestHonor ? '✓' : '◇'}</b></li></ul>
        <p className="cx-diamonds"><img src={assetUrl('blue-gem.webp')} alt="" /> {bank.playtestBlueDiamonds} {t('синих алмазов', 'blue diamonds')}</p>
        <button className="cx-primary" disabled={bank.playtestHonor > 0 || bank.playtestWins === 0} onClick={() => { const result = dispatch({ type: 'claimPlaytestHonor' }); if (result.ok) setNotice(t('Звание получено · +10 синих алмазов', 'Rank claimed · +10 blue diamonds')); }}>{bank.playtestHonor ? t('Звание получено', 'Rank claimed') : t('Получить · +10 синих', 'Claim · +10 blue')}</button>
        <small>{bank.playtestHonor ? t('Бонус звания действует с новой экспедиции. Следующее звание откроется в глубине Пещеры.', 'The rank bonus applies from the next expedition. The next rank opens deeper in the Cave.') : t('Одолейте Собор Бездны, чтобы получить первое звание.', 'Defeat the Abyss Cathedral to claim the first rank.')}</small></div>
      : panel === 'inventory' ? <>
        <div className="cx-inventory-tabs"><button aria-pressed={inventoryTab === 'gear'} onClick={() => setInventoryTab('gear')}>{t('Тёмная энергия', 'Dark energy')}</button><button aria-pressed={inventoryTab === 'gems'} onClick={() => setInventoryTab('gems')}>{t('Самоцветы', 'Gems')}</button></div>
        <div className="cx-inventory-content" data-focus={focusSlot ?? undefined}>{inventoryTab === 'gear'
          ? <CaveUmbraScreen en={en} hero={assetUrl('assets/territory/characters/heroes/male_viking/idle.webp')} onBack={() => navigate('battle')} focus={focusSlot} />
          : <CaveGemsScreen en={en} onBack={() => navigate('battle')} />}</div>
      </> : <div className="cx-camp-content">
        <span className="cx-eyebrow">{t('ТЁМНАЯ ПЕЩЕРА', 'DARK CAVE')}</span>
        <h1>{panel === 'floors' ? t('Сто этажей Пещеры', 'One hundred Cave floors') : panel === 'map' ? t('Путь в бездну', 'Into the abyss') : panel === 'hero' ? t('Герой', 'Hero') : panel === 'clan' ? t('Походный отряд', 'Expedition party') : panel === 'games' ? t('Летопись экспедиции', 'Expedition record') : t('Привал у входа', 'Entrance camp')}</h1>
        {panel === 'floors' ? <><p>{t('Выберите любой пройденный или текущий этаж. Каждый забег — четыре участка и финальный босс. Добыча зависит от выбранного этажа.', 'Choose any cleared or current floor. Every run has four sections and a final boss. Loot follows the selected floor.')}</p><div className="cx-floor-picker">{Array.from({length:100},(_,i)=>i+1).map(f=><button key={f} className={f<=cloudCleared?'cleared':f===cloudFloor?'current':''} disabled={playing || cloudBusy || (!!userId && (!cloud || f>cloudFloor || (ended && confirmedRun !== runId.current)))} onClick={()=>{ navigate('battle'); void begin(f); }}><b>{t('Этаж','Floor')} {f}</b><small>{f<=cloudCleared?t('Пройден','Cleared'):f===cloudFloor?t('Текущий','Current'):t('Закрыт','Locked')}</small></button>)}</div></>
        : panel === 'map' ? <><div className="cx-route-map">{(view.rules === 2 ? [['spore','ember'], ['astral','forge'], ['spore','ember'], ['astral','forge']] : [['crystal'], ['spore', 'ember'], ['astral', 'forge']]).map((row, depth) => <div key={depth} className="cx-route-row"><small>{t('Зал', 'Hall')} {depth + 1}</small>{row.map(b => <div key={b} className={view.route[depth] === b ? (depth === view.room ? 'here' : 'done') : ''} style={{ '--tone': BIOMES[b as Biome].color } as React.CSSProperties}><b>{biomeName(b as Biome)}</b><span>{view.route[depth] === b ? (depth === view.room && playing ? '➤' : '✓') : '◇'}</span></div>)}</div>)}<div className="cx-route-row"><small>☠</small><div className={view.bossSpawned ? 'here' : ''} style={{ '--tone': '#ff8fd0' } as React.CSSProperties}><b>{bossName}</b><span>{view.phase === 'VICTORY' ? '✓' : '◇'}</span></div></div></div><p>{t('Четыре обязательных участка, затем Собор Бездны. Только его победа открывает следующий этаж.', 'Four required sections, then the Abyss Cathedral. Only defeating it unlocks the next floor.')}</p></>
        : panel === 'hero' ? <><div className="cx-hero-card"><img className="cx-camp-hero" src={assetUrl('assets/territory/characters/heroes/male_viking/idle.webp')} alt="" /><ul><li><span>{t('Уровень', 'Level')}</span><b>{heroLevel}</b></li><li><span>{t('Здоровье', 'Health')}</span><b>{Math.ceil(view.hp)}/{view.maxHp}</b></li><li><span>{t('Удар', 'Strike')}</span><b>{power}</b></li><li><span>{t('Защита', 'Defense')}</span><b>{view.defenseBonus}</b></li><li><span>{t('Энергия', 'Energy')}</span><b>{Math.floor(view.energy)}/100</b></li></ul></div><UmbraMosaic bank={bank} en={en} assetUrl={assetUrl} onOpen={openGear} /><p>{t('Тёмные вещи, самоцветы и звание усиливают героя с новой экспедиции.', 'Dark gear, gems and rank strengthen the hero from the next expedition.')}</p></>
        : panel === 'clan' ? <div className="cx-party-cards">{['northern_warrior', 'forest_healer'].map((id, i) => <div key={id}><img src={assetUrl(`assets/territory/characters/followers/${id}/idle.webp`)} alt="" /><b>{i ? t('Лесная целительница', 'Forest healer') : t('Северный воин', 'Northern warrior')}</b><p>♥ {Math.ceil(view.followerHp[i])}/{i ? 220 : 260}</p><small>{i ? t('Магические снаряды · лечится Источником', 'Magic projectiles · healed by Spring') : t('Ближний бой · поддержка в атаке', 'Melee · attack support')}</small></div>)}</div>
        : panel === 'games' ? <><h2>{t('Сохранённые результаты', 'Saved results')}</h2><ul className="cx-record">{cloud?.history?.map(h => <li key={h.run_id}><span>{t('Этаж', 'Floor')} {h.floor} · {h.source === 'legacy' ? t('Прежний бой', 'Legacy fight') : t('Экспедиция', 'Expedition')}</span><b>{h.status === 'won' ? t('Победа', 'Victory') : t('Поражение', 'Defeat')}</b></li>)}</ul><h2>{t('На этом устройстве · тест', 'On this device · test')}</h2><ul className="cx-record"><li><span>{t('Побед над Собором', 'Cathedral victories')}</span><b>{bank.playtestWins}</b></li><li><span>{t('Повержено врагов', 'Foes defeated')}</span><b>{view.kills}/{view.rules === 2 ? `${view.stars.reduce((n, s) => n + 8 + s, 1) + (4-view.stars.length)*9}${view.stars.length < 4 ? '–' + (view.stars.reduce((n,s)=>n+8+s,1)+(4-view.stars.length)*11) : ''}` : 16}</b></li><li><span>{t('Блоки · уклонения', 'Blocks · evades')}</span><b>{view.blocks} · {view.dodges}</b></li><li><span>{t('Умений применено', 'Skills used')}</span><b>{view.casts}</b></li><li><span>{t('Время в пути', 'Time on the road')}</span><b>{clock}</b></li><li><span>{t('Вещей в тёмном складе', 'Items in dark storage')}</span><b>{bank.items.length}</b></li></ul></>
        : <><p>{t('У входа в Пещеру можно перевести дух, проверить снаряжение и начать путь заново.', 'At the Cave entrance you can catch your breath, check your gear and start the road again.')}</p><p>{t('Зал', 'Hall')} {view.room + 1}/{view.rules === 2 ? 4 : 3} · {view.kills}/{view.rules === 2 ? `${view.stars.reduce((n, s) => n + 8 + s, 1) + (4-view.stars.length)*9}${view.stars.length < 4 ? '–' + (view.stars.reduce((n,s)=>n+8+s,1)+(4-view.stars.length)*11) : ''}` : 16} {t('врагов', 'foes')}</p></>}
        <button className="cx-primary" onClick={() => navigate('battle')}>{playing ? t('Продолжить путь', 'Continue') : t('К экспедиции', 'To the expedition')}</button>
        {(panel === 'city' || panel === 'games') && <button onClick={() => { if (!playing || confirm(t('Начать экспедицию заново?', 'Restart the expedition?'))) begin(); }}>{t('Новая экспедиция', 'New expedition')}</button>}
      </div>}
    </section>}
    {!doorway && <Nav assetUrl={assetUrl} en={en} active={panel === 'inventory' || panel === 'hero' || panel === 'map' || panel === 'games' || panel === 'clan' || panel === 'city' ? panel : 'battle'} onNavigate={navigate} />}
  </main>;
  return focused ? createPortal(content, document.body) : content;
}
