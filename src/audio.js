import { REALMS } from './palettes.js';

/**
 * Pure Web Audio API Generative Celestial Soundscape Engine.
 * Zero external audio files — synthesizes warm harmonic pads, cosmic shimmer, and supernova sub-drops.
 */
export function createSpatialAudio() {
  let ctx = null;
  let masterGain = null;
  let padFilter = null;
  let shimmerGain = null;
  let voices = [];
  let enabled = false;
  let currentRealm = 0;

  function init() {
    if (ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    ctx = new AudioCtx();

    masterGain = ctx.createGain();
    masterGain.gain.value = 0.0001;
    masterGain.connect(ctx.destination);

    // Stereo feedback delay space network (ethereal cathedral tail)
    const delayL = ctx.createDelay(1.0);
    const delayR = ctx.createDelay(1.0);
    delayL.delayTime.value = 0.37;
    delayR.delayTime.value = 0.53;

    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.value = 0.42;
    fbR.gain.value = 0.42;

    const merger = ctx.createChannelMerger(2);
    delayL.connect(fbL);
    fbL.connect(delayR);
    delayR.connect(fbR);
    fbR.connect(delayL);

    delayL.connect(merger, 0, 0);
    delayR.connect(merger, 0, 1);

    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.36;
    merger.connect(wetGain);
    wetGain.connect(masterGain);

    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 420;
    padFilter.Q.value = 1.4;
    padFilter.connect(masterGain);
    padFilter.connect(delayL);

    const notes = REALMS[currentRealm].chordNotes;
    voices = notes.map((freq, idx) => {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const vGain = ctx.createGain();

      osc.type = idx < 2 ? 'sine' : 'triangle';
      osc2.type = 'sine';

      osc.frequency.value = freq;
      osc2.frequency.value = freq * 1.0035; // lush slow chorusing detune

      vGain.gain.value = idx < 2 ? 0.11 : 0.045 / (1 + idx * 0.22);

      osc.connect(vGain);
      osc2.connect(vGain);
      vGain.connect(padFilter);

      osc.start();
      osc2.start();
      return { osc, osc2, vGain };
    });

    // High harmonic shimmer voice modulated by mouse velocity
    const shimOsc = ctx.createOscillator();
    shimmerGain = ctx.createGain();
    shimOsc.type = 'sine';
    shimOsc.frequency.value = notes[5] * 2.0;
    shimmerGain.gain.value = 0.0;
    shimOsc.connect(shimmerGain);
    shimmerGain.connect(delayL);
    shimOsc.start();
    voices.shimmerOsc = shimOsc;
  }

  return {
    get isEnabled() {
      return enabled;
    },
    toggle() {
      if (!ctx) init();
      if (!ctx) return false;
      if (ctx.state === 'suspended') ctx.resume();

      enabled = !enabled;
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setTargetAtTime(enabled ? 0.42 : 0.0001, now, 0.35);
      return enabled;
    },
    setRealm(realmIdx) {
      currentRealm = realmIdx;
      if (!ctx) return;
      const now = ctx.currentTime;
      const notes = REALMS[realmIdx].chordNotes;
      voices.forEach((v, i) => {
        if (notes[i]) {
          v.osc.frequency.setTargetAtTime(notes[i], now, 0.45);
          v.osc2.frequency.setTargetAtTime(notes[i] * 1.0035, now, 0.45);
        }
      });
      if (voices.shimmerOsc) {
        voices.shimmerOsc.frequency.setTargetAtTime(notes[5] * 2.0, now, 0.45);
      }
    },
    triggerPulse(intensity = 1.0) {
      if (!ctx || !enabled) return;
      const now = ctx.currentTime;

      // Sub-bass gravitational drop + harmonic crystal bell
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(78 * (0.85 + intensity * 0.35), now);
      sub.frequency.exponentialRampToValueAtTime(28, now + 1.4);

      subGain.gain.setValueAtTime(0.32 * intensity, now);
      subGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);

      sub.connect(subGain);
      subGain.connect(masterGain);
      sub.start(now);
      sub.stop(now + 1.65);

      const notes = REALMS[currentRealm].chordNotes;
      [3, 4, 5].forEach((idx, step) => {
        const bell = ctx.createOscillator();
        const bGain = ctx.createGain();
        bell.type = 'sine';
        bell.frequency.value = notes[idx] * 2.0;

        const t0 = now + step * 0.065;
        bGain.gain.setValueAtTime(0.0001, t0);
        bGain.gain.linearRampToValueAtTime(0.07 * intensity, t0 + 0.02);
        bGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);

        bell.connect(bGain);
        bGain.connect(padFilter);
        bell.start(t0);
        bell.stop(t0 + 1.85);
      });
    },
    update(cursorSpeed, charge) {
      if (!ctx || !enabled) return;
      const now = ctx.currentTime;
      const cutoff = 340 + Math.min(cursorSpeed * 95, 950) + charge * 1400;
      padFilter.frequency.setTargetAtTime(cutoff, now, 0.08);
      if (shimmerGain) {
        const sLevel = Math.min(cursorSpeed * 0.006 + charge * 0.05, 0.075);
        shimmerGain.gain.setTargetAtTime(sLevel, now, 0.1);
      }
    },
  };
}
