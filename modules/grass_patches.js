/**
 * modules/grass_patches.js
 * Zonas de hierba alta (arbustos) donde aparecen Pokémon salvajes.
 *
 * Muchos mapas definen encuentros en data/hoenn_maps.js pero no tienen
 * "flowerPatches", así que aquí se generan zonas deterministas por mapa.
 * Esas mismas zonas se usan para:
 *   1. Pintar los arbustos en 2D y en 3D.
 *   2. Marcar tiles TALL_GRASS en el motor de colisiones.
 *   3. Decidir si el jugador está en una zona de encuentros.
 */
"use strict";
(function (window) {
  const TILE = 16;          // tamaño lógico de tile del motor 2D
  const MARGIN = 40;        // margen respecto al borde del mapa
  const MIN_W = 80;
  const MIN_H = 56;

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

  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const expand = (rect, pad) => ({
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.w + pad * 2,
    h: rect.h + pad * 2,
  });

  const roundTile = (value) => Math.round(value / TILE) * TILE;

  function validPatch(patch) {
    return !!patch
      && Number.isFinite(Number(patch.x))
      && Number.isFinite(Number(patch.y))
      && Number(patch.w) > 0
      && Number(patch.h) > 0;
  }

  function manualPatches(map) {
    return Array.isArray(map && map.flowerPatches) ? map.flowerPatches.filter(validPatch) : [];
  }

  /** Zonas donde no conviene poner hierba alta (spawn, salidas, items, NPCs...). */
  function blockedAreas(map) {
    const areas = [];
    const spawn = map.spawn || {};
    if (Number.isFinite(Number(spawn.x)) && Number.isFinite(Number(spawn.y))) {
      areas.push({ x: spawn.x - 96, y: spawn.y - 96, w: 192, h: 192 });
    }
    (map.exits || []).forEach((exit) => {
      if (!exit) return;
      areas.push({ x: (exit.x || 0) - 24, y: (exit.y || 0) - 24, w: (exit.w || 40) + 48, h: (exit.h || 40) + 48 });
    });
    (map.items || []).forEach((item) => {
      if (!item || item.hidden) return;
      areas.push({ x: (item.x || 0) - 40, y: (item.y || 0) - 40, w: 80, h: 80 });
    });
    (map.npcs || []).forEach((npc) => {
      if (!npc) return;
      areas.push({ x: (npc.x || 0) - 56, y: (npc.y || 0) - 56, w: 112, h: 112 });
    });
    (map.signs || []).forEach((sign) => {
      if (!sign) return;
      areas.push({ x: (sign.x || 0) - 40, y: (sign.y || 0) - 40, w: 80, h: 80 });
    });
    (map.obstacles || []).forEach((obs) => {
      if (!obs) return;
      areas.push({ x: (obs.x || 0) - 12, y: (obs.y || 0) - 12, w: (obs.w || 32) + 24, h: (obs.h || 32) + 24 });
    });
    return areas;
  }

  /** Genera `count` zonas nuevas evitando las ya existentes y los puntos de interés. */
  function generate(map, count, existing) {
    const width = Number(map.width) || 640;
    const height = Number(map.height) || 512;
    const seedText = `${map.id || ''}|${map.name || ''}|${width}x${height}|grass`;
    const random = makeRandom(hashString(seedText));
    const blocked = blockedAreas(map).concat((existing || []).map((patch) => expand(patch, 40)));
    const patches = [];
    // En mapas grandes (región completa) las zonas deben ser proporcionalmente mayores.
    const scale = Math.max(1, Math.min(4, Math.sqrt(width * height) / 700));
    const attempts = Math.max(60, count * 90);
    let guard = 0;
    while (patches.length < count && guard < attempts) {
      guard += 1;
      const w = roundTile((MIN_W + random() * 96) * scale);
      const h = roundTile((MIN_H + random() * 72) * scale);
      const maxX = width - w - MARGIN;
      const maxY = height - h - MARGIN;
      if (maxX <= MARGIN || maxY <= MARGIN) break;
      const rect = {
        x: roundTile(MARGIN + random() * (maxX - MARGIN)),
        y: roundTile(MARGIN + random() * (maxY - MARGIN)),
        w,
        h,
      };
      if (rect.x < MARGIN || rect.y < MARGIN) continue;
      if (rect.x + rect.w > width - MARGIN || rect.y + rect.h > height - MARGIN) continue;
      if (blocked.some((area) => overlaps(rect, area))) continue;
      patches.push(rect);
      blocked.push(expand(rect, 48));
    }
    return patches;
  }

  /**
   * Devuelve (y cachea en el mapa) las zonas de hierba alta.
   * Sólo se generan zonas nuevas si el mapa tiene Pokémon salvajes definidos.
   */
  function ensure(map) {
    if (!map || typeof map !== 'object') return [];
    if (Array.isArray(map._grassPatches)) return map._grassPatches;
    const manual = manualPatches(map);
    const encounters = map.encounters && Array.isArray(map.encounters.pokemon) ? map.encounters.pokemon : [];
    let patches = manual.slice();
    if (encounters.length) {
      const width = Number(map.width) || 640;
      const height = Number(map.height) || 512;
      const target = Math.max(3, Math.min(7, 3 + Math.floor((width * height) / 260000)));
      if (patches.length < target) {
        patches = patches.concat(generate(map, target - patches.length, patches));
      }
    }
    map._grassPatches = patches;
    // Compatibilidad: el resto del motor ya lee map.flowerPatches.
    map.flowerPatches = patches;
    return patches;
  }

  function contains(patch, x, y) {
    if (!patch) return false;
    return x >= patch.x && x <= patch.x + patch.w && y >= patch.y && y <= patch.y + patch.h;
  }

  function at(patches, x, y) {
    const list = patches || [];
    for (let i = 0; i < list.length; i += 1) {
      if (contains(list[i], x, y)) return list[i];
    }
    return null;
  }

  window.GrassPatches = { ensure, generate, at, contains, hashString };
})(window);
