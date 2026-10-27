/**
 * tilemap_renderer.js — Motor de Mapa y Avatar 100% Fiel a Pokémon Esmeralda (GBA)
 *
 * ESPECIFICACIONES GBA ESTRICTAS:
 * 1. Pantalla GBA: 240x160 px lógicos (15x10 tiles de 16x16 px).
 * 2. Escala Fija y Proporcional: ctx.scale(fixedZoom, fixedZoom) para que 1 tile = 16px lógicos.
 *    El personaje ocupa EXACTAMENTE 1 tile (16x16 px). NO hay zoom dinámico ni paneo por ratón.
 * 3. Mapa de Colisiones 2D por Tiles: flags WALKABLE(0), SOLID(1), TALL_GRASS(2), WATER(3), LEDGE(4), SIGN(5), NPC(6).
 * 4. Movimiento GBA:
 *    - Caminar: 16 px en 8 frames = 2 px/frame (~0.133s)
 *    - Correr (B/Shift): 16 px en 5 frames = 3.2 px/frame (~0.083s)
 *    - Interpolación lineal sin overshoot
 *    - Tabla de animación de 8 frames con hold: [0, 1, 0, 3, 0, 1, 0, 3]
 *    - Orientación inmediata al presionar tecla, antes del desplazamiento.
 * 5. Animación de Bump GBA:
 *    - Desplazamiento lineal de 3px en 4 frames (~0.067s, NO sinusoidal).
 *    - El personaje permanece orientado hacia el obstáculo.
 * 6. Cámara GBA:
 *    - Centrada fija en el personaje, sin lerp (seguimiento instantáneo).
 *    - Clamping estricto a los bordes del mapa y snapping a píxel entero.
 * 7. Transiciones GBA:
 *    - Fundido a negro de 8 frames (0.13s) y fundido desde negro de 8 frames.
 */
"use strict";

(function(global) {
  // Constantes de Hardware GBA
  const GBA_SCREEN_W = 240;
  const GBA_SCREEN_H = 160;
  const GBA_TILES_X = 15;
  const GBA_TILES_Y = 10;
  const TILE_LOGIC = 16; // 16x16 píxeles lógicos por tile

  // Velocidades en píxeles por frame (a 60 FPS)
  const WALK_SPEED = 16 / 8; // 2 px/frame -> 1 tile en 8 frames
  const RUN_SPEED = 16 / 5;  // 3.2 px/frame -> 1 tile en 5 frames

  // Tabla de animación de caminata con hold frames (8 frames por tile)
  // Col 0 = Reposo, Col 1 = Paso Izq, Col 2 = Reposo, Col 3 = Paso Der
  const WALK_ANIM_TABLE = [0, 1, 0, 3, 0, 1, 0, 3];

  // Bump lineal de 3px durante 4 frames (~0.067s)
  const BUMP_DISTANCE = 3;
  const BUMP_FRAMES = 4;

  // Transición de fundido de 8 frames (~0.13s)
  const FADE_FRAMES = 8;

  // Flags de colisión de tiles
  const COLLISION_FLAGS = {
    WALKABLE: 0,
    SOLID: 1,      // Muros, árboles, vallas, edificios
    TALL_GRASS: 2, // Hierba alta (probabilidad de encuentro salvaje)
    WATER: 3,      // Agua (requiere Surf)
    LEDGE: 4,      // Salto unidireccional
    SIGN: 5,       // Letrero interactuable (bloquea paso)
    NPC: 6         // NPC interactuable (bloquea paso)
  };

  const EMERALD_THEME = {
    darkGreen: '#0d2818',
    deepForest: '#163b25',
    emeraldMain: '#208b48',
    emeraldBright: '#2ecc71',
    creamWhite: '#f7faf7',
    goldAccent: '#f1c40f',
    hudBorder: '#0b2014'
  };

  class TileMapRenderer {
    constructor(containerId, options = {}) {
      this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
      if (!this.container) {
        console.error('TileMapRenderer: Contenedor no encontrado:', containerId);
        return;
      }

      this.container.innerHTML = '';
      this.canvas = null;
      this.ctx = null;

      // Configuración de la zona
      this.mapId = options.mapId || 'littleroot_town';
      this.mapName = options.name || 'Villa Raíz';
      this.mapSubtitle = options.subtitle || '';
      this.mapImageUrl = options.image || null;
      this.tileset = options.tileset || 'OverworldTrainers';

      this.mapWidth = options.width || 640;
      this.mapHeight = options.height || 512;
      this.stairs = options.stairs ? [...options.stairs] : [];
      this.elevation = 0;
      this.elevationTarget = 0;
      this.activeZoom = this.fixedZoom;

      // Posición lógica del jugador en píxeles (múltiplos de 16px)
      const spawnX = options.spawn?.x != null ? Math.round(options.spawn.x / TILE_LOGIC) * TILE_LOGIC : 240;
      const spawnY = options.spawn?.y != null ? Math.round(options.spawn.y / TILE_LOGIC) * TILE_LOGIC : 240;

      this.playerPos = { x: spawnX, y: spawnY };
      this.startGridPos = { x: spawnX, y: spawnY };
      this.targetGridPos = { x: spawnX, y: spawnY };
      this.playerDir = options.spawn?.dir || 'down'; // 'down', 'up', 'left', 'right'

      // Máquina de estados GBA
      this.avatarState = 'IDLE'; // 'IDLE' | 'WALKING' | 'COLLIDING' | 'INTERACTING' | 'IN_BATTLE'
      this.stepProgress = 0;
      this.walkFrame = 0;
      this.updateStairTransition();
      this.bumpFrame = 0;
      this.bumpTarget = { dx: 0, dy: 0 };

      // Zoom Fijo GBA (calculado según viewport)
      this.fixedZoom = 2;

      // Cámara GBA (coordenadas lógicas antes del scale)
      this.cameraX = this.playerPos.x;
      this.cameraY = this.playerPos.y;

      // Entidades y triggers
      this.items = options.items ? [...options.items] : [];
      this.npcs = options.npcs ? [...options.npcs] : [];
      this.obstacles = options.obstacles ? [...options.obstacles] : [];
      this.signs = options.signs ? [...options.signs] : [];
      this.exits = options.exits || options.warps || [];
      this.flowerPatches = options.flowerPatches || [];
      this.otherPlayers = options.otherPlayers || new Map();
      this.seats = options.seats || [];
      this.battleArena = options.battleArena || null;
      this.isSeated = false;
      this.currentSeat = null;
      this.myChatBubble = null;
      this.myChatBubbleUntil = 0;
      this.flashActive = !!options.flashActive;
      this.weatherType = this.detectWeather(this.mapId);
      this.weatherParticles = [];
      this.initWeatherParticles();

      // Construcción del Mapa de Colisiones 2D
      this.collisionGrid = this.buildCollisionMap({
        width: this.mapWidth,
        height: this.mapHeight,
        obstacles: this.obstacles,
        npcs: this.npcs,
        signs: this.signs,
        exits: this.exits,
        flowerPatches: this.flowerPatches,
        stairs: this.stairs
      });

      // Callbacks
      this.onItemCollect = options.onItemCollect || null;
      this.onNpcInteract = options.onNpcInteract || null;
      this.onPlayerMove = options.onPlayerMove || null;
      this.onWarp = options.onWarp || null;
      this.onEncounter = options.onEncounter || null;
      this.onSeatInteract = options.onSeatInteract || null;
      this.onOtherPlayerClick = options.onOtherPlayerClick || null;
      this.encounterRate = options.encounterRate || 0.14;

      // Assets y Caches
      this.mapImage = null;
      if (this.mapImageUrl) {
        this.mapImage = new Image();
        this.mapImage.src = this.mapImageUrl;
      }

      const localAssets = global.EMERALD_ASSETS || {};
      this.flowerPatchImage = new Image();
      this.flowerPatchImage.src = localAssets.flowerPatch || 'assets/sprites/flower_patch.png';
      this.itemAtlas = new Image();
      this.itemAtlas.src = localAssets.mapObjects || '';
      this.itemAtlasLoaded = false;
      this.itemAtlas.onload = () => { this.itemAtlasLoaded = true; };

      // Sprite oficial de Brendan (256x256 con celdas 64x64)
      this.brendanSprite = new Image();
      this.brendanSprite.src = options.playerSprite || localAssets.playerSprite || 'assets/sprites/brendan_spritesheet.png';
      this.brendanLoaded = false;
      this.brendanSprite.onload = () => { this.brendanLoaded = true; };

      // HUD y Transiciones GBA
      this.bannerTimer = 180; // ~3s a 60 FPS
      this.bannerSlide = 1.0;
      this.fadeState = 'IN';  // 'NONE' | 'OUT' | 'IN'
      this.fadeFrame = 0;
      this.fadeAlpha = 1.0;
      this.fadeCallback = null;

      this.keysPressed = {};
      this.running = true;
      this.animFrameId = null;
      this.lastTime = performance.now();
      this.renderSuppressed = false;

      this.init();
    }

    init() {
      this.createCanvas();
      this.calculateFixedZoom();
      this.setupEventListeners();
      this.updateCamera();
      this.startLoop();
    }

    createCanvas() {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'gba-world-canvas';
      this.canvas.style.display = 'block';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.imageRendering = 'pixelated';
      this.container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.resize();
    }

    resize() {
      if (!this.container || !this.canvas) return;
      const rect = this.container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(240, Math.floor(rect.width)) * dpr;
      this.canvas.height = Math.max(160, Math.floor(rect.height)) * dpr;
      this.calculateFixedZoom();
    }

    calculateFixedZoom() {
      if (!this.canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const viewportW = this.canvas.width / dpr;
      const viewportH = this.canvas.height / dpr;

      // Calcular factor de escala para mostrar ~15 tiles horizontales y ~10 verticales
      const zoomX = viewportW / (GBA_TILES_X * TILE_LOGIC);
      const zoomY = viewportH / (GBA_TILES_Y * TILE_LOGIC);
      
      // Proporción fija GBA (usar el menor para que el área visible contenga la escena)
      this.fixedZoom = Math.max(1, Math.min(zoomX, zoomY));
    }

    /* ============================================================
       MAPA DE COLISIONES POR TILES (GBA STYLE)
       ============================================================ */
    buildCollisionMap(mapData) {
      const cols = Math.ceil(mapData.width / TILE_LOGIC);
      const rows = Math.ceil(mapData.height / TILE_LOGIC);
      const grid = Array.from({ length: rows }, () => Array(cols).fill(COLLISION_FLAGS.WALKABLE));

      // 1. Marcar obstáculos como SOLID
      for (const obs of (mapData.obstacles || [])) {
        const x1 = Math.floor(obs.x / TILE_LOGIC);
        const y1 = Math.floor(obs.y / TILE_LOGIC);
        const x2 = Math.ceil((obs.x + obs.w) / TILE_LOGIC);
        const y2 = Math.ceil((obs.y + obs.h) / TILE_LOGIC);

        for (let y = y1; y < y2; y++) {
          for (let x = x1; x < x2; x++) {
            if (y >= 0 && y < rows && x >= 0 && x < cols) {
              grid[y][x] = COLLISION_FLAGS.SOLID;
            }
          }

        }
      }

      // 2. Marcar NPCs
      for (const npc of (mapData.npcs || [])) {
        const tx = Math.floor(npc.x / TILE_LOGIC);
        const ty = Math.floor(npc.y / TILE_LOGIC);
        if (ty >= 0 && ty < rows && tx >= 0 && tx < cols) {
          grid[ty][tx] = COLLISION_FLAGS.NPC;
        }
      }

      // 3. Marcar letreros
      for (const sign of (mapData.signs || [])) {
        const tx = Math.floor(sign.x / TILE_LOGIC);
        const ty = Math.floor(sign.y / TILE_LOGIC);
        if (ty >= 0 && ty < rows && tx >= 0 && tx < cols) {
          grid[ty][tx] = COLLISION_FLAGS.SIGN;
        }
      }

      // 4. Marcar parches de flores como hierba alta
      for (const fp of (mapData.flowerPatches || [])) {
        const x1 = Math.floor(fp.x / TILE_LOGIC);
        const y1 = Math.floor(fp.y / TILE_LOGIC);
        const x2 = Math.ceil((fp.x + fp.w) / TILE_LOGIC);
        const y2 = Math.ceil((fp.y + fp.h) / TILE_LOGIC);

        for (let y = y1; y < y2; y++) {
          for (let x = x1; x < x2; x++) {
            if (y >= 0 && y < rows && x >= 0 && x < cols) {
              if (grid[y][x] === COLLISION_FLAGS.WALKABLE) {
                grid[y][x] = COLLISION_FLAGS.TALL_GRASS;
              }
            }
          }
        }
      }

      // 5. Bordes perimetrales del mapa como SOLID (excepto donde hay exits)
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (x === 0 || x === cols - 1 || y === 0 || y === rows - 1) {
            const px = x * TILE_LOGIC;
            const py = y * TILE_LOGIC;
            let isExit = false;
            for (const exit of (mapData.exits || [])) {
              if (
                px + TILE_LOGIC > exit.x && px < exit.x + (exit.w || 32) &&
                py + TILE_LOGIC > exit.y && py < exit.y + (exit.h || 32)
              ) {
                isExit = true;
                break;
              }
            }
            if (!isExit && grid[y][x] === COLLISION_FLAGS.WALKABLE) {
              grid[y][x] = COLLISION_FLAGS.SOLID;
            }
          }
        }
      }

    // 6. Asegurar que los exits (puertas y rutas) sean siempre WALKABLE
      for (const exit of (mapData.exits || [])) {
        const x1 = Math.floor(exit.x / TILE_LOGIC);
        const y1 = Math.floor(exit.y / TILE_LOGIC);
        const x2 = Math.ceil((exit.x + (exit.w || 32)) / TILE_LOGIC);
        const y2 = Math.ceil((exit.y + (exit.h || 32)) / TILE_LOGIC);

        for (let y = y1; y < y2; y++) {
          for (let x = x1; x < x2; x++) {
            if (y >= 0 && y < rows && x >= 0 && x < cols) {
              grid[y][x] = COLLISION_FLAGS.WALKABLE;
            }
          }
        }
      }

      return grid;
    }

    isTileBlocked(tileX, tileY) {
      if (tileY < 0 || tileY >= this.collisionGrid.length) return true;
      if (tileX < 0 || tileX >= this.collisionGrid[0].length) return true;

      const flag = this.collisionGrid[tileY][tileX];
      return flag === COLLISION_FLAGS.SOLID ||
             flag === COLLISION_FLAGS.WATER ||
             flag === COLLISION_FLAGS.NPC ||
             flag === COLLISION_FLAGS.SIGN;
    }

    isBlocked(pixelX, pixelY) {
      // Hitbox exacto de 16x16: verificar todas las esquinas del tile lógico
      const tx1 = Math.floor(pixelX / TILE_LOGIC);
      const ty1 = Math.floor(pixelY / TILE_LOGIC);
      const tx2 = Math.floor((pixelX + TILE_LOGIC - 1) / TILE_LOGIC);
      const ty2 = Math.floor((pixelY + TILE_LOGIC - 1) / TILE_LOGIC);
      return this.isTileBlocked(tx1, ty1) ||
             this.isTileBlocked(tx2, ty1) ||
             this.isTileBlocked(tx1, ty2) ||
             this.isTileBlocked(tx2, ty2);
    }

    /* ============================================================
       GAME LOOP Y FSM DE MOVIMIENTO GBA
       ============================================================ */
    update(dt) {
      // 1. Transición de Fundido GBA (8 frames)
      this.updateFade();
      this.elevation += (this.elevationTarget - this.elevation) * Math.min(1, dt * 10);

      // 2. FSM del Avatar
      const isRunning = !!(this.keysPressed['Shift'] || this.keysPressed['shift'] || this.keysPressed['b'] || this.keysPressed['B']);

      if (this.avatarState === 'COLLIDING') {
        this.updateBump();
      } else if (this.avatarState === 'WALKING') {
        this.updateWalking(dt, isRunning);
      } else if (this.avatarState === 'IDLE') {
        this.checkInputMovement();
      }

      // 3. Cámara GBA (Centrada fija en el personaje, sin lerp)
      this.updateCamera();

      // 4. Temporizador del Banner de Localización
      if (this.bannerTimer > 0) {
        this.bannerTimer--;
        this.bannerSlide = Math.min(1, this.bannerSlide + 0.1);
      } else {
        this.bannerSlide = Math.max(0, this.bannerSlide - 0.08);
      }
    }

    checkInputMovement() {
      let dx = 0;
      let dy = 0;

      if (this.keysPressed['ArrowUp'] || this.keysPressed['w'] || this.keysPressed['W']) dy -= 1;
      else if (this.keysPressed['ArrowDown'] || this.keysPressed['s'] || this.keysPressed['S']) dy += 1;
      else if (this.keysPressed['ArrowLeft'] || this.keysPressed['a'] || this.keysPressed['A']) dx -= 1;
      else if (this.keysPressed['ArrowRight'] || this.keysPressed['d'] || this.keysPressed['D']) dx += 1;

      if (dx === 0 && dy === 0) return;

      // La dirección cambia ANTES de moverse (GBA Style)
      if (dy < 0) this.playerDir = 'up';
      else if (dy > 0) this.playerDir = 'down';
      else if (dx < 0) this.playerDir = 'left';
      else if (dx > 0) this.playerDir = 'right';

      const targetX = this.startGridPos.x + dx * TILE_LOGIC;
      const targetY = this.startGridPos.y + dy * TILE_LOGIC;

      if (this.isBlocked(targetX, targetY)) {
        // Disparar bump lineal de 3px
        this.avatarState = 'COLLIDING';
        this.bumpFrame = 0;
        this.bumpTarget = { dx, dy };
        this.targetGridPos = { x: this.playerPos.x, y: this.playerPos.y };
      } else {
        // Iniciar movimiento entre tiles
        this.avatarState = 'WALKING';
        this.stepProgress = 0;
        this.startGridPos = { x: this.playerPos.x, y: this.playerPos.y };
        this.targetGridPos = { x: targetX, y: targetY };
      }
    }

    updateWalking(dt, isRunning) {
      // Velocidad en px por frame -> normalizado a segundos a 60 FPS
      const speedPxPerFrame = isRunning ? RUN_SPEED : WALK_SPEED;
      const stepDurationSec = (TILE_LOGIC / speedPxPerFrame) / 60;

      this.stepProgress += dt / stepDurationSec;

      if (this.stepProgress >= 1.0) {
        // Llegó exactamente al tile destino
        this.playerPos.x = this.targetGridPos.x;
        this.playerPos.y = this.targetGridPos.y;
        this.startGridPos.x = this.targetGridPos.x;
        this.startGridPos.y = this.targetGridPos.y;
        this.avatarState = 'IDLE';
        this.stepProgress = 0;
        this.walkFrame = 0;

        // Comprobar warps/salidas
        const warp = this.checkWarp(this.playerPos.x, this.playerPos.y);
        if (warp && this.onWarp) {
          this.startFadeOut(() => this.onWarp(warp));
          return;
        }

        // Comprobar hierba alta (encuentros salvajes al {encounterRate}%)
        if (this.isInFlowerPatch(this.playerPos.x, this.playerPos.y) && Math.random() < this.encounterRate) {
          if (this.onEncounter) {
            this.onEncounter();
            return;
          }
        }

        // Comprobar items
        this.checkItemCollection();

        // Notificar movimiento
        if (this.onPlayerMove) {
          this.onPlayerMove(this.playerPos, this.playerDir);
        }
      } else {
        // Interpolación lineal sin overshoot
        this.playerPos.x = this.startGridPos.x + (this.targetGridPos.x - this.startGridPos.x) * this.stepProgress;
        this.playerPos.y = this.startGridPos.y + (this.targetGridPos.y - this.startGridPos.y) * this.stepProgress;
        this.updateStairTransition();

        // Animación de caminata / carrera con hold frames
        if (isRunning) {
          const runAnim = [0, 1, 0, 3, 0];
          const animIndex = Math.floor(this.stepProgress * 5) % 5;
          this.walkFrame = runAnim[animIndex];
        } else {
          const animIndex = Math.floor(this.stepProgress * 8) % 8;
          this.walkFrame = WALK_ANIM_TABLE[animIndex];
        }
      }
    }

    updateBump() {
      this.bumpFrame++;
      if (this.bumpFrame >= BUMP_FRAMES) {
        // Termina el bump — regresar a la posición exacta del tile
        this.avatarState = 'IDLE';
        this.bumpFrame = 0;
        this.playerPos.x = this.targetGridPos.x;
        this.playerPos.y = this.targetGridPos.y;
        return;
      }

      // Desplazamiento lineal: ida (frames 0-1) y vuelta (frames 2-3)
      const t = this.bumpFrame < BUMP_FRAMES / 2
        ? this.bumpFrame / (BUMP_FRAMES / 2)
        : 2 - this.bumpFrame / (BUMP_FRAMES / 2);

      const offset = BUMP_DISTANCE * t;
      this.playerPos.x = this.targetGridPos.x + this.bumpTarget.dx * offset;
      this.playerPos.y = this.targetGridPos.y + this.bumpTarget.dy * offset;
    }

    updateFade() {
      if (this.fadeState === 'OUT') {
        this.fadeFrame++;
        this.fadeAlpha = Math.min(1, this.fadeFrame / FADE_FRAMES);
        if (this.fadeFrame >= FADE_FRAMES) {
          this.fadeState = 'NONE';
          if (this.fadeCallback) {
            const cb = this.fadeCallback;
            this.fadeCallback = null;
            cb();
          }
        }
      } else if (this.fadeState === 'IN') {
        this.fadeFrame++;
        this.fadeAlpha = Math.max(0, 1 - this.fadeFrame / FADE_FRAMES);
        if (this.fadeFrame >= FADE_FRAMES) {
          this.fadeState = 'NONE';
          this.fadeAlpha = 0;
        }
      }
    }

    startFadeOut(callback) {
      this.fadeState = 'OUT';
      this.fadeFrame = 0;
      this.fadeCallback = callback;
    }

    startFadeIn() {
      this.fadeState = 'IN';
      this.fadeFrame = 0;
      this.fadeCallback = null;
    }

    /* ============================================================
       CÁMARA GBA (SIN LERP, CENTRADA FIJA)
       ============================================================ */
    updateCamera() {
      if (!this.canvas) return;
      const dpr = window.devicePixelRatio || 1;
      this.activeZoom = this.fixedZoom * (1 + this.elevation * 0.18);
      const viewWLog = this.canvas.width / (dpr * this.activeZoom);
      const viewHLog = this.canvas.height / (dpr * this.activeZoom);

      // Centrado exacto en el centro del tile del personaje
      let camX = (this.playerPos.x + TILE_LOGIC / 2) - viewWLog / 2;
      let camY = (this.playerPos.y + TILE_LOGIC / 2) - viewHLog / 2;

      // Clamping para no ver bordes negros fuera del mapa
      const maxCamX = Math.max(0, this.mapWidth - viewWLog);
      const maxCamY = Math.max(0, this.mapHeight - viewHLog);

      this.cameraX = Math.max(0, Math.min(maxCamX, camX));
      this.cameraY = Math.max(0, Math.min(maxCamY, camY));
    }

    /* ============================================================
       TRIGGERS Y DETECCIÓN
       ============================================================ */
    checkWarp(x, y) {
      for (const exit of this.exits) {
        if (
          x >= exit.x && x <= exit.x + (exit.w || 32) &&
          y >= exit.y && y <= exit.y + (exit.h || 32)
        ) {
          return exit;
        }
      }
      return null;
    }

    updateStairTransition() {
      const stair = this.stairs.find(item =>
        this.playerPos.x >= item.x &&
        this.playerPos.x <= item.x + (item.w || TILE_LOGIC) &&
        this.playerPos.y >= item.y &&
        this.playerPos.y <= item.y + (item.h || TILE_LOGIC)
      );
      this.elevationTarget = stair
        ? Math.max(0, Math.min(1, stair.height == null ? 1 : stair.height))
        : 0;
    }

    isInFlowerPatch(x, y) {
      for (const fp of this.flowerPatches) {
        if (x >= fp.x && x <= fp.x + fp.w && y >= fp.y && y <= fp.y + fp.h) {
          return true;
        }
      }
      return false;
    }

    checkItemCollection() {
      for (const item of this.items) {
        if (item.collected) continue;
        if (Math.abs(this.playerPos.x - item.x) < 16 && Math.abs(this.playerPos.y - item.y) < 16) {
          item.collected = true;
          if (this.onItemCollect) this.onItemCollect(item);
          if (typeof CustomEvent !== 'undefined' && typeof document !== 'undefined' && document.dispatchEvent) {
            const event = new CustomEvent('itemCollected', { detail: item });
            document.dispatchEvent(event);
          }
        }
      }
    }

    interactNearby() {
      const dirOffsets = {
        'up': { dx: 0, dy: -TILE_LOGIC },
        'down': { dx: 0, dy: TILE_LOGIC },
        'left': { dx: -TILE_LOGIC, dy: 0 },
        'right': { dx: TILE_LOGIC, dy: 0 }
      };
      const off = dirOffsets[this.playerDir] || { dx: 0, dy: TILE_LOGIC };
      const frontX = this.playerPos.x + off.dx;
      const frontY = this.playerPos.y + off.dy;

      // 0. Jugadores MMO frente al jugador
      if (this.otherPlayers) {
        for (const [id, p] of this.otherPlayers.entries()) {
          const pMap = p.mapId || p.map_id;
          // Sin mapa conocido solo se muestran en la Sala Unión (no en todo Hoenn).
          const sameMap = pMap ? (pMap === this.mapId) : (this.mapId === 'grand_hotel_lobby');
          if (!sameMap) continue;
          if (window.currentUser && p.id === window.currentUser.username.toLowerCase()) continue;
          
          if (Math.abs(frontX - p.x) < 16 && Math.abs(frontY - p.y) < 16) {
            if (global.App && typeof global.App.openPlayerInteractMenu === 'function') {
              global.App.openPlayerInteractMenu(p);
            }
            return;
          }
        }
      }

      // 1. NPCs frente al jugador
      for (const npc of this.npcs) {
        if (Math.abs(frontX - npc.x) < 16 && Math.abs(frontY - npc.y) < 16) {
          if (this.onNpcInteract) this.onNpcInteract(npc);
          return;
        }
      }

      // 2. Letreros frente al jugador
      for (const sign of this.signs) {
        if (Math.abs(frontX - sign.x) < 16 && Math.abs(frontY - sign.y) < 16) {
          if (global.App && typeof global.App.readSignData === 'function') {
            global.App.readSignData(sign);
          }
          return;
        }
      }

      // 3. Items frente al jugador
      for (const item of this.items) {
        if (item.collected) continue;
        if (Math.abs(frontX - item.x) < 16 && Math.abs(frontY - item.y) < 16) {
          item.collected = true;
          if (this.onItemCollect) this.onItemCollect(item);
          return;
        }
      }
    }

    /* ============================================================
       PIPELINE DE RENDERIZADO CANVAS (GBA-FIEL)
       ============================================================ */
    render() {
      if (!this.ctx || !this.canvas) return;
      if (this.renderSuppressed) return;

      const dpr = window.devicePixelRatio || 1;
      const screenW = this.canvas.width / dpr;
      const screenH = this.canvas.height / dpr;

      this.ctx.clearRect(0, 0, screenW, screenH);
      this.ctx.imageSmoothingEnabled = false;

      // Fondo oscuro
      this.ctx.fillStyle = '#0a1610';
      this.ctx.fillRect(0, 0, screenW, screenH);

      // APLICAR TRANSFORMACIÓN GBA FIJA
      const effectiveScale = this.activeZoom * dpr;
      this.ctx.save();
      this.ctx.scale(effectiveScale, effectiveScale);
      this.ctx.translate(-Math.floor(this.cameraX), -Math.floor(this.cameraY - this.elevation * 5));

      // 1. Renderizado del Mapa
      if (this.mapImage && this.mapImage.complete && this.mapImage.naturalWidth > 0) {
        this.ctx.drawImage(this.mapImage, 0, 0, this.mapWidth, this.mapHeight);
      } else {
        this.renderProceduralBackground();
      }

      // 2. Parches de flores/hierba alta
      this.renderFlowerPatches();

      // 3. Items
      this.renderItems();

      // 4. NPCs
      this.renderNpcs();

      // 5. Otros Jugadores (WebSocket)
      this.renderOtherPlayers();

      // 6. Protagonista (Brendan)
      this.renderPlayer();

      // 6.2. Mobiliario interactivo (Sofás, sillas de intercambio y taburetes)
      this.renderSeats();

      // 6.4. Clima atmosférico dinámico (Lluvia, Arena, Ceniza)
      this.renderWeatherParticles();

      this.ctx.restore();

      // 6.6. Iluminación de cuevas oscuras y MO 05 Destello
      this.renderCaveLighting(screenW, screenH);

      // 7. HUD de Pokémon Esmeralda (En coordenadas de pantalla completas)
      this.renderEmeraldHUD(screenW, screenH);

      // 8. Fundido Cinematográfico GBA
      if (this.fadeAlpha > 0.01) {
        this.ctx.fillStyle = `rgba(0, 0, 0, ${this.fadeAlpha})`;
        this.ctx.fillRect(0, 0, screenW, screenH);
      }
    }

    renderProceduralBackground() {
      const mapId = (this.mapId || '').toLowerCase();
      const w = this.mapWidth;
      const h = this.mapHeight;

      if (mapId === 'grand_hotel_lobby' || mapId.includes('hotel') || mapId.includes('lobby') || mapId.includes('union')) {
        // Suelo de parquet de madera pulida estilo Habbo Hotel / Sala Unión GBA
        this.ctx.fillStyle = '#3d2314';
        this.ctx.fillRect(0, 0, w, h);

        // Mosaico de baldosas de madera cálida
        this.ctx.fillStyle = '#4e2d1a';
        for (let y = 0; y < h; y += 32) {
          for (let x = 0; x < w; x += 32) {
            if ((Math.floor(x / 32) + Math.floor(y / 32)) % 2 === 0) {
              this.ctx.fillRect(x, y, 32, 32);
            }
          }
        }

        // Alfombra roja elegante central
        this.ctx.fillStyle = '#8b0000';
        this.ctx.fillRect(350, 240, 100, 400);
        this.ctx.strokeStyle = '#d4af37';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(350, 240, 100, 400);

        // Ring de Duelos y Coliseo Central (2D Top-Down)
        this.ctx.fillStyle = '#1e3799';
        this.ctx.fillRect(300, 260, 200, 160);
        this.ctx.strokeStyle = '#fbc531';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(300, 260, 200, 160);

        // Poké Ball emblem en el centro del ring
        this.ctx.fillStyle = '#e84118';
        this.ctx.beginPath();
        this.ctx.arc(400, 340, 28, Math.PI, 0);
        this.ctx.fill();
        this.ctx.fillStyle = '#f5f6fa';
        this.ctx.beginPath();
        this.ctx.arc(400, 340, 28, 0, Math.PI);
        this.ctx.fill();
        this.ctx.fillStyle = '#2f3640';
        this.ctx.fillRect(372, 337, 56, 6);
        this.ctx.beginPath();
        this.ctx.arc(400, 340, 9, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.arc(400, 340, 5, 0, Math.PI * 2);
        this.ctx.fill();

        // Pared superior de madera noble y molduras doradas
        this.ctx.fillStyle = '#231309';
        this.ctx.fillRect(0, 0, w, 60);
        this.ctx.fillStyle = '#f1c40f';
        this.ctx.fillRect(0, 56, w, 4);

        // Mostrador de recepción superior
        this.ctx.fillStyle = '#834c24';
        this.ctx.fillRect(300, 80, 200, 40);
        this.ctx.strokeStyle = '#532b10';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(300, 80, 200, 40);

        // Mesas de Intercambio (Oeste y Este)
        this.ctx.fillStyle = '#2c3e50';
        this.ctx.fillRect(120, 180, 80, 60);
        this.ctx.strokeStyle = '#3498db';
        this.ctx.strokeRect(120, 180, 80, 60);

        this.ctx.fillStyle = '#2c3e50';
        this.ctx.fillRect(600, 180, 80, 60);
        this.ctx.strokeStyle = '#3498db';
        this.ctx.strokeRect(600, 180, 80, 60);

        // Pantallas digitales sobre las mesas de intercambio
        this.ctx.fillStyle = '#00cec9';
        this.ctx.fillRect(145, 195, 30, 20);
        this.ctx.fillRect(625, 195, 30, 20);

        // Paredes laterales
        this.ctx.fillStyle = '#231309';
        this.ctx.fillRect(0, 0, 40, h);
        this.ctx.fillRect(w - 40, 0, 40, h);
        this.ctx.fillRect(0, h - 40, 350, 40);
        this.ctx.fillRect(450, h - 40, 350, 40);

        // Banner de la Sala Unión en la pared
        this.ctx.font = 'bold 12px Inter, sans-serif';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('⭐ SALA UNIÓN MMO · CLUB INALÁMBRICO DE HOENN ⭐', 400, 36);

      } else if (mapId === 'underwater') {
        // Fondo oceánico profundo
        this.ctx.fillStyle = '#0b2545';
        this.ctx.fillRect(0, 0, w, h);

        // Mosaico de luz submarina
        this.ctx.fillStyle = 'rgba(19, 64, 116, 0.4)';
        for (let y = 0; y < h; y += 32) {
          for (let x = 0; x < w; x += 32) {
            if ((Math.floor(x / 32) + Math.floor(y / 32)) % 2 === 0) {
              this.ctx.fillRect(x, y, 32, 32);
            }
          }
        }
      } else if (
        mapId.includes('cave') || mapId.includes('tunnel') || mapId.includes('falls') ||
        mapId.includes('path') || mapId.includes('mountain') || mapId.includes('pyre') ||
        mapId.includes('hideout')
      ) {
        // Suelo cavernoso de roca
        this.ctx.fillStyle = '#3c352a';
        this.ctx.fillRect(0, 0, w, h);

        this.ctx.fillStyle = '#483f32';
        for (let y = 0; y < h; y += 32) {
          for (let x = 0; x < w; x += 32) {
            if ((Math.floor(x / 32) + Math.floor(y / 32)) % 2 === 0) {
              this.ctx.fillRect(x, y, 32, 32);
            }
          }
        }

        // Borde rocoso perimetral
        this.ctx.fillStyle = '#231e17';
        this.ctx.fillRect(0, 0, w, 16);
        this.ctx.fillRect(0, h - 16, w, 16);
        this.ctx.fillRect(0, 0, 16, h);
        this.ctx.fillRect(w - 16, 0, 16, h);
      } else if (
        mapId.includes('route_105') || mapId.includes('route_106') ||
        mapId.includes('route_107') || mapId.includes('route_108') ||
        mapId.includes('route_109') ||
        (mapId.startsWith('route_') && parseInt(mapId.replace('route_', ''), 10) >= 124)
      ) {
        // Rutas marinas de Hoenn: Agua azul turquesa GBA
        this.ctx.fillStyle = '#1e7b9e';
        this.ctx.fillRect(0, 0, w, h);

        this.ctx.fillStyle = '#2998c2';
        for (let y = 8; y < h; y += 32) {
          for (let x = 0; x < w; x += 64) {
            this.ctx.fillRect(x + ((Math.floor(y / 32) % 2) ? 32 : 0), y, 24, 4);
          }
        }
      } else {
        // Rutas terrestres y ciudades: pradera GBA con árboles, caminos y detalles.
        const isCity = /city|town/.test(mapId);
        let seed = 2166136261;
        for (let i = 0; i < mapId.length; i++) {
          seed ^= mapId.charCodeAt(i);
          seed = Math.imul(seed, 16777619) >>> 0;
        }
        const rnd = () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed / 4294967296;
        };

        // Base de hierba con variación de tono
        this.ctx.fillStyle = isCity ? '#68ac63' : '#57a05b';
        this.ctx.fillRect(0, 0, w, h);
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
        for (let y = 0; y < h; y += 16) {
          for (let x = 0; x < w; x += 16) {
            if ((Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0) {
              this.ctx.fillRect(x, y, 16, 16);
            }
          }
        }

        // Matas de hierba sueltas
        const tufts = Math.min(160, Math.floor((w * h) / 6500) + 30);
        for (let i = 0; i < tufts; i++) {
          const tx = 20 + rnd() * (w - 40);
          const ty = 20 + rnd() * (h - 40);
          this.ctx.strokeStyle = 'rgba(32, 92, 44, 0.45)';
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.ctx.moveTo(tx, ty + 3);
          this.ctx.lineTo(tx - 2, ty - 2);
          this.ctx.moveTo(tx, ty + 3);
          this.ctx.lineTo(tx + 2, ty - 3);
          this.ctx.moveTo(tx, ty + 3);
          this.ctx.lineTo(tx, ty - 4);
          this.ctx.stroke();
        }

        // Caminos de tierra (cruz central) con bordes irregulares
        const midY = Math.round(h / 2);
        const midX = Math.round(w / 2);
        const pathW = 48;
        this.ctx.fillStyle = '#d9c08d';
        this.ctx.fillRect(0, midY - pathW / 2, w, pathW);
        this.ctx.fillRect(midX - pathW / 2, 0, pathW, h);
        this.ctx.fillStyle = '#c7ab77';
        this.ctx.fillRect(0, midY - pathW / 2, w, 3);
        this.ctx.fillRect(0, midY + pathW / 2 - 3, w, 3);
        this.ctx.fillRect(midX - pathW / 2, 0, 3, h);
        this.ctx.fillRect(midX + pathW / 2 - 3, 0, 3, h);
        // Piedrecillas del camino
        this.ctx.fillStyle = 'rgba(120, 96, 56, 0.35)';
        for (let i = 0; i < 70; i++) {
          const onH = rnd() > 0.5;
          const px = onH ? rnd() * w : midX - 18 + rnd() * 36;
          const py = onH ? midY - 18 + rnd() * 36 : rnd() * h;
          this.ctx.fillRect(px, py, 2 + rnd() * 3, 2 + rnd() * 2);
        }

        const exits = Array.isArray(this.exits) ? this.exits : [];
        const nearExit = (x, y) => exits.some(e =>
          x > (e.x || 0) - 60 && x < (e.x || 0) + (e.w || 0) + 60 &&
          y > (e.y || 0) - 60 && y < (e.y || 0) + (e.h || 0) + 60
        );

        const drawTree = (x, y, s) => {
          // Sombra
          this.ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
          this.ctx.beginPath();
          this.ctx.ellipse(x + s * 0.5, y + s * 0.95, s * 0.55, s * 0.2, 0, 0, Math.PI * 2);
          this.ctx.fill();
          // Tronco
          this.ctx.fillStyle = '#6b4a2b';
          this.ctx.fillRect(x + s * 0.42, y + s * 0.55, s * 0.18, s * 0.45);
          // Copa en capas
          this.ctx.fillStyle = '#1f5c2e';
          this.ctx.beginPath();
          this.ctx.arc(x + s * 0.5, y + s * 0.42, s * 0.52, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.fillStyle = '#2f7a3d';
          this.ctx.beginPath();
          this.ctx.arc(x + s * 0.38, y + s * 0.36, s * 0.36, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.fillStyle = '#3f9449';
          this.ctx.beginPath();
          this.ctx.arc(x + s * 0.62, y + s * 0.3, s * 0.24, 0, Math.PI * 2);
          this.ctx.fill();
        };

        // Línea de árboles en el perímetro, respetando las salidas del mapa
        for (let x = 6; x < w - 10; x += 32 + rnd() * 20) {
          if (!nearExit(x, 10)) drawTree(x, 4, 24 + rnd() * 10);
          if (!nearExit(x, h - 34)) drawTree(x, h - 34, 24 + rnd() * 10);
        }
        for (let y = 44; y < h - 40; y += 32 + rnd() * 20) {
          if (!nearExit(6, y)) drawTree(4, y, 22 + rnd() * 8);
          if (!nearExit(w - 30, y)) drawTree(w - 30, y, 22 + rnd() * 8);
        }

        // Arbustos y flores en zonas alejadas del camino
        for (let i = 0; i < 16; i++) {
          const bx = 50 + rnd() * (w - 100);
          const by = 50 + rnd() * (h - 100);
          if (Math.abs(bx - midX) < 60 || Math.abs(by - midY) < 60) continue;
          this.ctx.fillStyle = '#2f7a3d';
          this.ctx.beginPath();
          this.ctx.arc(bx, by, 5 + rnd() * 3, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.fillStyle = '#3f9449';
          this.ctx.beginPath();
          this.ctx.arc(bx - 2, by - 2, 2.5, 0, Math.PI * 2);
          this.ctx.fill();
        }
        const flowerColors = ['#f1c40f', '#e74c3c', '#ffffff', '#e67e22'];
        for (let i = 0; i < 26; i++) {
          const fx = 40 + rnd() * (w - 80);
          const fy = 40 + rnd() * (h - 80);
          if (Math.abs(fx - midX) < 34 || Math.abs(fy - midY) < 34) continue;
          this.ctx.fillStyle = flowerColors[Math.floor(rnd() * flowerColors.length)];
          this.ctx.fillRect(fx, fy, 2, 2);
          this.ctx.fillRect(fx + 3, fy + 1, 2, 2);
        }
      }
    }

    renderFlowerPatches() {
      const img = this.flowerPatchImage;
      const ready = !!(img && img.complete && img.naturalWidth > 0);
      if (ready && !this.__flowerPattern) {
        try { this.__flowerPattern = this.ctx.createPattern(img, 'repeat'); } catch (error) { this.__flowerPattern = null; }
      }
      for (const fp of this.flowerPatches) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(fp.x, fp.y, fp.w, fp.h);
        this.ctx.clip();
        this.ctx.imageSmoothingEnabled = false;
        if (ready && this.__flowerPattern) {
          // Se repite el tile de hierba alta en vez de estirarlo: se lee mejor.
          this.ctx.fillStyle = this.__flowerPattern;
          this.ctx.fillRect(fp.x, fp.y, fp.w, fp.h);
        } else {
          this.ctx.fillStyle = 'rgba(46, 204, 113, 0.3)';
          this.ctx.fillRect(fp.x, fp.y, fp.w, fp.h);
        }
        // Borde tenue para señalar la zona de Pokémon salvajes.
        this.ctx.strokeStyle = 'rgba(150, 235, 120, 0.5)';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(fp.x + 1, fp.y + 1, Math.max(1, fp.w - 2), Math.max(1, fp.h - 2));
        this.ctx.restore();
      }
    }

    renderItems() {
      for (const item of this.items) {
        if (item.collected) continue;
        if (item.spriteRect && this.itemAtlasLoaded) {
          const rect = item.spriteRect;
          this.ctx.imageSmoothingEnabled = false;
          this.ctx.drawImage(
            this.itemAtlas,
            rect.x, rect.y, rect.w, rect.h,
            Math.floor(item.x), Math.floor(item.y), rect.dw || 16, rect.dh || 16
          );
          continue;
        }
        // Poké Ball estilo GBA: círculo de 12px
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        this.ctx.beginPath();
        this.ctx.ellipse(item.x + 8, item.y + 14, 5, 2.5, 0, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#e74c3c';
        this.ctx.beginPath();
        this.ctx.arc(item.x + 8, item.y + 8, 5, Math.PI, 0);
        this.ctx.fill();

        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.arc(item.x + 8, item.y + 8, 5, 0, Math.PI);
        this.ctx.fill();

        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(item.x + 4, item.y + 7.5, 8, 1);
      }
    }

    renderNpcs() {
      for (const npc of this.npcs) {
        // Sombra
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        this.ctx.beginPath();
        this.ctx.ellipse(npc.x + 8, npc.y + 14, 6, 3, 0, 0, Math.PI * 2);
        this.ctx.fill();

        // Sprite NPC (16x22 px lógicos)
        if (this.brendanLoaded && this.brendanSprite.naturalWidth > 0) {
          const dirRows = { down: 0, left: 1, right: 2, up: 3 };
          const row = dirRows[npc.dir || 'down'] || 0;
          this.ctx.drawImage(
            this.brendanSprite,
            16, row * 64 + 10, 32, 44, // Source
            Math.floor(npc.x), Math.floor(npc.y - 6), 16, 22 // Dest 16x22
          );
        } else {
          this.ctx.fillStyle = npc.color || '#27ae60';
          this.ctx.fillRect(npc.x, npc.y, 16, 16);
        }
      }
    }

    renderOtherPlayers() {
      if (!this.otherPlayers || !this.otherPlayers.size) return;
      this.otherPlayers.forEach(p => {
        const pMap = p.mapId || p.map_id;
        // Sin mapa conocido solo se muestran en la Sala Unión (no en todo Hoenn).
        const sameMap = pMap ? (pMap === this.mapId) : (this.mapId === 'grand_hotel_lobby');
        if (!sameMap) return;
        if (window.currentUser && p.id === window.currentUser.username.toLowerCase()) return;

        // Sombra
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        this.ctx.beginPath();
        this.ctx.ellipse(p.x + 8, p.y + 14, 6, 3, 0, 0, Math.PI * 2);
        this.ctx.fill();

        // Sprite
        if (this.brendanLoaded) {
          const dirRows = { down: 0, left: 1, right: 2, up: 3 };
          const row = dirRows[p.dir || 'down'] || 0;
          this.ctx.drawImage(
            this.brendanSprite,
            16, row * 64 + 10, 32, 44,
            Math.floor(p.x), Math.floor(p.y - 6), 16, 22
          );
        }

        // Cartel del nombre
        const name = p.name || 'Entrenador';
        this.ctx.font = 'bold 8px Inter, sans-serif';
        const tw = this.ctx.measureText(name).width;
        this.ctx.fillStyle = (p.state === 'Sentado') ? 'rgba(41, 128, 185, 0.85)' : 'rgba(13, 40, 24, 0.85)';
        this.ctx.fillRect(p.x + 8 - tw / 2 - 3, p.y - 14, tw + 6, 10);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(name, p.x + 8, p.y - 6);

        // Burbuja de chat flotante estilo Habbo / Sala Unión
        if (p.chat_bubble && (p.chat_bubble_until == null || p.chat_bubble_until > Date.now() / 1000)) {
          this.renderSpeechBubble(p.x, p.y, p.chat_bubble, false);
        }
      });
    }

    renderPlayer() {
      const px = Math.floor(this.playerPos.x);
      const py = Math.floor(this.playerPos.y);

      // 1. Sombra bajo los pies estilo GBA
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
      this.ctx.beginPath();
      this.ctx.ellipse(px + 8, py + 14, 6, 3, 0, 0, Math.PI * 2);
      this.ctx.fill();

      // 2. Sprite de Brendan (16x22 px lógicos, pies alineados a la base del tile)
      if (this.brendanLoaded && this.brendanSprite.naturalWidth > 0) {
        const dirRows = { down: 0, left: 1, right: 2, up: 3 };
        const row = dirRows[this.playerDir] || 0;
        const col = (this.walkFrame % 4);

        // Recorte exacto del cuerpo desde la celda de 64x64 px
        this.ctx.drawImage(
          this.brendanSprite,
          col * 64 + 16, row * 64 + 10, 32, 44, // Source 32x44 px
          px, py - 6, 16, 22 // Dest 16x22 px (pies en el tile, cabeza sobresale arriba)
        );
      } else {
        this.ctx.fillStyle = '#e74c3c';
        this.ctx.fillRect(px, py, 16, 16);
      }

      // Burbuja de chat flotante propia estilo Habbo
      if (this.myChatBubble && this.myChatBubbleUntil > Date.now() / 1000) {
        this.renderSpeechBubble(px, py, this.myChatBubble, true);
      }
    }

    renderSpeechBubble(x, y, text, isMe = false) {
      if (!text) return;
      this.ctx.save();
      this.ctx.font = 'bold 9px Inter, sans-serif';
      const maxChars = 28;
      const displayText = text.length > maxChars ? text.substring(0, maxChars) + '...' : text;
      const textMetrics = this.ctx.measureText(displayText);
      const textWidth = Math.min(180, Math.max(34, textMetrics.width));
      const bubbleW = textWidth + 14;
      const bubbleH = 18;
      const bubbleX = Math.floor(x + 8 - bubbleW / 2);
      const bubbleY = Math.floor(y - 34);

      // Sombra suave
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      this.ctx.beginPath();
      this.ctx.roundRect(bubbleX + 2, bubbleY + 2, bubbleW, bubbleH, 6);
      this.ctx.fill();

      // Fondo de la burbuja
      this.ctx.fillStyle = isMe ? '#fef9e7' : '#ffffff';
      this.ctx.beginPath();
      this.ctx.roundRect(bubbleX, bubbleY, bubbleW, bubbleH, 6);
      this.ctx.fill();

      // Borde exterior
      this.ctx.strokeStyle = isMe ? '#f39c12' : '#2c3e50';
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();

      // Puntero triangular hacia el personaje
      this.ctx.fillStyle = isMe ? '#fef9e7' : '#ffffff';
      this.ctx.beginPath();
      this.ctx.moveTo(x + 8 - 4, bubbleY + bubbleH);
      this.ctx.lineTo(x + 8, bubbleY + bubbleH + 5);
      this.ctx.lineTo(x + 8 + 4, bubbleY + bubbleH);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.strokeStyle = isMe ? '#f39c12' : '#2c3e50';
      this.ctx.beginPath();
      this.ctx.moveTo(x + 8 - 4, bubbleY + bubbleH);
      this.ctx.lineTo(x + 8, bubbleY + bubbleH + 5);
      this.ctx.lineTo(x + 8 + 4, bubbleY + bubbleH);
      this.ctx.stroke();

      // Texto de la burbuja
      this.ctx.fillStyle = '#1e272e';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(displayText, bubbleX + bubbleW / 2, bubbleY + bubbleH / 2);
      this.ctx.restore();
    }

    setMyChatBubble(text) {
      this.myChatBubble = text;
      this.myChatBubbleUntil = (Date.now() / 1000) + 6.0;
    }

    renderSeats() {
      if (!this.seats || !this.seats.length) return;
      for (const seat of this.seats) {
        if (seat.type === 'sofa') {
          this.ctx.fillStyle = '#2980b9';
          this.ctx.beginPath();
          this.ctx.roundRect(seat.x, seat.y, 28, 18, 4);
          this.ctx.fill();
          this.ctx.strokeStyle = '#1c5980';
          this.ctx.stroke();
          this.ctx.fillStyle = '#3498db';
          this.ctx.fillRect(seat.x + 4, seat.y + 4, 20, 10);
        } else if (seat.type === 'trade') {
          this.ctx.fillStyle = '#8e44ad';
          this.ctx.beginPath();
          this.ctx.arc(seat.x + 8, seat.y + 8, 8, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.strokeStyle = '#5b2c6f';
          this.ctx.stroke();
        } else if (seat.type === 'bar') {
          this.ctx.fillStyle = '#d35400';
          this.ctx.beginPath();
          this.ctx.arc(seat.x + 7, seat.y + 7, 7, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.strokeStyle = '#a04000';
          this.ctx.stroke();
        }
      }
    }

    detectWeather(mapId) {
      if (!mapId) return 'NONE';
      const m = mapId.toLowerCase();
      if (m.includes('119') || m.includes('120') || m.includes('fortree')) return 'RAIN';
      if (m.includes('111') || m.includes('desert')) return 'SANDSTORM';
      if (m.includes('113')) return 'ASH';
      return 'NONE';
    }

    initWeatherParticles() {
      this.weatherParticles = [];
      const count = (this.weatherType === 'RAIN') ? 60 : (this.weatherType === 'SANDSTORM') ? 50 : (this.weatherType === 'ASH') ? 35 : 0;
      for (let i = 0; i < count; i++) {
        this.weatherParticles.push({
          x: Math.random() * (this.mapWidth || 640),
          y: Math.random() * (this.mapHeight || 512),
          speed: 2 + Math.random() * 4,
          length: 8 + Math.random() * 8,
          size: 1 + Math.random() * 2
        });
      }
    }

    renderWeatherParticles() {
      if (this.weatherType === 'NONE' || !this.weatherParticles.length) return;

      if (this.weatherType === 'RAIN') {
        this.ctx.strokeStyle = 'rgba(116, 185, 255, 0.65)';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        for (const p of this.weatherParticles) {
          this.ctx.moveTo(p.x, p.y);
          this.ctx.lineTo(p.x - p.length * 0.4, p.y + p.length);
          p.y += p.speed * 2.2;
          p.x -= p.speed * 0.8;
          if (p.y > this.mapHeight) {
            p.y = 0;
            p.x = Math.random() * this.mapWidth;
          }
        }
        this.ctx.stroke();

      } else if (this.weatherType === 'SANDSTORM') {
        this.ctx.fillStyle = 'rgba(243, 156, 18, 0.45)';
        for (const p of this.weatherParticles) {
          this.ctx.fillRect(p.x, p.y, p.size, p.size);
          p.x += p.speed * 2.5;
          p.y += p.speed * 0.5;
          if (p.x > this.mapWidth) {
            p.x = 0;
            p.y = Math.random() * this.mapHeight;
          }
        }

      } else if (this.weatherType === 'ASH') {
        this.ctx.fillStyle = 'rgba(236, 240, 241, 0.6)';
        for (const p of this.weatherParticles) {
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          this.ctx.fill();
          p.y += p.speed * 0.4;
          p.x += Math.sin(p.y * 0.05) * 0.6;
          if (p.y > this.mapHeight) {
            p.y = 0;
            p.x = Math.random() * this.mapWidth;
          }
        }
      }
    }

    renderCaveLighting(screenW, screenH) {
      const mapId = (this.mapId || '').toLowerCase();
      const isCave = mapId.includes('cave') || mapId.includes('tunnel') || mapId.includes('falls') || mapId.includes('pyre') || mapId.includes('victory_road');
      if (!isCave) return;

      const dpr = window.devicePixelRatio || 1;
      const effectiveScale = this.fixedZoom * dpr;
      const pxScreen = (this.playerPos.x + 8 - this.cameraX) * effectiveScale;
      const pyScreen = (this.playerPos.y + 8 - this.cameraY) * effectiveScale;
      const radius = (this.flashActive ? 180 : 45) * effectiveScale;

      this.ctx.save();
      const grad = this.ctx.createRadialGradient(pxScreen, pyScreen, radius * 0.3, pxScreen, pyScreen, radius);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(0.7, 'rgba(10, 15, 20, 0.7)');
      grad.addColorStop(1, 'rgba(5, 8, 12, 0.96)');

      this.ctx.fillStyle = grad;
      this.ctx.fillRect(0, 0, screenW, screenH);

      if (this.flashActive) {
        this.ctx.fillStyle = '#2ecc71';
        this.ctx.font = 'bold 11px Inter, sans-serif';
        this.ctx.textAlign = 'right';
        this.ctx.fillText('💡 MO 05 Destello Activo', screenW - 20, 30);
      }
      this.ctx.restore();
    }

    renderEmeraldHUD(viewW, viewH) {
      // 1. Cartel deslizante de localización estilo Esmeralda
      if (this.bannerSlide > 0.01) {
        const bannerW = Math.min(340, viewW - 30);
        const bannerH = 46;
        const bannerY = -bannerH + this.bannerSlide * (bannerH + 12);
        const bannerX = (viewW - bannerW) / 2;

        this.ctx.save();
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        this.ctx.shadowBlur = 10;
        this.ctx.fillStyle = EMERALD_THEME.darkGreen;
        this.ctx.strokeStyle = EMERALD_THEME.emeraldBright;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.roundRect(bannerX, bannerY, bannerW, bannerH, 6);
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.fillStyle = EMERALD_THEME.goldAccent;
        this.ctx.font = 'bold 13px "Outfit", Inter, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(this.mapName.toUpperCase(), viewW / 2, bannerY + 20);

        if (this.mapSubtitle) {
          this.ctx.fillStyle = '#b7e4c7';
          this.ctx.font = '10px Inter, sans-serif';
          this.ctx.fillText(this.mapSubtitle, viewW / 2, bannerY + 36);
        }
        this.ctx.restore();
      }

      // 2. Barra de Controles GBA Inferior (Retro)
      const barH = 22;
      this.ctx.fillStyle = 'rgba(11, 32, 20, 0.88)';
      this.ctx.fillRect(0, viewH - barH, viewW, barH);
      this.ctx.fillStyle = '#95d5b2';
      this.ctx.font = 'bold 10px Inter, monospace';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('[WASD/Flechas] Mover  •  [Shift] Correr  •  [E/Espacio] Hablar / Examinar', viewW / 2, viewH - barH / 2);
    }

    /* ============================================================
       EVENT LISTENERS (SIN ZOOM DE RATÓN NI PANEO)
       ============================================================ */
    setupEventListeners() {
      // Teclado
      this._keydownHandler = (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

        this.keysPressed[e.key] = true;

        if (e.key === 'e' || e.key === 'E' || e.key === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          this.interactNearby();
        }

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
        }
      };

      this._keyupHandler = (e) => {
        delete this.keysPressed[e.key];
      };

      document.addEventListener('keydown', this._keydownHandler);
      document.addEventListener('keyup', this._keyupHandler);

      // Redimensionado de ventana (recalcula zoom fijo)
      this._resizeHandler = () => this.resize();
      window.addEventListener('resize', this._resizeHandler);

      // Clics en canvas para interactuar con asientos y otros jugadores estilo Habbo
      this._clickHandler = (e) => {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const clickXScreen = (e.clientX - rect.left);
        const clickYScreen = (e.clientY - rect.top);
        const effectiveScale = this.fixedZoom;

        // Coordenadas lógicas en el mapa
        const mapX = Math.floor(this.cameraX + clickXScreen / effectiveScale);
        const mapY = Math.floor(this.cameraY + clickYScreen / effectiveScale);

        // 1. Verificar clic en otro jugador
        if (this.otherPlayers && this.otherPlayers.size) {
          for (const p of this.otherPlayers.values()) {
            if (p.mapId && p.mapId !== this.mapId) continue;
            if (Math.abs(mapX - (p.x + 8)) < 18 && Math.abs(mapY - (p.y + 8)) < 22) {
              if (this.onOtherPlayerClick) {
                this.onOtherPlayerClick(p);
                return;
              }
            }
          }
        }

        // 2. Verificar clic en asiento/sofá/silla de intercambio
        if (this.seats && this.seats.length) {
          for (const seat of this.seats) {
            if (Math.abs(mapX - (seat.x + 10)) < 18 && Math.abs(mapY - (seat.y + 10)) < 18) {
              this.isSeated = true;
              this.currentSeat = seat;
              this.playerPos.x = seat.x;
              this.playerPos.y = seat.y;
              this.playerDir = seat.dir || 'down';
              if (this.onSeatInteract) {
                this.onSeatInteract(seat);
              }
              return;
            }
          }
        }

        // 3. Levantarse si estaba sentado
        if (this.isSeated) {
          this.isSeated = false;
          this.currentSeat = null;
          if (this.onSeatInteract) {
            this.onSeatInteract(null);
          }
        }
      };
      this.canvas.addEventListener('click', this._clickHandler);
    }

    /* ============================================================
       CAMBIO DE MAPA Y CICLO DE VIDA
       ============================================================ */
    setMap(mapId, options = {}) {
      this.mapId = mapId;
      this.mapName = options.name || mapId;
      this.mapSubtitle = options.subtitle || '';
      this.mapWidth = options.width || 640;
      this.mapHeight = options.height || 512;

      if (options.image) {
        this.mapImageUrl = options.image;
        this.mapImage = new Image();
        this.mapImage.src = this.mapImageUrl;
      }

      this.obstacles = options.obstacles || [];
      this.npcs = options.npcs || [];
      this.signs = options.signs || [];
      this.exits = options.exits || options.warps || [];
      this.flowerPatches = options.flowerPatches || [];

      // Reconstruir mapa de colisiones para la nueva zona
      this.collisionGrid = this.buildCollisionMap({
        width: this.mapWidth,
        height: this.mapHeight,
        obstacles: this.obstacles,
        npcs: this.npcs,
        signs: this.signs,
        exits: this.exits,
        flowerPatches: this.flowerPatches
      });

      if (options.spawn) {
        this.playerPos.x = Math.round(options.spawn.x / TILE_LOGIC) * TILE_LOGIC;
        this.playerPos.y = Math.round(options.spawn.y / TILE_LOGIC) * TILE_LOGIC;
        this.startGridPos.x = this.playerPos.x;
        this.startGridPos.y = this.playerPos.y;
        this.targetGridPos.x = this.playerPos.x;
        this.targetGridPos.y = this.playerPos.y;
        this.playerDir = options.spawn.dir || 'down';
      }

      this.bannerTimer = 180;
      this.bannerSlide = 0.1;
      this.startFadeIn();
      this.updateCamera();
    }

    startLoop() {
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min(0.05, (now - this.lastTime) / 1000);
        this.lastTime = now;

        this.update(dt);
        this.render();

        this.animFrameId = requestAnimationFrame(loop);
      };
      this.animFrameId = requestAnimationFrame(loop);
    }

    destroy() {
      this.running = false;
      if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
      document.removeEventListener('keydown', this._keydownHandler);
      document.removeEventListener('keyup', this._keyupHandler);
      window.removeEventListener('resize', this._resizeHandler);
      if (this.canvas) {
        if (this._clickHandler) this.canvas.removeEventListener('click', this._clickHandler);
        if (this.canvas.parentNode) {
          this.canvas.parentNode.removeChild(this.canvas);
        }
      }
    }
  }

  // Exportar globalmente
  global.TileMapRenderer = TileMapRenderer;
})(typeof window !== 'undefined' ? window : this);
