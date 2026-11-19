import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const CinematicOpticsShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1.77 },
    uChromatic: { value: 0.0014 },
    uShockwave: { value: 0.0 },
    uCharge: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform float uChromatic;
    uniform float uShockwave;
    uniform float uCharge;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      vec2 aspectUv = vec2(centered.x * uAspect, centered.y);
      float rad = length(aspectUv);

      // Subtle screen-space refractive ripple when shockwave fires
      vec2 uv = vUv;
      if (uShockwave > 0.001 && uShockwave < 1.8) {
        float ringRadius = uShockwave * 0.95;
        float wave = sin((rad - ringRadius) * 28.0) * exp(-abs(rad - ringRadius) * 9.5) * exp(-uShockwave * 2.1);
        uv += normalize(centered + vec2(1e-5)) * wave * 0.014;
      }

      // Radial lens chromatic dispersion toward edges
      float caAmount = (uChromatic + uCharge * 0.0038) * pow(rad * 1.35, 2.0);
      vec2 caOffset = centered * caAmount;

      float r = texture2D(tDiffuse, uv + caOffset).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - caOffset).b;
      vec3 col = vec3(r, g, b);

      // Subtle cinematic vignette (preserves rich highlights, gently frames corners)
      float vig = smoothstep(1.28, 0.34, rad);
      col *= mix(0.66, 1.0, vig);

      // Fine 35mm organic film grain to eliminate dark gradient banding
      float grain = (hash12(vUv * 1280.0 + fract(uTime * 17.3)) - 0.5) * 0.022;
      col += grain;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export function createPostProcessing(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const hdrTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });

  const composer = new EffectComposer(renderer, hdrTarget);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.48, // strength: silky halation preserving dark micro-contrast
    0.62, // radius: smooth falloff
    0.88  // threshold: only true HDR glints & magma fissures bloom
  );
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const opticsPass = new ShaderPass(CinematicOpticsShader);
  opticsPass.uniforms.uAspect.value = window.innerWidth / Math.max(window.innerHeight, 1);
  composer.addPass(opticsPass);

  return {
    composer,
    bloomPass,
    opticsPass,
    onResize(w, h, dpr) {
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      bloomPass.resolution.set(w, h);
      opticsPass.uniforms.uAspect.value = w / Math.max(h, 1);
    },
    update(time, charge, shockwave, baseBloom) {
      const shockBoost = Math.exp(-shockwave * 2.5) * (shockwave > 0.001 ? 0.35 : 0.0);
      bloomPass.strength = baseBloom + charge * 0.32 + shockBoost;
      opticsPass.uniforms.uTime.value = time;
      opticsPass.uniforms.uCharge.value = charge;
      opticsPass.uniforms.uShockwave.value = shockwave;
    },
    render() {
      composer.render();
    },
  };
}
