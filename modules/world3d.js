/**
 * modules/world3d.js — Modo 3D para TODOS los mapas de PokePoke.
 *
 * Convierte el mapa GBA que ya conoce TileMapRenderer en un diorama 3D:
 *  - conserva el arte 2D como suelo (imagen oficial o fondo procedimental),
 *  - extruye edificios, muros, árboles, flores, items y salidas,
 *  - representa jugador, NPCs y entrenadores online con sprites animados,
 *  - añade cámara orbital, sombras, clima, partículas y etiquetas/chats.
 *
 * La lógica de movimiento, colisiones, encuentros y combate sigue viviendo en
 * TileMapRenderer/admin.js: este módulo es sólo una capa de presentación.
 */
(function (global) {
  'use strict';

  const THREE = global.THREE;
  if (!THREE) {
    console.warn('[World3D] three.js no está cargado; el mapa seguirá en 2D.');
    return;
  }

  const UNIT = 16; // píxeles lógicos del mapa por unidad 3D
  const DIR_ROW = { down: 0, left: 1, right: 2, up: 3 };
  const BANDANA_COLORS = ['#76bd45', '#e66d61', '#5da7e8', '#a879d8', '#e6ad45', '#49bda7'];
  const MAX_PIXEL_RATIO = 1.65;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash;
  }

  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function variantFromStyle(style, seed) {
    const match = String(style || '').match(/^brendan:([0-5])$/);
    if (match) return Number(match[1]);
    return hashString(seed || style || '') % BANDANA_COLORS.length;
  }

  function colorFromHex(hex, fallback) {
    try { return new THREE.Color(hex); } catch (error) { return new THREE.Color(fallback); }
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  function canvasTexture(canvas, options = {}) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.magFilter = options.smooth ? THREE.LinearFilter : THREE.NearestFilter;
    texture.minFilter = options.smooth ? THREE.LinearFilter : THREE.NearestFilter;
    texture.generateMipmaps = !!options.smooth;
    texture.needsUpdate = true;
    return texture;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function labelTexture(text, options = {}) {
    const canvas = makeCanvas(512, 128);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    roundedRect(ctx, 16, 18, 480, 84, 30);
    ctx.fillStyle = options.local ? 'rgba(16,113,104,.94)' : 'rgba(12,30,42,.88)';
    ctx.fill();
    ctx.strokeStyle = options.local ? '#f2cc76' : 'rgba(255,255,255,.42)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = '#fff8e8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 36px Inter, Segoe UI, system-ui, sans-serif';
    ctx.fillText(String(text || 'Entrenador').slice(0, 20), 256, 61);
    return canvasTexture(canvas, { smooth: true });
  }

  function bubbleTexture(text) {
    const value = String(text || '').slice(0, 90);
    const canvas = makeCanvas(512, 512);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 512);
    roundedRect(ctx, 40, 34, 432, 330, 54);
    ctx.fillStyle = 'rgba(255,249,231,.97)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(23,53,74,.35)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(216, 358);
    ctx.lineTo(256, 434);
    ctx.lineTo(298, 358);
    ctx.fillStyle = 'rgba(255,249,231,.97)';
    ctx.fill();
    ctx.fillStyle = '#17354a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = [];
    let current = '';
    for (const word of value.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > 18 && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
      if (lines.length >= 3) break;
    }
    if (current && lines.length < 3) lines.push(current);
    const isEmoji = value.length <= 4 && !/[a-z0-9]/i.test(value);
    if (isEmoji) {
      ctx.font = '210px system-ui, "Segoe UI Emoji", sans-serif';
      ctx.fillText(value, 256, 210);
    } else {
      ctx.font = '700 48px Inter, Segoe UI, system-ui, sans-serif';
      lines.forEach((line, index) => {
        const trimmed = line.length > 18 ? `${line.slice(0, 17)}…` : line;
        ctx.fillText(trimmed, 256, 150 + index * 62);
      });
    }
    return canvasTexture(canvas, { smooth: true });
  }

  function pokeballTexture() {
    const canvas = makeCanvas(512, 512);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 512);
    ctx.beginPath();
    ctx.arc(256, 256, 238, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = '#f5f6fa';
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(256, 256, 238, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#e84118';
    ctx.fillRect(18, 18, 476, 238);
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(18, 240, 476, 32);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(256, 256, 66, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1b1b';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(256, 256, 46, 0, Math.PI * 2);
    ctx.fillStyle = '#f5f6fa';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(256, 256, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1b1b';
    ctx.fill();
    return canvasTexture(canvas, { smooth: true });
  }

  function titleTexture(title, subtitle) {
    const canvas = makeCanvas(1024, 256);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#12343a';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = '#e9b85e';
    ctx.lineWidth = 12;
    ctx.strokeRect(10, 10, 1004, 236);
    ctx.fillStyle = '#fff3ce';
    ctx.textAlign = 'center';
    ctx.font = '800 74px Inter, Segoe UI, system-ui, sans-serif';
    ctx.fillText(title, 512, 118);
    ctx.fillStyle = '#8fd8b6';
    ctx.font = '600 30px Inter, Segoe UI, system-ui, sans-serif';
    ctx.fillText(subtitle, 512, 178);
    return canvasTexture(canvas, { smooth: true });
  }

  const THEMES = {
    grass: {
      name: 'grass',
      bg: 0x8fc7ad, fog: 0x9bcbb3, sky: 0xfff0ca, ground: 0x315b45,
      wall: 0x4b7045, wallTop: 0x6b9557, building: 0xe0c9a4, roof: 0xb95843,
      trim: 0xe9b85e, tree: 0x2f7a3d, treeLight: 0x4a9b50, flower: 0xf2c94c,
      outdoor: true, indoor: false, exposed: 1,
    },
    city: {
      name: 'city',
      bg: 0xa9d4b5, fog: 0xb7dcc3, sky: 0xfff2d2, ground: 0x4a7a4f,
      wall: 0x6b7d67, wallTop: 0x8b9a82, building: 0xf0dfc0, roof: 0xc45b48,
      trim: 0xe9b85e, tree: 0x2f7a3d, treeLight: 0x55a75a, flower: 0xee7a8b,
      outdoor: true, indoor: false, exposed: 1,
    },
    water: {
      name: 'water',
      bg: 0x5ab6cf, fog: 0x6fc3d8, sky: 0xd9fbff, ground: 0x145a7e,
      wall: 0x2c6f7e, wallTop: 0x3d8f99, building: 0xe9d3ac, roof: 0xc1604c,
      trim: 0xe9b85e, tree: 0x2f7a3d, treeLight: 0x55a75a, flower: 0xffffff,
      outdoor: true, indoor: false, exposed: 1, sea: true,
    },
    underwater: {
      name: 'underwater',
      bg: 0x0a2c4d, fog: 0x0b3355, sky: 0x4ab8d8, ground: 0x123f5d,
      wall: 0x1f5d75, wallTop: 0x2b7b8d, building: 0x3a7b8d, roof: 0x386a7b,
      trim: 0x74e0e8, tree: 0x2f7a6d, treeLight: 0x4db39d, flower: 0x9ff6ff,
      outdoor: false, indoor: false, dark: true, underwater: true,
    },
    cave: {
      name: 'cave',
      bg: 0x2a261f, fog: 0x211e18, sky: 0x7a6a50, ground: 0x241f18,
      wall: 0x3b3328, wallTop: 0x615340, building: 0x554839, roof: 0x3d342a,
      trim: 0xb38b54, tree: 0x3b4d35, treeLight: 0x596b47, flower: 0xd8b86a,
      outdoor: false, indoor: true, dark: true, cave: true,
    },
    indoor: {
      name: 'indoor',
      bg: 0xc5a57b, fog: 0xd6bb95, sky: 0xfff4d8, ground: 0x9d7d58,
      wall: 0xead9ba, wallTop: 0xf6e9cf, building: 0xd2af82, roof: 0x8f6848,
      trim: 0xe9b85e, tree: 0x4d8d50, treeLight: 0x6cb06c, flower: 0xe66d61,
      outdoor: false, indoor: true, exposed: 0.85,
    },
    hotel: {
      name: 'hotel',
      bg: 0x102d35, fog: 0x183f45, sky: 0xffe0ae, ground: 0x3d2314,
      wall: 0xffefd0, wallTop: 0xfff7e6, building: 0x167d78, roof: 0x0e4e51,
      trim: 0xe9b85e, tree: 0x3b8b62, treeLight: 0x77b967, flower: 0xd96352,
      outdoor: false, indoor: true,
    },
    reference: {
      name: 'reference',
      bg: 0x102a2f, fog: 0x102a2f, sky: 0x8fd8b6, ground: 0x102a2f,
      wall: 0x0f2429, wallTop: 0x183b43, building: 0x1d4b54, roof: 0x163b43,
      trim: 0xe9b85e, tree: 0x2f7a6d, treeLight: 0x49bda7, flower: 0x8fd8b6,
      outdoor: false, indoor: false, exposed: 0.6, reference: true,
    },
  };

  function resolveTheme(mapId, map, isDark) {
    const id = String(mapId || '').toLowerCase();
    if (id.includes('hotel') || id.includes('lobby') || id.includes('union')) return THEMES.hotel;
    if (id === 'underwater' || id.includes('underwater')) return THEMES.underwater;
    if (id.startsWith('reference_')) return THEMES.reference;
    if (
      id.includes('cave') || id.includes('tunnel') || id.includes('falls') ||
      id.includes('path') || id.includes('mountain') || id.includes('pyre') ||
      id.includes('hideout') || id.includes('victory_road') || id.includes('shoal') ||
      id.includes('abandoned_ship')
    ) return THEMES.cave;
    if (
      id.includes('pokemon_center') || id.includes('poke_mart') || id.includes('birch_lab') ||
      id.includes('gym_')
    ) return THEMES.indoor;
    if (id === 'overworld') return THEMES.grass;
    if (/route_(105|106|107|108|109|124|125|126|127|128|129|130|131|132|133|134)$/.test(id)) return THEMES.water;
    if (id.includes('city') || id.includes('town')) return THEMES.city;
    const theme = THEMES.grass;
    if (isDark) return Object.assign({}, theme, { dark: true });
    return theme;
  }

  function detectWeather(mapId) {
    const id = String(mapId || '').toLowerCase();
    if (/route_(119|120|121|123)/.test(id) || id.includes('fortree')) return 'RAIN';
    if (id.includes('desert') || id.includes('safari')) return 'SANDSTORM';
    if (id.includes('chimney') || id.includes('pyre') || id.includes('lavaridge')) return 'ASH';
    return 'NONE';
  }

  /* =========================================================================
     Avatares (sprites animados + placa de nombre + burbuja de chat/emote)
     ========================================================================= */
  class Avatar3D {
    constructor(world, options) {
      this.world = world;
      this.key = options.key;
      this.local = !!options.local;
      this.kind = options.kind || 'player';
      this.data = options.data || {};
      this.group = new THREE.Group();
      this.group.scale.setScalar(world.avatarScale || 1);
      this.group.userData.pick = options.pick || { type: this.kind, data: this.data };
      this.name = String(this.data.name || '').slice(0, 20);
      this.variant = Number(this.data.variant) || 0;
      this.dir = this.data.dir || 'down';
      this.animTime = 0;
      this.bubble = null;
      this.bubbleUntil = 0;
      this.bubbleText = '';

      this.material = new THREE.SpriteMaterial({
        transparent: true,
        alphaTest: 0.06,
        depthWrite: false,
        sizeAttenuation: true,
      });
      this.sprite = new THREE.Sprite(this.material);
      this.sprite.scale.set(2.55, 2.55, 1);
      this.sprite.position.y = 1.22;
      this.sprite.center.set(0.5, 0.5);
      this.sprite.castShadow = false;
      this.group.add(this.sprite);

      this.shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.5, 22),
        new THREE.MeshBasicMaterial({ color: 0x102b30, transparent: true, opacity: 0.24, depthWrite: false }),
      );
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.025;
      this.shadow.scale.set(1, 0.58, 1);
      this.shadow.castShadow = false;
      this.shadow.receiveShadow = false;
      this.group.add(this.shadow);

      this.label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: labelTexture(this.name, { local: this.local }),
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }));
      this.label.scale.set(2.5, 0.62, 1);
      this.label.position.y = this.kind === 'npc' ? 2.55 : 2.75;
      this.label.renderOrder = 20;
      this.label.castShadow = false;
      this.group.add(this.label);

      this.setVariant(this.variant);
      this.setPosition(
        (Number(this.data.x) || 0) / UNIT,
        (Number(this.data.y) || 0) / UNIT,
      );
    }

    setPosition(x, z) {
      this.targetX = x;
      this.targetZ = z;
      this.group.position.x = x;
      this.group.position.z = z;
    }

    setVariant(variant) {
      const index = ((Number(variant) || 0) % BANDANA_COLORS.length + BANDANA_COLORS.length) % BANDANA_COLORS.length;
      this.variant = index;
      this.material.map?.dispose();
      const base = this.world.getAvatarTexture(index);
      this.material.map = base.clone();
      this.material.map.needsUpdate = true;
      this.material.needsUpdate = true;
      this.applyFrame(0);
    }

    setName(name, local) {
      const clean = String(name || 'Entrenador').slice(0, 20);
      if (clean === this.name && this.local === !!local) return;
      this.name = clean;
      this.local = !!local;
      this.label.material.map?.dispose();
      this.label.material.map = labelTexture(clean, { local: this.local });
      this.label.material.needsUpdate = true;
    }

    applyFrame(frame) {
      if (!this.material.map) return;
      const row = DIR_ROW[this.dir] ?? 0;
      const col = ((Number(frame) || 0) % 4 + 4) % 4;
      this.material.map.offset.set(col * 0.25, row * 0.25);
      this.material.map.repeat.set(0.25, 0.25);
    }

    update(dt, now, data) {
      this.data = data;
      if (data.name) this.setName(data.name, this.local);
      if (Number(data.variant) !== this.variant && data.variant != null) this.setVariant(data.variant);
      if (data.dir && data.dir !== this.dir) this.dir = data.dir;

      const moving = !!data.moving;
      const running = !!data.running;
      this.animTime += dt * (running ? 12 : moving ? 8 : 2.4);
      const frame = moving ? (Math.floor(this.animTime) % 4) : 0;
      this.applyFrame(frame);

      const targetX = (Number(data.x) || 0) / UNIT;
      const targetZ = (Number(data.y) || 0) / UNIT;
      this.targetX = targetX;
      this.targetZ = targetZ;
      this.group.position.x = damp(this.group.position.x, targetX, 16, dt);
      this.group.position.z = damp(this.group.position.z, targetZ, 16, dt);

      const bob = moving
        ? Math.abs(Math.sin(this.animTime * 1.5)) * 0.055
        : Math.sin(now * 0.0018 + (this.data.seed || 0)) * 0.018;
      this.sprite.position.y = 1.22 + bob;
      this.shadow.scale.set(moving ? 1.06 : 1, 0.58, 1);

      const bubbleText = String(data.bubble || data.chat_bubble || '').trim();
      const nowMs = Date.now();
      if (bubbleText) {
        let until = Number(data.bubbleUntil || 0);
        if (!until) until = Number(data.chat_bubble_until || 0) * 1000;
        if (until && until <= nowMs) {
          this.clearBubble();
        } else {
          this.setBubble(bubbleText, until > nowMs ? until : nowMs + 4200);
        }
      } else if (this.bubble && nowMs > this.bubbleUntil) {
        this.clearBubble();
      }
      if (this.bubble) {
        this.bubble.position.y = (this.kind === 'npc' ? 2.55 : 2.75) + 0.9 + Math.sin(now * 0.005) * 0.06;
        if (nowMs > this.bubbleUntil) this.clearBubble();
      }
    }

    setBubble(text, until) {
      const clean = String(text || '').slice(0, 90);
      if (clean === this.bubbleText && this.bubble) {
        this.bubbleUntil = Math.max(this.bubbleUntil, until || Date.now() + 4000);
        return;
      }
      this.clearBubble();
      this.bubbleText = clean;
      this.bubbleUntil = until || Date.now() + 4200;
      this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({
        map: bubbleTexture(clean),
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }));
      this.bubble.scale.set(1.95, 1.95, 1);
      this.bubble.position.set(0.9, (this.kind === 'npc' ? 2.55 : 2.75) + 0.9, 0);
      this.bubble.renderOrder = 25;
      this.group.add(this.bubble);
    }

    showEmote(emoji, duration = 2800) {
      this.setBubble(emoji, Date.now() + duration);
    }

    clearBubble() {
      if (!this.bubble) return;
      this.group.remove(this.bubble);
      this.bubble.material.map?.dispose();
      this.bubble.material.dispose();
      this.bubble = null;
      this.bubbleText = '';
    }

    dispose() {
      this.clearBubble();
      this.group.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : (object.material ? [object.material] : []);
        materials.forEach((material) => {
          if (material.map) material.map.dispose();
          material.dispose();
        });
      });
      this.group.parent?.remove(this.group);
    }
  }

  /* =========================================================================
     World3D
     ========================================================================= */
  class World3D {
    constructor(container, options = {}) {
      this.container = typeof container === 'string' ? document.getElementById(container) : container;
      if (!this.container) throw new Error('World3D: contenedor no encontrado');

      this.view = options.view || global.worldTileRenderer || null;
      this.options = options;
      this.map = options.map || {};
      this.mapId = options.mapId || this.map.id || 'littleroot_town';
      this.mapName = options.name || this.map.name || this.mapId;
      this.mapWidth = Number(options.width || this.map.width || 640);
      this.mapHeight = Number(options.height || this.map.height || 512);
      this.theme = resolveTheme(this.mapId, this.map, !!(options.isDark || this.map.isDark));
      this.imageUrl = options.image || this.map.image || null;
      this.avatarScale = (this.imageUrl && this.theme.indoor) ? 1.55 : 1;
      this.obstacles = options.obstacles || this.map.obstacles || [];
      this.npcs = options.npcs || this.map.npcs || [];
      this.items = options.items || this.map.items || [];
      this.exits = options.exits || this.map.exits || [];
      this.signs = options.signs || this.map.signs || [];
      this.seats = options.seats || this.map.seats || [];
      this.flowerPatches = options.flowerPatches || this.map.flowerPatches || [];
      this.weatherType = detectWeather(this.mapId);

      this.enabled = true;
      this.paused = false;
      this.disposed = false;
      this.ready = false;
      this.root = null;
      this.avatars = new Map();
      this.npcAvatars = new Map();
      this.itemObjects = new Map();
      this.pickables = [];
      this.animated = [];
      this.droplets = [];
      this.dust = null;
      this.weather = null;
      this.clock = new THREE.Clock();
      this.elapsed = 0;
      this.lastHudUpdate = 0;
      this.pointer = { down: false, x: 0, y: 0, moved: 0 };
      this.raycaster = new THREE.Raycaster();
      this.savedCamera = global.__world3dCamera || null;
      this.yaw = this.savedCamera ? this.savedCamera.yaw : (this.theme.name === 'hotel' ? 0.35 : 0.68);
      this.pitch = this.savedCamera ? this.savedCamera.pitch : 0.93;
      this.distance = this.savedCamera ? this.savedCamera.distance : (
        this.theme.reference ? 34 :
        this.theme.name === 'hotel' ? 18 :
        (this.imageUrl && this.theme.indoor) ? 16 : 21
      );
      this.avatarTextures = [];
      this.sheetImage = null;
      this.sheetReady = false;
      this.localVariant = getStoredVariant();
      this.cameraLookAhead = this.theme.name === 'hotel' ? -4.0 : (this.imageUrl && this.theme.indoor ? -1.6 : 0);
      this.terminalGroup = null;
      this.fountain = null;
      this.arenaGlow = null;

      this.initRenderer();
      this.initScene();
      this.resize();
      this.build();
      this.bindEvents();
      this.loadSpriteSheet();
      this.loop();
    }

    /* ---------------------------- Infraestructura ---------------------------- */
    initRenderer() {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'world3d-canvas';
      this.canvas.setAttribute('aria-label', `Mapa 3D de ${this.mapName}`);
      this.canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block; outline:none; touch-action:none;';
      this.container.appendChild(this.canvas);

      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, MAX_PIXEL_RATIO));
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    initScene() {
      const theme = this.theme;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(theme.bg);
      this.scene.fog = new THREE.Fog(
        theme.fog,
        theme.reference ? 44 : Math.max(26, Math.min(this.mapWidth, this.mapHeight) / 26),
        theme.reference ? 130 : Math.max(65, Math.max(this.mapWidth, this.mapHeight) / 14),
      );

      this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 700);
      this.hemisphere = new THREE.HemisphereLight(theme.sky, theme.ground, theme.dark ? 0.95 : theme.indoor ? 1.05 : 1.45);
      this.scene.add(this.hemisphere);

      this.sun = new THREE.DirectionalLight(theme.dark ? 0xffd6a0 : 0xffe7bd, theme.dark ? 1.0 : theme.indoor ? 1.15 : 1.65);
      this.sun.position.set(-18, 32, 14);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      this.sun.shadow.camera.left = -28;
      this.sun.shadow.camera.right = 28;
      this.sun.shadow.camera.top = 28;
      this.sun.shadow.camera.bottom = -28;
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 90;
      this.sun.shadow.bias = -0.0006;
      this.scene.add(this.sun);
      this.scene.add(this.sun.target);

      this.playerLight = new THREE.PointLight(theme.dark ? 0xffc777 : 0xffe4b0, theme.dark ? 1.55 : theme.indoor ? 0.9 : 0.25, 20, 2);
      this.playerLight.position.set(0, 3.2, 0);
      this.scene.add(this.playerLight);
    }

    /* ------------------------------ Construcción ----------------------------- */
    build() {
      if (this.root) this.disposeRoot();
      this.avatars.forEach((avatar) => avatar.dispose());
      this.avatars.clear();
      this.npcAvatars.forEach((avatar) => avatar.dispose());
      this.npcAvatars.clear();
      this.itemObjects.clear();
      this.pickables = [];
      this.animated = [];
      this.droplets = [];
      this.terminalGroup = null;
      this.fountain = null;
      this.arenaGlow = null;

      this.root = new THREE.Group();
      this.root.name = 'world3d-root';
      this.scene.add(this.root);

      this.buildFloor();
      if (this.theme.name === 'hotel') {
        this.buildHotel();
        this.buildSeats();
        this.buildExitsSignsItems();
      } else {
        this.buildObstacles();
        this.buildDecorations();
        this.buildExitsSignsItems();
        this.buildSeats();
        if (this.theme.reference) this.buildReferenceFrame();
      }
      this.buildAtmosphere();

      const player = this.view ? this.view.playerPos : this.map.spawn || { x: this.mapWidth / 2, y: this.mapHeight / 2 };
      this.cameraTarget = new THREE.Vector3((player.x || 0) / UNIT, 1.1, (player.y || 0) / UNIT);
      this.cameraPosition = this.cameraTarget.clone();
      this.ready = true;
      this.syncAvatars(0.016, performance.now(), true);
      this.syncNpcs(0.016, performance.now(), true);
      this.updateCamera(0.016, true);
    }

    buildFloor() {
      const width = this.mapWidth / UNIT;
      const height = this.mapHeight / UNIT;
      const theme = this.theme;

      const base = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.7, height),
        new THREE.MeshStandardMaterial({ color: theme.name === 'hotel' ? 0x1d1109 : 0x1c2b24, roughness: 0.96 }),
      );
      base.position.set(width / 2, -0.37, height / 2);
      base.receiveShadow = true;
      this.root.add(base);

      const texture = this.floorTexture();
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        color: texture ? 0xffffff : new THREE.Color(theme.ground),
        roughness: 0.93,
        metalness: 0,
      });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(width / 2, 0.001, height / 2);
      floor.receiveShadow = true;
      floor.name = 'world3d-floor';
      this.root.add(floor);

      if (this.theme.sea || this.theme.underwater) this.buildWaterSurface(width, height);
    }

    floorTexture() {
      try {
        if (this.imageUrl) {
          const loader = new THREE.TextureLoader();
          const texture = loader.load(encodeURI(this.imageUrl), (loaded) => {
            loaded.encoding = THREE.sRGBEncoding;
            loaded.needsUpdate = true;
          });
          texture.encoding = THREE.sRGBEncoding;
          texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          return texture;
        }
        if (this.theme.name === 'hotel') return this.hotelFloorTexture();
        return this.capture2DBackground();
      } catch (error) {
        console.warn('[World3D] No se pudo generar el suelo:', error);
        return null;
      }
    }

    capture2DBackground() {
      const view = this.view;
      if (!view || typeof view.renderProceduralBackground !== 'function' || !view.ctx) return null;
      const width = Number(view.mapWidth || this.mapWidth);
      const height = Number(view.mapHeight || this.mapHeight);
      const scale = Math.min(1, 2048 / Math.max(width, height));
      const canvas = makeCanvas(width * scale, height * scale);
      const ctx = canvas.getContext('2d');
      const originalCtx = view.ctx;
      const originalImage = view.mapImage;
      try {
        view.ctx = ctx;
        view.mapImage = null;
        ctx.save();
        ctx.scale(scale, scale);
        view.renderProceduralBackground();
        ctx.restore();
      } finally {
        view.ctx = originalCtx;
        view.mapImage = originalImage;
      }
      const texture = canvasTexture(canvas, { smooth: false });
      texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      return texture;
    }

    hotelFloorTexture() {
      const width = 800;
      const height = 640;
      const canvas = makeCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#3d2314';
      ctx.fillRect(0, 0, width, height);
      for (let y = 0; y < height; y += 32) {
        for (let x = 0; x < width; x += 32) {
          ctx.fillStyle = (Math.floor(x / 32) + Math.floor(y / 32)) % 2 === 0 ? '#4e2d1a' : '#452716';
          ctx.fillRect(x, y, 32, 32);
          ctx.fillStyle = 'rgba(0,0,0,.12)';
          ctx.fillRect(x, y, 32, 2);
          ctx.fillRect(x, y, 2, 32);
        }
      }
      // Alfombra central
      const carpet = ctx.createLinearGradient(0, 180, 0, 620);
      carpet.addColorStop(0, '#7f1d1d');
      carpet.addColorStop(1, '#9c1f1f');
      ctx.fillStyle = carpet;
      ctx.fillRect(330, 190, 140, 420);
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 5;
      ctx.strokeRect(330, 190, 140, 420);
      ctx.strokeStyle = 'rgba(255,232,176,.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(342, 202, 116, 396);
      // Vetas y brillos del parquet
      ctx.strokeStyle = 'rgba(255,210,140,.06)';
      ctx.lineWidth = 1;
      for (let y = 16; y < height; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y + 8);
        ctx.stroke();
      }
      const texture = canvasTexture(canvas, { smooth: true });
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      return texture;
    }

    buildWaterSurface(width, height) {
      const material = new THREE.MeshStandardMaterial({
        color: 0x2b9dc2,
        roughness: 0.22,
        metalness: 0.12,
        transparent: true,
        opacity: 0.72,
      });
      const water = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 1), material);
      water.rotation.x = -Math.PI / 2;
      water.position.set(width / 2, 0.06, height / 2);
      water.receiveShadow = true;
      this.root.add(water);
      this.animated.push((dt, now) => {
        water.position.y = 0.06 + Math.sin(now * 0.0014) * 0.018;
        material.opacity = 0.68 + Math.sin(now * 0.0019) * 0.05;
      });
      for (let i = 0; i < 26; i++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.5 + Math.random() * 1.3, 0.025, 4, 20),
          new THREE.MeshBasicMaterial({ color: 0xbdf7ff, transparent: true, opacity: 0.35 }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(Math.random() * width, 0.075, Math.random() * height);
        this.root.add(ring);
        this.animated.push((dt, now) => {
          ring.scale.setScalar(1 + Math.sin(now * 0.001 + ring.position.x) * 0.08);
          ring.material.opacity = 0.22 + Math.sin(now * 0.0015 + ring.position.z) * 0.12;
        });
      }
    }

    box(width, height, depth, x, y, z, color, options = {}) {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: options.roughness == null ? 0.82 : options.roughness,
        metalness: options.metalness || 0,
        emissive: options.emissive || 0x000000,
        emissiveIntensity: options.emissiveIntensity || 0,
        transparent: !!options.transparent,
        opacity: options.opacity == null ? 1 : options.opacity,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = options.castShadow !== false;
      mesh.receiveShadow = options.receiveShadow !== false;
      (options.parent || this.root).add(mesh);
      return mesh;
    }

    cylinder(radiusTop, radiusBottom, height, x, y, z, color, options = {}) {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: options.roughness == null ? 0.78 : options.roughness,
        metalness: options.metalness || 0,
        emissive: options.emissive || 0x000000,
        emissiveIntensity: options.emissiveIntensity || 0,
        transparent: !!options.transparent,
        opacity: options.opacity == null ? 1 : options.opacity,
      });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, options.segments || 24), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = options.castShadow !== false;
      mesh.receiveShadow = options.receiveShadow !== false;
      (options.parent || this.root).add(mesh);
      return mesh;
    }

    buildObstacles() {
      const theme = this.theme;
      const mapWidth = this.mapWidth;
      const mapHeight = this.mapHeight;
      const imageMap = !!this.imageUrl;
      if (imageMap) {
        this.buildImageRelief();
        return;
      }
      const isEdge = (obstacle) => (
        obstacle.x <= 6 ||
        obstacle.y <= 6 ||
        obstacle.x + obstacle.w >= mapWidth - 6 ||
        obstacle.y + obstacle.h >= mapHeight - 6
      );

      this.obstacles.forEach((obstacle, index) => {
        if (!obstacle || !obstacle.w || !obstacle.h) return;
        const edge = isEdge(obstacle);
        const width = obstacle.w / UNIT;
        const depth = obstacle.h / UNIT;
        const x = (obstacle.x + obstacle.w / 2) / UNIT;
        const z = (obstacle.y + obstacle.h / 2) / UNIT;
        const longSide = Math.max(width, depth);

        if (edge) {
          const height = theme.cave ? 2.7 : theme.indoor ? 2.0 : 1.35;
          const wall = this.box(
            width,
            height,
            depth,
            x,
            height / 2,
            z,
            theme.wall,
            { roughness: 0.92 },
          );
          // remate superior para que el borde se lea como un muro 3D
          this.box(
            width + 0.1,
            0.16,
            depth + 0.1,
            x,
            height + 0.07,
            z,
            theme.wallTop,
            { roughness: 0.9 },
          );
          if (theme.name === 'hotel') wall.material.color.set(0x231309);
          return;
        }

        const building = obstacle.w >= 58 && obstacle.h >= 48;
        if (building) {
          const height = clamp(1.9 + Math.min(width, depth) * 0.035, 2.0, 3.0);
          const body = this.box(width, height, depth, x, height / 2, z, theme.building, { roughness: 0.86 });
          const roof = this.box(
            width + 0.5,
            0.32,
            depth + 0.5,
            x,
            height + 0.12,
            z,
            theme.roof,
            { roughness: 0.8 },
          );
          roof.castShadow = true;
          // alero dorado
          this.box(width + 0.65, 0.08, depth + 0.65, x, height - 0.12, z, theme.trim, { roughness: 0.55, metalness: 0.15 });
          // ventanas emisivas en la fachada sur (la que mira a cámara)
          const rows = height > 2.55 ? 2 : 1;
          const windowCount = Math.max(1, Math.floor(width / 2.2));
          for (let row = 0; row < rows; row++) {
            for (let col = 0; col < windowCount; col++) {
              const wx = x - width / 2 + (col + 0.5) * (width / windowCount);
              const wy = 1.12 + row * 0.85;
              const window = this.box(0.72, 0.58, 0.08, wx, wy, z + depth / 2 + 0.05, 0x9fdcdf, {
                emissive: 0x2e7d85,
                emissiveIntensity: 0.55,
                roughness: 0.25,
                castShadow: false,
              });
              window.material.transparent = true;
              window.material.opacity = 0.92;
            }
          }
          // puerta
          this.box(1.15, 1.45, 0.1, x, 0.74, z + depth / 2 + 0.06, 0x5c3a26, { roughness: 0.8, castShadow: false });
          // pequeño letrero en el tejado
          if (index % 3 === 0) {
            const sign = new THREE.Mesh(
              new THREE.PlaneGeometry(Math.min(width * 0.7, 5.5), 0.9),
              new THREE.MeshBasicMaterial({
                map: titleTexture('POKÉPOKE', this.mapName.split(' (')[0].toUpperCase()),
                transparent: true,
              }),
            );
            sign.position.set(x, height + 0.75, z + depth / 2 + 0.2);
            this.root.add(sign);
          }
          body.receiveShadow = true;
        } else {
          // Rocas, cajas, setos o puestos pequeños.
          const height = clamp(0.35 + longSide * 0.06, 0.35, 0.95);
          const isRock = theme.cave || index % 3 === 0;
          const color = isRock ? theme.wallTop : (theme.indoor ? theme.building : theme.treeLight);
          if (isRock) {
            const rock = new THREE.Mesh(
              new THREE.IcosahedronGeometry(Math.max(width, depth) * 0.52, 0),
              new THREE.MeshStandardMaterial({ color, roughness: 0.96, flatShading: true }),
            );
            rock.scale.set(width / Math.max(width, depth), height / Math.max(width, depth), depth / Math.max(width, depth));
            rock.position.set(x, height * 0.45, z);
            rock.castShadow = true;
            rock.receiveShadow = true;
            this.root.add(rock);
          } else {
            this.box(width, height, depth, x, height / 2, z, color, { roughness: 0.9 });
          }
        }
      });
    }

    /**
     * Para mapas con lámina oficial: el arte 2D se queda como suelo y se
     * levantan muros bajos alrededor de los edificios/obstáculos. Así se
     * conserva el dibujo original pero el mapa gana volumen real.
     */
    buildImageRelief() {
      const theme = this.theme;
      const width = this.mapWidth / UNIT;
      const height = this.mapHeight / UNIT;
      const mapWidth = this.mapWidth;
      const mapHeight = this.mapHeight;
      const isEdge = (obstacle) => (
        obstacle.x <= 6 || obstacle.y <= 6 ||
        obstacle.x + obstacle.w >= mapWidth - 6 ||
        obstacle.y + obstacle.h >= mapHeight - 6
      );

      // Marco bajo del diorama.
      const frameColor = theme.reference ? 0xe9b85e : theme.wallTop;
      this.box(width + 0.3, 0.2, 0.22, width / 2, 0.1, 0.11, frameColor, { roughness: 0.6, metalness: theme.reference ? 0.25 : 0 });
      this.box(width + 0.3, 0.2, 0.22, width / 2, 0.1, height - 0.11, frameColor, { roughness: 0.6, metalness: theme.reference ? 0.25 : 0 });
      this.box(0.22, 0.2, height, 0.11, 0.1, height / 2, frameColor, { roughness: 0.6, metalness: theme.reference ? 0.25 : 0 });
      this.box(0.22, 0.2, height, width - 0.11, 0.1, height / 2, frameColor, { roughness: 0.6, metalness: theme.reference ? 0.25 : 0 });

      if (theme.reference) return;

      (this.obstacles || []).forEach((obstacle) => {
        if (!obstacle || !obstacle.w || !obstacle.h || isEdge(obstacle)) return;
        const x1 = obstacle.x / UNIT;
        const z1 = obstacle.y / UNIT;
        const w = obstacle.w / UNIT;
        const d = obstacle.h / UNIT;
        const x2 = x1 + w;
        const z2 = z1 + d;
        const building = obstacle.w >= 58 && obstacle.h >= 48;
        const wallHeight = building ? 0.92 : 0.34;
        const thickness = building ? 0.18 : 0.12;
        const color = building ? theme.building : theme.trim;
        const trim = building ? theme.roof : theme.wallTop;

        if (building) {
          // Cuatro muros perimetrales, sin techo: la lámina del edificio
          // sigue visible desde la cámara.
          this.box(w, wallHeight, thickness, x1 + w / 2, wallHeight / 2, z1 + thickness / 2, color, { roughness: 0.84 });
          this.box(w, wallHeight, thickness, x1 + w / 2, wallHeight / 2, z2 - thickness / 2, color, { roughness: 0.84 });
          this.box(thickness, wallHeight, d, x1 + thickness / 2, wallHeight / 2, z1 + d / 2, color, { roughness: 0.84 });
          this.box(thickness, wallHeight, d, x2 - thickness / 2, wallHeight / 2, z1 + d / 2, color, { roughness: 0.84 });
          // Remate superior.
          this.box(w + 0.04, 0.08, 0.08, x1 + w / 2, wallHeight + 0.04, z1 + thickness / 2, trim, { roughness: 0.6 });
          this.box(w + 0.04, 0.08, 0.08, x1 + w / 2, wallHeight + 0.04, z2 - thickness / 2, trim, { roughness: 0.6 });
          this.box(0.08, 0.08, d, x1 + thickness / 2, wallHeight + 0.04, z1 + d / 2, trim, { roughness: 0.6 });
          this.box(0.08, 0.08, d, x2 - thickness / 2, wallHeight + 0.04, z1 + d / 2, trim, { roughness: 0.6 });
        } else {
          this.box(w, wallHeight, d, x1 + w / 2, wallHeight / 2, z1 + d / 2, color, {
            roughness: 0.8,
            transparent: true,
            opacity: 0.72,
          });
        }
      });
    }

    buildDecorations() {
      const theme = this.theme;
      const width = this.mapWidth / UNIT;
      const height = this.mapHeight / UNIT;
      const random = seededRandom(hashString(this.mapId));
      const exits = this.exits || [];
      const nearExit = (x, z, pad = 3.4) => exits.some((exit) => {
        const ex = ((exit.x || 0) + (exit.w || 0) / 2) / UNIT;
        const ez = ((exit.y || 0) + (exit.h || 0) / 2) / UNIT;
        return Math.hypot(x - ex, z - ez) < pad;
      });

      if (theme.cave || theme.underwater) {
        const count = theme.underwater ? 40 : 42;
        const spawnPoint = this.view ? { x: this.view.playerPos.x / UNIT, z: this.view.playerPos.y / UNIT } : { x: width / 2, z: height / 2 };
        for (let i = 0; i < count; i++) {
          const x = 2 + random() * (width - 4);
          const z = 2 + random() * (height - 4);
          if (nearExit(x, z)) continue;
          if (Math.hypot(x - spawnPoint.x, z - spawnPoint.z) < 4.5) continue;
          const scale = 0.35 + random() * 1.1;
          const material = new THREE.MeshStandardMaterial({
            color: theme.underwater ? 0x2f8a82 : (i % 2 ? theme.wall : theme.wallTop),
            roughness: 0.95,
            flatShading: true,
          });
          const rock = new THREE.Mesh(new THREE.ConeGeometry(scale, scale * (theme.underwater ? 2.6 : 1.7), 6), material);
          rock.position.set(x, scale * (theme.underwater ? 1.3 : 0.85), z);
          rock.rotation.y = random() * Math.PI;
          rock.castShadow = true;
          rock.receiveShadow = true;
          this.root.add(rock);
        }
      } else if (theme.sea) {
        // Rutas marinas: islotes, rompientes y algún peñasco, sin árboles flotando.
        for (let i = 0; i < 12; i++) {
          const x = 8 + random() * (width - 16);
          const z = 8 + random() * (height - 16);
          if (nearExit(x, z, 5)) continue;
          if (Math.hypot(x - width / 2, z - height / 2) < 7) continue;
          const radius = 1.1 + random() * 1.7;
          const island = new THREE.Mesh(
            new THREE.CircleGeometry(radius, 22),
            new THREE.MeshStandardMaterial({ color: 0xe8d39a, roughness: 0.95 }),
          );
          island.rotation.x = -Math.PI / 2;
          island.position.set(x, 0.045, z);
          this.root.add(island);
          const rock = new THREE.Mesh(
            new THREE.IcosahedronGeometry(radius * 0.45, 0),
            new THREE.MeshStandardMaterial({ color: 0x8b8b74, roughness: 0.96, flatShading: true }),
          );
          rock.position.set(x + (random() - 0.5) * radius * 0.5, radius * 0.38, z + (random() - 0.5) * radius * 0.5);
          rock.castShadow = true;
          this.root.add(rock);
          if (i % 3 === 0) {
            const trunk = new THREE.Mesh(
              new THREE.CylinderGeometry(0.08, 0.12, 0.9, 6),
              new THREE.MeshStandardMaterial({ color: 0x714631, roughness: 0.95 }),
            );
            trunk.position.set(x, 0.45, z);
            this.root.add(trunk);
            const crown = new THREE.Mesh(
              new THREE.IcosahedronGeometry(0.7, 0),
              new THREE.MeshStandardMaterial({ color: theme.tree, roughness: 0.9, flatShading: true }),
            );
            crown.position.set(x, 1.2, z);
            crown.scale.set(1.1, 0.9, 1.1);
            crown.castShadow = true;
            this.root.add(crown);
          }
        }
      } else if (theme.outdoor && !theme.sea && !this.imageUrl) {
        const trunkGeometry = new THREE.CylinderGeometry(0.1, 0.16, 0.9, 6);
        const crownGeometry = new THREE.IcosahedronGeometry(0.9, 0);
        const positions = [];
        const step = 2.4;
        for (let x = 1.4; x < width - 1; x += step) {
          if (!nearExit(x, 1.6)) positions.push([x + (random() - 0.5) * 0.5, 1.65]);
          if (!nearExit(x, height - 1.6)) positions.push([x + (random() - 0.5) * 0.5, height - 1.65]);
        }
        for (let z = 2.5; z < height - 1; z += step) {
          if (!nearExit(1.65, z)) positions.push([1.65, z + (random() - 0.5) * 0.5]);
          if (!nearExit(width - 1.65, z)) positions.push([width - 1.65, z + (random() - 0.5) * 0.5]);
        }
        // pequeños grupos de árboles en el interior, sin tapar caminos ni edificios
        for (let i = 0; i < 24; i++) {
          const x = 2 + random() * (width - 4);
          const z = 2 + random() * (height - 4);
          if (nearExit(x, z)) continue;
          if (Math.abs(x - width / 2) < 2.6 || Math.abs(z - height / 2) < 2.6) continue;
          positions.push([x, z]);
        }
        if (this.mapId === 'overworld') {
          // El mapa general necesita bosques y relieves para no verse vacío.
          for (let cluster = 0; cluster < 34; cluster++) {
            const cx = 12 + random() * (width - 24);
            const cz = 12 + random() * (height - 24);
            if (Math.hypot(cx - width / 2, cz - height / 2) < 14) continue;
            const count = 6 + Math.floor(random() * 7);
            for (let i = 0; i < count; i++) {
              positions.push([
                clamp(cx + (random() - 0.5) * 10, 1.4, width - 1.4),
                clamp(cz + (random() - 0.5) * 10, 1.4, height - 1.4),
              ]);
            }
          }
        }

        const trunks = new THREE.InstancedMesh(
          trunkGeometry,
          new THREE.MeshStandardMaterial({ color: 0x714631, roughness: 0.95 }),
          positions.length,
        );
        const crowns = new THREE.InstancedMesh(
          crownGeometry,
          new THREE.MeshStandardMaterial({ color: theme.tree, roughness: 0.92, flatShading: true }),
          positions.length,
        );
        const dummy = new THREE.Object3D();
        positions.forEach(([x, z], index) => {
          const scale = 0.8 + random() * 0.55;
          dummy.position.set(x, 0.45 * scale, z);
          dummy.scale.set(scale, scale, scale);
          dummy.rotation.y = random() * Math.PI * 2;
          dummy.updateMatrix();
          trunks.setMatrixAt(index, dummy.matrix);
          dummy.position.set(x, (0.75 + 0.9) * scale, z);
          dummy.scale.set(scale * (0.8 + random() * 0.25), scale * 0.95, scale * (0.8 + random() * 0.2));
          dummy.updateMatrix();
          crowns.setMatrixAt(index, dummy.matrix);
          crowns.setColorAt(index, new THREE.Color(index % 3 === 0 ? theme.treeLight : theme.tree));
        });
        trunks.castShadow = true;
        trunks.receiveShadow = true;
        crowns.castShadow = true;
        crowns.receiveShadow = true;
        if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
        this.root.add(trunks, crowns);

        if (this.mapId === 'overworld') {
          // Lagunas y montañas lejanas para dar profundidad al mapa general.
          for (let i = 0; i < 9; i++) {
            const x = 16 + random() * (width - 32);
            const z = 16 + random() * (height - 32);
            if (Math.hypot(x - width / 2, z - height / 2) < 18) continue;
            const radius = 3 + random() * 6;
            const pond = new THREE.Mesh(
              new THREE.CircleGeometry(radius, 28),
              new THREE.MeshStandardMaterial({ color: 0x3d9dbb, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.86 }),
            );
            pond.rotation.x = -Math.PI / 2;
            pond.position.set(x, 0.025, z);
            this.root.add(pond);
          }
          for (let i = 0; i < 12; i++) {
            const x = 20 + random() * (width - 40);
            const z = 20 + random() * (height - 40);
            if (Math.hypot(x - width / 2, z - height / 2) < 22) continue;
            const size = 2.2 + random() * 3.5;
            const mountain = new THREE.Mesh(
              new THREE.ConeGeometry(size, size * 1.7, 6),
              new THREE.MeshStandardMaterial({ color: 0x8b8b74, roughness: 0.96, flatShading: true }),
            );
            mountain.position.set(x, size * 0.85, z);
            mountain.rotation.y = random() * Math.PI;
            mountain.castShadow = true;
            mountain.receiveShadow = true;
            this.root.add(mountain);
          }
        }
      } else if (theme.indoor && !this.imageUrl && theme.name !== 'hotel') {
        for (let i = 0; i < 6; i++) {
          const x = 1.4 + random() * (width - 2.8);
          const z = 1.4 + random() * (height - 2.8);
          this.addPlant(x, z, 0.8 + random() * 0.35);
        }
      }

      // Flores/hierba alta en 3D sobre los parches del mapa.
      const patchData = this.flowerPatches || [];
      patchData.forEach((patch) => {
        const px = patch.x / UNIT;
        const pz = patch.y / UNIT;
        const pw = Math.max(0.8, patch.w / UNIT);
        const ph = Math.max(0.8, patch.h / UNIT);
        const count = Math.min(46, Math.max(8, Math.floor(pw * ph * 1.7)));
        for (let i = 0; i < count; i++) {
          const x = px + random() * pw;
          const z = pz + random() * ph;
          const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.018, 0.026, 0.28, 4),
            new THREE.MeshStandardMaterial({ color: 0x2f7a3d, roughness: 1 }),
          );
          stem.position.set(x, 0.14, z);
          this.root.add(stem);
          const flower = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.08, 0),
            new THREE.MeshStandardMaterial({
              color: new THREE.Color([theme.flower, 0xffffff, 0xe66d61, 0xe6ad45][i % 4]),
              emissive: 0x221100,
              emissiveIntensity: 0.08,
              roughness: 0.8,
            }),
          );
          flower.position.set(x, 0.3 + random() * 0.08, z);
          flower.castShadow = true;
          this.root.add(flower);
        }
      });
    }

    addPlant(x, z, scale = 1) {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.2, 0.46, 14),
        new THREE.MeshStandardMaterial({ color: 0xc27a56, roughness: 0.9 }),
      );
      pot.position.set(x, 0.23 * scale, z);
      pot.scale.setScalar(scale);
      pot.castShadow = true;
      this.root.add(pot);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.045, 0.9, 6),
        new THREE.MeshStandardMaterial({ color: 0x4b6b3b, roughness: 1 }),
      );
      stem.position.set(x, 0.82 * scale, z);
      stem.scale.setScalar(scale);
      this.root.add(stem);
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const leaf = new THREE.Mesh(
          new THREE.SphereGeometry(0.3, 7, 5),
          new THREE.MeshStandardMaterial({ color: i % 2 ? 0x3b8b62 : 0x77b967, roughness: 0.94 }),
        );
        leaf.scale.set(0.46, 1.25, 0.24);
        leaf.position.set(
          x + Math.cos(angle) * 0.23 * scale,
          (1.05 + (i % 3) * 0.16) * scale,
          z + Math.sin(angle) * 0.23 * scale,
        );
        leaf.rotation.z = Math.cos(angle) * 0.55;
        leaf.rotation.x = Math.sin(angle) * 0.55;
        leaf.castShadow = true;
        this.root.add(leaf);
      }
    }

    buildExitsSignsItems() {
      const theme = this.theme;
      (this.exits || []).forEach((exit) => {
        if (!exit || exit.targetMap === 'PREVIOUS') return;
        const x = ((exit.x || 0) + (exit.w || 40) / 2) / UNIT;
        const z = ((exit.y || 0) + (exit.h || 40) / 2) / UNIT;
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        const isDoor = exit.type === 'door';
        const color = isDoor ? theme.trim : 0xbff6dc;
        const archMaterial = new THREE.MeshStandardMaterial({ color, emissive: isDoor ? 0x6d4c17 : 0x1a6356, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.2 });
        const postA = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), archMaterial);
        postA.position.set(x - 0.8, 0.55, z);
        const postB = postA.clone();
        postB.position.x = x + 0.8;
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.12, 0.12), archMaterial);
        top.position.set(x, 1.12, z);
        [postA, postB, top].forEach((piece) => { piece.castShadow = true; this.root.add(piece); });
        if (exit.label) {
          const label = new THREE.Sprite(new THREE.SpriteMaterial({
            map: labelTexture(exit.label, { local: isDoor }),
            transparent: true,
            depthTest: false,
            depthWrite: false,
          }));
          label.scale.set(2.1, 0.52, 1);
          label.position.set(x, 1.55, z);
          label.renderOrder = 15;
          this.root.add(label);
        }
      });

      (this.signs || []).forEach((sign) => {
        if (!sign) return;
        const x = sign.x / UNIT;
        const z = sign.y / UNIT;
        this.box(0.12, 0.9, 0.12, x, 0.45, z, 0x714631);
        const panel = this.box(1.25, 0.62, 0.09, x, 1.05, z, 0xffefd0, { roughness: 0.8 });
        panel.rotation.y = -0.12;
        if (sign.label) {
          const label = new THREE.Sprite(new THREE.SpriteMaterial({
            map: labelTexture(sign.label, { local: false }),
            transparent: true,
            depthTest: false,
            depthWrite: false,
          }));
          label.scale.set(1.75, 0.44, 1);
          label.position.set(x, 1.62, z);
          label.renderOrder = 12;
          this.root.add(label);
        }
      });

      (this.items || []).forEach((item) => {
        if (!item || item.collected || item.x == null || item.y == null) return;
        const x = item.x / UNIT;
        const z = item.y / UNIT;
        const group = new THREE.Group();
        group.position.set(x, 0.42, z);
        const red = new THREE.Mesh(
          new THREE.SphereGeometry(0.27, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0xe84118, roughness: 0.45, metalness: 0.15 }),
        );
        red.position.y = 0.0;
        const white = new THREE.Mesh(
          new THREE.SphereGeometry(0.27, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0xf5f6fa, roughness: 0.5 }),
        );
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(0.265, 0.035, 6, 20),
          new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.4 }),
        );
        band.rotation.x = Math.PI / 2;
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(0.075, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0xdff9ff, emissive: 0x6ee8ff, emissiveIntensity: 1.2 }),
        );
        core.position.z = 0.25;
        group.add(red, white, band, core);
        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(0.48, 0.018, 4, 24),
          new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.7 }),
        );
        halo.rotation.x = Math.PI / 2;
        group.add(halo);
        group.traverse((object) => { if (object.isMesh) object.castShadow = true; });
        this.root.add(group);
        this.itemObjects.set(item.id, group);
        this.animated.push((dt, now) => {
          group.position.y = 0.42 + Math.sin(now * 0.0025 + x) * 0.09;
          group.rotation.y = now * 0.0015;
          halo.rotation.z = now * 0.001;
        });
      });
    }

    buildSeats() {
      (this.seats || []).forEach((seat) => {
        if (this.theme.name === 'hotel' && seat.type === 'sofa') return; // los sofás lounge ya son 3D
        const x = seat.x / UNIT;
        const z = seat.y / UNIT;
        let group;
        if (seat.type === 'sofa') {
          group = this.makeSofa(seat.color || (seat.id.includes('_e') ? 0x167d78 : 0xd96352));
          group.position.set(x, 0, z);
          group.rotation.y = seat.dir === 'left' ? Math.PI / 2 : seat.dir === 'right' ? -Math.PI / 2 : 0;
        } else if (seat.type === 'trade') {
          group = this.makeStool(0x2c3e50);
          group.position.set(x, 0, z);
        } else {
          group = this.makeStool(0xe9b85e);
          group.position.set(x, 0, z);
        }
        group.userData.pick = { type: 'seat', seat };
        this.pickables.push(group);
        this.root.add(group);
      });
    }

    makeSofa(color) {
      const group = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.96 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.45, 1.0), material);
      base.position.y = 0.44;
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.95, 0.3), material);
      back.position.set(0, 0.98, -0.42);
      back.castShadow = true;
      group.add(back);
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.64, 1.1), material);
        arm.position.set(side * 1.28, 0.6, 0);
        arm.castShadow = true;
        group.add(arm);
      }
      group.children.forEach((child) => { child.receiveShadow = true; });
      return group;
    }

    makeStool(color) {
      const group = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.36, 0.14, 16), material);
      seat.position.y = 0.58;
      seat.castShadow = true;
      group.add(seat);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.7 }));
      leg.position.y = 0.28;
      group.add(leg);
      return group;
    }

    buildHotel() {
      const theme = THEMES.hotel;
      const width = this.mapWidth / UNIT;
      const height = this.mapHeight / UNIT;

      // Paredes perimetrales de madera noble con molduras doradas.
      const wallH = 3.2;
      this.box(width, wallH, 0.6, width / 2, wallH / 2, 0.3, 0x2a170d, { roughness: 0.9 });
      this.box(0.6, wallH, height, 0.3, wallH / 2, height / 2, 0x2a170d, { roughness: 0.9 });
      this.box(0.6, wallH, height, width - 0.3, wallH / 2, height / 2, 0x2a170d, { roughness: 0.9 });
      this.box(width / 2 - 2.8, 0.55, 0.6, width / 4 - 1.4, 0.27, height - 0.3, 0x2a170d, { roughness: 0.9 });
      this.box(width / 2 - 2.8, 0.55, 0.6, width * 0.75 + 1.4, 0.27, height - 0.3, 0x2a170d, { roughness: 0.9 });
      // Remate dorado
      this.box(width, 0.12, 0.3, width / 2, wallH, 0.3, theme.trim, { metalness: 0.3, roughness: 0.4 });
      this.box(0.3, 0.12, height, 0.3, wallH, height / 2, theme.trim, { metalness: 0.3, roughness: 0.4 });
      this.box(0.3, 0.12, height, width - 0.3, wallH, height / 2, theme.trim, { metalness: 0.3, roughness: 0.4 });

      // Letrero principal en la pared norte.
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(15, 3.6),
        new THREE.MeshBasicMaterial({
          map: titleTexture('POKEPOKE', 'SALA UNIÓN · CENTRO DE ENTRENADORES'),
        }),
      );
      banner.position.set(width / 2, 4.4, 0.62);
      this.root.add(banner);

      // Recepción (400, 80-120 px).
      const reception = new THREE.Group();
      reception.position.set(width / 2, 0, 6.4);
      this.box(12, 1.35, 2.2, 0, 0.68, 0, 0x0e4e51, { parent: reception, roughness: 0.72 });
      this.box(12.6, 0.22, 2.5, 0, 1.45, 0, 0xffefd0, { parent: reception, roughness: 0.6 });
      this.box(11, 0.7, 0.1, 0, 0.72, 1.16, 0x167d78, { parent: reception, roughness: 0.5 });
      for (const x of [-4.1, 0, 4.1]) {
        const medallion = this.cylinder(0.42, 0.42, 0.1, x, 0.72, 1.2, theme.trim, { parent: reception, segments: 22, metalness: 0.4, roughness: 0.35 });
        medallion.rotation.x = Math.PI / 2;
        const center = this.cylinder(0.23, 0.23, 0.12, x, 0.72, 1.26, 0xd96352, { parent: reception, segments: 22, roughness: 0.4 });
        center.rotation.x = Math.PI / 2;
      }
      for (const x of [-3.4, 3.4]) {
        this.box(1.35, 0.1, 0.9, x, 1.7, -0.1, 0x172b3c, { parent: reception });
        const screen = this.box(1.2, 0.78, 0.08, x, 2.15, -0.3, 0x9cf5ce, {
          parent: reception,
          emissive: 0x1a9d83,
          emissiveIntensity: 0.85,
          roughness: 0.2,
          castShadow: false,
        });
        screen.rotation.x = -0.16;
      }
      this.root.add(reception);
      this.makePickable(reception, { type: 'reception' });

      // Bar de bayas (noroeste).
      const bar = new THREE.Group();
      bar.position.set(9.5, 0, 6.2);
      this.box(8.2, 1.25, 1.4, 0, 0.63, 0, 0x714631, { parent: bar, roughness: 0.86 });
      this.box(8.6, 0.16, 1.65, 0, 1.33, 0, 0xffefd0, { parent: bar, roughness: 0.6 });
      this.box(7.2, 0.3, 0.18, 0, 1.62, -0.55, 0x0e4e51, { parent: bar });
      for (let i = 0; i < 7; i++) {
        this.cylinder(0.1, 0.1, 0.48 + (i % 3) * 0.12, -3 + i * 1.0, 1.9, -0.55, [0xe6ad45, 0x49bda7, 0xd96352][i % 3], { parent: bar, segments: 10 });
      }
      this.root.add(bar);

      // Mesas de intercambio (160,210) y (640,210).
      for (const [x, z] of [[10, 13.1], [40, 13.1]]) {
        const table = new THREE.Group();
        table.position.set(x, 0, z);
        this.cylinder(1.7, 1.85, 0.22, 0, 0.9, 0, 0x2c3e50, { parent: table, segments: 28, metalness: 0.2, roughness: 0.55 });
        this.cylinder(0.25, 0.38, 0.86, 0, 0.46, 0, 0x172b3c, { parent: table, segments: 12 });
        const screen = this.box(1.45, 0.9, 0.09, 0, 1.6, 0, 0x8ff4e2, {
          parent: table,
          emissive: 0x1fbfa8,
          emissiveIntensity: 0.95,
          roughness: 0.18,
          castShadow: false,
        });
        screen.rotation.x = -0.45;
        this.root.add(table);
        this.animated.push((dt, now) => { screen.material.emissiveIntensity = 0.8 + Math.sin(now * 0.002 + x) * 0.18; });
      }

      // Sofás lounge.
      const sofaLeft = this.makeSofa(0xd96352);
      sofaLeft.position.set(10, 0, 27.5);
      sofaLeft.rotation.y = Math.PI / 2;
      this.root.add(sofaLeft);
      this.makePickable(sofaLeft, { type: 'seat', seat: { id: 'sofa_w', type: 'sofa', x: 160, y: 440, dir: 'up' } });
      const sofaRight = this.makeSofa(0x167d78);
      sofaRight.position.set(41.25, 0, 27.5);
      sofaRight.rotation.y = -Math.PI / 2;
      this.root.add(sofaRight);
      this.makePickable(sofaRight, { type: 'seat', seat: { id: 'sofa_e', type: 'sofa', x: 660, y: 440, dir: 'up' } });

      // Coliseo central con emblema Poké Ball.
      const arena = new THREE.Group();
      arena.position.set(width / 2, 0, height * 0.53);
      this.cylinder(6.3, 6.6, 0.34, 0, 0.17, 0, 0x10245e, { parent: arena, segments: 48, roughness: 0.72 });
      const arenaTop = new THREE.Mesh(
        new THREE.CircleGeometry(5.9, 48),
        new THREE.MeshBasicMaterial({ color: 0x172a75 }),
      );
      arenaTop.rotation.x = -Math.PI / 2;
      arenaTop.position.y = 0.355;
      arena.add(arenaTop);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(6.35, 0.11, 8, 72),
        new THREE.MeshStandardMaterial({ color: theme.trim, emissive: 0x6b4a12, emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.3 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.36;
      arena.add(ring);
      this.arenaGlow = ring.material;
      // Emblema Poké Ball dibujado en textura (evita z-fighting).
      const emblem = new THREE.Mesh(
        new THREE.PlaneGeometry(5.6, 5.6),
        new THREE.MeshBasicMaterial({ map: pokeballTexture(), transparent: true }),
      );
      emblem.rotation.x = -Math.PI / 2;
      emblem.position.set(0, 0.375, 0);
      arena.add(emblem);
      this.root.add(arena);
      this.makePickable(arena, { type: 'arena' });

      // Fuente decorativa al este.
      const fountain = new THREE.Group();
      fountain.position.set(44, 0, 20);
      this.cylinder(2.7, 2.9, 0.5, 0, 0.25, 0, 0xffefd0, { parent: fountain, segments: 36 });
      this.cylinder(2.35, 2.35, 0.12, 0, 0.53, 0, 0x55c8cc, { parent: fountain, segments: 36, roughness: 0.2, transparent: true, opacity: 0.84 });
      this.cylinder(0.48, 0.72, 1.5, 0, 1.18, 0, 0x0e4e51, { parent: fountain, segments: 20 });
      this.cylinder(1.25, 0.95, 0.2, 0, 1.98, 0, 0xffefd0, { parent: fountain, segments: 28 });
      const orb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.5, 2),
        new THREE.MeshStandardMaterial({ color: theme.trim, emissive: 0x9d6424, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.25 }),
      );
      orb.position.y = 2.55;
      orb.castShadow = true;
      fountain.add(orb);
      this.fountain = { group: fountain, orb, water: fountain.children[1] };
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const drop = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xa9ffff, transparent: true, opacity: 0.75 }),
        );
        drop.position.set(Math.cos(angle) * 1.0, 1.5, Math.sin(angle) * 1.0);
        drop.userData.phase = i / 12;
        fountain.add(drop);
        this.droplets.push(drop);
      }
      this.root.add(fountain);
      this.makePickable(fountain, { type: 'fountain' });

      // Terminal de estilo (bandana).
      const terminal = new THREE.Group();
      terminal.position.set(44, 0, 30);
      terminal.rotation.y = -0.35;
      this.box(1.8, 1.15, 1.35, 0, 0.6, 0, 0x172b3c, { parent: terminal });
      this.box(2.0, 0.16, 1.5, 0, 1.22, 0, theme.trim, { parent: terminal });
      const screen = this.box(1.55, 0.95, 0.09, 0, 1.76, 0.25, 0x9cf5ce, {
        parent: terminal,
        emissive: 0x1a9d83,
        emissiveIntensity: 0.9,
        roughness: 0.18,
        castShadow: false,
      });
      screen.rotation.x = 0.16;
      for (const x of [-0.45, 0, 0.45]) {
        this.cylinder(0.09, 0.09, 0.06, x, 1.34, -0.4, x === 0 ? 0xd96352 : 0x8fd8b6, { parent: terminal, segments: 12 });
      }
      this.root.add(terminal);
      this.terminalGroup = terminal;
      this.makePickable(terminal, { type: 'terminal' });

      // Plantas y lámparas.
      [[3.4, 3.4], [46.6, 3.4], [3.4, 36], [46.6, 36], [22, 3.2], [28, 3.2]].forEach(([x, z]) => this.addPlant(x, z, 1.15));
      [[10, 11], [40, 11], [10, 24], [40, 24], [21, 33], [29, 33]].forEach(([x, z]) => {
        const lamp = new THREE.Group();
        lamp.position.set(x, 3.4, z);
        this.cylinder(0.06, 0.06, 1.5, 0, 0.72, 0, 0x172b3c, { parent: lamp, segments: 8 });
        const shade = this.cylinder(0.62, 0.34, 0.42, 0, -0.18, 0, theme.trim, { parent: lamp, segments: 18, metalness: 0.25 });
        shade.material.side = THREE.DoubleSide;
        const light = new THREE.PointLight(0xffd99a, 1.2, 14, 2);
        light.position.y = -0.4;
        lamp.add(light);
        this.root.add(lamp);
        this.animated.push((dt, now) => { shade.rotation.y = now * 0.0004 + x; });
      });

      // Alfombra 3D que recorre el pasillo central.
      const carpet = new THREE.Mesh(
        new THREE.PlaneGeometry(8.2, 22),
        new THREE.MeshStandardMaterial({ color: 0x8b0f14, roughness: 0.98 }),
      );
      carpet.rotation.x = -Math.PI / 2;
      carpet.position.set(width / 2, 0.014, 25);
      carpet.receiveShadow = true;
      this.root.add(carpet);
      for (const x of [width / 2 - 4.1, width / 2 + 4.1]) {
        this.box(0.08, 0.012, 22, x, 0.02, 25, theme.trim, { castShadow: false });
      }
    }

    makePickable(object, info) {
      object.userData.pick = info;
      this.pickables.push(object);
    }

    buildReferenceFrame() {
      const width = this.mapWidth / UNIT;
      const height = this.mapHeight / UNIT;
      this.box(width + 0.7, 0.55, 0.7, width / 2, 0.27, 0.15, 0xe9b85e, { metalness: 0.25, roughness: 0.45 });
      this.box(width + 0.7, 0.55, 0.7, width / 2, 0.27, height - 0.15, 0xe9b85e, { metalness: 0.25, roughness: 0.45 });
      this.box(0.7, 0.55, height, 0.15, 0.27, height / 2, 0xe9b85e, { metalness: 0.25, roughness: 0.45 });
      this.box(0.7, 0.55, height, width - 0.15, 0.27, height / 2, 0xe9b85e, { metalness: 0.25, roughness: 0.45 });
    }

    buildAtmosphere() {
      const theme = this.theme;
      const count = theme.underwater ? 70 : 90;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * Math.max(20, this.mapWidth / UNIT);
        positions[i * 3 + 1] = 0.6 + Math.random() * 8;
        positions[i * 3 + 2] = (Math.random() - 0.5) * Math.max(20, this.mapHeight / UNIT);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: theme.underwater ? 0x9ff6ff : theme.name === 'hotel' ? 0xffe6a8 : 0xfff3ca,
        size: theme.underwater ? 0.06 : 0.045,
        transparent: true,
        opacity: theme.underwater ? 0.6 : 0.42,
        depthWrite: false,
      });
      this.dust = new THREE.Points(geometry, material);
      this.dust.frustumCulled = false;
      this.root.add(this.dust);

      if (this.weatherType === 'RAIN') {
        const rainCount = 620;
        const positions = new Float32Array(rainCount * 3);
        for (let i = 0; i < rainCount; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 34;
          positions[i * 3 + 1] = Math.random() * 16;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 34;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({ color: 0xc9f6ff, size: 0.075, transparent: true, opacity: 0.55, depthWrite: false });
        this.weather = new THREE.Points(geometry, material);
        this.weather.frustumCulled = false;
        this.root.add(this.weather);
      } else if (this.weatherType === 'SANDSTORM' || this.weatherType === 'ASH') {
        const count = this.weatherType === 'ASH' ? 320 : 500;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 30;
          positions[i * 3 + 1] = Math.random() * 10;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
          color: this.weatherType === 'ASH' ? 0xffb37a : 0xe7c67a,
          size: this.weatherType === 'ASH' ? 0.08 : 0.06,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        });
        this.weather = new THREE.Points(geometry, material);
        this.weather.frustumCulled = false;
        this.root.add(this.weather);
      }
    }

    /* ------------------------------- Sprites -------------------------------- */
    loadSpriteSheet() {
      const cached = global.__pokepokeBrendanSheet;
      if (cached && cached.ready) {
        this.sheetImage = cached.image;
        this.buildVariantTextures();
        return;
      }
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        this.sheetImage = image;
        global.__pokepokeBrendanSheet = { image, ready: true };
        this.buildVariantTextures();
        this.avatars.forEach((avatar) => avatar.setVariant(avatar.variant));
        this.npcAvatars.forEach((avatar) => avatar.setVariant(avatar.variant));
      };
      image.onerror = () => {
        console.warn('[World3D] No se pudo cargar el spritesheet de Brendan.');
      };
      image.src = 'assets/sprites/brendan_spritesheet.png';
      this.sheetImage = image;
      this.buildPlaceholderTextures();
    }

    buildPlaceholderTextures() {
      this.avatarTextures = BANDANA_COLORS.map((hex, index) => {
        const canvas = makeCanvas(256, 256);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 256, 256);
        ctx.fillStyle = hex;
        roundedRect(ctx, 88, 72, 80, 120, 34);
        ctx.fill();
        ctx.fillStyle = '#f6d0a8';
        ctx.beginPath();
        ctx.arc(128, 58, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        roundedRect(ctx, 88, 44, 80, 22, 10);
        ctx.fill();
        const texture = canvasTexture(canvas, { smooth: false });
        texture.flipY = false;
        texture.repeat.set(0.25, 0.25);
        return texture;
      });
    }

    buildVariantTextures() {
      if (!this.sheetImage || !this.sheetImage.width) return;
      const source = this.sheetImage;
      this.avatarTextures.forEach((texture) => texture.dispose());
      this.avatarTextures = BANDANA_COLORS.map((hex, index) => {
        const canvas = makeCanvas(source.width, source.height);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, 0, 0);
        if (index > 0) {
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const target = colorFromHex(hex, '#76bd45');
          const data = pixels.data;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (data[i + 3] > 0 && g > r * 1.15 && g > b * 1.08) {
              const value = Math.max(0.35, g / 190);
              data[i] = Math.min(255, target.r * 255 * value);
              data[i + 1] = Math.min(255, target.g * 255 * value);
              data[i + 2] = Math.min(255, target.b * 255 * value);
            }
          }
          ctx.putImageData(pixels, 0, 0);
        }
        const texture = canvasTexture(canvas, { smooth: false });
        texture.flipY = false;
        texture.repeat.set(0.25, 0.25);
        return texture;
      });
      this.sheetReady = true;
    }

    getAvatarTexture(variant) {
      if (!this.avatarTextures.length) this.buildPlaceholderTextures();
      const index = ((Number(variant) || 0) % this.avatarTextures.length + this.avatarTextures.length) % this.avatarTextures.length;
      return this.avatarTextures[index] || this.avatarTextures[0];
    }

    /* ------------------------------- Avatares ------------------------------- */
    syncAvatars(dt, now, initial = false) {
      if (!this.view) return;
      const localData = {
        id: 'local',
        name: (global.trainerState && global.trainerState.name) || (global.currentUser && global.currentUser.username) || 'Brendan',
        x: this.view.playerPos?.x || 0,
        y: this.view.playerPos?.y || 0,
        dir: this.view.playerDir || 'down',
        moving: this.view.avatarState === 'WALKING',
        running: !!(this.view.keysPressed && (this.view.keysPressed.Shift || this.view.keysPressed.shift)),
        variant: this.localVariant,
        bubble: (this.view.myChatBubble && Number(this.view.myChatBubbleUntil || 0) * 1000 > Date.now()) ? this.view.myChatBubble : '',
        bubbleUntil: Number(this.view.myChatBubbleUntil || 0) * 1000,
      };
      this.updateAvatar('local', localData, true, 'player', dt, now);
      // Alias usado por la HUD y las acciones del lobby.
      this.localAvatar = this.avatars.get('local');

      const others = this.view.otherPlayers;
      if (others && typeof others.forEach === 'function') {
        others.forEach((player, id) => {
          if (!player || id === 'local') return;
          if (global.currentUser && String(player.id || '').toLowerCase() === String(global.currentUser.username || '').toLowerCase()) return;
          const playerMap = player.mapId || player.map_id;
          const sameMap = playerMap ? playerMap === this.mapId : this.mapId === 'grand_hotel_lobby';
          if (!sameMap) return;
          this.updateAvatar(`player:${id}`, {
            ...player,
            id,
            dir: player.dir || 'down',
            moving: !!player.moving,
            running: !!player.running,
            variant: player.variant == null ? variantFromStyle(player.avatar_style || player.avatarStyle, player.name || id) : player.variant,
          }, false, 'player', dt, now);
        });
      }
      // Limpieza de jugadores que ya no están en este mapa.
      for (const [key, avatar] of this.avatars.entries()) {
        if (!key.startsWith('player:')) continue;
        const id = key.slice('player:'.length);
        const player = others && others.get ? others.get(id) : null;
        const playerMap = player && (player.mapId || player.map_id);
        const inMap = player && (playerMap ? playerMap === this.mapId : this.mapId === 'grand_hotel_lobby');
        if (!inMap) {
          avatar.dispose();
          this.avatars.delete(key);
        }
      }
    }

    updateAvatar(key, data, local, kind, dt = 0.016, now = performance.now()) {
      let avatar = this.avatars.get(key);
      if (!avatar) {
        avatar = new Avatar3D(this, {
          key,
          local,
          kind,
          data,
          pick: { type: 'player', data },
        });
        avatar.setVariant(data.variant == null ? 0 : data.variant);
        this.avatars.set(key, avatar);
        this.root.add(avatar.group);
        if (kind === 'player' && !local) this.pickables.push(avatar.group);
      }
      avatar.group.userData.pick = { type: 'player', data };
      if (local) {
        avatar.local = true;
        avatar.setName(data.name, true);
      }
      avatar.update(dt, now, data);
      return avatar;
    }

    syncNpcs(dt, now, initial = false) {
      if (!this.view) return;
      const npcs = this.view.npcs || [];
      const active = new Set();
      npcs.forEach((npc, index) => {
        if (!npc) return;
        const key = `npc:${npc.id || index}`;
        active.add(key);
        let avatar = this.npcAvatars.get(key);
        const dir = npc.dir || 'down';
        if (!avatar) {
          const variant = hashString(npc.id || npc.name || index) % BANDANA_COLORS.length;
          avatar = new Avatar3D(this, {
            key,
            local: false,
            kind: 'npc',
            data: { ...npc, dir, variant },
            pick: { type: 'npc', data: npc },
          });
          avatar.setVariant(variant);
          avatar.label.scale.set(2.2, 0.5, 1);
          this.npcAvatars.set(key, avatar);
          this.root.add(avatar.group);
          this.pickables.push(avatar.group);
        }
        avatar.group.userData.pick = { type: 'npc', data: npc };
        avatar.update(dt, now, {
          ...npc,
          dir,
          moving: false,
          variant: avatar.variant,
          seed: index,
        });
      });
      for (const [key, avatar] of this.npcAvatars.entries()) {
        if (!active.has(key)) {
          avatar.dispose();
          this.npcAvatars.delete(key);
        }
      }
    }

    syncItems() {
      if (!this.view) return;
      for (const item of (this.view.items || [])) {
        const group = this.itemObjects.get(item.id);
        if (group && (item.collected || item.hidden)) {
          group.visible = false;
        } else if (group) {
          group.visible = true;
        }
      }
    }

    /* ------------------------------- Cámara --------------------------------- */
    updateCamera(dt, immediate = false) {
      if (!this.camera) return;
      const player = this.localAvatar?.group.position || this.cameraTarget || new THREE.Vector3(this.mapWidth / UNIT / 2, 0, this.mapHeight / UNIT / 2);
      const target = new THREE.Vector3(player.x, 1.15, player.z + this.cameraLookAhead);
      if (!this.cameraTarget) this.cameraTarget = target.clone();
      if (immediate) this.cameraTarget.copy(target);
      else {
        this.cameraTarget.x = damp(this.cameraTarget.x, target.x, 8, dt);
        this.cameraTarget.y = damp(this.cameraTarget.y, target.y, 8, dt);
        this.cameraTarget.z = damp(this.cameraTarget.z, target.z, 8, dt);
      }

      const cosPitch = Math.cos(this.pitch);
      const desired = new THREE.Vector3(
        this.cameraTarget.x + Math.sin(this.yaw) * this.distance * cosPitch,
        this.cameraTarget.y + Math.sin(this.pitch) * this.distance,
        this.cameraTarget.z + Math.cos(this.yaw) * this.distance * cosPitch,
      );
      const width = this.mapWidth / UNIT;
      const height = this.mapHeight / UNIT;
      if (!this.theme.reference) {
        desired.x = clamp(desired.x, -6, width + 6);
        desired.z = clamp(desired.z, -6, height + 6);
      }
      if (immediate || !this.cameraPosition) this.cameraPosition = desired.clone();
      else {
        this.cameraPosition.x = damp(this.cameraPosition.x, desired.x, 7, dt);
        this.cameraPosition.y = damp(this.cameraPosition.y, desired.y, 7, dt);
        this.cameraPosition.z = damp(this.cameraPosition.z, desired.z, 7, dt);
      }
      this.camera.position.copy(this.cameraPosition);
      this.camera.lookAt(this.cameraTarget.x, this.cameraTarget.y + 0.25, this.cameraTarget.z);
    }

    /* ------------------------------ Bucle ---------------------------------- */
    loop() {
      if (this.disposed) return;
      this._raf = requestAnimationFrame(() => this.loop());
      if (!this.enabled || this.paused) return;
      const dt = Math.min(0.05, this.clock.getDelta());
      const now = performance.now();
      this.elapsed += dt;
      this.update(dt, now);
      this.renderer.render(this.scene, this.camera);
    }

    update(dt, now) {
      this.syncAvatars(dt, now);
      this.syncNpcs(dt, now);
      this.syncItems();
      this.updateCamera(dt);

      if (this.dust) {
        this.dust.rotation.y += dt * 0.012;
        this.dust.position.x = this.cameraTarget.x;
        this.dust.position.z = this.cameraTarget.z;
      }
      if (this.sun) {
        this.sun.position.set(this.cameraTarget.x - 18, 32, this.cameraTarget.z + 14);
        this.sun.target.position.set(this.cameraTarget.x, 0, this.cameraTarget.z);
        this.sun.target.updateMatrixWorld();
      }
      if (this.playerLight) {
        this.playerLight.position.set(this.cameraTarget.x, 3.4, this.cameraTarget.z);
      }
      if (this.fountain) {
        this.fountain.orb.rotation.y += dt * 0.65;
        this.fountain.orb.position.y = 2.55 + Math.sin(now * 0.0018) * 0.06;
        this.droplets.forEach((drop) => {
          const phase = (now * 0.00055 + drop.userData.phase) % 1;
          drop.position.y = 2.1 - phase * 1.3;
          drop.scale.setScalar(0.7 + phase * 0.6);
        });
      }
      if (this.arenaGlow) this.arenaGlow.emissiveIntensity = 0.45 + Math.sin(now * 0.0017) * 0.14;
      for (const animate of this.animated) {
        try { animate(dt, now); } catch (error) { /* un efecto roto no debe detener el mapa */ }
      }
      if (this.weather) {
        const positions = this.weather.geometry.attributes.position.array;
        const isRain = this.weatherType === 'RAIN';
        for (let i = 0; i < positions.length; i += 3) {
          positions[i + 1] -= dt * (isRain ? 16 : this.weatherType === 'ASH' ? 1.3 : 2.4);
          if (isRain) positions[i] -= dt * 2.5;
          else positions[i] += dt * (this.weatherType === 'SANDSTORM' ? 3.5 : 0.6);
          if (positions[i + 1] < 0) {
            positions[i + 1] = isRain ? 14 + Math.random() * 4 : 7 + Math.random() * 4;
            positions[i] = (Math.random() - 0.5) * 34;
            positions[i + 2] = (Math.random() - 0.5) * 34;
          }
        }
        this.weather.geometry.attributes.position.needsUpdate = true;
        this.weather.position.set(this.cameraTarget.x, 0, this.cameraTarget.z);
      }
      if (now - this.lastHudUpdate > 700) {
        this.lastHudUpdate = now;
        const online = document.getElementById('world3dOnline');
        if (online) {
          const count = Math.max(1, this.avatars.size + this.npcAvatars.size);
          online.textContent = `${count} personaje${count === 1 ? '' : 's'}`;
        }
        const fps = document.getElementById('world3dFps');
        if (fps) fps.textContent = `${Math.round(1 / Math.max(dt, 0.001))} FPS`;
      }
    }

    /* ------------------------------ Eventos --------------------------------- */
    bindEvents() {
      this.onPointerDown = (event) => {
        if (event.button !== 0) return;
        this.pointer.down = true;
        this.pointer.x = event.clientX;
        this.pointer.y = event.clientY;
        this.pointer.moved = 0;
        this.canvas.setPointerCapture?.(event.pointerId);
      };
      this.onPointerMove = (event) => {
        if (!this.pointer.down) return;
        const dx = event.clientX - this.pointer.x;
        const dy = event.clientY - this.pointer.y;
        this.pointer.x = event.clientX;
        this.pointer.y = event.clientY;
        this.pointer.moved += Math.abs(dx) + Math.abs(dy);
        this.yaw -= dx * 0.0052;
        this.pitch = clamp(this.pitch - dy * 0.0035, 0.42, 1.32);
        this.saveCamera();
      };
      this.onPointerUp = (event) => {
        if (!this.pointer.down) return;
        const wasClick = this.pointer.moved < 6;
        this.pointer.down = false;
        this.canvas.releasePointerCapture?.(event.pointerId);
        if (wasClick) this.pickAt(event.clientX, event.clientY);
      };
      this.onWheel = (event) => {
        event.preventDefault();
        this.distance = clamp(this.distance + event.deltaY * 0.012, this.theme.reference ? 18 : 8, this.theme.reference ? 52 : 42);
        this.saveCamera();
      };
      this.onKey = (event) => {
        const target = event.target;
        if (target && target.matches && target.matches('input, textarea, select, [contenteditable="true"]')) return;
        if (event.code === 'KeyR') {
          this.yaw = this.theme.name === 'hotel' ? 0.35 : 0.68;
          this.pitch = 0.93;
          this.distance = this.theme.reference ? 34 : this.theme.name === 'hotel' ? 18 : (this.imageUrl && this.theme.indoor) ? 16 : 21;
          this.saveCamera();
        }
      };
      this.onResize = () => this.resize();
      this.canvas.addEventListener('pointerdown', this.onPointerDown);
      global.addEventListener('pointermove', this.onPointerMove);
      global.addEventListener('pointerup', this.onPointerUp);
      this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
      global.addEventListener('keydown', this.onKey);
      global.addEventListener('resize', this.onResize);
    }

    pickAt(clientX, clientY) {
      if (!this.pickables.length) return;
      const rect = this.canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(pointer, this.camera);
      const intersections = this.raycaster.intersectObjects(this.pickables, true);
      for (const hit of intersections) {
        let node = hit.object;
        while (node && node !== this.root) {
          if (node.userData && node.userData.pick) {
            const pick = node.userData.pick;
            if (pick.type === 'player' && pick.data && pick.data.id && pick.data.id !== 'local') {
              this.options.onPlayerClick && this.options.onPlayerClick(pick.data);
            } else if (pick.type === 'npc' && pick.data) {
              this.options.onNpcClick && this.options.onNpcClick(pick.data);
            } else if (pick.type === 'seat' && pick.seat) {
              this.options.onSeatClick && this.options.onSeatClick(pick.seat);
            } else if (pick.type === 'terminal') {
              this.options.onTerminal && this.options.onTerminal();
            } else if (pick.type === 'reception') {
              this.options.onReception && this.options.onReception();
            }
            return;
          }
          node = node.parent;
        }
      }
    }

    saveCamera() {
      global.__world3dCamera = { yaw: this.yaw, pitch: this.pitch, distance: this.distance };
    }

    resize() {
      if (!this.renderer || !this.container) return;
      const rect = this.container.getBoundingClientRect();
      const width = Math.max(320, rect.width || 800);
      const height = Math.max(240, rect.height || 500);
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, MAX_PIXEL_RATIO));
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    /* ------------------------------ API pública ----------------------------- */
    setEnabled(enabled) {
      this.enabled = !!enabled;
      this.canvas.style.display = this.enabled ? 'block' : 'none';
      this.container.classList.toggle('world3d-on', this.enabled);
      if (this.view) this.view.renderSuppressed = this.enabled;
      if (this.enabled) this.resize();
    }

    setPaused(paused) {
      this.paused = !!paused;
      this.clock.getDelta();
    }

    setVariant(variant) {
      this.localVariant = ((Number(variant) || 0) % BANDANA_COLORS.length + BANDANA_COLORS.length) % BANDANA_COLORS.length;
      setStoredVariant(this.localVariant);
      this.localAvatar?.setVariant(this.localVariant);
    }

    showEmote(emoji) {
      this.localAvatar?.showEmote(emoji);
    }

    focusCamera() {
      this.cameraTarget = null;
      this.updateCamera(0.016, true);
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      global.removeEventListener('pointermove', this.onPointerMove);
      global.removeEventListener('pointerup', this.onPointerUp);
      this.canvas.removeEventListener('wheel', this.onWheel);
      global.removeEventListener('keydown', this.onKey);
      global.removeEventListener('resize', this.onResize);
      this.avatars.forEach((avatar) => avatar.dispose());
      this.npcAvatars.forEach((avatar) => avatar.dispose());
      this.disposeRoot();
      this.renderer.dispose();
      this.canvas.parentNode?.removeChild(this.canvas);
      this.container.classList.remove('world3d-on');
      if (this.view) this.view.renderSuppressed = false;
      this.avatarTextures.forEach((texture) => texture.dispose());
    }

    disposeRoot() {
      if (!this.root) return;
      this.root.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : (object.material ? [object.material] : []);
        materials.forEach((material) => {
          if (material.map && material.map !== global.__pokepokeBrendanSheet?.texture) material.map.dispose();
          material.dispose();
        });
      });
      this.scene.remove(this.root);
      this.root = null;
    }
  }

  function getStoredVariant() {
    try {
      const value = global.localStorage.getItem('pokepoke.bandana');
      return value == null ? 0 : clamp(Number(value) || 0, 0, BANDANA_COLORS.length - 1);
    } catch (error) {
      return 0;
    }
  }

  function setStoredVariant(variant) {
    try { global.localStorage.setItem('pokepoke.bandana', String(variant)); } catch (error) { /* almacenamiento bloqueado */ }
  }

  World3D.BANDANA_COLORS = BANDANA_COLORS;
  global.World3D = World3D;
})(typeof window !== 'undefined' ? window : this);
