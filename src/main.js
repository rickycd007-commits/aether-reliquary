import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPaletteState } from './palettes.js';
import {
  buildStudioEnvironment,
  createSkyDome,
  createMirrorFloor,
  createArchitecture,
} from './environment.js';
import { createReliquary } from './reliquary.js';
import { createGPGPUParticles } from './gpgpuParticles.js';
import { createPostProcessing } from './postprocessing.js';
import { createSpatialAudio } from './audio.js';

// ============================================================================
// 1. RENDERER, SCENE & CAMERA INITIALIZATION
// ============================================================================
const container = document.getElementById('canvas-container');
const introBar = document.getElementById('intro-bar');
const introCurtain = document.getElementById('intro-curtain');
if (introBar) introBar.style.width = '68%';

const renderer = new THREE.WebGLRenderer({
  powerPreference: 'high-performance',
  antialias: false, // Handled by 4x MSAA HalfFloat HDR RenderTarget in EffectComposer
  stencil: false,
});
const getDPR = () => Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(getDPR());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const palette = createPaletteState(0);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(palette.current.fogColor.getHex(), 0.0145);

const camera = new THREE.PerspectiveCamera(
  44,
  window.innerWidth / Math.max(window.innerHeight, 1),
  0.15,
  260
);
// Start slightly further out for a majestic opening glide-in
camera.position.set(0.0, 3.6, 17.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.045;
controls.rotateSpeed = 0.72;
controls.zoomSpeed = 0.85;
controls.panSpeed = 0.65;
controls.minDistance = 2.55;
controls.maxDistance = 28.0;
controls.maxPolarAngle = Math.PI * 0.565; // Allows dramatic low-angle grazing right above y = -4.2 mirror floor
controls.target.set(0, 0.15, 0);

// ============================================================================
// 2. ENVIRONMENT, HERO RELIQUARY, 65K GPGPU PARTICLES & LIGHTING
// ============================================================================
scene.environment = buildStudioEnvironment(renderer);

const skyDome = createSkyDome(palette);
scene.add(skyDome.mesh);

const mirrorFloor = createMirrorFloor(palette);
scene.add(mirrorFloor.mesh);

const architecture = createArchitecture(palette);
scene.add(architecture.group);

const reliquary = createReliquary(palette);
scene.add(reliquary.root);

const particles = createGPGPUParticles(renderer, palette);
scene.add(particles.group);

// Dynamic Cinematographer Lights
const corePointLight = new THREE.PointLight(palette.current.coreHot, 12.5, 28.0, 1.5);
corePointLight.position.set(0, 0.2, 0);
scene.add(corePointLight);

const rimLightA = new THREE.DirectionalLight(palette.current.coreRim, 2.2);
rimLightA.position.set(-10, 9, -8);
scene.add(rimLightA);

const keyLightB = new THREE.DirectionalLight(palette.current.metalPrimary, 1.9);
keyLightB.position.set(9, 11, 8);
scene.add(keyLightB);

// Interactive 3D Cursor Light Wand + Subtle Luminous Locus Sprite
const cursorLight = new THREE.PointLight(palette.current.coreRim, 5.5, 11.0, 1.8);
scene.add(cursorLight);

const cursorLocusMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uColor: { value: palette.current.coreRim.clone() },
    uIntensity: { value: 0.45 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      mv.xy += position.xy;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uIntensity;
    varying vec2 vUv;
    void main() {
      vec2 p = (vUv - 0.5) * 2.0;
      float r = length(p);
      if (r > 1.0) discard;
      float core = exp(-r * 8.5);
      float thinRing = smoothstep(0.045, 0.0, abs(r - 0.58)) * 0.42;
      float alpha = (core * 0.85 + thinRing) * uIntensity;
      gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.65), alpha);
    }
  `,
});
const cursorLocus = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.68), cursorLocusMat);
scene.add(cursorLocus);

const post = createPostProcessing(renderer, scene, camera);
const audio = createSpatialAudio();

// ============================================================================
// 3. CAMERA DIRECTOR PRESETS & SMOOTH INTERRUPTIBLE TRANSITIONS
// ============================================================================
const CAMERA_PRESETS = [
  { pos: new THREE.Vector3(0.0, 1.85, 14.2), target: new THREE.Vector3(0, 0.15, 0) }, // 0: 圣殿全景 Sanctuary Wide
  { pos: new THREE.Vector3(1.85, 0.62, 4.35), target: new THREE.Vector3(0, 0.05, 0) }, // 1: 奇点微距 Macro Refraction
  { pos: new THREE.Vector3(0.01, 15.2, 0.85), target: new THREE.Vector3(0, 0.0, 0) }, // 2: 天顶星盘 Zenith Sacred Mandala
  { pos: new THREE.Vector3(-5.2, -3.35, 12.8), target: new THREE.Vector3(0, 0.55, 0) }, // 3: 掠水仰视 Abyssal Mirror Graze
];

let camTransition = {
  active: true,
  progress: 0,
  duration: 2.3,
  fromPos: camera.position.clone(),
  toPos: CAMERA_PRESETS[0].pos.clone(),
  fromTarget: controls.target.clone(),
  toTarget: CAMERA_PRESETS[0].target.clone(),
};

function flyToCameraPreset(idx, duration = 1.65) {
  const preset = CAMERA_PRESETS[idx];
  if (!preset) return;
  camTransition = {
    active: true,
    progress: 0,
    duration,
    fromPos: camera.position.clone(),
    toPos: preset.pos.clone(),
    fromTarget: controls.target.clone(),
    toTarget: preset.target.clone(),
  };
  document.querySelectorAll('#camera-buttons .dock-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });
}

// Immediately yield camera control if user manually drags or scrolls
controls.addEventListener('start', () => {
  camTransition.active = false;
});

// ============================================================================
// 4. INTERACTIVE 3D CURSOR FORCE-FIELD, CHARGE & SUPERNOVA SHOCKWAVE
// ============================================================================
const pointerNDC = new THREE.Vector2(0.18, 0.12);
const raycaster = new THREE.Raycaster();
const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const planeNormal = new THREE.Vector3();
const rawCursor3D = new THREE.Vector3(1.8, 0.8, 1.5);
const cursor3D = new THREE.Vector3(1.8, 0.8, 1.5);
const prevCursor3D = new THREE.Vector3(1.8, 0.8, 1.5);
const cursorVel = new THREE.Vector3();

const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 4.2);
const floorHit = new THREE.Vector3();

let isCharging = false;
let chargeLevel = 0.0;
let shockwaveTime = 99.0; // > 6 means inactive
let pointerDownPos = { x: 0, y: 0 };
let pointerMoved = false;
let pointerHoldTimer = null;

const params = {
  turbulence: 1.0,
  aperture: 0.35,
  dispersion: 5.5,
  vortex: 1.0,
  bloom: 0.48,
  tempo: 1.0,
};

function startCharge() {
  isCharging = true;
  document.getElementById('btn-pulse')?.classList.add('charging');
}

function releaseSupernova(minBoost = 0.35) {
  if (!isCharging && minBoost <= 0) return;
  const strength = Math.max(chargeLevel, minBoost);
  isCharging = false;
  document.getElementById('btn-pulse')?.classList.remove('charging');

  shockwaveTime = 0.001;
  mirrorFloor.triggerRipple(0, 0, 1.15 + strength * 0.9, clock.elapsedTime);
  audio.triggerPulse(0.65 + strength * 0.55);
}

window.addEventListener('pointermove', (e) => {
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

  const dx = e.clientX - pointerDownPos.x;
  const dy = e.clientY - pointerDownPos.y;
  if (Math.hypot(dx, dy) > 7) {
    pointerMoved = true;
    if (pointerHoldTimer) {
      clearTimeout(pointerHoldTimer);
      pointerHoldTimer = null;
    }
    // If user starts orbiting before deep charge, cancel charge cleanly
    if (isCharging && chargeLevel < 0.22) {
      isCharging = false;
      document.getElementById('btn-pulse')?.classList.remove('charging');
    }
  }
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pointerDownPos = { x: e.clientX, y: e.clientY };
  pointerMoved = false;

  if (pointerHoldTimer) clearTimeout(pointerHoldTimer);
  pointerHoldTimer = setTimeout(() => {
    if (!pointerMoved) {
      startCharge();
    }
  }, 210);
});

window.addEventListener('pointerup', () => {
  if (pointerHoldTimer) {
    clearTimeout(pointerHoldTimer);
    pointerHoldTimer = null;
  }
  if (isCharging) {
    releaseSupernova(0.45);
  } else if (!pointerMoved) {
    // Crisp tap/click sends a localized harmonic ripple on the obsidian mirror floor & subtle core pulse
    raycaster.setFromCamera(pointerNDC, camera);
    if (raycaster.ray.intersectPlane(floorPlane, floorHit) && floorHit.length() < 32) {
      mirrorFloor.triggerRipple(floorHit.x, floorHit.z, 0.85, clock.elapsedTime);
    } else {
      mirrorFloor.triggerRipple(cursor3D.x * 0.6, cursor3D.z * 0.6, 0.75, clock.elapsedTime);
    }
    if (shockwaveTime > 1.2) shockwaveTime = 0.001;
    audio.triggerPulse(0.45);
  }
});

// ============================================================================
// 5. UI CONTROLS & KEYBOARD BINDINGS
// ============================================================================
function selectRealm(idx) {
  palette.setRealm(idx);
  audio.setRealm(idx);
  document.querySelectorAll('#realm-buttons .dock-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });
  mirrorFloor.triggerRipple(0, 0, 0.9, clock.elapsedTime);
}

document.querySelectorAll('#realm-buttons .dock-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectRealm(Number(btn.dataset.realm)));
});

document.querySelectorAll('#camera-buttons .dock-btn').forEach((btn) => {
  btn.addEventListener('click', () => flyToCameraPreset(Number(btn.dataset.cam)));
});

const pulseBtn = document.getElementById('btn-pulse');
pulseBtn?.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  startCharge();
});
pulseBtn?.addEventListener('pointerup', (e) => {
  e.stopPropagation();
  releaseSupernova(0.65);
});
pulseBtn?.addEventListener('pointerleave', () => {
  if (isCharging) releaseSupernova(0.5);
});

// Audio Toggle
const btnAudio = document.getElementById('btn-audio');
const soundBars = document.getElementById('sound-bars');
const audioLabel = document.getElementById('audio-label');
function toggleAudioUI() {
  const on = audio.toggle();
  btnAudio?.classList.toggle('active', on);
  soundBars?.classList.toggle('playing', on);
  if (audioLabel) audioLabel.textContent = on ? 'SOUND ON' : 'SOUND OFF';
}
btnAudio?.addEventListener('click', toggleAudioUI);

// Collapsible Optics Lab Drawer
const opticsPanel = document.getElementById('optics-panel');
const btnLab = document.getElementById('btn-lab');
const toggleLab = () => {
  opticsPanel?.classList.toggle('hidden');
  btnLab?.classList.toggle('active', !opticsPanel?.classList.contains('hidden'));
};
btnLab?.addEventListener('click', toggleLab);
document.getElementById('btn-close-lab')?.addEventListener('click', toggleLab);

function bindSlider(id, valId, key, digits = 2) {
  const el = document.getElementById(id);
  const label = document.getElementById(valId);
  el?.addEventListener('input', () => {
    const v = parseFloat(el.value);
    params[key] = v;
    if (label) label.textContent = v.toFixed(digits);
  });
}
bindSlider('slider-turbulence', 'val-turbulence', 'turbulence');
bindSlider('slider-aperture', 'val-aperture', 'aperture');
bindSlider('slider-dispersion', 'val-dispersion', 'dispersion');
bindSlider('slider-vortex', 'val-vortex', 'vortex');
bindSlider('slider-bloom', 'val-bloom', 'bloom');
bindSlider('slider-tempo', 'val-tempo', 'tempo');

// Pure Cinema Mode HUD Toggle
const hudEl = document.getElementById('hud');
const btnRestoreHud = document.getElementById('btn-restore-hud');
function toggleHud() {
  const hidden = hudEl?.classList.toggle('hud-hidden');
  btnRestoreHud?.classList.toggle('hidden', !hidden);
}
document.getElementById('btn-hide-hud')?.addEventListener('click', toggleHud);
btnRestoreHud?.addEventListener('click', toggleHud);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space') {
    e.preventDefault();
    startCharge();
  } else if (e.key === '1') selectRealm(0);
  else if (e.key === '2') selectRealm(1);
  else if (e.key === '3') selectRealm(2);
  else if (e.key === '4') selectRealm(3);
  else if (e.key === 'h' || e.key === 'H') toggleHud();
  else if (e.key === 'l' || e.key === 'L') toggleLab();
  else if (e.key === 'm' || e.key === 'M') toggleAudioUI();
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    releaseSupernova(0.65);
  }
});

// ============================================================================
// 6. RESIZE & MAIN ANIMATION LOOP
// ============================================================================
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = Math.max(window.innerHeight, 1);
  const dpr = getDPR();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  post.onResize(w, h, dpr);
  particles.onResize(dpr);
});

const telFlux = document.getElementById('tel-flux');
const telIor = document.getElementById('tel-ior');
const telFps = document.getElementById('tel-fps');
const chargeFill = document.getElementById('charge-fill');
const chargePct = document.getElementById('charge-pct');

const clock = new THREE.Clock();
let fpsFrames = 0;
let fpsAccum = 0;
let lastHeartbeat = 0;

// Reveal Curtain gracefully once shaders compile on first frame
renderer.compile(scene, camera);
if (introBar) introBar.style.width = '100%';
setTimeout(() => {
  introCurtain?.classList.add('fade-out');
}, 420);

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  // 1. Update smooth Realm Palette interpolation & Scene Fog
  palette.update(dt);
  scene.fog.color.copy(palette.current.fogColor);

  // 2. Smooth Camera Preset Choreography (if active)
  if (camTransition.active) {
    camTransition.progress = Math.min(1, camTransition.progress + dt / camTransition.duration);
    const k = easeOutCubic(camTransition.progress);
    camera.position.lerpVectors(camTransition.fromPos, camTransition.toPos, k);
    controls.target.lerpVectors(camTransition.fromTarget, camTransition.toTarget, k);
    if (camTransition.progress >= 1) {
      camTransition.active = false;
    }
  }
  controls.update();
  // Guarantee camera never dips below obsidian water mirror plane
  if (camera.position.y < -3.75) camera.position.y = -3.75;

  // 3. Project 2D Pointer into 3D Sanctuary Volume
  camera.getWorldDirection(planeNormal).negate();
  interactionPlane.setFromNormalAndCoplanarPoint(planeNormal, controls.target);
  raycaster.setFromCamera(pointerNDC, camera);
  if (raycaster.ray.intersectPlane(interactionPlane, rawCursor3D)) {
    rawCursor3D.clampLength(0, 9.5);
    if (rawCursor3D.y < -3.6) rawCursor3D.y = -3.6;
  }

  prevCursor3D.copy(cursor3D);
  cursor3D.lerp(rawCursor3D, 1.0 - Math.exp(-dt * 11.0));
  cursorVel.subVectors(cursor3D, prevCursor3D).divideScalar(Math.max(dt, 0.001));
  const cursorSpeed = cursorVel.length();

  // 4. Update Singularity Charge & Supernova Shockwave Timer
  if (isCharging) {
    chargeLevel = Math.min(1.0, chargeLevel + dt * 0.72);
  } else {
    chargeLevel = Math.max(0.0, chargeLevel - dt * 2.4);
  }

  if (shockwaveTime < 8.0) {
    shockwaveTime += dt;
  }
  const activeShock = shockwaveTime < 6.0 ? shockwaveTime : 0.0;

  // Ambient sanctuary heartbeat ripple every ~5.5s
  if (elapsed - lastHeartbeat > 5.5) {
    lastHeartbeat = elapsed;
    mirrorFloor.triggerRipple(0, 0, 0.42, elapsed);
  }

  // 5. Update Dynamic Lights
  corePointLight.color.copy(palette.current.coreHot);
  corePointLight.intensity =
    12.5 + Math.sin(elapsed * 2.2) * 1.6 + chargeLevel * 16.0 + Math.exp(-shockwaveTime * 2.5) * 12.0;
  rimLightA.color.copy(palette.current.coreRim);
  keyLightB.color.copy(palette.current.metalPrimary);

  cursorLight.position.copy(cursor3D);
  cursorLight.color.copy(palette.current.coreRim);
  cursorLight.intensity = 4.5 + Math.min(cursorSpeed * 0.35, 5.5) + chargeLevel * 5.5;

  cursorLocus.position.copy(cursor3D);
  cursorLocusMat.uniforms.uColor.value.copy(palette.current.coreRim);
  cursorLocusMat.uniforms.uIntensity.value =
    0.32 + Math.min(cursorSpeed * 0.045, 0.48) + chargeLevel * 0.4;

  // 6. Update World Systems
  skyDome.update(elapsed, palette);
  mirrorFloor.update(elapsed, palette, cursor3D, chargeLevel);
  architecture.update(elapsed, palette, chargeLevel);

  reliquary.update({
    time: elapsed,
    dt,
    paletteState: palette,
    cursor3D,
    charge: chargeLevel,
    shockwave: activeShock,
    turbulence: params.turbulence,
    aperture: params.aperture,
    dispersion: params.dispersion,
    tempo: params.tempo,
  });

  particles.update({
    time: elapsed,
    dt,
    paletteState: palette,
    cursor3D,
    cursorVel,
    charge: chargeLevel,
    shockwave: activeShock,
    vortex: params.vortex,
  });

  audio.update(cursorSpeed, chargeLevel);
  post.update(elapsed, chargeLevel, activeShock, params.bloom);

  // 7. Update HUD Telemetry
  const displayCharge = Math.round(chargeLevel * 100);
  if (chargeFill) chargeFill.style.height = `${Math.max(6, displayCharge)}%`;
  if (chargePct) chargePct.textContent = `${String(displayCharge).padStart(2, '0')}%`;

  fpsFrames++;
  fpsAccum += dt;
  if (fpsAccum >= 0.35) {
    const fps = Math.round(fpsFrames / fpsAccum);
    if (telFps) telFps.textContent = `${fps} FPS`;
    if (telFlux) telFlux.textContent = `${(1.0 + chargeLevel * 2.4 + cursorSpeed * 0.03).toFixed(3)} Ψ`;
    if (telIor) telIor.textContent = `IOR ${palette.current.ior.toFixed(2)}`;
    fpsFrames = 0;
    fpsAccum = 0;
  }

  // 8. Render HDR Post-Processing Pipeline
  post.render();
}

animate();
