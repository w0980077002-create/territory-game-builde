import type { World } from '../../../game/cavePreviewWorld/engine';
/** Original synthesized cave ambience and cues. No files, requests or persistence. */
export class CaveAudio {
  private context?: AudioContext;
  private bus?: GainNode;
  private lastEffect = -1;
  private lastStep = 0;
  private phase = '';
  private suspended = false;
  private primed = false;
  private kills = 0;
  private actionAt = 0;
  muted = false;
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.bus = this.context.createGain(); this.bus.gain.value = this.muted ? 0 : .13; this.bus.connect(this.context.destination);
      for (const frequency of [48, 72.3]) {
        const drone = this.context.createOscillator(); const gain = this.context.createGain();
        drone.frequency.value = frequency; gain.gain.value = .045; drone.connect(gain); gain.connect(this.bus); drone.start();
      }
    }
    await this.context.resume(); this.suspended = false;
  }
  mute(value: boolean) { this.muted = value; if (this.bus && this.context) this.bus.gain.setTargetAtTime(value ? 0 : .13, this.context.currentTime, .03); }
  private tone(frequency: number, end: number, duration: number, volume: number, type: OscillatorType = 'sine') {
    if (!this.context || !this.bus || this.muted) return;
    const t = this.context.currentTime, oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, t); oscillator.frequency.exponentialRampToValueAtTime(end, t + duration);
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    oscillator.connect(gain); gain.connect(this.bus); oscillator.start(t); oscillator.stop(t + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  tick(w: World) {
    if (!this.context) return;
    // A restored checkpoint may contain the tail of old impacts. Establish a
    // cursor before playing; unlocking/resuming must never replay that history.
    if (!this.primed || w.time < this.lastStep) {
      this.primed = true; this.lastEffect = w.time; this.lastStep = w.time;
      this.kills = w.kills; this.actionAt = w.heroActionAt; this.phase = w.phase;
    }
    const suspend = w.paused || document.hidden || ['LOBBY', 'VICTORY', 'DEFEAT'].includes(w.phase);
    if (suspend !== this.suspended) { this.suspended = suspend; void (suspend ? this.context.suspend() : this.context.resume()).catch(() => {}); }
    if (suspend) return;
    if (w.kills > this.kills) this.tone(145, 39, .23, .16, 'triangle');
    this.kills = w.kills;
    if (w.pose === 'attack' && w.heroActionAt > this.actionAt) this.tone(240, 95, .09, .08, 'triangle');
    this.actionAt = Math.max(this.actionAt, w.heroActionAt);
    if (w.pose === 'run' && w.time - this.lastStep > .29) { this.lastStep = w.time; this.tone(90, 38, .08, .16, 'triangle'); }
    for (const effect of w.effects) {
      if (effect.born <= this.lastEffect) continue;
      if (effect.kind === 'heal') this.tone(390, 780, .6, .3);
      else if (effect.kind === 'block') this.tone(650, 230, .22, .3, 'triangle');
      else if (effect.kind === 'shock') this.tone(130, 24, .65, .5, 'sawtooth');
      else if (effect.kind === 'dodge') this.tone(440, 150, .18, .16, 'triangle');
      else if (effect.kind === 'impact') this.tone(310, 58, .11, .24, 'triangle');
      else if (effect.kind === 'slash') this.tone(185, 62, .13, .12, 'triangle');
      else if (effect.kind === 'energy') this.tone(580, 820, .18, .12);
    }
    if (w.effects.length) this.lastEffect = Math.max(...w.effects.map(e => e.born));
    if (w.phase !== this.phase) {
      if (w.phase === 'PORTAL_ENTER') this.tone(180, 920, .9, .35);
      if (w.phase === 'BOSS') this.tone(150, 28, 1.1, .5, 'triangle');
      this.phase = w.phase;
    }
  }
  close() { void this.context?.close().catch(() => {}); }
}
