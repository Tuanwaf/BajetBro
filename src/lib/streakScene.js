// The full-screen streak celebration, in three.js. Only ever loaded through
// a dynamic import() from StreakCelebration.svelte, so three.js is split
// into its own chunk and costs nothing until a milestone actually happens.
//
// The buddies are flat 2D art, so the buddy itself is a textured plane --
// what three.js adds is everything a CSS transform can't: a vertex-deformed
// squash/stretch + jelly wobble, a shine sweep / white flash / grey-to-colour
// shader, a Y-axis spin for the evolve, and real lit 3D coins + sparkles +
// light rays around it.
//
// Everything is created per run and fully disposed at the end (renderer,
// WebGL context, geometries, textures) -- nothing keeps the GPU busy once
// the celebration is over.

import * as THREE from 'three';

// Shared with StreakCelebration.svelte's text placement -- keep in sync.
export const BUDDY_CENTER_Y = 0.36; // fraction of screen height from the top
export function buddyPx(W, H) {
  return Math.min(W * 0.6, H * 0.34, 300);
}

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeInQuad = (x) => x * x;
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const rand = (a, b) => a + Math.random() * (b - a);

// Painted "matcap" for the coins: a sphere of gold lighting baked into a
// small canvas. Looks as shiny as a physically-lit metal but costs one tiny
// shader -- the lit version needed a generated environment map + several
// heavy shader programs, which is what made the first celebration take
// seconds to appear on a phone.
let goldMatcapCanvas = null;
function goldMatcap() {
  if (!goldMatcapCanvas) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const base = g.createRadialGradient(46, 40, 4, 64, 64, 64);
    base.addColorStop(0, '#fff6c8');
    base.addColorStop(0.25, '#ffd65a');
    base.addColorStop(0.62, '#e0a21c');
    base.addColorStop(0.9, '#8a5a06');
    base.addColorStop(1, '#5a3a02');
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    // Rim light from the lower right, so edge-on coins still glint.
    const rim = g.createRadialGradient(92, 96, 2, 92, 96, 30);
    rim.addColorStop(0, 'rgba(255, 236, 150, 0.8)');
    rim.addColorStop(1, 'rgba(255, 236, 150, 0)');
    g.fillStyle = rim;
    g.fillRect(0, 0, 128, 128);
    goldMatcapCanvas = c;
  }
  const t = new THREE.CanvasTexture(goldMatcapCanvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Same idea for the freeze's ice shards: pale blue with a hard white glint.
let iceMatcapCanvas = null;
function iceMatcap() {
  if (!iceMatcapCanvas) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const base = g.createRadialGradient(44, 38, 2, 64, 64, 64);
    base.addColorStop(0, '#ffffff');
    base.addColorStop(0.3, '#d9f1ff');
    base.addColorStop(0.7, '#7cc4ff');
    base.addColorStop(1, '#2f6fb8');
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    iceMatcapCanvas = c;
  }
  const t = new THREE.CanvasTexture(iceMatcapCanvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function loadTex(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        resolve(t);
      },
      undefined,
      reject
    );
  });
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const BUDDY_VERT = /* glsl */ `
  uniform vec2 uSizeA;
  uniform vec2 uSizeB;
  uniform float uMix;
  uniform vec2 uSquash;
  uniform float uWobble;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec2 size = uMix < 0.5 ? uSizeA : uSizeB;
    vec3 p = position;
    // Origin at the buddy's feet, so squash/stretch keeps it planted.
    p.xy *= size;
    p.y += size.y * 0.5;
    float h = p.y / size.y;
    p.x *= uSquash.x;
    p.y *= uSquash.y;
    // Jelly: a travelling sideways wave, stronger towards the top.
    p.x += sin(uTime * 17.0 + h * 3.2) * uWobble * h * size.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const BUDDY_FRAG = /* glsl */ `
  uniform sampler2D uMapA;
  uniform sampler2D uMapB;
  uniform float uMix;
  uniform float uFlash;
  uniform float uSat;
  uniform float uShine;
  uniform float uAlpha;
  uniform float uFrost;      // 0..1 strength of the ice encasing
  uniform float uFrostLevel; // how far up the ice has crept (uv.y)
  varying vec2 vUv;
  void main() {
    vec4 c = uMix < 0.5 ? texture2D(uMapA, vUv) : texture2D(uMapB, vUv);
    float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    c.rgb = mix(vec3(g) * 1.05, c.rgb, uSat);
    // Ice: an icy-blue wash with faceted glints, creeping up from the feet,
    // with a bright freezing edge along the front.
    float frozen = (1.0 - smoothstep(uFrostLevel - 0.06, uFrostLevel, vUv.y)) * uFrost;
    vec3 ice = mix(vec3(0.62, 0.84, 1.0), vec3(1.0), g * 0.7);
    float facet = abs(sin(vUv.x * 38.0 + vUv.y * 21.0) * sin(vUv.y * 33.0 - vUv.x * 15.0));
    ice += smoothstep(0.86, 1.0, facet) * 0.4;
    c.rgb = mix(c.rgb, ice, frozen * 0.85);
    float edge = (1.0 - smoothstep(0.0, 0.035, abs(vUv.y - uFrostLevel))) * uFrost * step(uFrostLevel, 1.02);
    c.rgb += vec3(0.75, 0.92, 1.0) * edge * 0.8;
    float band = 1.0 - smoothstep(0.0, 0.085, abs((vUv.x * 0.62 + vUv.y * 0.38) - uShine));
    c.rgb += band * 0.42;
    c.rgb = mix(c.rgb, vec3(1.0), uFlash);
    gl_FragColor = vec4(c.rgb, c.a * uAlpha);
    #include <colorspace_fragment>
  }
`;

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uI;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2) * uI;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

const RAYS_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uI;
  uniform float uRot;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float ang = atan(p.y, p.x);
    float rays = smoothstep(0.35, 1.0, sin(ang * 11.0 + uRot)) * 0.7
               + smoothstep(0.6, 1.0, sin(ang * 7.0 - uRot * 0.6)) * 0.45;
    float fade = smoothstep(1.0, 0.18, r) * smoothstep(0.02, 0.2, r);
    float a = rays * fade * uI;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

const RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uR;
  uniform float uA;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float w = 0.06 + uR * 0.05;
    float a = (1.0 - smoothstep(0.0, w, abs(d - uR))) * uA;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

const SPARK_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const SPARK_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    // Four-pointed twinkle: a soft core plus two thin crossed streaks.
    float core = smoothstep(0.22, 0.0, length(p));
    float cross = smoothstep(0.035, 0.0, abs(p.x)) * smoothstep(0.5, 0.0, abs(p.y))
                + smoothstep(0.035, 0.0, abs(p.y)) * smoothstep(0.5, 0.0, abs(p.x));
    float a = clamp(core + cross * 0.8, 0.0, 1.0) * vAlpha;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.6) * a, a);
  }
`;

function quad(frag, uniforms, size) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: frag,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  return m;
}

// ---------------------------------------------------------------------------
// runCelebration
//
// kind:      'start' | 'milestone' | 'tierup' | 'revive' | 'freeze'
// fromImg:   buddy image before (tierup: the old tier)
// toImg:     buddy image after
// color:     tier colour (css hex) for glow/rays/sparkles
// getTarget: () => DOMRect | null -- where to fly back to at the end
// onPhase:   (name) => void -- 'text' when the headline should appear,
//            'exit' when the overlay should start fading; 'ready' (with the
//            setup time in ms) right before the first real frame
//
// Returns { done: Promise<void>, dismiss(): void }.
// ---------------------------------------------------------------------------

export async function runCelebration({ canvas, kind, fromImg, toImg, color, getTarget, onPhase = () => {} }) {
  const tStart = performance.now();
  const W = window.innerWidth;
  const H = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 100);
  camera.position.z = 10;
  const visH = 2 * 10 * Math.tan(THREE.MathUtils.degToRad(17.5));
  const upp = visH / H; // world units per CSS pixel on the z=0 plane

  const tint = new THREE.Color(color);
  const textures = [];
  const texA = await loadTex(fromImg);
  textures.push(texA);
  const texB = toImg && toImg !== fromImg ? await loadTex(toImg) : texA;
  if (texB !== texA) textures.push(texB);

  // ---- buddy ----
  const bh = buddyPx(W, H) * upp;
  const sizeOf = (t) => new THREE.Vector2(bh * (t.image.width / t.image.height), bh);
  const buddyU = {
    uMapA: { value: texA },
    uMapB: { value: texB },
    uSizeA: { value: sizeOf(texA) },
    uSizeB: { value: sizeOf(texB) },
    uMix: { value: 0 },
    uSquash: { value: new THREE.Vector2(1, 1) },
    uWobble: { value: 0 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uSat: { value: kind === 'revive' ? 0 : 1 },
    uShine: { value: -1 },
    uAlpha: { value: 1 },
    uFrost: { value: 0 },
    uFrostLevel: { value: 0 },
  };
  const buddy = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1, 24, 24),
    new THREE.ShaderMaterial({
      vertexShader: BUDDY_VERT,
      fragmentShader: BUDDY_FRAG,
      uniforms: buddyU,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  buddy.renderOrder = 5;
  const centerY = (0.5 - BUDDY_CENTER_Y) * visH;
  const restY = centerY - bh / 2; // feet
  const startY = visH / 2 + bh * 0.2;
  buddy.position.set(0, startY, 0);
  scene.add(buddy);

  // ---- glow, rays, ring ----
  const glowU = { uColor: { value: tint }, uI: { value: 0 } };
  const glow = quad(GLOW_FRAG, glowU, bh * 2.6);
  glow.position.set(0, centerY, -1);
  scene.add(glow);

  const raysU = { uColor: { value: tint.clone().lerp(new THREE.Color('#ffffff'), 0.35) }, uI: { value: 0 }, uRot: { value: 0 } };
  const rays = quad(RAYS_FRAG, raysU, visH * 1.5);
  rays.position.set(0, centerY, -2);
  scene.add(rays);

  const ringU = { uColor: { value: new THREE.Color('#ffffff') }, uR: { value: 0 }, uA: { value: 0 } };
  const ring = quad(RING_FRAG, ringU, bh * 3.2);
  ring.position.set(0, centerY, -0.5);
  scene.add(ring);
  let ringT = -1;
  const fireRing = () => (ringT = 0);

  // ---- coins (real lit 3D, instanced) ----
  const COINS = 44;
  const coinR = bh * 0.085;
  const isFreeze = kind === 'freeze';
  let coinGeo;
  if (isFreeze) {
    // Long thin ice shards.
    coinGeo = new THREE.OctahedronGeometry(coinR * 0.9, 0);
    coinGeo.scale(0.55, 1.7, 0.35);
  } else {
    coinGeo = new THREE.CylinderGeometry(coinR, coinR, coinR * 0.24, 32);
    coinGeo.rotateX(Math.PI / 2);
  }
  const matcapTex = isFreeze ? iceMatcap() : goldMatcap();
  textures.push(matcapTex);
  const coinMat = new THREE.MeshMatcapMaterial({ matcap: matcapTex });
  const coins = new THREE.InstancedMesh(coinGeo, coinMat, COINS);
  coins.renderOrder = 6;
  coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(coins);
  const coin = Array.from({ length: COINS }, () => ({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 1 }));
  const dummy = new THREE.Object3D();
  const GRAV = -visH * 2.4;
  function spawnCoin(p, v) {
    const c = coin.find((x) => !x.alive);
    if (!c) return;
    c.alive = true;
    c.p.copy(p);
    c.v.copy(v);
    c.r.set(rand(0, TAU), rand(0, TAU), 0);
    c.w.set(rand(-9, 9), rand(-12, 12), rand(-4, 4));
    c.s = rand(0.75, 1.2);
  }
  function coinBurst(n, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(0.15, Math.PI - 0.15);
      const sp = rand(0.55, 1) * visH * 1.05 * power;
      spawnCoin(new THREE.Vector3(rand(-0.2, 0.2) * bh, centerY, rand(0, 0.5)), new THREE.Vector3(Math.cos(a) * sp * 0.75, Math.sin(a) * sp, rand(0.5, 3)));
    }
  }
  function coinRain(n) {
    for (let i = 0; i < n; i++) {
      spawnCoin(new THREE.Vector3(rand(-0.5, 0.5) * visH * (W / H), visH / 2 + rand(0.2, 1.5), rand(-1, 1.5)), new THREE.Vector3(rand(-0.3, 0.3), rand(-1, 0), 0));
    }
  }

  // ---- sparkles ----
  const SPARKS = 90;
  const sGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(SPARKS * 3);
  const sSize = new Float32Array(SPARKS);
  const sAlpha = new Float32Array(SPARKS);
  const sCol = new Float32Array(SPARKS * 3);
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
  sGeo.setAttribute('aAlpha', new THREE.BufferAttribute(sAlpha, 1));
  sGeo.setAttribute('aColor', new THREE.BufferAttribute(sCol, 3));
  const sMat = new THREE.ShaderMaterial({
    vertexShader: SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    uniforms: { uScale: { value: renderer.getPixelRatio() * 10 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sparks = new THREE.Points(sGeo, sMat);
  sparks.renderOrder = 7;
  sparks.frustumCulled = false;
  scene.add(sparks);
  const spark = Array.from({ length: SPARKS }, () => ({ alive: false, life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), size: 1, target: null }));
  const white = new THREE.Color('#ffffff');
  const gold = new THREE.Color(isFreeze ? '#bfe6ff' : '#ffd35a');
  function spawnSpark(p, v, max, size, target = null) {
    const s = spark.find((x) => !x.alive);
    if (!s) return;
    const i = spark.indexOf(s);
    s.alive = true;
    s.life = 0;
    s.max = max;
    s.p.copy(p);
    s.v.copy(v);
    s.size = size;
    s.target = target;
    const c = [tint, white, gold][i % 3];
    sCol[i * 3] = c.r;
    sCol[i * 3 + 1] = c.g;
    sCol[i * 3 + 2] = c.b;
  }
  function sparkBurst(n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(0.3, 1) * bh * 2.2;
      spawnSpark(new THREE.Vector3(0, centerY, 0.3), new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp, 0), rand(0.6, 1.2), rand(14, 30));
    }
  }
  function sparkConverge(n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const r = bh * rand(1.1, 1.6);
      const p = new THREE.Vector3(Math.cos(a) * r, centerY + Math.sin(a) * r, 0.3);
      spawnSpark(p, new THREE.Vector3(), rand(0.5, 0.8), rand(10, 20), new THREE.Vector3(0, centerY, 0.3));
    }
  }
  function sparkIdle() {
    const a = rand(0, TAU);
    const r = bh * rand(0.55, 0.95);
    spawnSpark(new THREE.Vector3(Math.cos(a) * r, centerY + Math.sin(a) * r, 0.3), new THREE.Vector3(0, bh * 0.15, 0), rand(0.7, 1.2), rand(10, 22));
  }

  // ---- squash spring ----
  // s > 0 = wide & short, s < 0 = tall & thin.
  let sq = 0;
  let sqV = 0;
  const kick = (v) => (sqV += v);

  // ---- timeline ----
  const T = {
    start: { land: 0.38, text: 0.45, tapAfter: 0.6, auto: 4.2 },
    milestone: { land: 0.38, text: 0.45, tapAfter: 0.6, auto: 4.6 },
    revive: { land: 0.5, text: 1.35, tapAfter: 1.5, auto: 5.2 },
    tierup: { land: 0.38, text: 2.65, tapAfter: 2.7, auto: 6.6 },
    freeze: { land: 0.38, text: 2.05, tapAfter: 2.1, auto: 5.6 },
  }[kind] ?? { land: 0.38, text: 0.45, tapAfter: 0.6, auto: 4.2 };

  let t = 0;
  let last = performance.now();
  let raf = 0;
  let landed = false;
  let textShown = false;
  let exitAt = -1;
  let exitFrom = null;
  let exitTo = null;
  let spinY = 0;
  let spinFrom = null;
  let spinTo = null;
  let swapped = false;
  let reviveBurst = false;
  let shattered = false;
  let finished = false;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const EXIT = 0.6;

  function beginExit() {
    if (exitAt >= 0) return;
    exitAt = t;
    onPhase('exit');
    exitFrom = { x: buddy.position.x, y: buddy.position.y, s: buddy.scale.x };
    const rect = getTarget?.();
    const onScreen = rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < H;
    exitTo = onScreen
      ? { x: (rect.left + rect.width / 2 - W / 2) * upp, y: -(rect.bottom - H / 2) * upp, s: (rect.height * upp) / bh, fly: true }
      : { x: 0, y: restY + bh * 0.3, s: 0.2, fly: false };
  }

  function step(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    t += dt;
    buddyU.uTime.value = t;

    // Spring for squash/stretch.
    sqV += (-190 * sq - 11 * sqV) * dt;
    sq += sqV * dt;
    buddyU.uSquash.value.set(1 + sq, 1 - sq * 0.85);

    // Drop in.
    if (t < T.land) {
      const k = easeInQuad(t / T.land);
      buddy.position.y = startY + (restY - startY) * k;
      sq = -0.12 * k; // stretched while falling
    } else if (!landed) {
      landed = true;
      buddy.position.y = restY;
      sq = 0;
      kick(kind === 'revive' ? 2.6 : 5.2);
      buddyU.uWobble.value = 0.05;
      if (kind === 'start' || kind === 'milestone') {
        coinBurst(kind === 'start' ? 22 : 30);
        sparkBurst(36);
        fireRing();
      }
    }

    // Per-kind choreography.
    if (kind === 'tierup') {
      if (t > 0.9 && t < 1.95) {
        const k = (t - 0.9) / 1.05;
        buddy.position.x = Math.sin(t * 75) * 0.05 * k * bh;
        glowU.uI.value = 0.35 + k * 0.6;
        if (Math.random() < 0.6) sparkConverge(1);
      }
      if (t >= 1.95 && t < 2.55) {
        const k = (t - 1.95) / 0.6;
        buddy.position.x = 0;
        spinY += (8 + 70 * k * k) * dt;
        buddyU.uFlash.value = easeInQuad(k);
        if (k > 0.9 && !swapped) {
          swapped = true;
          buddyU.uMix.value = 1;
        }
      }
      if (t >= 2.55 && t < 2.95) {
        const k = (t - 2.55) / 0.4;
        // Settle the spin onto a full turn so it ends facing forward.
        if (spinFrom == null) {
          spinFrom = spinY;
          spinTo = Math.ceil(spinY / TAU + 1) * TAU;
          coinBurst(36, 1.15);
          sparkBurst(50);
          fireRing();
          kick(-6);
        }
        spinY = spinFrom + (spinTo - spinFrom) * easeOutCubic(k);
        buddyU.uFlash.value = 1 - easeOutCubic(k);
        const pop = 1 + Math.sin(k * Math.PI) * 0.28;
        buddy.scale.setScalar(pop);
      } else if (t >= 2.95 && spinTo != null && buddy.scale.x !== 1 && exitAt < 0) {
        spinY = spinTo;
        buddy.scale.setScalar(1);
        buddyU.uFlash.value = 0;
      }
      buddy.rotation.y = spinY;
      if (t > 2.6) {
        raysU.uI.value = Math.min(1, raysU.uI.value + dt * 2.5);
        glowU.uI.value = Math.max(0.75, glowU.uI.value - dt);
      }
    } else if (kind === 'freeze') {
      // Ice creeps up from the feet...
      if (t > 0.6 && t < 1.3) {
        const k = (t - 0.6) / 0.7;
        buddyU.uFrost.value = 1;
        buddyU.uFrostLevel.value = easeInOut(k) * 1.08;
        glowU.uI.value = k * 0.5;
        if (Math.random() < 0.5) sparkConverge(1);
      }
      // ...holds, shivering...
      if (t >= 1.3 && t < 1.9) buddy.position.x = Math.sin(t * 90) * 0.012 * bh;
      // ...and shatters, leaving the buddy (and its streak) unharmed.
      if (t >= 1.9 && !shattered) {
        shattered = true;
        buddy.position.x = 0;
        coinBurst(34, 1.05);
        sparkBurst(44);
        fireRing();
        kick(-5.5);
        buddyU.uFlash.value = 0.55;
      }
      if (shattered) {
        buddyU.uFrost.value = Math.max(0, buddyU.uFrost.value - dt * 4);
        buddyU.uFlash.value = Math.max(0, buddyU.uFlash.value - dt * 2.5);
        raysU.uI.value = Math.min(0.75, raysU.uI.value + dt * 2);
        glowU.uI.value = Math.min(0.8, glowU.uI.value + dt * 2);
      }
    } else if (kind === 'revive') {
      if (t > 0.8 && t < 1.7) {
        const k = (t - 0.8) / 0.9;
        buddyU.uSat.value = easeInOut(k);
        glowU.uI.value = k * 0.9;
        if (Math.random() < 0.5) sparkConverge(1);
      }
      if (t >= 1.3 && !reviveBurst) {
        reviveBurst = true;
        fireRing();
        sparkBurst(44);
        coinBurst(18, 0.85);
        kick(-5);
      }
      if (t > 1.3) raysU.uI.value = Math.min(0.85, raysU.uI.value + dt * 2);
    } else {
      if (t > T.land) {
        raysU.uI.value = Math.min(0.9, raysU.uI.value + dt * 3);
        glowU.uI.value = Math.min(0.85, glowU.uI.value + dt * 3);
      }
      if (kind === 'milestone' && t > 0.8 && t < 2.2 && Math.random() < 0.35) coinRain(1);
    }

    // Idle life once settled.
    const settled = t > T.text + 0.3 && exitAt < 0;
    if (settled) {
      buddy.position.y = restY + Math.sin((t - T.text) * 2.4) * bh * 0.025;
      buddy.rotation.z = Math.sin((t - T.text) * 1.7) * 0.035;
      if (Math.random() < 0.12) sparkIdle();
    }
    buddyU.uWobble.value *= Math.pow(0.02, dt);
    // Shine sweeps across every ~1.8s once the headline is up.
    buddyU.uShine.value = t > T.text ? (((t - T.text) * 0.75) % 1.8) - 0.35 : -1;
    raysU.uRot.value = t * 0.35;

    if (!textShown && t >= T.text) {
      textShown = true;
      onPhase('text');
    }
    if (exitAt < 0 && t >= T.auto) beginExit();

    // Exit: fly into the Home card (or shrink away if it isn't on screen).
    if (exitAt >= 0) {
      const k = clamp01((t - exitAt) / EXIT);
      const e = easeInOut(k);
      buddy.position.x = exitFrom.x + (exitTo.x - exitFrom.x) * e;
      // A little arc upward on the way, so it reads as a throw, not a slide.
      buddy.position.y = exitFrom.y + (exitTo.y - exitFrom.y) * e + Math.sin(k * Math.PI) * bh * 0.25;
      buddy.scale.setScalar(exitFrom.s + (exitTo.s - exitFrom.s) * e);
      buddy.rotation.z *= 0.9;
      if (!exitTo.fly) buddyU.uAlpha.value = 1 - e;
      raysU.uI.value *= Math.pow(0.001, dt);
      glowU.uI.value *= Math.pow(0.001, dt);
      if (k >= 1 && !finished) {
        finished = true;
        cleanup();
        resolveDone();
        return;
      }
    }

    glow.position.x = buddy.position.x;
    glow.position.y = buddy.position.y + (bh / 2) * buddy.scale.y;

    // Ring.
    if (ringT >= 0) {
      ringT += dt;
      const k = clamp01(ringT / 0.7);
      ringU.uR.value = easeOutCubic(k) * 0.95;
      ringU.uA.value = (1 - k) * 0.9;
      if (k >= 1) ringT = -1;
    }

    // Coins.
    const floor = -visH / 2 - coinR * 4;
    for (let i = 0; i < COINS; i++) {
      const c = coin[i];
      if (c.alive) {
        c.v.y += GRAV * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt;
        c.r.y += c.w.y * dt;
        c.r.z += c.w.z * dt;
        if (c.p.y < floor) c.alive = false;
      }
      dummy.position.copy(c.p);
      dummy.rotation.copy(c.r);
      dummy.scale.setScalar(c.alive ? c.s : 0);
      dummy.updateMatrix();
      coins.setMatrixAt(i, dummy.matrix);
    }
    coins.instanceMatrix.needsUpdate = true;

    // Sparkles.
    for (let i = 0; i < SPARKS; i++) {
      const s = spark[i];
      if (s.alive) {
        s.life += dt;
        const k = s.life / s.max;
        if (k >= 1) s.alive = false;
        else if (s.target) s.p.lerp(s.target, Math.min(1, dt * 6));
        else {
          s.p.addScaledVector(s.v, dt);
          s.v.multiplyScalar(Math.pow(0.08, dt));
        }
        sAlpha[i] = s.alive ? Math.sin(k * Math.PI) : 0;
        sSize[i] = s.size * (0.6 + 0.4 * Math.sin(k * Math.PI));
      } else {
        sAlpha[i] = 0;
      }
      sPos[i * 3] = s.p.x;
      sPos[i * 3 + 1] = s.p.y;
      sPos[i * 3 + 2] = s.p.z;
    }
    sGeo.attributes.position.needsUpdate = true;
    sGeo.attributes.aAlpha.needsUpdate = true;
    sGeo.attributes.aSize.needsUpdate = true;
    sGeo.attributes.aColor.needsUpdate = true;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(step);
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    coins.dispose();
    textures.forEach((x) => x.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
  }

  // Compile every shader (the lit coin material especially) BEFORE the
  // timeline starts -- otherwise the first frame stalls on compilation right
  // in the middle of the drop-in. The overlay's backdrop is already fading
  // in meanwhile, so the wait is hidden behind it.
  // compileAsync alone isn't enough: some GL drivers (ANGLE included) only
  // link a program on its first real draw, so one throwaway render follows.
  // The buddy starts above the top edge and every coin/spark is at zero
  // size/alpha, so this frame shows nothing.
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    // Older WebGL paths: the warm-up render below does the work instead.
  }
  renderer.render(scene, camera);
  await new Promise((r) => requestAnimationFrame(r));
  // The overlay only fades its backdrop in now -- so nothing is dimmed or
  // blurred while the scene is still being prepared.
  onPhase('ready', Math.round(performance.now() - tStart));

  raf = requestAnimationFrame((now) => {
    last = now;
    step(now);
  });

  return {
    done,
    dismiss() {
      if (t >= T.tapAfter) beginExit();
    },
    // For when the component is torn down mid-run.
    abort() {
      if (finished) return;
      finished = true;
      cleanup();
      resolveDone();
    },
  };
}
