import * as THREE from 'three';

export const REALMS = [
  {
    name: 'AETHERIUM GOLD',
    cn: '苍穹鎏金',
    cssAccent: '#e6b973',
    cssAccentRgb: '230, 185, 115',
    skyVoid: '#020409',
    skyNebulaA: '#0b1629',
    skyNebulaB: '#23170e',
    horizonGlow: '#2b1f14',
    fogColor: '#04060c',
    coreDeep: '#3a0e04',
    coreMid: '#e86f1c',
    coreHot: '#ffe39e',
    coreRim: '#63e5ff',
    metalPrimary: '#e0b472',
    metalSecondary: '#1f2532',
    crystalTint: '#eef8ff',
    crystalAttenuation: '#ffdba6',
    particleSlow: '#d97828',
    particleFast: '#fff1c9',
    particleAccent: '#5ce6ff',
    beamColor: '#ffdfa8',
    floorGlow: '#e8b05c',
    chordNotes: [65.41, 98.0, 146.83, 196.0, 246.94, 329.63], // C2 Lydian ethereal
    ior: 1.58,
  },
  {
    name: 'ABYSSAL BIOLUME',
    cn: '深渊幽蓝',
    cssAccent: '#4ef2d8',
    cssAccentRgb: '78, 242, 216',
    skyVoid: '#01050b',
    skyNebulaA: '#061d38',
    skyNebulaB: '#160d2e',
    horizonGlow: '#072638',
    fogColor: '#020710',
    coreDeep: '#04132e',
    coreMid: '#0ca4d4',
    coreHot: '#7effe8',
    coreRim: '#b388ff',
    metalPrimary: '#b5d6e8',
    metalSecondary: '#121c2b',
    crystalTint: '#dcfffb',
    crystalAttenuation: '#6ee7ff',
    particleSlow: '#1264c4',
    particleFast: '#94fff0',
    particleAccent: '#c18cff',
    beamColor: '#7af5ff',
    floorGlow: '#32e6d2',
    chordNotes: [58.27, 87.31, 130.81, 174.61, 233.08, 311.13], // Bb minor9 deep sea
    ior: 1.52,
  },
  {
    name: 'SOLAR ECLIPSE',
    cn: '日冕黑曜',
    cssAccent: '#ff7142',
    cssAccentRgb: '255, 113, 66',
    skyVoid: '#050204',
    skyNebulaA: '#24070b',
    skyNebulaB: '#1c0e06',
    horizonGlow: '#330d08',
    fogColor: '#070305',
    coreDeep: '#090204',
    coreMid: '#d92914',
    coreHot: '#ffbe6b',
    coreRim: '#ff477e',
    metalPrimary: '#d9845b',
    metalSecondary: '#181114',
    crystalTint: '#fff0eb',
    crystalAttenuation: '#ff8e63',
    particleSlow: '#b81d18',
    particleFast: '#ffd28a',
    particleAccent: '#ff5286',
    beamColor: '#ff8a54',
    floorGlow: '#ff5e2b',
    chordNotes: [55.0, 82.41, 123.47, 164.81, 220.0, 277.18], // A cosmic eclipse
    ior: 1.66,
  },
  {
    name: 'PRISMATIC OPAL',
    cn: '虹彩圣晶',
    cssAccent: '#e2b8ff',
    cssAccentRgb: '226, 184, 255',
    skyVoid: '#04040a',
    skyNebulaA: '#171332',
    skyNebulaB: '#0c242e',
    horizonGlow: '#211936',
    fogColor: '#05050d',
    coreDeep: '#1b1138',
    coreMid: '#7c74ff',
    coreHot: '#ffe6fa',
    coreRim: '#75ffea',
    metalPrimary: '#ebd8e8',
    metalSecondary: '#1d1f30',
    crystalTint: '#ffffff',
    crystalAttenuation: '#e5caff',
    particleSlow: '#7768ff',
    particleFast: '#fff0fc',
    particleAccent: '#75ffea',
    beamColor: '#ebd4ff',
    floorGlow: '#c99eff',
    chordNotes: [73.42, 110.0, 164.81, 220.0, 277.18, 369.99], // D major9 crystalline
    ior: 1.72,
  },
];

export function createPaletteState(initialIndex = 0) {
  const src = REALMS[initialIndex];
  const colorKeys = [
    'skyVoid',
    'skyNebulaA',
    'skyNebulaB',
    'horizonGlow',
    'fogColor',
    'coreDeep',
    'coreMid',
    'coreHot',
    'coreRim',
    'metalPrimary',
    'metalSecondary',
    'crystalTint',
    'crystalAttenuation',
    'particleSlow',
    'particleFast',
    'particleAccent',
    'beamColor',
    'floorGlow',
  ];

  const current = {};
  const target = {};
  for (const k of colorKeys) {
    current[k] = new THREE.Color(src[k]);
    target[k] = new THREE.Color(src[k]);
  }
  current.ior = src.ior;
  target.ior = src.ior;

  return {
    index: initialIndex,
    current,
    target,
    colorKeys,
    setRealm(idx) {
      const r = REALMS[idx];
      this.index = idx;
      for (const k of colorKeys) {
        this.target[k].set(r[k]);
      }
      this.target.ior = r.ior;
      document.documentElement.style.setProperty('--accent', r.cssAccent);
      document.documentElement.style.setProperty('--accent-rgb', r.cssAccentRgb);
    },
    update(dt) {
      const alpha = 1.0 - Math.exp(-dt * 2.6);
      for (const k of colorKeys) {
        this.current[k].lerp(this.target[k], alpha);
      }
      this.current.ior += (this.target.ior - this.current.ior) * alpha;
    },
  };
}
