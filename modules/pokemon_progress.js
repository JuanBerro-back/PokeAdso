/**
 * modules/pokemon_progress.js — Progresión real por Pokémon (Gen 3)
 *
 * Responsabilidades:
 *  - Normalizar Pokémon guardados (nivel, XP, estadísticas reales).
 *  - Curva de experiencia (medium-fast: nivel^3) y reparto de XP.
 *  - Subida de nivel con recálculo de estadísticas.
 *  - Evoluciones por nivel usando data/evoluciones.json.
 *  - Creación de Pokémon salvajes/de entrenador a partir del catálogo.
 *
 * No depende del DOM: se puede probar en Node.
 */
(function (root) {
  "use strict";

  const STAT_KEYS = ["hp", "attack", "defense", "sp_attack", "sp_defense", "speed"];
  const MAX_LEVEL = 100;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  /** XP total acumulada necesaria para alcanzar `level` (curva media). */
  function xpForLevel(level) {
    const l = clamp(Math.floor(level), 1, MAX_LEVEL);
    return Math.pow(l, 3);
  }

  /** XP que falta para el siguiente nivel. */
  function xpToNext(mon) {
    if (!mon) return 0;
    const level = clamp(Math.floor(toNumber(mon.level, 1)), 1, MAX_LEVEL);
    if (level >= MAX_LEVEL) return 0;
    return Math.max(0, xpForLevel(level + 1) - toNumber(mon.xp, xpForLevel(level)));
  }

  /** XP que otorga un Pokémon derrotado. */
  function xpYield(defeated) {
    if (!defeated) return 1;
    const base = baseStatsOf(defeated);
    const bst = STAT_KEYS.reduce((sum, key) => sum + toNumber(base[key], 50), 0);
    const level = clamp(toNumber(defeated.level, 5), 1, MAX_LEVEL);
    return Math.max(1, Math.floor((bst / 4) * level / 4));
  }

  function baseStatsOf(mon) {
    const raw = (mon && mon.baseStats) || mon || {};
    return {
      hp: toNumber(raw.hp, 50),
      attack: toNumber(raw.attack, 50),
      defense: toNumber(raw.defense, 50),
      sp_attack: toNumber(raw.sp_attack, 50),
      sp_defense: toNumber(raw.sp_defense, 50),
      speed: toNumber(raw.speed, 50)
    };
  }

  /** Estadísticas reales de Gen 3 (IV 15, EV 0) para un nivel dado. */
  function statsFor(base, level) {
    const l = clamp(Math.floor(level), 1, MAX_LEVEL);
    const b = baseStatsOf(base);
    return {
      hp: Math.max(10, Math.floor((2 * b.hp * l) / 100) + l + 10),
      attack: Math.max(5, Math.floor((2 * b.attack * l) / 100) + 5),
      defense: Math.max(5, Math.floor((2 * b.defense * l) / 100) + 5),
      sp_attack: Math.max(5, Math.floor((2 * b.sp_attack * l) / 100) + 5),
      sp_defense: Math.max(5, Math.floor((2 * b.sp_defense * l) / 100) + 5),
      speed: Math.max(5, Math.floor((2 * b.speed * l) / 100) + 5)
    };
  }

  function findBase(mon, catalog) {
    if (!mon) return null;
    const list = Array.isArray(catalog) ? catalog : [];
    const dexId = toNumber(mon.dexId || mon.id, 0);
    if (dexId > 0) {
      const byId = list.find(p => toNumber(p.dexId || p.id, 0) === dexId);
      if (byId) return byId;
    }
    const name = String(mon.name || "").trim().toLowerCase();
    if (!name) return null;
    return list.find(p =>
      String(p.name || "").trim().toLowerCase() === name ||
      String(p.name_en || "").trim().toLowerCase() === name
    ) || null;
  }

  function typesOf(base, fallback) {
    if (base && Array.isArray(base.types) && base.types.length) return base.types.slice();
    if (base && base.type) return String(base.type).split("/").map(s => s.trim()).filter(Boolean);
    if (fallback && Array.isArray(fallback.types) && fallback.types.length) return fallback.types.slice();
    if (fallback && fallback.type) return String(fallback.type).split("/").map(s => s.trim()).filter(Boolean);
    return ["Normal"];
  }

  /**
   * Normaliza un Pokémon (guardado antiguo, capturado o creado a mano).
   * Preserva el porcentaje de PS actual al recalcular el máximo.
   */
  function ensureMon(mon, options) {
    if (!mon) return mon;
    const opts = options || {};
    const catalog = opts.catalog || [];
    const base = findBase(mon, catalog) || mon;
    const level = clamp(Math.floor(toNumber(mon.level, opts.level || 5)), 1, MAX_LEVEL);
    const stats = statsFor(base, level);

    const oldMax = toNumber(mon.maxHp || mon.hp, stats.hp);
    const oldCurrent = toNumber(mon.currentHp, oldMax);
    const wasFull = oldCurrent >= oldMax;
    const ratio = oldMax > 0 ? oldCurrent / oldMax : 1;

    mon.level = level;
    mon.xp = clamp(Math.floor(toNumber(mon.xp, xpForLevel(level))), 0, xpForLevel(MAX_LEVEL));
    mon.baseStats = baseStatsOf(base);
    mon.dexId = toNumber(base.dexId || base.id || mon.dexId || mon.id, mon.dexId || mon.id || 0) || mon.dexId || mon.id;
    mon.types = typesOf(base, mon);
    mon.type = mon.types.join("/");
    mon.hp = stats.hp;
    mon.maxHp = stats.hp;
    mon.attack = stats.attack;
    mon.defense = stats.defense;
    mon.sp_attack = stats.sp_attack;
    mon.sp_defense = stats.sp_defense;
    mon.speed = stats.speed;
    mon.currentHp = oldCurrent <= 0 ? 0 : (wasFull ? stats.hp : clamp(Math.round(stats.hp * ratio), 1, stats.hp));
    if (base && base.image && !mon.image) mon.image = base.image;
    if (base && base.name && opts.rename !== false) mon.name = base.name;
    mon.statsVersion = 2;
    return mon;
  }

  /** Crea un Pokémon listo para combatir a partir de una especie del catálogo. */
  function createMon(base, level, options) {
    const opts = options || {};
    const lvl = clamp(Math.floor(toNumber(level, 5)), 1, MAX_LEVEL);
    const stats = statsFor(base, lvl);
    const types = typesOf(base);
    const mon = {
      name: base.name || opts.name || "Pokémon",
      dexId: toNumber(base.dexId || base.id, 0) || base.id,
      types,
      type: types.join("/"),
      level: lvl,
      xp: xpForLevel(lvl),
      baseStats: baseStatsOf(base),
      hp: stats.hp,
      maxHp: stats.hp,
      currentHp: opts.fullHp === false ? Math.max(0, Math.floor(stats.hp / 2)) : stats.hp,
      attack: stats.attack,
      defense: stats.defense,
      sp_attack: stats.sp_attack,
      sp_defense: stats.sp_defense,
      speed: stats.speed,
      image: base.image || opts.image || null,
      isWild: !!opts.isWild,
      statsVersion: 2
    };
    return mon;
  }

  function pickEvolution(mon, evolutions) {
    if (!mon || !evolutions) return null;
    const list = evolutions[String(mon.dexId || mon.id)] || [];
    const level = toNumber(mon.level, 1);
    const candidates = list
      .filter(e => e && e.to && (!e.method || e.method === "level-up") && toNumber(e.level, 0) <= level)
      .sort((a, b) => toNumber(a.level, 0) - toNumber(b.level, 0));
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  /**
   * Aplica XP, subidas de nivel y evolución.
   * Devuelve un resumen para el registro de combate.
   */
  function grantXp(mon, amount, options) {
    const opts = options || {};
    const result = { xp: Math.max(0, Math.floor(amount)), levels: [], evolution: null, fromLevel: mon ? mon.level : null };
    if (!mon || result.xp <= 0) return result;

    const oldLevel = clamp(Math.floor(toNumber(mon.level, 5)), 1, MAX_LEVEL);
    mon.level = oldLevel;
    mon.xp = toNumber(mon.xp, xpForLevel(oldLevel)) + result.xp;

    while (mon.level < MAX_LEVEL && mon.xp >= xpForLevel(mon.level + 1)) {
      mon.level += 1;
      result.levels.push(mon.level);
      const beforeHp = toNumber(mon.currentHp, mon.maxHp || mon.hp);
      const wasFainted = beforeHp <= 0;
      const oldMax = toNumber(mon.maxHp || mon.hp, 10);
      const stats = statsFor(baseStatsOf(mon), mon.level);
      mon.hp = stats.hp;
      mon.maxHp = stats.hp;
      mon.attack = stats.attack;
      mon.defense = stats.defense;
      mon.sp_attack = stats.sp_attack;
      mon.sp_defense = stats.sp_defense;
      mon.speed = stats.speed;
      // Como en los juegos: al subir de nivel se recupera la diferencia de PS (un debilitado sigue debilitado).
      mon.currentHp = wasFainted ? 0 : Math.max(1, Math.min(stats.hp, beforeHp + Math.max(0, stats.hp - oldMax)));

      if (opts.evolutions) {
        const evo = pickEvolution(mon, opts.evolutions);
        if (evo) {
          const evolved = evolveMon(mon, evo, opts.catalog || []);
          if (evolved) result.evolution = evolved;
        }
      }
    }

    if (mon.level >= MAX_LEVEL) mon.xp = Math.min(mon.xp, xpForLevel(MAX_LEVEL));
    return result;
  }

  /** Evoluciona un Pokémon conservando nivel, XP y movimientos. */
  function evolveMon(mon, entry, catalog) {
    const targetId = toNumber(entry && entry.to, 0);
    if (!mon || !targetId) return null;
    const base = (catalog || []).find(p => toNumber(p.dexId || p.id, 0) === targetId);
    if (!base) return null;
    const fromName = mon.name;
    const fromDex = mon.dexId || mon.id;
    const stats = statsFor(base, mon.level);
    const ratio = mon.maxHp ? clamp(toNumber(mon.currentHp, mon.maxHp) / mon.maxHp, 0, 1) : 1;

    mon.name = base.name || mon.name;
    mon.dexId = targetId;
    mon.id = targetId;
    mon.baseStats = baseStatsOf(base);
    mon.types = typesOf(base, mon);
    mon.type = mon.types.join("/");
    mon.hp = stats.hp;
    mon.maxHp = stats.hp;
    mon.attack = stats.attack;
    mon.defense = stats.defense;
    mon.sp_attack = stats.sp_attack;
    mon.sp_defense = stats.sp_defense;
    mon.speed = stats.speed;
    mon.currentHp = ratio <= 0 ? 0 : Math.max(1, Math.round(stats.hp * ratio));
    if (base.image) mon.image = base.image;
    mon.statsVersion = 2;
    return { from: fromName, fromDex, to: mon.name, toDex: targetId, level: mon.level };
  }

  /**
   * Reparte XP al equipo: el activo recibe el 100% y el resto el 50%.
   * Devuelve una lista de resúmenes por Pokémon.
   */
  function grantPartyXp(team, active, amount, options) {
    const opts = options || {};
    const list = Array.isArray(team) ? team.filter(Boolean) : [];
    const reports = [];
    const seen = new Set();
    list.forEach(mon => {
      if (seen.has(mon)) return;
      seen.add(mon);
      const isActive = mon === active;
      const share = isActive ? amount : Math.floor(amount * (opts.benchShare != null ? opts.benchShare : 0.5));
      if (share <= 0) return;
      const report = grantXp(mon, share, opts);
      report.mon = mon;
      report.isActive = isActive;
      reports.push(report);
    });
    return reports;
  }

  const api = {
    STAT_KEYS,
    MAX_LEVEL,
    xpForLevel,
    xpToNext,
    xpYield,
    baseStatsOf,
    statsFor,
    findBase,
    ensureMon,
    createMon,
    pickEvolution,
    grantXp,
    grantPartyXp,
    evolveMon
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.PokemonProgress = api;
})(typeof window !== "undefined" ? window : globalThis);
