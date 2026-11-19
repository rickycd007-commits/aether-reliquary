import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise.glsl.js';

export function createReliquary(palette) {
  const root = new THREE.Group();

  // =========================================================================
  // 1. INNER LIVING FERRO-SOLAR SINGULARITY CORE (Opaque for true refraction)
  // =========================================================================
  const coreUniforms = {
    uTime: { value: 0 },
    uTurbulence: { value: 1.0 },
    uCharge: { value: 0.0 },
    uShockwave: { value: 0.0 },
    uCursorLocal: { value: new THREE.Vector3(0, 0, 5) },
    uCoreDeep: { value: palette.current.coreDeep.clone() },
    uCoreMid: { value: palette.current.coreMid.clone() },
    uCoreHot: { value: palette.current.coreHot.clone() },
    uCoreRim: { value: palette.current.coreRim.clone() },
    uMetalColor: { value: palette.current.metalPrimary.clone() },
  };

  const coreMat = new THREE.ShaderMaterial({
    uniforms: coreUniforms,
    transparent: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uTurbulence;
      uniform float uCharge;
      uniform float uShockwave;
      uniform vec3 uCursorLocal;

      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      varying float vDisp;
      varying float vCursorPull;

      ${NOISE_GLSL}

      float evalDisplacement(vec3 dir, out float cursorInfluence) {
        float t = uTime * (0.48 + uCharge * 0.85);
        float n1 = fbm3(dir * (2.15 + uCharge * 1.1) + vec3(t, -t * 0.7, t * 0.45));
        float ridged = 1.0 - abs(snoise(dir * 4.4 - vec3(t * 1.15)));
        ridged = pow(ridged, 2.4);

        // Magnetic ferrofluid spikes toward 3D cursor
        vec3 cursorDir = normalize(uCursorLocal + vec3(1e-5));
        float cursorDist = length(uCursorLocal);
        float align = max(dot(dir, cursorDir), 0.0);
        float proximity = smoothstep(6.5, 1.4, cursorDist);
        float ferroSpike = pow(align, 7.0) * proximity * (0.28 + 0.16 * sin(dir.x * 18.0 + uTime * 5.0));
        cursorInfluence = pow(align, 4.0) * proximity;

        float baseAmp = (0.17 * n1 + 0.095 * ridged) * uTurbulence;
        float compress = 1.0 - uCharge * 0.22;
        float shockRipple = sin(align * 14.0 - uShockwave * 16.0) * exp(-uShockwave * 2.5) * 0.12 * step(0.001, uShockwave);

        return (baseAmp + ferroSpike + shockRipple) * compress;
      }

      void main() {
        vec3 dir = normalize(position);

        // Build orthogonal tangent frame on unit sphere for exact analytical-style normal perturbation
        vec3 helper = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 tangent = normalize(cross(helper, dir));
        vec3 bitangent = cross(dir, tangent);

        float eps = 0.018;
        float cPull = 0.0;
        float dummy = 0.0;

        float d0 = evalDisplacement(dir, cPull);
        float d1 = evalDisplacement(normalize(dir + tangent * eps), dummy);
        float d2 = evalDisplacement(normalize(dir + bitangent * eps), dummy);

        float baseRadius = 1.14 * (1.0 - uCharge * 0.16);
        vec3 p0 = dir * (baseRadius + d0);
        vec3 p1 = normalize(dir + tangent * eps) * (baseRadius + d1);
        vec3 p2 = normalize(dir + bitangent * eps) * (baseRadius + d2);

        vec3 perturbedNormal = normalize(cross(p2 - p0, p1 - p0));
        if (dot(perturbedNormal, dir) < 0.0) perturbedNormal = -perturbedNormal;

        vDisp = d0;
        vCursorPull = cPull;
        vec4 wp = modelMatrix * vec4(p0, 1.0);
        vWorldPos = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * perturbedNormal);

        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uCharge;
      uniform vec3 uCoreDeep;
      uniform vec3 uCoreMid;
      uniform vec3 uCoreHot;
      uniform vec3 uCoreRim;
      uniform vec3 uMetalColor;

      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      varying float vDisp;
      varying float vCursorPull;

      ${NOISE_GLSL}

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float NoV = clamp(dot(N, V), 0.0, 1.0);
        float fresnel = pow(1.0 - NoV, 3.2);

        // Parallax internal magma veins — razor-sharp incandescent fissures against dark liquid ferrofluid
        vec3 internalCoord = vWorldPos * 2.8 - V * 0.42 + vec3(0.0, uTime * 0.24, 0.0);
        float veinNoise = fbm3(internalCoord);
        float hotVein = pow(clamp(1.0 - abs(veinNoise) * 2.9, 0.0, 1.0), 4.2);

        // Deep dark crevices glow with concentrated magma; raised ridges gleam like dark liquid obsidian-gold
        float valleyMask = smoothstep(0.09, -0.14, vDisp);
        float crestMask = smoothstep(-0.04, 0.16, vDisp);

        vec3 magma = mix(uCoreDeep * 0.35, uCoreMid * 1.45, valleyMask * 0.85);
        magma += uCoreHot * (2.6 + uCharge * 1.8) * clamp(hotVein * 0.95 + pow(valleyMask, 2.4) * 0.42 + vCursorPull * 0.65, 0.0, 1.2);

        // Sharp specular lobes on dark liquid-metal crests
        vec3 L1 = normalize(vec3(0.7, 0.85, 0.55));
        vec3 L2 = normalize(vec3(-0.8, 0.35, -0.6));
        vec3 H1 = normalize(L1 + V);
        vec3 H2 = normalize(L2 + V);
        float spec1 = pow(max(dot(N, H1), 0.0), 64.0);
        float spec2 = pow(max(dot(N, H2), 0.0), 32.0);

        vec3 liquidMetal = uMetalColor * (0.08 + 0.38 * max(dot(N, L1), 0.0)) + uCoreHot * spec1 * 2.2 + uCoreRim * spec2 * 1.35;

        vec3 col = mix(magma, liquidMetal, crestMask * 0.78);
        // Crisp iridescent thin-film Fresnel halo
        col += mix(uCoreRim, uCoreHot, 0.32) * fresnel * (1.25 + uCharge * 1.15);
        col += uCoreHot * vCursorPull * 0.65;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const coreGeo = new THREE.IcosahedronGeometry(1.0, 56);
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  root.add(coreMesh);

  // =========================================================================
  // 2. ARTICULATED OPTICAL DIAMOND-CRYSTAL CONTAINMENT SHELL (20 Prism Plates)
  // =========================================================================
  const crystalGroup = new THREE.Group();
  root.add(crystalGroup);

  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: palette.current.crystalTint.clone(),
    attenuationColor: palette.current.crystalAttenuation.clone(),
    attenuationDistance: 1.9,
    transmission: 0.96,
    ior: palette.current.ior,
    thickness: 1.35,
    roughness: 0.025,
    metalness: 0.0,
    iridescence: 0.92,
    iridescenceIOR: 1.36,
    iridescenceThicknessRange: [140, 540],
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.85,
  });
  if ('dispersion' in crystalMat) {
    crystalMat.dispersion = 5.5;
  }

  const crystalWireMat = new THREE.LineBasicMaterial({
    color: palette.current.metalPrimary.clone(),
    transparent: true,
    opacity: 0.48,
  });

  // Extract the 20 triangular faces of a base icosahedron and extrude each into a beveled crystal shard
  const baseIco = new THREE.IcosahedronGeometry(1.66, 0);
  const posAttr = baseIco.attributes.position;
  const shards = [];

  for (let i = 0; i < posAttr.count; i += 3) {
    const vA = new THREE.Vector3().fromBufferAttribute(posAttr, i);
    const vB = new THREE.Vector3().fromBufferAttribute(posAttr, i + 1);
    const vC = new THREE.Vector3().fromBufferAttribute(posAttr, i + 2);

    const centroid = new THREE.Vector3().add(vA).add(vB).add(vC).divideScalar(3);
    const normal = centroid.clone().normalize();

    // Build local coordinate basis on face plane
    const xAxis = new THREE.Vector3().subVectors(vB, vA).normalize();
    const yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize();

    const shrink = 0.86; // Leave sleek architectural gaps between shards so core light shines between facets
    const pts2D = [vA, vB, vC].map((v) => {
      const rel = v.clone().sub(centroid).multiplyScalar(shrink);
      return new THREE.Vector2(rel.dot(xAxis), rel.dot(yAxis));
    });

    const shape = new THREE.Shape(pts2D);
    const shardGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.13,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.032,
      bevelThickness: 0.032,
    });
    shardGeo.translate(0, 0, -0.065);

    const shardHolder = new THREE.Group();
    const basisMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
    shardHolder.quaternion.setFromRotationMatrix(basisMat);
    shardHolder.position.copy(centroid);

    const shardMesh = new THREE.Mesh(shardGeo, crystalMat);
    shardHolder.add(shardMesh);

    const edges = new THREE.EdgesGeometry(shardGeo, 28);
    const wire = new THREE.LineSegments(edges, crystalWireMat);
    shardHolder.add(wire);

    const shardData = {
      holder: shardHolder,
      basePos: centroid.clone(),
      baseQuat: shardHolder.quaternion.clone(),
      normal,
      phase: i * 0.37,
      currentOffset: 0.35,
      currentTilt: 0,
    };
    shards.push(shardData);
    crystalGroup.add(shardHolder);
  }

  // =========================================================================
  // 3. CONCENTRIC PRECISION ENGRAVED ASTROLABE GIMBAL RINGS
  // =========================================================================
  const ringsGroup = new THREE.Group();
  root.add(ringsGroup);

  const goldMat = new THREE.MeshPhysicalMaterial({
    color: palette.current.metalPrimary.clone(),
    metalness: 0.96,
    roughness: 0.19,
    clearcoat: 0.55,
    clearcoatRoughness: 0.18,
    envMapIntensity: 2.3,
  });

  const darkTitaniumMat = new THREE.MeshPhysicalMaterial({
    color: palette.current.metalSecondary.clone(),
    metalness: 0.88,
    roughness: 0.28,
    clearcoat: 0.5,
    envMapIntensity: 1.8,
  });

  const jewelMat = new THREE.MeshBasicMaterial({
    color: palette.current.coreHot.clone(),
  });

  const engravingUniforms = {
    uTime: { value: 0 },
    uPrimaryColor: { value: palette.current.metalPrimary.clone() },
    uGlowColor: { value: palette.current.coreHot.clone() },
    uRimColor: { value: palette.current.coreRim.clone() },
    uCharge: { value: 0 },
  };

  const engravingMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: engravingUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vLocalPos;
      void main() {
        vUv = uv;
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uPrimaryColor;
      uniform vec3 uGlowColor;
      uniform vec3 uRimColor;
      uniform float uCharge;
      varying vec2 vUv;
      varying vec3 vLocalPos;

      void main() {
        float angle = atan(vLocalPos.y, vLocalPos.x);
        float normA = (angle + 3.14159265) / 6.2831853;

        // Polar vernier degree ticks (360, 72, 12 divisions)
        float fineTick = smoothstep(0.92, 1.0, cos(angle * 180.0)) * smoothstep(0.32, 0.5, vUv.y) * smoothstep(0.68, 0.5, vUv.y);
        float midTick  = smoothstep(0.975, 1.0, cos(angle * 36.0)) * smoothstep(0.15, 0.4, vUv.y) * smoothstep(0.85, 0.6, vUv.y);
        float majTick  = smoothstep(0.992, 1.0, cos(angle * 8.0));

        // Concentric hairline tracks
        float track1 = smoothstep(0.05, 0.0, abs(vUv.y - 0.18));
        float track2 = smoothstep(0.05, 0.0, abs(vUv.y - 0.82));

        // Traveling luminous data/energy arc
        float arc1 = smoothstep(0.22, 0.0, abs(fract(normA - uTime * 0.18) - 0.5));
        float arc2 = smoothstep(0.16, 0.0, abs(fract(normA + uTime * 0.13 + 0.35) - 0.5));

        float pattern = fineTick * 0.35 + midTick * 0.65 + majTick * 0.95 + (track1 + track2) * 0.5;
        vec3 col = mix(uPrimaryColor, uGlowColor, 0.45 + arc1 * 0.55);
        col = mix(col, uRimColor, arc2 * 0.65);

        float alpha = pattern * (0.28 + arc1 * 0.62 + arc2 * 0.45 + uCharge * 0.45);
        gl_FragColor = vec4(col * 1.4, clamp(alpha, 0.0, 0.95));
      }
    `,
  });

  const ringConfigs = [
    { radius: 2.48, tube: 0.032, bandWidth: 0.16, tilt: [0.42, 0.2, 0.0], speed: [0.34, -0.21, 0.11], primary: true },
    { radius: 3.18, tube: 0.038, bandWidth: 0.21, tilt: [-0.58, 0.15, 0.38], speed: [-0.24, 0.29, -0.09], primary: false },
    { radius: 4.06, tube: 0.044, bandWidth: 0.25, tilt: [0.28, -0.45, -0.32], speed: [0.16, 0.19, -0.22], primary: true },
    { radius: 5.18, tube: 0.028, bandWidth: 0.18, tilt: [1.22, 0.18, 0.24], speed: [-0.11, -0.14, 0.17], primary: false },
  ];

  const rings = ringConfigs.map((cfg, idx) => {
    const g = new THREE.Group();
    g.rotation.set(cfg.tilt[0], cfg.tilt[1], cfg.tilt[2]);

    // Outer & inner metallic rim rails
    const railMat = cfg.primary ? goldMat : darkTitaniumMat;
    const accentMat = cfg.primary ? darkTitaniumMat : goldMat;

    const outerRail = new THREE.Mesh(
      new THREE.TorusGeometry(cfg.radius + cfg.bandWidth * 0.5, cfg.tube, 20, 160),
      railMat
    );
    g.add(outerRail);

    const innerRail = new THREE.Mesh(
      new THREE.TorusGeometry(cfg.radius - cfg.bandWidth * 0.5, cfg.tube * 0.72, 16, 160),
      accentMat
    );
    g.add(innerRail);

    // Engraved astronomical scale band between the rails
    const bandGeo = new THREE.RingGeometry(
      cfg.radius - cfg.bandWidth * 0.46,
      cfg.radius + cfg.bandWidth * 0.46,
      180,
      1
    );
    const bandMesh = new THREE.Mesh(bandGeo, engravingMat);
    g.add(bandMesh);

    // 4 Cardinal jewel bearings + sleek mechanical clasps
    const claspGeo = new THREE.BoxGeometry(0.12, cfg.bandWidth * 1.45, 0.14);
    const jewelGeo = new THREE.OctahedronGeometry(0.065 + idx * 0.008, 0);
    for (let c = 0; c < 4; c++) {
      const a = (c / 4) * Math.PI * 2;
      const cx = Math.cos(a) * cfg.radius;
      const cy = Math.sin(a) * cfg.radius;

      const clasp = new THREE.Mesh(claspGeo, goldMat);
      clasp.position.set(cx, cy, 0);
      clasp.rotation.z = a + Math.PI * 0.5;
      g.add(clasp);

      const jewel = new THREE.Mesh(jewelGeo, jewelMat);
      jewel.position.set(Math.cos(a) * (cfg.radius + cfg.bandWidth * 0.78), Math.sin(a) * (cfg.radius + cfg.bandWidth * 0.78), 0);
      g.add(jewel);
    }

    ringsGroup.add(g);
    return { group: g, cfg };
  });

  const invMatrix = new THREE.Matrix4();
  const localCursor = new THREE.Vector3();
  const qTilt = new THREE.Quaternion();
  const tiltAxis = new THREE.Vector3();

  return {
    root,
    crystalMat,
    update({
      time,
      dt,
      paletteState,
      cursor3D,
      charge,
      shockwave,
      turbulence,
      aperture,
      dispersion,
      tempo,
    }) {
      // Gentle levitation of the entire reliquary
      root.position.y = Math.sin(time * 0.85) * 0.16;

      // Transform 3D world cursor into core local space
      invMatrix.copy(coreMesh.matrixWorld).invert();
      localCursor.copy(cursor3D).applyMatrix4(invMatrix);

      // Update Core Uniforms
      coreUniforms.uTime.value = time;
      coreUniforms.uTurbulence.value = turbulence;
      coreUniforms.uCharge.value = charge;
      coreUniforms.uShockwave.value = shockwave;
      coreUniforms.uCursorLocal.value.copy(localCursor);
      coreUniforms.uCoreDeep.value.copy(paletteState.current.coreDeep);
      coreUniforms.uCoreMid.value.copy(paletteState.current.coreMid);
      coreUniforms.uCoreHot.value.copy(paletteState.current.coreHot);
      coreUniforms.uCoreRim.value.copy(paletteState.current.coreRim);
      coreUniforms.uMetalColor.value.copy(paletteState.current.metalPrimary);

      coreMesh.rotation.y = time * 0.14;
      coreMesh.rotation.z = Math.sin(time * 0.25) * 0.12;

      // Update Crystal Shell Material & Per-Shard Articulation
      crystalMat.color.copy(paletteState.current.crystalTint);
      crystalMat.attenuationColor.copy(paletteState.current.crystalAttenuation);
      crystalMat.ior = paletteState.current.ior;
      if ('dispersion' in crystalMat) {
        crystalMat.dispersion = dispersion + charge * 3.5;
      }
      crystalWireMat.color.copy(paletteState.current.metalPrimary);

      crystalGroup.rotation.y = -time * 0.09;
      crystalGroup.rotation.x = Math.sin(time * 0.21) * 0.08;

      invMatrix.copy(crystalGroup.matrixWorld).invert();
      const crystalLocalCursor = localCursor.copy(cursor3D).applyMatrix4(invMatrix);
      const cursorDist = crystalLocalCursor.length();
      const cursorDir = crystalLocalCursor.clone().normalize();

      const shockPush = Math.sin(Math.min(shockwave * 3.2, Math.PI)) * Math.exp(-shockwave * 1.4) * 0.95;

      for (const s of shards) {
        const align = Math.max(0, s.normal.dot(cursorDir));
        const hoverOpen = Math.pow(align, 3.0) * THREE.MathUtils.smoothstep(5.8, 1.5, cursorDist) * 0.68;
        const breath = Math.sin(time * 1.35 + s.phase) * 0.055;
        const targetOffset =
          (aperture + breath + hoverOpen + shockPush) * (1.0 - charge * 0.55);

        s.currentOffset += (targetOffset - s.currentOffset) * (1.0 - Math.exp(-dt * 8.0));
        s.holder.position
          .copy(s.basePos)
          .addScaledVector(s.normal, s.currentOffset);

        // Subtle petal-like tilt when opening toward cursor
        const targetTilt = hoverOpen * 0.42 + shockPush * 0.25;
        s.currentTilt += (targetTilt - s.currentTilt) * (1.0 - Math.exp(-dt * 8.0));
        tiltAxis.crossVectors(s.normal, cursorDir);
        if (tiltAxis.lengthSq() > 1e-5) {
          tiltAxis.normalize();
          qTilt.setFromAxisAngle(tiltAxis, s.currentTilt);
          s.holder.quaternion.copy(s.baseQuat).premultiply(qTilt);
        } else {
          s.holder.quaternion.copy(s.baseQuat);
        }
      }

      // Update Metallic & Engraved Astrolabe Rings
      goldMat.color.copy(paletteState.current.metalPrimary);
      darkTitaniumMat.color.copy(paletteState.current.metalSecondary);
      jewelMat.color.copy(paletteState.current.coreHot).multiplyScalar(1.8);

      engravingUniforms.uTime.value = time;
      engravingUniforms.uPrimaryColor.value.copy(paletteState.current.metalPrimary);
      engravingUniforms.uGlowColor.value.copy(paletteState.current.coreHot);
      engravingUniforms.uRimColor.value.copy(paletteState.current.coreRim);
      engravingUniforms.uCharge.value = charge;

      const speedMult = tempo * (1.0 + charge * 3.4 + shockPush * 1.8);
      for (const r of rings) {
        r.group.rotation.x += r.cfg.speed[0] * dt * speedMult;
        r.group.rotation.y += r.cfg.speed[1] * dt * speedMult;
        r.group.rotation.z += r.cfg.speed[2] * dt * speedMult;
      }
    },
  };
}
