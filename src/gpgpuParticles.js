import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise.glsl.js';

const SIM_SIZE = 256; // 256 x 256 = 65,536 GPU-simulated fluid particles

export function createGPGPUParticles(renderer, palette) {
  const supportsFloatRT = !!renderer.extensions.get('EXT_color_buffer_float');
  const texType = supportsFloatRT ? THREE.FloatType : THREE.HalfFloatType;

  const makeDataTex = (floatArr) => {
    let data = floatArr;
    if (!supportsFloatRT) {
      data = new Uint16Array(floatArr.length);
      for (let i = 0; i < floatArr.length; i++) {
        data[i] = THREE.DataUtils.toHalfFloat(floatArr[i]);
      }
    }
    const tex = new THREE.DataTexture(data, SIM_SIZE, SIM_SIZE, THREE.RGBAFormat, texType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  };

  // Initial positions (distributed in an artistic inclined spiral torus + spherical halo)
  const count = SIM_SIZE * SIM_SIZE;
  const posInit = new Float32Array(count * 4);
  const velInit = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const i4 = i * 4;
    // Sculpt 5 braided galactic silk ribbon streams with rich dark negative space between streams
    const streamIdx = i % 5;
    const streamPhase = (streamIdx / 5) * Math.PI * 2;
    const t = Math.random();
    const r = 2.15 + Math.pow(t, 0.85) * 6.6;
    const spiralAngle = streamPhase + r * 0.72 + (Math.random() - 0.5) * 0.38;

    const ribbonWidth = 0.24 + t * 0.38;
    const x = Math.cos(spiralAngle) * r + (Math.random() - 0.5) * ribbonWidth;
    const z = Math.sin(spiralAngle) * r + (Math.random() - 0.5) * ribbonWidth;
    const y =
      Math.sin(spiralAngle * 2.0 + streamIdx) * (0.55 + r * 0.14) +
      (Math.random() - 0.5) * ribbonWidth * 0.75;

    posInit[i4] = x;
    posInit[i4 + 1] = y;
    posInit[i4 + 2] = z;
    posInit[i4 + 3] = Math.random(); // lifecycle phase [0..1]

    velInit[i4] = -Math.sin(spiralAngle) * 0.65;
    velInit[i4 + 1] = (Math.random() - 0.5) * 0.12;
    velInit[i4 + 2] = Math.cos(spiralAngle) * 0.65;
    velInit[i4 + 3] = Math.random(); // per-particle immutable seed
  }

  const rtOptions = {
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: texType,
    depthBuffer: false,
    stencilBuffer: false,
  };

  let posRead = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, rtOptions);
  let posWrite = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, rtOptions);
  let velRead = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, rtOptions);
  let velWrite = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, rtOptions);

  const simScene = new THREE.Scene();
  const simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simQuadGeo = new THREE.PlaneGeometry(2, 2);

  // Copy helper to seed ping-pong targets
  const copyMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
    `,
    fragmentShader: `
      uniform sampler2D uTex;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D(uTex, vUv); }
    `,
  });

  const simQuad = new THREE.Mesh(simQuadGeo, copyMat);
  simScene.add(simQuad);

  const seedTarget = (tex, rt) => {
    copyMat.uniforms.uTex.value = tex;
    renderer.setRenderTarget(rt);
    renderer.render(simScene, simCam);
  };

  const initPosTex = makeDataTex(posInit);
  const initVelTex = makeDataTex(velInit);
  seedTarget(initPosTex, posRead);
  seedTarget(initPosTex, posWrite);
  seedTarget(initVelTex, velRead);
  seedTarget(initVelTex, velWrite);
  renderer.setRenderTarget(null);

  // =========================================================================
  // VELOCITY UPDATE SHADER (Curl Noise + Orbital Vortex + Cursor Force + Shock)
  // =========================================================================
  const velUniforms = {
    uPosTex: { value: posRead.texture },
    uVelTex: { value: velRead.texture },
    uTime: { value: 0 },
    uDt: { value: 0.016 },
    uVortexStrength: { value: 1.0 },
    uCursor3D: { value: new THREE.Vector3() },
    uCursorVel: { value: new THREE.Vector3() },
    uCharge: { value: 0 },
    uShockwave: { value: 0 },
  };

  const velMat = new THREE.ShaderMaterial({
    uniforms: velUniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uPosTex;
      uniform sampler2D uVelTex;
      uniform float uTime;
      uniform float uDt;
      uniform float uVortexStrength;
      uniform vec3 uCursor3D;
      uniform vec3 uCursorVel;
      uniform float uCharge;
      uniform float uShockwave;
      varying vec2 vUv;

      ${NOISE_GLSL}

      void main() {
        vec4 posData = texture2D(uPosTex, vUv);
        vec4 velData = texture2D(uVelTex, vUv);
        vec3 pos = posData.xyz;
        float life = posData.w;
        vec3 vel = velData.xyz;
        float seed = velData.w;

        // If particle just respawned (life near 0), reset velocity cleanly
        if (life < 0.015) {
          vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), pos + vec3(1e-4)));
          gl_FragColor = vec4(tang * (0.65 + seed * 0.45), seed);
          return;
        }

        float r = length(pos) + 1e-4;
        vec3 dir = pos / r;

        // 1. Inclined orbital Keplerian swirl around reliquary
        vec3 orbitAxis = normalize(vec3(sin(uTime * 0.14) * 0.22, 1.0, cos(uTime * 0.11) * 0.18));
        vec3 swirl = normalize(cross(orbitAxis, pos) + vec3(1e-5));
        float targetRadius = mix(3.4 + seed * 4.4, 1.55 + seed * 0.9, uCharge);
        float radialPull = (targetRadius - r) * (0.65 + uCharge * 3.8);

        // Gently flatten toward inclined orbital plane while keeping volumetric thickness
        float planeDist = dot(pos, orbitAxis);
        vec3 planeRestore = -orbitAxis * planeDist * (0.42 + 0.35 * seed);

        // 2. Multi-scale 3D Divergence-Free Curl Noise (coherent fluid silk ribbons)
        vec3 curl = curlNoise(pos * 0.24 + vec3(uTime * 0.08, -uTime * 0.06, uTime * 0.05));
        vec3 fineCurl = curlNoise(pos * 0.65 - vec3(uTime * 0.14));

        vec3 acc = swirl * (1.75 + uCharge * 3.4) * (2.8 / (1.1 + r * 0.38));
        acc += dir * radialPull;
        acc += planeRestore * 1.35;
        acc += (curl * 1.15 + fineCurl * 0.38) * uVortexStrength;

        // Core repulsion boundary so particles gracefully skim around the inner core
        float coreGuard = smoothstep(1.65, 1.05, r);
        acc += dir * coreGuard * 6.5;

        // Floor guard above obsidian water mirror (y = -4.05)
        if (pos.y < -3.85) {
          acc.y += (-3.85 - pos.y) * 5.0;
        }

        // 3. Interactive 3D Cursor Magnetic Vortex & Velocity Wake
        vec3 toCursor = uCursor3D - pos;
        float cDist = length(toCursor) + 1e-4;
        float cZone = smoothstep(4.8, 0.35, cDist);
        vec3 cSwirl = cross(normalize(toCursor), vec3(0.0, 1.0, 0.25));
        acc += (normalize(toCursor) * 2.4 + cSwirl * 3.6 + uCursorVel * 0.38) * cZone;

        // 4. Supernova Shockwave Radial Blast
        if (uShockwave > 0.001 && uShockwave < 2.5) {
          float waveRadius = uShockwave * 9.5;
          float shell = exp(-abs(r - waveRadius) * 0.85) * exp(-uShockwave * 1.15);
          acc += (dir * 22.0 + swirl * 8.0) * shell;
        }

        vel += acc * uDt;
        // Smooth fluid drag
        vel *= exp(-uDt * (1.28 - uCharge * 0.35));

        // Clamp max speed for stability
        float spd = length(vel);
        if (spd > 14.0) vel = (vel / spd) * 14.0;

        gl_FragColor = vec4(vel, seed);
      }
    `,
  });

  // =========================================================================
  // POSITION & LIFECYCLE UPDATE SHADER
  // =========================================================================
  const posUniforms = {
    uPosTex: { value: posRead.texture },
    uVelTex: { value: velWrite.texture },
    uInitTex: { value: initPosTex },
    uTime: { value: 0 },
    uDt: { value: 0.016 },
  };

  const posMat = new THREE.ShaderMaterial({
    uniforms: posUniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uPosTex;
      uniform sampler2D uVelTex;
      uniform sampler2D uInitTex;
      uniform float uTime;
      uniform float uDt;
      varying vec2 vUv;

      void main() {
        vec4 posData = texture2D(uPosTex, vUv);
        vec4 velData = texture2D(uVelTex, vUv);
        vec3 pos = posData.xyz;
        float life = posData.w;
        float seed = velData.w;

        life += uDt * (0.065 + seed * 0.075);
        pos += velData.xyz * uDt;

        // Respawn if lifecycle ends or drifted too far
        if (life >= 1.0 || length(pos) > 19.0) {
          vec4 home = texture2D(uInitTex, vUv);
          float ang = uTime * 0.35 + seed * 6.2831853;
          float ca = cos(ang);
          float sa = sin(ang);
          pos = vec3(
            home.x * ca - home.z * sa,
            home.y,
            home.x * sa + home.z * ca
          );
          life = 0.005;
        }

        gl_FragColor = vec4(pos, life);
      }
    `,
  });

  // =========================================================================
  // PARTICLE RENDER GEOMETRY & SHADER (65,536 GPU Points)
  // =========================================================================
  const pGeo = new THREE.BufferGeometry();
  const refs = new Float32Array(count * 2);
  const dummyPos = new Float32Array(count * 3);
  for (let y = 0; y < SIM_SIZE; y++) {
    for (let x = 0; x < SIM_SIZE; x++) {
      const idx = y * SIM_SIZE + x;
      refs[idx * 2] = (x + 0.5) / SIM_SIZE;
      refs[idx * 2 + 1] = (y + 0.5) / SIM_SIZE;
    }
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(dummyPos, 3));
  pGeo.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
  // Large bounding sphere so frustum culling never clips GPU-displaced particles
  pGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);

  const renderUniforms = {
    uPosTex: { value: posRead.texture },
    uVelTex: { value: velRead.texture },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uColorSlow: { value: palette.current.particleSlow.clone() },
    uColorFast: { value: palette.current.particleFast.clone() },
    uColorAccent: { value: palette.current.particleAccent.clone() },
    uCharge: { value: 0 },
  };

  const renderMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: renderUniforms,
    vertexShader: /* glsl */ `
      uniform sampler2D uPosTex;
      uniform sampler2D uVelTex;
      uniform float uPixelRatio;
      uniform float uCharge;

      attribute vec2 aRef;

      varying float vSpeed;
      varying float vLifeAlpha;
      varying float vSeed;
      varying float vCoreProx;

      void main() {
        vec4 posData = texture2D(uPosTex, aRef);
        vec4 velData = texture2D(uVelTex, aRef);

        vec3 pos = posData.xyz;
        float life = posData.w;
        float speed = length(velData.xyz);
        float seed = velData.w;

        vSpeed = speed;
        vSeed = seed;
        vCoreProx = smoothstep(6.5, 1.6, length(pos));
        // Smooth fade-in and fade-out at birth/death
        vLifeAlpha = smoothstep(0.0, 0.12, life) * smoothstep(1.0, 0.78, life);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float dist = max(-mvPosition.z, 1.0);

        float baseSize = (0.58 + pow(seed, 4.0) * 1.85 + clamp(speed * 0.14, 0.0, 0.95)) * (1.0 + uCharge * 0.32);
        gl_PointSize = clamp(baseSize * uPixelRatio * (14.5 / dist), 0.9, 14.0 * uPixelRatio);

        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorSlow;
      uniform vec3 uColorFast;
      uniform vec3 uColorAccent;
      uniform float uCharge;

      varying float vSpeed;
      varying float vLifeAlpha;
      varying float vSeed;
      varying float vCoreProx;

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv) * 2.0;
        if (d > 1.0) discard;

        // Crisp hot star-core + silky exponential aura
        float halo = pow(1.0 - d, 2.8);
        float hotCore = smoothstep(0.42, 0.0, d);

        float energy = clamp(vSpeed * 0.24 + vCoreProx * 0.42 + uCharge * 0.4, 0.0, 1.0);
        vec3 col = mix(uColorSlow, uColorFast, smoothstep(0.08, 0.85, energy));
        col = mix(col, uColorAccent, step(0.76, vSeed) * 0.68);
        col += vec3(0.35) * hotCore * energy;

        float alpha = (halo * 0.34 + hotCore * 0.52) * vLifeAlpha * (0.34 + energy * 0.46);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const gpuPoints = new THREE.Points(pGeo, renderMat);
  gpuPoints.frustumCulled = false;

  // =========================================================================
  // SECONDARY AMBIENT SANCTUARY BOKEH MOTES (2,200 Wide-Space Parallax Motes)
  // =========================================================================
  const ambientCount = 2200;
  const ambGeo = new THREE.BufferGeometry();
  const ambPos = new Float32Array(ambientCount * 3);
  const ambSeed = new Float32Array(ambientCount);
  for (let i = 0; i < ambientCount; i++) {
    const r = 4.0 + Math.random() * 19.0;
    const th = Math.random() * Math.PI * 2;
    ambPos[i * 3] = Math.cos(th) * r;
    ambPos[i * 3 + 1] = -3.8 + Math.random() * 16.5;
    ambPos[i * 3 + 2] = Math.sin(th) * r;
    ambSeed[i] = Math.random();
  }
  ambGeo.setAttribute('position', new THREE.BufferAttribute(ambPos, 3));
  ambGeo.setAttribute('aSeed', new THREE.BufferAttribute(ambSeed, 1));

  const ambUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uColorA: { value: palette.current.particleFast.clone() },
    uColorB: { value: palette.current.particleAccent.clone() },
  };

  const ambMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: ambUniforms,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSeed;
      varying float vAlpha;
      varying float vSeed;
      void main() {
        vSeed = aSeed;
        vec3 p = position;
        // Slow ethereal upward drift with gentle sinusoidal sway
        float ySpan = 16.5;
        p.y = -3.8 + mod(p.y + 3.8 + uTime * (0.12 + aSeed * 0.18), ySpan);
        p.x += sin(uTime * 0.35 + aSeed * 25.0) * 0.45;
        p.z += cos(uTime * 0.29 + aSeed * 19.0) * 0.45;

        float normY = (p.y + 3.8) / ySpan;
        vAlpha = sin(normY * 3.14159265) * (0.28 + 0.35 * sin(uTime * 1.4 + aSeed * 40.0));

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = max(-mv.z, 1.2);
        // Foreground motes get gentle cinematic bokeh blur size
        gl_PointSize = clamp((1.5 + aSeed * 3.8) * uPixelRatio * (14.0 / dist), 1.0, 22.0 * uPixelRatio);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying float vAlpha;
      varying float vSeed;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float soft = pow(1.0 - d, 2.2);
        vec3 col = mix(uColorA, uColorB, vSeed);
        gl_FragColor = vec4(col, soft * max(vAlpha, 0.0) * 0.55);
      }
    `,
  });

  const ambientPoints = new THREE.Points(ambGeo, ambMat);

  const group = new THREE.Group();
  group.add(gpuPoints);
  group.add(ambientPoints);

  return {
    group,
    onResize(pixelRatio) {
      renderUniforms.uPixelRatio.value = pixelRatio;
      ambUniforms.uPixelRatio.value = pixelRatio;
    },
    update({
      time,
      dt,
      paletteState,
      cursor3D,
      cursorVel,
      charge,
      shockwave,
      vortex,
    }) {
      const clampedDt = Math.min(dt, 0.04);
      const prevRT = renderer.getRenderTarget();

      // Step 1: Simulate Velocity -> velWrite
      velUniforms.uPosTex.value = posRead.texture;
      velUniforms.uVelTex.value = velRead.texture;
      velUniforms.uTime.value = time;
      velUniforms.uDt.value = clampedDt;
      velUniforms.uVortexStrength.value = vortex;
      velUniforms.uCursor3D.value.copy(cursor3D);
      velUniforms.uCursorVel.value.copy(cursorVel);
      velUniforms.uCharge.value = charge;
      velUniforms.uShockwave.value = shockwave;

      simQuad.material = velMat;
      renderer.setRenderTarget(velWrite);
      renderer.render(simScene, simCam);

      // Step 2: Simulate Position -> posWrite
      posUniforms.uPosTex.value = posRead.texture;
      posUniforms.uVelTex.value = velWrite.texture;
      posUniforms.uTime.value = time;
      posUniforms.uDt.value = clampedDt;

      simQuad.material = posMat;
      renderer.setRenderTarget(posWrite);
      renderer.render(simScene, simCam);

      renderer.setRenderTarget(prevRT);

      // Ping-pong swap
      let tmp = posRead;
      posRead = posWrite;
      posWrite = tmp;

      tmp = velRead;
      velRead = velWrite;
      velWrite = tmp;

      // Step 3: Bind updated textures & colors to Particle Renderers
      renderUniforms.uPosTex.value = posRead.texture;
      renderUniforms.uVelTex.value = velRead.texture;
      renderUniforms.uColorSlow.value.copy(paletteState.current.particleSlow);
      renderUniforms.uColorFast.value.copy(paletteState.current.particleFast);
      renderUniforms.uColorAccent.value.copy(paletteState.current.particleAccent);
      renderUniforms.uCharge.value = charge;

      ambUniforms.uTime.value = time;
      ambUniforms.uColorA.value.copy(paletteState.current.particleFast);
      ambUniforms.uColorB.value.copy(paletteState.current.particleAccent);
    },
  };
}
