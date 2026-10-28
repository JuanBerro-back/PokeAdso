/**
 * modules/terrain_patches.js
 * Relieves 3D del mapa: montañas con volumen real y colisión.
 *
 * Los mapas de Hoenn se dibujan con un fondo procedural (o una lámina), así que
 * una montaña era sólo un píxel plano. Este módulo genera cadenas montañosas
 * deterministas por mapa y las comparte entre:
 *   1. El motor 2D (`tilemap_renderer`) para dibujarlas y bloquear sus tiles.
 *   2. El diorama 3D (`world3d`) para levantar geometría real con sombras.
 *
 * No toca mapas interiores, cuevas, rutas marinas ni mapas con lámina oficial.
 */
"use strict";
(function (window) {
  const TAU = Math.PI * 2;
  const TILE = 16;
  const MARGIN = 32; // px de respeto respecto al borde del mapa

  const CAVE_RE = /(cave|tunnel|falls|path|mountain|pyre|hideout|victory_road|shoal|abandoned_ship)/;
  const INDOOR_RE = /(pokemon_center|poke_mart|birch_lab|gym_|hotel|lobby|union|interior|room_)/;
  const SEA_RE = /^route_(105|106|107|108|109|124|125|126|127|128|129|130|131|132|133|134)$/;

  function hashString(text) {
    let hash = 2166136261 >>> 0;
    const str = String(text || 'hoenn');
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function makeRandom(seed) {
    let state = seed >>> 0;
    return function random() {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function supports(map) {
    if (!map || map.image) return false;
    const id = String(map.id || '').toLowerCase();
    if (!id || id === 'overworld' || id === 'underwater' || id.startsWith('underwater_')) return false;
    if (id.startsWith('reference_') || INDOOR_RE.test(id) || CAVE_RE.test(id)) return false;
    if (SEA_RE.test(id)) return false;
    return true;
  }

  function rect(x, y, w, h) {
    return { x, y, w, h };
  }

  /** Zonas que una montaña no debe tapar: salidas, NPCs, objetos, caminos... */
  function blockedAreas(map, width, height) {
    const areas = [];
    const spawn = map.spawn || {};
    if (Number.isFinite(Number(spawn.x)) && Number.isFinite(Number(spawn.y))) {
      areas.push(rect(spawn.x - 96, spawn.y - 96, 192, 192));
    }
    (map.exits || []).forEach((exit) => {
      if (!exit) return;
      areas.push(rect((exit.x || 0) - 48, (exit.y || 0) - 48, (exit.w || 48) + 96, (exit.h || 48) + 96));
    });
    (map.items || []).forEach((item) => {
      if (!item || item.hidden) return;
      areas.push(rect((item.x || 0) - 56, (item.y || 0) - 56, 112, 112));
    });
    (map.npcs || []).forEach((npc) => {
      if (!npc) return;
      areas.push(rect((npc.x || 0) - 72, (npc.y || 0) - 72, 144, 144));
    });
    (map.signs || []).forEach((sign) => {
      if (!sign) return;
      areas.push(rect((sign.x || 0) - 56, (sign.y || 0) - 56, 112, 112));
    });
    (map.obstacles || []).forEach((obs) => {
      if (!obs) return;
      areas.push(rect((obs.x || 0) - 20, (obs.y || 0) - 20, (obs.w || 32) + 40, (obs.h || 32) + 40));
    });
    (map.flowerPatches || []).forEach((patch) => {
      if (!patch) return;
      areas.push(rect(patch.x - 20, patch.y - 20, patch.w + 40, patch.h + 40));
    });
    // El fondo procedural pinta un camino en cruz; las montañas lo respetan.
    const midX = width / 2;
    const midY = height / 2;
    areas.push(rect(midX - 80, 0, 160, height));
    areas.push(rect(0, midY - 80, width, 160));
    return areas;
  }

  /**
   * Rejilla de tiles libres. Se usa el centro de cada tile igual que hace la
   * colisión, así lo que se pinta como montaña es exactamente lo que bloquea.
   */
  function occupancy(map, width, height) {
    const cols = Math.max(1, Math.ceil(width / TILE));
    const rows = Math.max(1, Math.ceil(height / TILE));
    const blocked = new Uint8Array(cols * rows);
    const areas = blockedAreas(map, width, height);

    for (let ty = 0; ty < rows; ty += 1) {
      const cy = ty * TILE + TILE / 2;
      for (let tx = 0; tx < cols; tx += 1) {
        const cx = tx * TILE + TILE / 2;
        let hit = cx < MARGIN || cy < MARGIN || cx > width - MARGIN || cy > height - MARGIN;
        if (!hit) {
          for (let i = 0; i < areas.length; i += 1) {
            const area = areas[i];
            if (cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h) {
              hit = true;
              break;
            }
          }
        }
        if (hit) blocked[ty * cols + tx] = 1;
      }
    }

    return { cols, rows, blocked };
  }

  /** Tiles cuyo centro cae dentro de la elipse; null si alguno ya está ocupado. */
  function fitEllipse(occ, x, y, rx, ry) {
    const x1 = Math.max(0, Math.floor((x - rx) / TILE));
    const x2 = Math.min(occ.cols - 1, Math.floor((x + rx) / TILE));
    const y1 = Math.max(0, Math.floor((y - ry) / TILE));
    const y2 = Math.min(occ.rows - 1, Math.floor((y + ry) / TILE));
    const tiles = [];
    for (let ty = y1; ty <= y2; ty += 1) {
      const cy = ty * TILE + TILE / 2;
      for (let tx = x1; tx <= x2; tx += 1) {
        const cx = tx * TILE + TILE / 2;
        const dx = (cx - x) / rx;
        const dy = (cy - y) / ry;
        if (dx * dx + dy * dy > 1) continue;
        const index = ty * occ.cols + tx;
        if (occ.blocked[index]) return null;
        tiles.push(index);
      }
    }
    return tiles.length >= 10 ? tiles : null;
  }

  function generate(map, width, height) {
    const area = width * height;
    const random = makeRandom(hashString(`${map.id}|${map.name}|${width}x${height}|terrain`));
    const scale = Math.max(0.85, Math.min(3.4, Math.sqrt(area) / 620));
    const target = Math.max(2, Math.min(6, 2 + Math.floor(area / 260000)));
    const occ = occupancy(map, width, height);

    // Centros candidatos: sólo tiles libres. Elegir al azar entre ellos hace que
    // las montañas aprovechen los huecos reales (esquinas, claros del bosque).
    const freeTiles = [];
    for (let i = 0; i < occ.blocked.length; i += 1) {
      if (!occ.blocked[i]) freeTiles.push(i);
    }

    const mountains = [];
    let attempts = 0;
    const maxAttempts = 500;

    while (mountains.length < target && attempts < maxAttempts && freeTiles.length) {
      attempts += 1;
      const pick = freeTiles[Math.floor(random() * freeTiles.length)];
      const tx = pick % occ.cols;
      const ty = (pick - tx) / occ.cols;
      const x = tx * TILE + TILE / 2 + (random() - 0.5) * TILE;
      const y = ty * TILE + TILE / 2 + (random() - 0.5) * TILE;

      let placed = null;
      const sizes = [1, 0.82, 0.66, 0.52];
      for (let s = 0; s < sizes.length; s += 1) {
        const rx = (68 + random() * 54) * scale * sizes[s];
        const ry = rx * (0.66 + random() * 0.44);
        if (rx < 24 || ry < 18) continue;
        if (x - rx < MARGIN * 0.6 || y - ry < MARGIN * 0.6) continue;
        if (x + rx > width - MARGIN * 0.6 || y + ry > height - MARGIN * 0.6) continue;
        const tiles = fitEllipse(occ, x, y, rx, ry);
        if (tiles) {
          placed = { rx, ry, tiles };
          break;
        }
      }
      if (!placed) continue;

      placed.tiles.forEach((index) => { occ.blocked[index] = 1; });
      const grow = Math.min(1.6, Math.max(0.7, placed.rx / 78));
      mountains.push({
        id: `${map.id || 'map'}_mtn_${mountains.length + 1}`,
        x,
        y,
        rx: placed.rx,
        ry: placed.ry,
        peak: (1.9 + random() * 1.7) * grow,
        seed: hashString(`${map.id}-${mountains.length}-${Math.round(x)}-${Math.round(y)}`),
      });
    }

    return mountains.length ? { mountains } : null;
  }

  function ensure(map) {
    if (!map || typeof map !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(map, '_terrainPatches')) return map._terrainPatches;
    const width = Number(map.width) || 640;
    const height = Number(map.height) || 512;
    const terrain = supports(map) ? generate(map, width, height) : null;
    map._terrainPatches = terrain;
    return terrain;
  }

  /** ¿El punto (px) cae dentro de una montaña? `factor` ajusta el borde sólido. */
  function at(terrain, x, y, factor = 0.86) {
    if (!terrain || !Array.isArray(terrain.mountains)) return null;
    for (let i = 0; i < terrain.mountains.length; i += 1) {
      const m = terrain.mountains[i];
      const dx = (x - m.x) / (m.rx * factor);
      const dy = (y - m.y) / (m.ry * factor);
      if (dx * dx + dy * dy <= 1) return m;
    }
    return null;
  }

  function contains(terrain, x, y, factor = 0.86) {
    return !!at(terrain, x, y, factor);
  }

  /**
   * Dibuja las montañas en el mapa 2D (vista cenital) con volumen simulado:
   * sombra, base rocosa, laderas y cumbre. Así el bloqueo no es invisible.
   */
  function draw2D(ctx, terrain) {
    if (!ctx || !terrain || !Array.isArray(terrain.mountains)) return;
    terrain.mountains.forEach((m) => {
      const random = makeRandom(m.seed >>> 0);
      const { x, y, rx, ry } = m;
      const base = Math.max(0.7, Math.min(2.2, rx / 70));

      ctx.save();
      // Sombra proyectada hacia el sureste.
      ctx.fillStyle = 'rgba(18, 26, 18, 0.20)';
      ctx.beginPath();
      ctx.ellipse(x + rx * 0.10, y + ry * 0.14, rx * 1.02, ry * 1.02, 0, 0, TAU);
      ctx.fill();

      // Base rocosa con degradado radial: la luz viene del noroeste, así que el
      // centro (cumbre) queda claro y la ladera sureste cae en sombra. Esto se
      // lee como un monte en vista cenital, no como un blanco de tiro.
      const lightX = x - rx * 0.22;
      const lightY = y - ry * 0.26;
      const relief = ctx.createRadialGradient(lightX, lightY, Math.max(2, rx * 0.05), x, y, rx * 1.05);
      relief.addColorStop(0, '#cdc19d');
      relief.addColorStop(0.28, '#ada080');
      relief.addColorStop(0.55, '#8b8163');
      relief.addColorStop(0.8, '#6b6350');
      relief.addColorStop(1, '#4e4839');
      ctx.fillStyle = relief;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
      ctx.fill();

      // Crestas radiales: líneas que bajan de la cumbre al pie.
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, rx * 0.99, ry * 0.99, 0, 0, TAU);
      ctx.clip();
      const spines = 7;
      for (let i = 0; i < spines; i += 1) {
        const angle = (i / spines) * TAU + random() * 0.35;
        const bend = 0.10 + random() * 0.18;
        ctx.strokeStyle = i % 2
          ? `rgba(58, 52, 39, ${0.28 + base * 0.08})`
          : `rgba(226, 214, 183, ${0.16 + base * 0.05})`;
        ctx.lineWidth = (1.1 + random() * 1.1) * base;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * rx * 0.12, y + Math.sin(angle) * ry * 0.12);
        ctx.quadraticCurveTo(
          x + Math.cos(angle + bend) * rx * 0.62,
          y + Math.sin(angle + bend) * ry * 0.62,
          x + Math.cos(angle) * rx * 0.98,
          y + Math.sin(angle) * ry * 0.98,
        );
        ctx.stroke();
      }

      // Repisas de roca suelta.
      for (let i = 0; i < 6; i += 1) {
        const angle = random() * TAU;
        const rr = 0.25 + random() * 0.6;
        const sx = x + Math.cos(angle) * rx * rr;
        const sy = y + Math.sin(angle) * ry * rr;
        ctx.fillStyle = `rgba(72, 65, 50, ${0.22 + random() * 0.2})`;
        ctx.beginPath();
        ctx.ellipse(sx, sy, (3 + random() * 5) * base, (2 + random() * 3) * base, random() * Math.PI, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      // Perfil del pie y cumbre.
      ctx.strokeStyle = '#413c2e';
      ctx.lineWidth = 1.6 * base;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
      ctx.stroke();

      ctx.fillStyle = 'rgba(233, 223, 195, 0.85)';
      ctx.beginPath();
      ctx.ellipse(lightX, lightY, rx * 0.09, ry * 0.08, 0, 0, TAU);
      ctx.fill();

      // Falda de hierba y rocas sueltas al pie.
      ctx.strokeStyle = 'rgba(58, 112, 62, 0.65)';
      ctx.lineWidth = 2 * base;
      ctx.beginPath();
      ctx.ellipse(x, y, rx * 1.01, ry * 1.01, 0, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();

      ctx.fillStyle = '#5c5646';
      for (let i = 0; i < 7; i += 1) {
        const angle = random() * TAU;
        const rr = 0.88 + random() * 0.16;
        const sx = x + Math.cos(angle) * rx * rr;
        const sy = y + Math.sin(angle) * ry * rr;
        const size = (1.4 + random() * 2.2) * base;
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, TAU);
        ctx.fill();
      }

      ctx.restore();
    });
  }

  window.TerrainPatches = {
    ensure,
    at,
    contains,
    draw2D,
    supports,
    hashString,
    makeRandom,
  };
})(window);
