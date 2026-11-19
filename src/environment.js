import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise.glsl.js';

/**
 * Generates a high-contrast HDR light-stage + celestial environment map via PMREMGenerator
 * so transmissive crystal, dispersion prisms, and satin gold rings gleam with realistic speculars.
 */
export function buildStudioEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x03050a);

  const addPanel = (pos, lookAt, w, h, color, intensity) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.lookAt(lookAt);
    envScene.add(mesh);
  };

  const origin = new THREE.Vector3(0, 0, 0);
  // Zenith warm halo ring
  const ringGeo = new THREE.RingGeometry(5.5, 7.2, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffe0a8).multiplyScalar(7.5),
    side: THREE.DoubleSide,
  });
  const zenithRing = new THREE.Mesh(ringGeo, ringMat);
  zenithRing.position.set(0, 14, 0);
  zenithRing.rotation.x = Math.PI * 0.5;
  envScene.add(zenithRing);

  // Key warm champagne softbox strip
  addPanel(new THREE.Vector3(12, 8, 10), origin, 10, 18, 0xffd596, 5.5);
  // Rim cool celestial cyan softbox strip
  addPanel(new THREE.Vector3(-13, 6, -9), origin, 9, 18, 0x5fe2ff, 4.8);
  // Secondary violet-pearl accent strip for dispersion richness
  addPanel(new THREE.Vector3(-8, -5, 13), origin, 12, 4.5, 0xb89eff, 2.8);
  // Warm floor bounce strip
  addPanel(new THREE.Vector3(6, -10, -8), origin, 14, 6, 0xe89c4a, 2.2);

  const envRT = pmrem.fromScene(envScene, 0.035);
  pmrem.dispose();
  return envRT.texture;
}

/**
 * Deep Cosmic Nebula & Multi-Temperature Starfield Sky Dome
 */
export function createSkyDome(palette) {
  const uniforms = {
    uTime: { value: 0 },
    uVoidColor: { value: palette.current.skyVoid.clone() },
    uNebulaA: { value: palette.current.skyNebulaA.clone() },
    uNebulaB: { value: palette.current.skyNebulaB.clone() },
    uHorizonColor: { value: palette.current.horizonGlow.clone() },
  };

  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uVoidColor;
      uniform vec3 uNebulaA;
      uniform vec3 uNebulaB;
      uniform vec3 uHorizonColor;
      varying vec3 vWorldDir;

      ${NOISE_GLSL}

      float starHash(vec3 p) {
        p = fract(p * vec3(443.8975, 397.2973, 491.1871));
        p += dot(p.zxy, p.yxz + 19.19);
        return fract(p.x * p.y * p.z);
      }

      float starLayer(vec3 dir, float scale, float threshold) {
        vec3 grid = floor(dir * scale);
        vec3 f = fract(dir * scale) - 0.5;
        float h = starHash(grid);
        if (h < threshold) return 0.0;
        vec3 jitter = (vec3(starHash(grid + 1.1), starHash(grid + 2.3), starHash(grid + 3.7)) - 0.5) * 0.55;
        float d = length(f - jitter);
        float twinkle = 0.72 + 0.28 * sin(uTime * (1.5 + h * 4.0) + h * 60.0);
        float core = smoothstep(0.16, 0.0, d) * pow((h - threshold) / (1.0 - threshold), 1.6);
        return core * twinkle;
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float elev = clamp(dir.y, -1.0, 1.0);

        // Slow drifting FBM nebula clouds
        vec3 np = dir * 2.2 + vec3(uTime * 0.008, -uTime * 0.005, uTime * 0.006);
        float n1 = fbm3(np);
        float n2 = fbm3(np * 1.9 + vec3(4.2, -2.1, 7.4) + n1 * 0.65);

        vec3 col = uVoidColor;
        float nebulaMaskA = smoothstep(-0.15, 0.75, n1) * smoothstep(-0.2, 0.65, elev + 0.35);
        float nebulaMaskB = smoothstep(-0.05, 0.80, n2) * (1.0 - abs(elev) * 0.55);

        col = mix(col, uNebulaA * 1.45, nebulaMaskA * 0.65);
        col = mix(col, uNebulaB * 1.35, nebulaMaskB * 0.48);

        // Horizon atmospheric band seamlessly bridging sky & mirror floor at elev = 0
        float lowerMask = smoothstep(0.06, -0.12, elev);
        col = mix(col, uVoidColor, lowerMask);
        float horizonBand = exp(-pow(elev * 7.5, 2.0));
        col += uHorizonColor * horizonBand * 0.52;

        // Crisp multi-temperature starfield above horizon
        float skyVis = smoothstep(0.02, 0.26, elev);
        float s1 = starLayer(dir, 145.0, 0.972);
        float s2 = starLayer(dir + vec3(0.31, 0.17, 0.53), 260.0, 0.985);
        float temp = starHash(floor(dir * 145.0) + 9.2);
        vec3 starTint = mix(vec3(0.72, 0.86, 1.0), vec3(1.0, 0.86, 0.66), temp);

        col += starTint * (s1 * 1.65 + s2 * 0.95) * skyVis;

        gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(120, 48, 32), mat);
  return {
    mesh,
    update(time, paletteState) {
      uniforms.uTime.value = time;
      uniforms.uVoidColor.value.copy(paletteState.current.skyVoid);
      uniforms.uNebulaA.value.copy(paletteState.current.skyNebulaA);
      uniforms.uNebulaB.value.copy(paletteState.current.skyNebulaB);
      uniforms.uHorizonColor.value.copy(paletteState.current.horizonGlow);
    },
  };
}

/**
 * Abyssal Obsidian Water-Mirror Floor with Sacred Astrolabe Etchings, Caustics & Interactive Ripples
 */
export function createMirrorFloor(palette) {
  const MAX_RIPPLES = 6;
  const ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
  let rippleCursor = 0;

  const uniforms = {
    uTime: { value: 0 },
    uFloorGlow: { value: palette.current.floorGlow.clone() },
    uRimColor: { value: palette.current.coreRim.clone() },
    uVoidColor: { value: palette.current.skyVoid.clone() },
    uHorizonColor: { value: palette.current.horizonGlow.clone() },
    uCursor3D: { value: new THREE.Vector3() },
    uCharge: { value: 0 },
    uRipples: { value: ripples },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFloorGlow;
      uniform vec3 uRimColor;
      uniform vec3 uVoidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uCursor3D;
      uniform float uCharge;
      uniform vec4 uRipples[6];

      varying vec3 vWorldPos;

      ${NOISE_GLSL}

      void main() {
        vec2 p = vWorldPos.xz;
        float dist = length(p);
        float angle = atan(p.y, p.x);

        // Multi-ripple wave height & normal perturbation
        float waveSum = 0.0;
        vec2 waveGrad = vec2(0.0);
        for (int i = 0; i < 6; i++) {
          vec4 rp = uRipples[i];
          float age = uTime - rp.z;
          if (age > 0.0 && age < 6.5) {
            vec2 dp = p - rp.xy;
            float r = length(dp) + 1e-4;
            float radius = age * 6.8;
            float env = exp(-abs(r - radius) * 1.15) * exp(-age * 0.58) * rp.w;
            float phase = (r - radius) * 6.5;
            float w = sin(phase) * env;
            waveSum += w;
            waveGrad += (dp / r) * cos(phase) * env * 1.4;
          }
        }

        // Subtle ambient water micro-ripples
        float nA = snoise(vec3(p * 0.42 + vec2(uTime * 0.08, -uTime * 0.06), uTime * 0.14));
        float nB = snoise(vec3(p * 1.15 - vec2(uTime * 0.11, uTime * 0.09), uTime * 0.22));
        vec2 microGrad = vec2(nA, nB) * 0.09 + waveGrad * 0.28;

        vec3 N = normalize(vec3(-microGrad.x, 1.0, -microGrad.y));
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.2);

        // Base dark polished obsidian surface
        vec3 baseCol = mix(vec3(0.012, 0.015, 0.024), uVoidColor * 1.35, 0.5);

        // Virtual reflection of the central glowing core at (0, 0, 0) mirrored at (0, -8.4, 0)
        vec3 R = reflect(-V, N);
        vec3 toCore = normalize(vec3(0.0, 0.2, 0.0) - vWorldPos);
        float coreSpec = pow(max(dot(R, toCore), 0.0), 28.0);
        float coreWide = pow(max(dot(R, toCore), 0.0), 4.5);

        // Projected golden-cyan water caustics beneath the reliquary
        vec2 cp = p * 0.55 + microGrad * 1.6;
        float c1 = abs(snoise(vec3(cp, uTime * 0.25)));
        float c2 = abs(snoise(vec3(cp * 1.85 + 3.1, -uTime * 0.31)));
        float caustic = pow(1.0 - min(c1 + c2, 1.0), 5.2);
        float centerFalloff = exp(-dist * 0.19);

        // Sacred astronomical floor inlays (concentric rings + radial azimuth hairlines)
        float rRing1 = smoothstep(0.035, 0.0, abs(dist - 4.2));
        float rRing2 = smoothstep(0.035, 0.0, abs(dist - 7.8));
        float rRing3 = smoothstep(0.045, 0.0, abs(dist - 12.6));
        float rRing4 = smoothstep(0.055, 0.0, abs(dist - 15.5));
        float degTicks = smoothstep(0.985, 1.0, cos(angle * 72.0)) * smoothstep(0.32, 0.0, abs(dist - 7.8));
        float radials = smoothstep(0.9965, 1.0, cos(angle * 12.0)) * smoothstep(3.2, 4.5, dist) * smoothstep(18.0, 13.0, dist);
        float sacredInlay = (rRing1 * 0.8 + rRing2 * 0.9 + rRing3 * 0.55 + rRing4 * 0.5 + degTicks * 0.75 + radials * 0.45);

        // Traveling pulse on sacred inlays
        float inlayPulse = 0.55 + 0.45 * sin(dist * 1.2 - uTime * 2.2);

        // Cursor light reflection on floor
        float cursorDist = length(vWorldPos.xz - uCursor3D.xz);
        float cursorGlow = exp(-cursorDist * 0.45) * 0.35;

        vec3 glowCol = mix(uFloorGlow, uRimColor, 0.28 + 0.25 * sin(dist * 0.4 - uTime));
        vec3 col = baseCol;
        col += uFloorGlow * (coreSpec * 1.25 + coreWide * 0.22) * (1.0 + uCharge * 0.85);
        col += mix(uFloorGlow, uRimColor, 0.35) * caustic * centerFalloff * 0.72;
        col += glowCol * sacredInlay * inlayPulse * 0.52 * exp(-dist * 0.055);
        col += mix(uRimColor, uFloorGlow, 0.5) * abs(waveSum) * 1.35;
        col += uRimColor * cursorGlow;
        col += mix(uVoidColor, uFloorGlow * 0.25, 0.35) * fresnel * 0.45;

        // Seamless horizon blend matching sky dome's horizon glow at the far edge
        float horizonFade = smoothstep(76.0, 16.0, dist);
        vec3 farHorizon = uVoidColor + uHorizonColor * 0.50;
        col = mix(farHorizon, col, horizonFade);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const geo = new THREE.CircleGeometry(82, 128);
  geo.rotateX(-Math.PI * 0.5);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -4.2;

  return {
    mesh,
    triggerRipple(x, z, strength = 1.0, currentTime = 0) {
      ripples[rippleCursor].set(x, z, currentTime, strength);
      rippleCursor = (rippleCursor + 1) % MAX_RIPPLES;
    },
    update(time, paletteState, cursor3D, charge) {
      uniforms.uTime.value = time;
      uniforms.uFloorGlow.value.copy(paletteState.current.floorGlow);
      uniforms.uRimColor.value.copy(paletteState.current.coreRim);
      uniforms.uVoidColor.value.copy(paletteState.current.skyVoid);
      uniforms.uHorizonColor.value.copy(paletteState.current.horizonGlow);
      uniforms.uCursor3D.value.copy(cursor3D);
      uniforms.uCharge.value = charge;
    },
  };
}

/**
 * Sacred Basalt Monolith Colonnade & Volumetric Tyndall Light Shafts
 */
export function createArchitecture(palette) {
  const group = new THREE.Group();

  // Dark brushed basalt material for outer architectural monoliths
  const pillarMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x121621),
    metalness: 0.72,
    roughness: 0.26,
    clearcoat: 0.65,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.5,
  });

  const goldTrimMat = new THREE.MeshPhysicalMaterial({
    color: palette.current.metalPrimary.clone(),
    metalness: 0.95,
    roughness: 0.18,
    envMapIntensity: 2.1,
  });

  const filamentMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: palette.current.floorGlow.clone() },
      uColorB: { value: palette.current.coreRim.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vPhase;
      attribute float aPhase;
      void main() {
        vUv = uv;
        vPhase = aPhase;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vUv;
      varying float vPhase;
      void main() {
        float pulse = smoothstep(0.28, 0.0, abs(fract(vUv.y - uTime * 0.22 - vPhase) - 0.5));
        float edgeFade = sin(vUv.y * 3.14159265);
        vec3 col = mix(uColorA, uColorB, vUv.y);
        float alpha = (0.22 + pulse * 0.85) * edgeFade;
        gl_FragColor = vec4(col * 1.6, alpha);
      }
    `,
  });

  const COUNT = 12;
  const RADIUS = 15.5;
  const pillarGeo = new THREE.CylinderGeometry(0.24, 0.42, 13.5, 6);
  const capGeo = new THREE.OctahedronGeometry(0.32, 0);

  for (let i = 0; i < COUNT; i++) {
    const theta = (i / COUNT) * Math.PI * 2;
    const holder = new THREE.Group();
    holder.position.set(Math.cos(theta) * RADIUS, 2.3, Math.sin(theta) * RADIUS);
    holder.lookAt(0, 2.3, 0);

    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.rotation.z = 0.045; // Subtle monumental inward lean
    holder.add(pillar);

    // Floating золотой octahedron capstone above each monolith
    const cap = new THREE.Mesh(capGeo, goldTrimMat);
    cap.position.set(0, 7.55, 0);
    cap.userData.baseY = 7.55;
    cap.userData.phase = i * 0.65;
    holder.add(cap);

    // Thin glowing meridian light strip along the inner face pointing toward the core
    const stripGeo = new THREE.PlaneGeometry(0.055, 11.6);
    const phases = new Float32Array(stripGeo.attributes.position.count).fill(i / COUNT);
    stripGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    const strip = new THREE.Mesh(stripGeo, filamentMat);
    strip.position.set(0, 0.2, 0.36);
    holder.add(strip);

    group.add(holder);
  }

  // Volumetric Zenith God-Ray Cone (View-dependent soft Tyndall light shaft)
  const beamUniforms = {
    uTime: { value: 0 },
    uBeamColor: { value: palette.current.beamColor.clone() },
    uRimColor: { value: palette.current.coreRim.clone() },
    uCharge: { value: 0 },
  };

  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: beamUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uBeamColor;
      uniform vec3 uRimColor;
      uniform float uCharge;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;

      ${NOISE_GLSL}

      void main() {
        vec3 V = normalize(cameraPosition - vWorldPos);
        // Smooth edge attenuation so cone boundaries are completely invisible
        float facing = pow(abs(dot(normalize(vNormalW), V)), 2.35);
        float verticalFade = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.18, vUv.y);

        float angle = vUv.x * 6.2831853;
        float streaks = 0.55 + 0.45 * snoise(vec3(cos(angle) * 2.6, vUv.y * 2.2 - uTime * 0.12, sin(angle) * 2.6));
        float fineRays = 0.65 + 0.35 * sin(angle * 9.0 + uTime * 0.25);

        // Attenuate beam softly through the core zone so the hero crystal stays razor-crisp
        float zenithBias = smoothstep(0.08, 0.62, vUv.y);
        vec3 col = mix(uBeamColor, uRimColor, (1.0 - vUv.y) * 0.35);
        float intensity = facing * verticalFade * streaks * fineRays * (0.018 + zenithBias * 0.048 + uCharge * 0.055);
        gl_FragColor = vec4(col, intensity);
      }
    `,
  });

  const outerBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 8.8, 24, 64, 1, true), beamMat);
  outerBeam.position.y = 7.5;
  group.add(outerBeam);

  const innerBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 4.1, 22, 48, 1, true), beamMat);
  innerBeam.position.y = 6.8;
  group.add(innerBeam);

  return {
    group,
    update(time, paletteState, charge) {
      goldTrimMat.color.copy(paletteState.current.metalPrimary);
      pillarMat.color.copy(paletteState.current.metalSecondary).multiplyScalar(0.85);

      filamentMat.uniforms.uTime.value = time;
      filamentMat.uniforms.uColorA.value.copy(paletteState.current.floorGlow);
      filamentMat.uniforms.uColorB.value.copy(paletteState.current.coreRim);

      beamUniforms.uTime.value = time;
      beamUniforms.uBeamColor.value.copy(paletteState.current.beamColor);
      beamUniforms.uRimColor.value.copy(paletteState.current.coreRim);
      beamUniforms.uCharge.value = charge;

      // Levitate capstones gently
      for (const holder of group.children) {
        if (holder.children && holder.children[1] && holder.children[1].userData.baseY) {
          const cap = holder.children[1];
          cap.position.y = cap.userData.baseY + Math.sin(time * 1.4 + cap.userData.phase) * 0.14;
          cap.rotation.y = time * 0.6 + cap.userData.phase;
        }
      }
    },
  };
}
