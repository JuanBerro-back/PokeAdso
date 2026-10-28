/**
 * admin.js — Motor de Aventura Hoenn / PokéTrainer
 * 100% Recreación de Mapas de Esmeralda:
 * - Mapa Inicial: Villa Raíz (Littleroot Town) [Foto 3]
 * - Ciudades conectadas: Ciudad Petalia [Foto 2] y Ciudad Férrica [Foto 1]
 * - NPCs con movimiento autónomo continuo e interacción completa en tiempo real
 * - Diálogos retro GBA, curación, suministros y combates integrados directamente en el mapa (sin otra página)
 */
"use strict";

console.log('[PVP] admin.js v23 cargado (PvP 1v1 lista)');
window.PVP_BUILD_VERSION = 23;

(function AppMain() {

  /* ============================================================
     1. CRYPTO — AES-256-GCM por sesión
     ============================================================ */
  const Crypto = (() => {
    const KEY_STORE = 'hoennKey';
    let _key = null;

    function bufToB64(buf) {
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function b64ToBuf(b64) {
      const base64 = b64.replace(/-/g, '+').replace(/_/g, '/');
      const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - base64.length % 4);
      const s = atob(base64 + pad);
      const buf = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i);
      return buf.buffer;
    }

    async function generate() {
      _key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      const raw = await crypto.subtle.exportKey('raw', _key);
      sessionStorage.setItem(KEY_STORE, bufToB64(raw));
    }

    async function load() {
      const stored = sessionStorage.getItem(KEY_STORE);
      if (!stored) return;
      try {
        const raw = b64ToBuf(stored);
        _key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      } catch {
        _key = null;
        sessionStorage.removeItem(KEY_STORE);
      }
    }

    function clear()  { _key = null; sessionStorage.removeItem(KEY_STORE); }
    function hasKey() { return !!_key; }

    async function encrypt(text) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const enc = new TextEncoder().encode(text);
      const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _key, enc);
      return bufToB64(cipher) + '.' + bufToB64(iv.buffer);
    }

    async function decrypt(encoded) {
      const [dataB64, ivB64] = encoded.split('.');
      if (!dataB64 || !ivB64) throw new Error('Formato inválido');
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(ivB64)) },
        _key,
        b64ToBuf(dataB64)
      );
      return new TextDecoder().decode(plain);
    }

    return { generate, load, clear, hasKey, encrypt, decrypt };
  })();

  /* ============================================================
     2. STORAGE SEGURO
     ============================================================ */
  const Store = {
    async set(key, val) {
      if (!Crypto.hasKey()) return;
      try {
        const enc = await Crypto.encrypt(JSON.stringify(val));
        localStorage.setItem(key, enc);
      } catch (e) { console.warn('Store.set', e); }
    },

    async get(key) {
      if (!Crypto.hasKey()) return null;
      try {
        const enc = localStorage.getItem(key);
        if (!enc) return null;
        return JSON.parse(await Crypto.decrypt(enc));
      } catch { return null; }
    }
  };

  /* ============================================================
     3. SANITIZACIÓN / VALIDACIÓN
     ============================================================ */
  const Validate = {
    sanitize(str) {
      if (typeof str !== 'string') return '';
      return str.replace(/[<>]/g, '').replace(/['";\/\\]/g, '').trim();
    },
    escHtml(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  };

  /* ============================================================
     4. ESTADO DE JUEGO Y ENTRENADOR
     ============================================================ */
  let currentUser = null;
  let currentView = 'mundo';

  // Equipo del rival (se pobla al recibir PVP_BATTLE_START con opponent_team)
  let pvpOpponentTeam = [];

  const $ = id => document.getElementById(id);
  const dom = {
    sidebar:         $('sidebar'),
    menuContainer:   $('menuContainer'),
    pageContent:     $('pageContent'),
    viewTitle:       $('viewTitle'),
    roleBadge:       $('roleBadge'),
    userNameDisplay: $('userNameDisplay'),
    userRoleDisplay: $('userRoleDisplay'),
    userAvatar:      $('userAvatar'),
    modalOverlay:    $('modalOverlay'),
    modalBody:       $('modalBody'),
    modalCloseBtn:   $('modalCloseBtn'),
  };

  const WIKIDEX_SPRITES = window.WIKIDEX_EMERALD_SPRITES || {};

  function getPokemonSpriteUrl(name, id) {
    if (window.getEmeraldSprite) return window.getEmeraldSprite(name, id);
    if (WIKIDEX_SPRITES[name]) return WIKIDEX_SPRITES[name];
    if (window.EMERALD_ASSETS && Number.isFinite(Number(id))) {
      return window.EMERALD_ASSETS.pokedexSprite(id);
    }
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id || 25}.png`;
  }

  // ── Paneles laterales de equipo (Sala Unión / PvP) ──────────────────────────
  function myTeamList() {
    const list = [];
    if (trainerState && trainerState.starter && trainerState.starter.name) {
      list.push(trainerState.starter);
    }
    if (trainerState && Array.isArray(trainerState.collection)) {
      const activeName = trainerState.starter && trainerState.starter.name;
      trainerState.collection.forEach(p => {
        if (p && p.name && p.name !== activeName) list.push(p);
      });
    }
    return list;
  }

  function teamSpr(mon) {
    return (mon && mon.image)
      ? mon.image
      : getPokemonSpriteUrl((mon && mon.name) || 'Pikachu', (mon && mon.dexId) || (mon && mon.id) || 25);
  }

  function teamCardHtml(mon, active) {
    const name = (mon && mon.name) || '???';
    const lvl = (mon && (mon.level || mon.nivel)) || 5;
    const maxHp = (mon && (mon.hp || mon.maxHp)) || 50;
    const hp = (mon && (mon.current_hp != null ? mon.current_hp : (mon.currentHp != null ? mon.currentHp : maxHp))) || maxHp;
    const pct = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
    return `
      <div class="pvp-team-card ${active ? 'pvp-team-active' : ''}">
        <img class="pvp-team-sprite" src="${teamSpr(mon)}" alt="${name}" loading="lazy"
             onerror="this.onerror=null;this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png';">
        <div class="pvp-team-card-body">
          <div class="pvp-team-name">${Validate.escHtml(name)} <span class="pvp-team-lvl">Nv.${lvl}</span></div>
          <div class="pvp-team-hpbar"><div class="pvp-team-hpfill ${pct < 25 ? 'low' : ''}" style="width:${pct}%"></div></div>
          <div class="pvp-team-hpnum">${hp}/${maxHp} PS ${active ? '· EQUIPO' : ''}</div>
        </div>
      </div>`;
  }

  function renderTeamPanelHtml(side, title, mons, activeName, emptyText) {
    const count = mons && mons.length ? mons.length : 0;
    const cards = count
      ? mons.map(m => teamCardHtml(m, m && m.name === activeName)).join('')
      : `<div class="pvp-team-empty">${emptyText}</div>`;
    return `
      <div class="pvp-team-panel ${side}">
        <div class="pvp-team-title"><i class="fas ${side === 'pvp-team-left' ? 'fa-user' : 'fa-bolt'}"></i> ${title} <span class="pvp-team-count">${count}</span></div>
        <div class="pvp-team-body">${cards}</div>
      </div>`;
  }

  const STARTERS = [
    { id: 'treecko', dexId: 252, name: 'Treecko', type: 'Planta', hp: 19, maxHp: 19, attack: 9, image: 'https://images.wikidexcdn.net/mwuploads/wikidex/0/08/latest/20080926023345/Treecko_E.gif', baseStats: { hp: 40, attack: 45, defense: 35, sp_attack: 65, sp_defense: 55, speed: 70 } },
    { id: 'torchic', dexId: 255, name: 'Torchic', type: 'Fuego', hp: 19, maxHp: 19, attack: 11, image: 'https://images.wikidexcdn.net/mwuploads/wikidex/d/d3/latest/20090206005624/Torchic_E.gif', baseStats: { hp: 45, attack: 60, defense: 40, sp_attack: 70, sp_defense: 50, speed: 45 } },
    { id: 'mudkip',  dexId: 258, name: 'Mudkip',  type: 'Agua',   hp: 20, maxHp: 20, attack: 12, image: 'https://images.wikidexcdn.net/mwuploads/wikidex/7/71/latest/20091217193111/Mudkip_E.gif', baseStats: { hp: 50, attack: 70, defense: 50, sp_attack: 50, sp_defense: 50, speed: 40 } }
  ];

  // Catálogo completo de los 414 Pokémon con sprites animados de Pokémon Esmeralda (WikiDex)
  const EMERALD_POKEMON_LIST = Object.entries(WIKIDEX_SPRITES).map(([pokeName, spriteUrl], index) => {
    const id = index + 1;
    const waterNames = ['Mudkip', 'Marshtomp', 'Swampert', 'Kyogre', 'Lotad', 'Lombre', 'Ludicolo', 'Magikarp', 'Gyarados', 'Barboach', 'Whiscash', 'Marill', 'Azumarill', 'Pelipper', 'Wingull', 'Carvanha', 'Sharpedo', 'Wailmer', 'Wailord', 'Corphish', 'Crawdaunt', 'Feebas', 'Milotic', 'Staryu', 'Starmie', 'Spheal', 'Sealeo', 'Walrein', 'Clamperl', 'Huntail', 'Gorebyss', 'Relicanth', 'Luvdisc', 'Squirtle', 'Wartortle', 'Blastoise', 'Psyduck', 'Golduck', 'Poliwag', 'Poliwhirl', 'Poliwrath', 'Tentacool', 'Tentacruel', 'Slowpoke', 'Slowbro', 'Seel', 'Dewgong', 'Shellder', 'Cloyster', 'Krabby', 'Kingler', 'Horsea', 'Seadra', 'Goldeen', 'Seaking', 'Vaporeon', 'Totodile', 'Croconaw', 'Feraligatr', 'Chinchou', 'Lanturn', 'Wooper', 'Quagsire', 'Qwilfish', 'Corsola', 'Remoraid', 'Octillery', 'Mantine', 'Kingdra', 'Suicune'];
    const fireNames = ['Torchic', 'Combusken', 'Blaziken', 'Groudon', 'Vulpix', 'Ninetales', 'Numel', 'Camerupt', 'Torkoal', 'Charmander', 'Charmeleon', 'Charizard', 'Growlithe', 'Arcanine', 'Ponyta', 'Rapidash', 'Magmar', 'Flareon', 'Moltres', 'Cyndaquil', 'Quilava', 'Typhlosion', 'Slugma', 'Magcargo', 'Houndour', 'Houndoom', 'Magby', 'Entei', 'Ho-Oh'];
    const grassNames = ['Treecko', 'Grovyle', 'Sceptile', 'Seedot', 'Nuzleaf', 'Shiftry', 'Shroomish', 'Breloom', 'Roselia', 'Cacnea', 'Cacturne', 'Tropius', 'Bulbasaur', 'Ivysaur', 'Venusaur', 'Oddish', 'Gloom', 'Vileplume', 'Bellsprout', 'Weepinbell', 'Victreebel', 'Exeggcute', 'Exeggutor', 'Tangela', 'Chikorita', 'Bayleef', 'Meganium', 'Bellossom', 'Hoppip', 'Skiploom', 'Jumpluff', 'Sunkern', 'Sunflora', 'Celebi'];
    const elecNames = ['Pikachu', 'Raichu', 'Electrike', 'Manectric', 'Plusle', 'Minun', 'Magnemite', 'Magneton', 'Voltorb', 'Electrode', 'Electabuzz', 'Jolteon', 'Zapdos', 'Pichu', 'Mareep', 'Flaaffy', 'Ampharos', 'Elekid', 'Raikou'];
    const rockGroundNames = ['Geodude', 'Graveler', 'Golem', 'Onix', 'Nosepass', 'Aron', 'Lairon', 'Aggron', 'Baltoy', 'Claydol', 'Anorith', 'Armaldo', 'Regirock', 'Registeel', 'Sandshrew', 'Sandslash', 'Diglett', 'Dugtrio', 'Cubone', 'Marowak', 'Rhyhorn', 'Rhydon', 'Sudowoodo', 'Gligar', 'Steelix', 'Phanpy', 'Donphan', 'Larvitar', 'Pupitar', 'Tyranitar'];
    const dragonNames = ['Dratini', 'Dragonair', 'Dragonite', 'Bagon', 'Shelgon', 'Salamence', 'Trapinch', 'Vibrava', 'Flygon', 'Altaria', 'Rayquaza', 'Latias', 'Latios'];
    const psychGhostNames = ['Abra', 'Kadabra', 'Alakazam', 'Drowzee', 'Hypno', 'Mr. Mime', 'Mewtwo', 'Mew', 'Ralts', 'Kirlia', 'Gardevoir', 'Spoink', 'Grumpig', 'Lunatone', 'Solrock', 'Chimecho', 'Dusclops', 'Duskull', 'Shuppet', 'Banette', 'Sableye', 'Gastly', 'Haunter', 'Gengar', 'Misdreavus', 'Deoxys', 'Jirachi'];

    let type = 'Normal';
    if (waterNames.includes(pokeName)) type = 'Agua';
    else if (fireNames.includes(pokeName)) type = 'Fuego';
    else if (grassNames.includes(pokeName)) type = 'Planta';
    else if (elecNames.includes(pokeName)) type = 'Eléctrico';
    else if (rockGroundNames.includes(pokeName)) type = 'Roca/Tierra';
    else if (dragonNames.includes(pokeName)) type = 'Dragón';
    else if (psychGhostNames.includes(pokeName)) type = 'Psíquico/Fantasma';

    return {
      id,
      name: pokeName,
      type,
      hp: 55 + (id % 45),
      attack: 16 + (id % 20),
      image: spriteUrl
    };
  });

  let WILD_POKEMON = EMERALD_POKEMON_LIST.length ? EMERALD_POKEMON_LIST : STARTERS;
  let FULL_CATALOG_LOADED = false;

  // ----- Catálogo completo Gen 1-9 cargado desde data/pokemon_todos.json -----
  async function loadFullPokemonCatalog() {
    try {
      let response;
      try {
        response = await fetch('/api/pokemon/all');
        if (!response.ok) throw new Error();
      } catch {
        response = await fetch('data/pokemon_todos.json');
      }
      if (!response.ok) throw new Error('Error cargando catálogo completo');

      const fullDb = await response.json();
      const catalog = fullDb.map(entry => {
        const esName = entry.name_es || entry.name || '';
        return {
          id: Number(entry.id),
          dexId: Number(entry.id),
          name: esName,
          name_en: entry.name || '',
          types: Array.isArray(entry.types) ? entry.types.slice() : (entry.type ? [entry.type] : []),
          type: Array.isArray(entry.types) ? entry.types.slice().join('/') : (entry.type || 'Normal'),
          hp: Number(entry.hp) || 50,
          attack: Number(entry.attack) || 50,
          defense: Number(entry.defense) || 50,
          sp_attack: Number(entry.sp_attack) || 50,
          sp_defense: Number(entry.sp_defense) || 50,
          speed: Number(entry.speed) || 50,
          catch_rate: Number(entry.catch_rate) != null ? Number(entry.catch_rate) : 45,
          generation: Number(entry.generation) || 1,
          image: getPokemonSpriteUrl(entry.name, entry.id)
        };
      });

      if (catalog.length) {
        catalog.sort((a, b) => a.id - b.id);
        WILD_POKEMON = catalog;
        FULL_CATALOG_LOADED = true;
        // Si la partida ya estaba cargada, recalcula el equipo con las stats reales.
        refreshTeamStatsFromCatalog();
      }
    } catch (err) {
      console.warn('Catálogo completo no disponible, usando Esmeralda:', err);
    }
  }

  loadFullPokemonCatalog();

  // ===== Tabla de evoluciones por nivel (data/evoluciones.json) =====
  let EVOLUTIONS = {};

  async function loadEvolutions() {
    try {
      const response = await fetch('data/evoluciones.json', { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      EVOLUTIONS = await response.json();
      window.EVOLUTIONS = EVOLUTIONS;
    } catch (err) {
      console.warn('Tabla de evoluciones no disponible:', err);
    }
  }
  loadEvolutions();

  // ===== Base de datos de movimientos reales (data/pokemon_moves.json) =====
  let POKEMON_MOVES_DB = { moves: {}, pokemon: {} };
  let MOVES_DB_READY = false;

  async function loadPokemonMoves() {
    try {
      let response;
      try {
        response = await fetch('/api/pokemon/moves');
        if (!response.ok) throw new Error();
      } catch {
        response = await fetch('data/pokemon_moves.json');
      }
      if (!response.ok) throw new Error('Error cargando movimientos');
      const db = await response.json();
      if (db && db.pokemon) {
        POKEMON_MOVES_DB = db;
        MOVES_DB_READY = true;
      }
    } catch (err) {
      console.warn('Base de movimientos no disponible:', err);
    }
    applyMovesToAllTeam();
  }

  const FALLBACK_MOVES = {
    Normal:   [{ id:'tackle', name:'Placaje', type:'Normal', category:'fisico', power:40, pp:35 }, { id:'growl', name:'Gruñido', type:'Normal', category:'estatus', power:0, pp:40 }, { id:'quick_attack', name:'Ataque Rápido', type:'Normal', category:'fisico', power:40, pp:30 }, { id:'headbutt', name:'Golpe Cabeza', type:'Normal', category:'fisico', power:70, pp:15 }],
    Fuego:    [{ id:'ember', name:'Ascuas', type:'Fuego', category:'especial', power:40, pp:25 }, { id:'fire_spin', name:'Giro Fuego', type:'Fuego', category:'especial', power:35, pp:15 }, { id:'fire_punch', name:'Puño Ígneo', type:'Fuego', category:'fisico', power:75, pp:15 }, { id:'flame_wheel', name:'Rueda Ígnea', type:'Fuego', category:'fisico', power:60, pp:25 }],
    Agua:     [{ id:'water_gun', name:'Pistola Agua', type:'Agua', category:'especial', power:40, pp:25 }, { id:'bubble', name:'Burbuja', type:'Agua', category:'especial', power:40, pp:30 }, { id:'aqua_jet', name:'Aqua Jet', type:'Agua', category:'fisico', power:40, pp:20 }, { id:'water_pulse', name:'Pulso Agua', type:'Agua', category:'especial', power:60, pp:20 }],
    Planta:   [{ id:'absorb', name:'Absorber', type:'Planta', category:'especial', power:20, pp:25 }, { id:'vine_whip', name:'Látigo Cepa', type:'Planta', category:'fisico', power:45, pp:25 }, { id:'razor_leaf', name:'Hojas Navajas', type:'Planta', category:'fisico', power:55, pp:25 }, { id:'leaf_storm', name:'Tormenta Hoja', type:'Planta', category:'especial', power:130, pp:5 }],
    Eléctrico:[{ id:'thunder_shock', name:'Impactrueno', type:'Eléctrico', category:'especial', power:40, pp:30 }, { id:'spark', name:'Chispa', type:'Eléctrico', category:'fisico', power:65, pp:20 }, { id:'shock_wave', name:'Onda Choque', type:'Eléctrico', category:'especial', power:60, pp:20 }, { id:'thunderbolt', name:'Trueno', type:'Eléctrico', category:'especial', power:110, pp:10 }],
    Psíquico: [{ id:'confusion', name:'Confusión', type:'Psíquico', category:'especial', power:50, pp:25 }, { id:'psybeam', name:'Psicorrayo', type:'Psíquico', category:'especial', power:65, pp:20 }, { id:'psywave', name:'Psicoonda', type:'Psíquico', category:'especial', power:50, pp:15 }, { id:'psychic', name:'Psíquico', type:'Psíquico', category:'especial', power:90, pp:10 }],
    Roca:     [{ id:'rock_throw', name:'Lanzarrocas', type:'Roca', category:'fisico', power:50, pp:15 }, { id:'rock_slide', name:'Avalancha', type:'Roca', category:'fisico', power:75, pp:10 }, { id:'smack_down', name:'Golpe Colo', type:'Roca', category:'fisico', power:50, pp:15 }, { id:'stone_edge', name:'Roca Afilada', type:'Roca', category:'fisico', power:100, pp:5 }],
    Tierra:   [{ id:'mud_slap', name:'Bofetón Lodo', type:'Tierra', category:'especial', power:20, pp:10 }, { id:'dig', name:'Excavar', type:'Tierra', category:'fisico', power:80, pp:10 }, { id:'bulldoze', name:'Topo Toro', type:'Tierra', category:'fisico', power:60, pp:20 }, { id:'earth_power', name:'Poder Terrestre', type:'Tierra', category:'especial', power:90, pp:10 }],
    Hielo:    [{ id:'powder_snow', name:'Nieve Polvo', type:'Hielo', category:'especial', power:40, pp:25 }, { id:'ice_shard', name:'Copos Glacial', type:'Hielo', category:'fisico', power:40, pp:30 }, { id:'frost_breath', name:'Aliento Gélido', type:'Hielo', category:'especial', power:60, pp:10 }, { id:'ice_beam', name:'Rayo Hielo', type:'Hielo', category:'especial', power:90, pp:10 }],
    Volador:  [{ id:'gust', name:'Tornado', type:'Volador', category:'especial', power:40, pp:35 }, { id:'wing_attack', name:'Ataque Ala', type:'Volador', category:'fisico', power:60, pp:35 }, { id:'air_slash', name:'Aire Filo', type:'Volador', category:'especial', power:75, pp:15 }, { id:'brave_bird', name:'Pájaro Osado', type:'Volador', category:'fisico', power:120, pp:15 }],
    Bicho:    [{ id:'bug_bite', name:'Picadura', type:'Bicho', category:'fisico', power:60, pp:20 }, { id:'silver_wind', name:'Viento Plateado', type:'Bicho', category:'especial', power:60, pp:5 }, { id:'x_scissor', name:'Tijera X', type:'Bicho', category:'fisico', power:80, pp:15 }, { id:'bug_buzz', name:'Zumbido', type:'Bicho', category:'especial', power:90, pp:10 }],
    Lucha:    [{ id:'karate_chop', name:'Golpe Kárate', type:'Lucha', category:'fisico', power:50, pp:25 }, { id:'low_kick', name:'Tiro Bajo', type:'Lucha', category:'fisico', power:60, pp:20 }, { id:'brick_break', name:'Demolición', type:'Lucha', category:'fisico', power:75, pp:15 }, { id:'close_combat', name:'Combate Cercano', type:'Lucha', category:'fisico', power:120, pp:5 }],
    Veneno:   [{ id:'poison_sting', name:'Aguijón Venenoso', type:'Veneno', category:'fisico', power:15, pp:35 }, { id:'acid', name:'Ácido', type:'Veneno', category:'especial', power:40, pp:30 }, { id:'sludge_bomb', name:'Bomba Lodo', type:'Veneno', category:'especial', power:90, pp:10 }, { id:'gunk_shot', name:'Lanzamugre', type:'Veneno', category:'fisico', power:120, pp:5 }],
    Fantasma: [{ id:'lick', name:'Lengüetazo', type:'Fantasma', category:'fisico', power:30, pp:30 }, { id:'shadow_ball', name:'Bola Sombra', type:'Fantasma', category:'especial', power:80, pp:15 }, { id:'shadow_claw', name:'Garra Umbría', type:'Fantasma', category:'fisico', power:70, pp:15 }, { id:'phantom_force', name:'Fuerza Fantasma', type:'Fantasma', category:'fisico', power:90, pp:10 }],
    Dragón:   [{ id:'dragon_rage', name:'Furia Dragón', type:'Dragón', category:'especial', power:40, pp:10 }, { id:'dragon_breath', name:'Aliento Dragón', type:'Dragón', category:'especial', power:60, pp:20 }, { id:'dragon_claw', name:'Garra Dragón', type:'Dragón', category:'fisico', power:80, pp:15 }, { id:'outrage', name:'Enfado', type:'Dragón', category:'fisico', power:120, pp:10 }],
    Siniestro:[{ id:'bite', name:'Mordisco', type:'Siniestro', category:'fisico', power:60, pp:25 }, { id:'thief', name:'Robo', type:'Siniestro', category:'fisico', power:60, pp:25 }, { id:'night_slash', name:'Tajo Umbrío', type:'Siniestro', category:'fisico', power:70, pp:20 }, { id:'dark_pulse', name:'Pulso Umbrío', type:'Siniestro', category:'especial', power:80, pp:15 }],
    Acero:    [{ id:'metal_claw', name:'Garra Metal', type:'Acero', category:'fisico', power:50, pp:35 }, { id:'iron_tail', name:'Cola Acero', type:'Acero', category:'fisico', power:100, pp:15 }, { id:'flash_cannon', name:'Cañón Destello', type:'Acero', category:'especial', power:80, pp:10 }, { id:'steel_beam', name:'Vigía Acero', type:'Acero', category:'especial', power:140, pp:5 }],
    Hada:     [{ id:'disarming_voice', name:'Voz Cautivadora', type:'Hada', category:'especial', power:40, pp:15 }, { id:'fairy_wind', name:'Viento Hada', type:'Hada', category:'especial', power:40, pp:30 }, { id:'draining_kiss', name:'Beso Drenaje', type:'Hada', category:'especial', power:50, pp:10 }, { id:'moonblast', name:'Fuerza Lunar', type:'Hada', category:'especial', power:95, pp:15 }]
  };

  function primaryTypeOf(mon) {
    if (mon && Array.isArray(mon.types) && mon.types.length) return mon.types[0].split('/')[0].trim();
    if (mon && mon.type) return String(mon.type).split('/')[0].trim();
    return 'Normal';
  }

  function buildMoveFromEntry(entry) {
    const meta = POKEMON_MOVES_DB.moves && POKEMON_MOVES_DB.moves[String(entry.move)];
    return {
      id: String(entry.move),
      name: (meta && meta.name_es) || entry.move,
      type: (meta && meta.type) || 'Normal',
      category: (meta && meta.category) || 'fisico',
      power: Number((meta && meta.power) || 40) || 40,
      pp: Number((meta && meta.pp) || 20) || 20,
      maxPp: Number((meta && meta.pp) || 20) || 20,
      level: entry.level
    };
  }

  // Los 4 movimientos más recientes aprendidos a un nivel dado (como en los juegos reales)
  function getMovesForMon(mon, level) {
    const dexId = mon ? (mon.dexId || mon.id) : null;
    const primary = primaryTypeOf(mon);
    const list = (dexId != null && POKEMON_MOVES_DB.pokemon) ? (POKEMON_MOVES_DB.pokemon[String(dexId)] || []) : [];
    const learned = list
      .filter(e => (e.level || 1) <= (level || 5))
      .sort((a, b) => (a.level || 0) - (b.level || 0));
    let moves = learned.slice(-4).map(buildMoveFromEntry);

    // Rellenar hasta 4 con el movimiento por tipo + Placaje
    if (moves.length < 4) {
      const fallback = (FALLBACK_MOVES[primary] || FALLBACK_MOVES.Normal).slice();
      let i = 0;
      while (moves.length < 4 && i < fallback.length) {
        const fm = fallback[i];
        if (!moves.some(m => m.id === fm.id)) {
          moves.push({ ...fm, maxPp: fm.pp });
        }
        i++;
      }
    }
    if (!moves.length) {
      moves = [{
        id: 'tackle', name: 'Placaje', type: 'Normal', category: 'fisico', power: 40, pp: 35, maxPp: 35
      }];
    }
    return moves.slice(0, 4);
  }

  function applyMovesToMon(mon, force = false) {
    if (!mon || !MOVES_DB_READY) return;
    if (!force && mon.moves && Array.isArray(mon.moves) && mon.moves.length) return;
    const level = mon.level || trainerState.level || 5;
    mon.moves = getMovesForMon(mon, level).map(m => ({
      ...m,
      currentPp: m.pp,
      maxPp: m.maxPp
    }));
    return mon;
  }

  function applyMovesToAllTeam() {
    if (trainerState && trainerState.starter) applyMovesToMon(trainerState.starter);
    if (trainerState && Array.isArray(trainerState.collection)) {
      trainerState.collection.forEach(p => applyMovesToMon(p));
    }
  }

  // ===== Entrenadores / Rivales / Líderes reales de Esmeralda (pasa por data/entrenadores_esmeralda.js) =====
  const EMERALD_TRAINERS = (typeof window !== 'undefined' && window.EMERALD_TRAINERS) ? window.EMERALD_TRAINERS : null;

  function findTrainerConfig(trainerId) {
    if (!EMERALD_TRAINERS || !trainerId) return null;
    if (EMERALD_TRAINERS.rivals && EMERALD_TRAINERS.rivals.some(r => r.id === trainerId)) {
      return EMERALD_TRAINERS.rivals.find(r => r.id === trainerId);
    }
    if (EMERALD_TRAINERS.gymLeaders && EMERALD_TRAINERS.gymLeaders.some(g => g.id === trainerId)) {
      return EMERALD_TRAINERS.gymLeaders.find(g => g.id === trainerId);
    }
    if (EMERALD_TRAINERS.routeTrainers && EMERALD_TRAINERS.routeTrainers[trainerId]) {
      return EMERALD_TRAINERS.routeTrainers[trainerId];
    }
    return null;
  }

  function isTrainerDefeated(trainerId) {
    return !!trainerId && Array.isArray(trainerState.defeatedTrainers) && trainerState.defeatedTrainers.includes(trainerId);
  }

  // Busca una especie en el catálogo cargado (name_es o name_en)
  function findCatalogMon(name) {
    const target = String(name || '').trim().toLowerCase();
    if (!target) return null;
    return (WILD_POKEMON || []).find(p => {
      const n1 = String(p.name || '').trim().toLowerCase();
      const n2 = String(p.name_en || '').trim().toLowerCase();
      return n1 === target || n2 === target;
    }) || null;
  }

  function scaleStat(base, level) {
    return Math.max(12, Math.round(base * (1 + (level - 5) * 0.10)));
  }

  // Construye un Pokémon rival completo a partir de {especie, nivel}
  function buildTrainerMon(entry) {
    const name = String(entry.especie || entry.name || '?');
    const level = entry.nivel || entry.level || 5;
    const base = findCatalogMon(name);
    let mon = (base && window.PokemonProgress)
      ? window.PokemonProgress.createMon(base, level, { fullHp: true })
      : null;
    if (!mon) {
      const hp = base ? scaleStat(Number(base.hp) || 50, level) : scaleStat(50, level);
      const atk = base ? scaleStat(Number(base.attack) || 30, level) : scaleStat(30, level);
      const def = base ? scaleStat(Number(base.defense) || 30, level) : scaleStat(30, level);
      const satk = base ? scaleStat(Number(base.sp_attack) || 30, level) : scaleStat(30, level);
      const sdef = base ? scaleStat(Number(base.sp_defense) || 30, level) : scaleStat(30, level);
      const spd = base ? scaleStat(Number(base.speed) || 50, level) : scaleStat(50, level);
      const types = base && Array.isArray(base.types) && base.types.length
        ? base.types.slice()
        : (base && base.type ? String(base.type).split('/').map(s => s.trim()) : [String(entry.tipo || 'Normal')]);
      mon = {
        name,
        level,
        tipo: types.join('/'),
        type: types.join('/'),
        types,
        dexId: base ? (base.dexId || base.id) : null,
        hp,
        maxHp: hp,
        currentHp: hp,
        attack: atk,
        defense: def,
        sp_attack: satk,
        sp_defense: sdef,
        speed: spd,
        image: base ? base.image : getPokemonSpriteUrl(name, entry.dexId || null),
        isWild: false
      };
    }
    mon.isWild = false;
    mon.moves = getMovesForMon(mon, level).map(m => ({ ...m, currentPp: m.pp, maxPp: m.maxPp }));
    return mon;
  }

  loadPokemonMoves();

  function createBaseTrainerState() {
    return {
      starter: null,
      token: null,
      collection: [],
      level: 5,
      xp: 0,
      medals: [],
      inventory: {
        coins: 500,
        // Legacy compat (kept for saves that have them)
        potions: 0,
        pokeballs: 0,
        // Inventario basado en ITEMS_DATABASE
        items: {
          'Potion': 5,
          'Super Potion': 2,
          'Antidote': 3,
          'Revive': 1,
          'Full Heal': 1,
          'Pokeball': 10,
          'Great Ball': 3,
          'Escape Rope': 2,
          'Repel': 3,
          'Pecha Berry': 2,
          'Cheri Berry': 2,
          'Oran Berry': 3,
          'X Attack': 1,
          'X Defend': 1
        }
      },
      shinyMode: false,
      defeatedTrainers: [],
      visitedTowns: ['littleroot_town']
    };
  }

  let trainerState = createBaseTrainerState();
  window.trainerState = trainerState;

  const SAVE_VERSION = 2;
  let saveTimer = null;

  function trainerStorageKey() {
    const user = (currentUser && (currentUser.username || currentUser.accountId)) || 'guest';
    return `hoennTrainer_${String(user).toLowerCase()}`;
  }

  // Crea el compañero inicial con estadísticas reales de Gen 3.
  function createDefaultStarter() {
    const chosen = Number(window.__chosenStarterId || 2);
    const starter = STARTERS[Math.max(0, Math.min(STARTERS.length - 1, chosen - 1))] || STARTERS[1];
    const mon = window.PokemonProgress
      ? window.PokemonProgress.createMon(starter, 5, { fullHp: true })
      : { ...starter, level: 5, xp: 125, hp: starter.hp, maxHp: starter.hp, currentHp: starter.hp };
    mon.moves = getMovesForMon(mon, mon.level).map(m => ({ ...m, currentPp: m.pp, maxPp: m.maxPp }));
    return mon;
  }

  function normalizePokemon(mon) {
    if (!mon) return mon;
    if (window.PokemonProgress) {
      // Si el catálogo completo aún no llegó, usa las stats ya guardadas en el
      // Pokémon en lugar de las estimaciones del listado rápido de Esmeralda.
      window.PokemonProgress.ensureMon(mon, {
        catalog: FULL_CATALOG_LOADED ? WILD_POKEMON : [],
        rename: false
      });
    }
    if (!Array.isArray(mon.moves) || !mon.moves.length) {
      mon.moves = getMovesForMon(mon, mon.level || 5).map(m => ({ ...m, currentPp: m.pp, maxPp: m.maxPp }));
    }
    mon.currentHp = Math.max(0, Math.min(mon.maxHp || mon.hp || 1, Number(mon.currentHp)));
    return mon;
  }

  // Recalcula el equipo con el catálogo completo (stats reales) cuando termina de cargar.
  function refreshTeamStatsFromCatalog() {
    if (!FULL_CATALOG_LOADED || !trainerState) return;
    const team = [];
    if (trainerState.starter) team.push(trainerState.starter);
    (trainerState.collection || []).forEach(mon => {
      if (mon && mon !== trainerState.starter) team.push(mon);
    });
    if (!team.length) return;
    team.forEach(normalizePokemon);
    applyMovesToAllTeam();
    if (currentUser) saveTrainerProgress();
  }

  function loadTrainerState() {
    // Parte siempre de un estado limpio: evita que la partida de otra cuenta
    // o de una sesión anterior se filtre al cambiar de usuario.
    trainerState = createBaseTrainerState();
    activeMapKey = 'littleroot_town';
    playerPos = { x: 230, y: 240, dir: 'down', moving: false };

    const key = trainerStorageKey();
    let stored = null;
    try { stored = localStorage.getItem(key); } catch { /* almacenamiento bloqueado */ }

    // Migración: las partidas antiguas vivían en sessionStorage.
    if (!stored) {
      try {
        stored = sessionStorage.getItem(key) || sessionStorage.getItem('hoennTrainer_guest');
        if (stored) {
          localStorage.setItem(key, stored);
          sessionStorage.removeItem(key);
        }
      } catch { /* almacenamiento bloqueado */ }
    }

    if (stored) {
      try {
        const saved = JSON.parse(stored);
        trainerState = { ...trainerState, ...saved };
      } catch {
        console.warn('Partida guardada corrupta; se crea una nueva.');
      }
    }

    // Inventario y campos obligatorios
    if (!trainerState.inventory) trainerState.inventory = { coins: 500, items: {} };
    if (!trainerState.inventory.items) trainerState.inventory.items = {};
    if (!Array.isArray(trainerState.defeatedTrainers)) trainerState.defeatedTrainers = [];
    if (!Array.isArray(trainerState.visitedTowns) || !trainerState.visitedTowns.length) {
      trainerState.visitedTowns = ['littleroot_town'];
    }
    if (!Array.isArray(trainerState.medals)) trainerState.medals = [];
    if (!Array.isArray(trainerState.collection)) trainerState.collection = [];

    // Migrar inventario legacy
    if (trainerState.inventory.potions > 0) {
      trainerState.inventory.items['Potion'] = (trainerState.inventory.items['Potion'] || 0) + trainerState.inventory.potions;
      trainerState.inventory.potions = 0;
    }
    if (trainerState.inventory.pokeballs > 0) {
      trainerState.inventory.items['Pokeball'] = (trainerState.inventory.items['Pokeball'] || 0) + trainerState.inventory.pokeballs;
      trainerState.inventory.pokeballs = 0;
    }

    // Compañero activo
    if (!trainerState.starter || !trainerState.starter.name) {
      trainerState.starter = createDefaultStarter();
    }

    // El compañero activo y la colección deben ser el MISMO objeto,
    // para que la XP y los niveles se guarden en un único sitio.
    const collection = trainerState.collection;
    const active = trainerState.starter;
    const activeId = active.dexId || active.id;
    const matchIndex = collection.findIndex(p => p && (p === active || (
      String(p.name || '').toLowerCase() === String(active.name || '').toLowerCase() &&
      Number(p.dexId || p.id || 0) === Number(activeId || 0)
    )));
    if (matchIndex >= 0) {
      Object.assign(collection[matchIndex], active);
      trainerState.starter = collection[matchIndex];
    } else {
      collection.unshift(active);
      trainerState.starter = active;
    }

    // Normaliza estadísticas, XP y PS de todo el equipo.
    collection.forEach(normalizePokemon);
    trainerState.level = trainerState.starter.level || 5;
    trainerState.xp = trainerState.starter.xp || 0;

    // Restaurar la última posición explorada.
    const allMaps = {
      ...(window.HOENN_FULL_MAPS || {}),
      ...(window.HOENN_INTERIORS || {}),
      ...(window.EMERALD_REFERENCE_MAPS || {})
    };
    if (trainerState.mapKey && allMaps[trainerState.mapKey]) {
      activeMapKey = trainerState.mapKey;
    }
    if (trainerState.position && Number.isFinite(Number(trainerState.position.x)) && Number.isFinite(Number(trainerState.position.y))) {
      playerPos = {
        x: Number(trainerState.position.x),
        y: Number(trainerState.position.y),
        dir: trainerState.position.dir || 'down',
        moving: false
      };
    }

    window.trainerState = trainerState;
    if (!trainerState.token) trainerState.token = 'tk_' + Math.random().toString(36).slice(2, 11);

    // Asignar el avatar del protagonista (Brendan / Bruno) en el panel de usuario
    if (dom.userAvatar) {
      dom.userAvatar.innerHTML = `<div class="user-avatar-brendan" title="${Validate.escHtml(currentUser?.username || 'Brendan')}"></div>`;
    }
    applyMovesToAllTeam();
    saveTrainerProgress();
  }

  function saveTrainerProgress() {
    if (!trainerState) return;
    trainerState.saveVersion = SAVE_VERSION;
    trainerState.savedAt = Date.now();
    trainerState.mapKey = activeMapKey;
    trainerState.position = { x: playerPos.x, y: playerPos.y, dir: playerPos.dir };
    if (trainerState.starter) {
      trainerState.level = trainerState.starter.level || trainerState.level || 5;
      trainerState.xp = trainerState.starter.xp || 0;
    }
    try {
      localStorage.setItem(trainerStorageKey(), JSON.stringify(trainerState));
    } catch (e) {
      console.warn('No se pudo guardar la partida:', e);
    }
  }

  // Guardado diferido para no escribir en cada paso.
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveTrainerProgress, 700);
  }

  window.addEventListener('beforeunload', saveTrainerProgress);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveTrainerProgress();
  });

  /* ============================================================
     5. CARTOGRAFÍA UNIFICADA DE ESMERALDA (HOENN_FULL_MAPS)
     ============================================================ */
  // Fuente única de verdad: todas las 67+ zonas integradas
  const HOENN_MAPS = (typeof window !== 'undefined' && window.HOENN_FULL_MAPS) ? window.HOENN_FULL_MAPS : {};

    let activeMapKey = 'littleroot_town'; // LA ULTIMA FOTO ES EL INICIO DEL JUEGO
  let playerPos = { x: 230, y: 240, dir: 'down', moving: false };
  let activeDialog = null;
  let inMapBattle = null;
  let npcLoopInterval = null;

  /* ============================================================
     6. MOTOR DE COLISIONES Y MOVIMIENTO
     ============================================================ */
  function isObstacle(map, x, y, width = 16, height = 16, excludeNpcId = null) {
    if (worldTileRenderer && worldTileRenderer.collisionGrid) {
      return worldTileRenderer.isBlocked(x, y);
    }

    // Fuera de límites del mapa
    if (x < 16 || x > map.width - 16 || y < 16 || y > map.height - 16) return true;

    // Obstáculos definidos del mapa (edificios, vallas, agua, muros)
    if (map.obstacles) {
      for (const obs of map.obstacles) {
        if (x + width / 2 > obs.x && x - width / 2 < obs.x + obs.w &&
            y + height / 2 > obs.y && y - height / 2 < obs.y + obs.h) {
          return true;
        }
      }
    }

    // Colisión sólida con NPCs del mapa
    if (map.npcs) {
      for (const npc of map.npcs) {
        if (excludeNpcId && npc.id === excludeNpcId) continue;
        if (Math.abs(x - npc.x) < 16 && Math.abs(y - npc.y) < 16) {
          return true;
        }
      }
    }

    // Colisión sólida con letreros y buzones
    if (map.signs) {
      for (const sign of map.signs) {
        if (Math.abs(x - sign.x) < 14 && Math.abs(y - sign.y) < 14) {
          return true;
        }
      }
    }

    return false;
  }

  function isInFlowerPatch(map, x, y) {
    if (!map || !map.flowerPatches) return false;
    for (const fp of map.flowerPatches) {
      if (x >= fp.x && x <= fp.x + fp.w &&
          y >= fp.y && y <= fp.y + fp.h) {
        return true;
      }
    }
    return false;
  }

  function getNPCColorFilter(npc) {
    const filters = {
      boy_littleroot: 'hue-rotate(185deg) saturate(1.5)',
      fat_man_littleroot: 'hue-rotate(38deg) saturate(1.6) brightness(1.05)',
      girl_littleroot: 'hue-rotate(315deg) saturate(1.7) brightness(1.1)',
      prof_birch: 'hue-rotate(95deg) saturate(1.35) brightness(1.15)',
      leader_norman: 'hue-rotate(345deg) saturate(1.7) contrast(1.15)',
      nurse_joy_petalburg: 'hue-rotate(295deg) saturate(1.8) brightness(1.18)',
      nurse_joy_rustboro: 'hue-rotate(295deg) saturate(1.8) brightness(1.18)',
      clerk_petalburg: 'hue-rotate(215deg) saturate(1.7)',
      fisher_petalburg: 'hue-rotate(145deg) saturate(1.6) brightness(1.05)',
      leader_roxanne: 'hue-rotate(260deg) saturate(1.6) brightness(1.05)',
      devon_scientist: 'hue-rotate(170deg) saturate(1.85) brightness(1.2)',
      elder_fountain: 'grayscale(0.75) sepia(0.25) brightness(0.95)'
    };
    return filters[npc.id] || 'hue-rotate(120deg) saturate(1.3)';
  }

  function startNPCMovementLoop() {
    if (npcLoopInterval) clearInterval(npcLoopInterval);
    npcLoopInterval = setInterval(() => {
      if (activeDialog || inMapBattle) return; // Pausa durante diálogo o combate

      const map = HOENN_MAPS[activeMapKey];
      if (!map || !map.npcs) return;

      map.npcs.forEach(npc => {
        if (npc.range <= 0) return; // NPC estático (ej: líderes, Birch)
        if (Math.random() > 0.42) return; // Probabilidad de paso

        const dirs = ['up', 'down', 'left', 'right'];
        const chosenDir = dirs[Math.floor(Math.random() * dirs.length)];
        const step = 16;
        let nx = npc.x;
        let ny = npc.y;

        if (chosenDir === 'left') nx -= step;
        else if (chosenDir === 'right') nx += step;
        else if (chosenDir === 'up') ny -= step;
        else if (chosenDir === 'down') ny += step;

        // Comprobar rango desde origen
        if (Math.abs(nx - npc.originX) > npc.range || Math.abs(ny - npc.originY) > npc.range) return;
        // No chocar con el jugador
        if (Math.abs(nx - playerPos.x) < 22 && Math.abs(ny - playerPos.y) < 24) return;
        // Comprobar colisión sólida con mapa y demás NPCs
        if (isObstacle(map, nx, ny, 18, 22, npc.id)) return;

        npc.x = nx;
        npc.y = ny;
        npc.dir = chosenDir;
        renderEntityPos(npc.id, npc.x, npc.y, npc.dir, true);
        setTimeout(() => {
          renderEntityPos(npc.id, npc.x, npc.y, npc.dir, false);
        }, 280);
      });
    }, 1500);
  }

  function renderEntityPos(id, x, y, dir, isWalking = false) {
    const el = document.getElementById(`entity_${id}`);
    if (el) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      const box = el.querySelector('.entity-sprite-box');
      if (box) {
        box.className = `entity-sprite-box dir-${dir}`;
      }
      const spr = el.querySelector('.brendan-sprite');
      if (spr) {
        spr.className = `brendan-sprite dir-${dir} ${isWalking ? 'walking' : ''}`;
      }
    }
  }

  let worldTileRenderer = null;
  let world3dRenderer = null;
  let collectedItems = {};
  let pendingBattleEffect = null;

  window.App = window.App || {};

  const WORLD3D_PREF_KEY = 'pokepoke.world3d';
  const BANDANA_PREF_KEY = 'pokepoke.bandana';

  function world3dEnabledByPreference() {
    try { return localStorage.getItem(WORLD3D_PREF_KEY) !== '0'; } catch (error) { return true; }
  }

  function storedBandana() {
    try {
      const value = Number(localStorage.getItem(BANDANA_PREF_KEY));
      return Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : 0;
    } catch (error) {
      return 0;
    }
  }

  function destroyWorld3D() {
    if (world3dRenderer) {
      try { world3dRenderer.dispose(); } catch (error) { console.warn('[3D] Error al liberar el mapa:', error); }
      world3dRenderer = null;
    }
    window.world3dRenderer = null;
    if (window.Battle3D) window.Battle3D.dispose();
  }

  function updateWorld3DToggle() {
    const button = document.getElementById('toggle3dBtn');
    const hud = document.getElementById('world3dHud');
    const active = !!(world3dRenderer && world3dRenderer.enabled);
    if (hud) hud.style.display = active ? '' : 'none';
    if (!button) return;
    button.classList.toggle('is-active', active);
    button.innerHTML = active
      ? '<i class="fas fa-cube"></i> 3D'
      : '<i class="fas fa-border-all"></i> 2D';
    button.title = active ? 'Cambiar al mapa GBA 2D' : 'Activar el mapa 3D';
  }

  function initWorld3D(container, mapData, dims) {
    destroyWorld3D();
    if (!window.World3D || !window.THREE) return;
    try {
      world3dRenderer = new window.World3D(container, {
        view: worldTileRenderer,
        map: mapData,
        mapId: dims.mapId,
        name: dims.name,
        width: dims.width,
        height: dims.height,
        image: dims.image,
        obstacles: dims.obstacles,
        npcs: dims.npcs,
        items: dims.items,
        exits: dims.exits,
        signs: dims.signs,
        seats: dims.seats,
        flowerPatches: dims.flowerPatches,
        isDark: dims.isDark,
        onPlayerClick: (player) => {
          if (window.LobbyManager) window.LobbyManager.openPlayerContextMenu(player);
        },
        onNpcClick: (npc) => {
          if (npc && npc.id) App.interactWith(npc.id);
        },
        onSeatClick: (seat) => {
          if (window.LobbyManager) window.LobbyManager.sitDown(seat);
        },
        onTerminal: () => App.openBandanaPicker(),
        onReception: () => {
          if (activeMapKey === 'grand_hotel_lobby') App.interactWith('hotel_receptionist');
        }
      });
      world3dRenderer.setVariant(storedBandana());
      world3dRenderer.setEnabled(world3dEnabledByPreference());
      if (inMapBattle) world3dRenderer.setPaused(true);
      window.world3dRenderer = world3dRenderer;
    } catch (error) {
      console.warn('[3D] No se pudo iniciar el mapa 3D:', error);
      if (world3dRenderer) {
        try { world3dRenderer.dispose(); } catch (disposeError) { /* ignorar */ }
        world3dRenderer = null;
      }
      container.querySelectorAll('.world3d-canvas').forEach((canvas) => canvas.remove());
      if (worldTileRenderer) worldTileRenderer.renderSuppressed = false;
    }
    updateWorld3DToggle();
  }

  function renderLobbyPlayers() {
    const list = document.getElementById('lobbyPlayersList');
    const countEl = document.getElementById('lobbyOnlineCount');
    if (!list) return;
    const colors = (window.World3D && window.World3D.BANDANA_COLORS) || ['#76bd45', '#e66d61', '#5da7e8', '#a879d8', '#e6ad45', '#49bda7'];
    const localName = (currentUser && currentUser.username) || (trainerState && trainerState.name) || 'Tú';
    const players = [{ id: 'local', name: localName, variant: storedBandana(), local: true }];
    if (window.MultiplayerClient && window.MultiplayerClient.otherPlayers) {
      window.MultiplayerClient.otherPlayers.forEach((player, id) => {
        if (!player) return;
        if (String(player.id || id).toLowerCase() === String(localName).toLowerCase()) return;
        players.push({ ...player, id, local: false });
      });
    }
    if (countEl) countEl.textContent = String(players.length);
    list.innerHTML = players.slice(0, 12).map((player) => {
      const name = Validate.escHtml(String(player.name || player.id || 'Entrenador').slice(0, 16));
      const styleMatch = String(player.avatar_style || player.avatarStyle || '').match(/^brendan:([0-5])$/);
      const variant = ((Number(player.variant != null ? player.variant : (styleMatch ? styleMatch[1] : 0)) || 0) % colors.length + colors.length) % colors.length;
      const initial = name.charAt(0).toUpperCase() || '?';
      return `<span class="lobby-player-chip ${player.local ? 'me' : ''}" title="${name}">
        <span class="lobby-player-dot" style="--swatch:${colors[variant]};">${initial}</span>${name}${player.local ? ' (tú)' : ''}
      </span>`;
    }).join('');
    const log = document.getElementById('lobbyChatLog');
    if (log && !log.dataset.ready) {
      log.dataset.ready = '1';
      log.innerHTML = '<div style="opacity:.55;padding:4px 2px;">La conversación del lobby aparecerá aquí. Saluda con un emote o escribe abajo.</div>';
    }
  }

  function initBattle3D() {
    if (!window.Battle3D) return;
    const layer = document.getElementById('battle3dLayer');
    if (!layer || !inMapBattle) {
      pendingBattleEffect = null;
      window.Battle3D.dispose();
      return;
    }
    try {
      window.Battle3D.mount(layer, {
        opponent: inMapBattle.opponent,
        player: (trainerState && trainerState.starter) || null
      });
      const effect = pendingBattleEffect;
      pendingBattleEffect = null;
      if (effect) {
        setTimeout(() => {
          if (!window.Battle3D) return;
          if (effect === 'throw') window.Battle3D.playThrow();
          else window.Battle3D.playAttack(effect);
        }, 180);
      }
      if (world3dRenderer) world3dRenderer.setPaused(true);
    } catch (error) {
      console.warn('[3D] No se pudo iniciar la arena de combate:', error);
      if (window.Battle3D) window.Battle3D.dispose();
      layer.querySelectorAll('.battle3d-canvas').forEach((canvas) => canvas.remove());
    }
  }

  window.App.toggleWorld3D = function() {
    const next = !(world3dRenderer && world3dRenderer.enabled);
    if (!world3dRenderer && worldTileRenderer) {
      const container = document.getElementById('worldCanvasStage');
      if (container) {
        const fullMaps = {
          ...(window.HOENN_FULL_MAPS || {}),
          ...(window.HOENN_INTERIORS || {}),
          ...(window.EMERALD_REFERENCE_MAPS || {})
        };
        const fallback = fullMaps[activeMapKey] || {};
        initWorld3D(container, fallback, {
          mapId: activeMapKey,
          name: fallback.name || activeMapKey,
          width: fallback.width || 640,
          height: fallback.height || 512,
          image: fallback.image || null,
          obstacles: fallback.obstacles || [],
          npcs: fallback.npcs || [],
          items: fallback.items || [],
          exits: fallback.exits || [],
          signs: fallback.signs || [],
          seats: fallback.seats || [],
          flowerPatches: window.GrassPatches ? window.GrassPatches.ensure(fallback) : (fallback.flowerPatches || []),
          terrain: window.TerrainPatches ? window.TerrainPatches.ensure(fallback) : null,
          isDark: fallback.isDark || false
        });
      }
    } else if (world3dRenderer) {
      world3dRenderer.setEnabled(next);
    }
    try { localStorage.setItem(WORLD3D_PREF_KEY, next ? '1' : '0'); } catch (error) { /* almacenamiento bloqueado */ }
    updateWorld3DToggle();
  };

  window.App.lobbyEmote = function(emoji) {
    if (world3dRenderer) world3dRenderer.showEmote(emoji);
    if (window.LobbyManager && typeof window.LobbyManager.sendChatMessage === 'function') {
      window.LobbyManager.sendChatMessage(emoji, 'ROOM');
    }
  };

  window.App.setBandana = function(index) {
    const value = Math.max(0, Math.min(5, Number(index) || 0));
    if (world3dRenderer) world3dRenderer.setVariant(value);
    try { localStorage.setItem(BANDANA_PREF_KEY, String(value)); } catch (error) { /* almacenamiento bloqueado */ }
    if (window.MultiplayerClient && typeof window.MultiplayerClient.sendAvatarStyle === 'function') {
      window.MultiplayerClient.sendAvatarStyle(value);
    }
    document.querySelectorAll('.bandana-grid button, .lobby3d-swatches button').forEach((button) => {
      button.classList.toggle('selected', Number(button.dataset.bandana) === value);
    });
    renderLobbyPlayers();
  };

  window.App.openBandanaPicker = function() {
    if (!dom.modalOverlay || !dom.modalBody) return;
    const colors = (window.World3D && window.World3D.BANDANA_COLORS) || ['#76bd45', '#e66d61', '#5da7e8', '#a879d8', '#e6ad45', '#49bda7'];
    const selected = storedBandana();
    dom.modalBody.innerHTML = `
      <div style="text-align:center; padding:6px 8px 14px;">
        <div style="width:58px;height:58px;margin:0 auto 12px;border-radius:16px;display:grid;place-items:center;background:linear-gradient(145deg,#167d78,#0e4e51);border:1px solid rgba(233,184,94,.55);color:#ffe7a3;font-size:1.5rem;">
          <i class="fas fa-palette"></i>
        </div>
        <h3 style="margin:0 0 6px;">Elige tu bandana</h3>
        <p style="margin:0 0 14px;color:#666;font-size:0.86rem;">El color se aplica al instante en el lobby 3D y se guarda en este navegador.</p>
        <div class="bandana-grid">
          ${colors.map((color, index) => `
            <button type="button" data-bandana="${index}" class="${index === selected ? 'selected' : ''}" style="--swatch:${color};" onclick="App.setBandana(${index})" aria-label="Bandana ${index + 1}">
              ${index === selected ? '<i class="fas fa-check"></i>' : ''}
            </button>`).join('')}
        </div>
        <button class="btn btn-primary" style="margin-top:16px;" onclick="App.closeModal()"><i class="fas fa-check"></i> Listo</button>
      </div>`;
    dom.modalOverlay.style.display = 'flex';
    dom.modalOverlay.classList.add('active');
    dom.modalOverlay.classList.add('open');
  };

  function getZoneCategory(id) {
    if (id.startsWith('reference_')) return 'Ubicaciones Esmeralda';
    if (id === 'grand_hotel_lobby' || id === 'union_room') return 'Sala Unión MMO';
    if (id === 'overworld' || id === 'underwater') return 'Mundo Principal';
    if (id.startsWith('route_')) {
      const num = parseInt(id.replace('route_', ''), 10);
      return num <= 117 ? 'Rutas 101 - 117' : 'Rutas 118 - 134';
    }
    if (id.endsWith('_city') || id.endsWith('_town')) return 'Ciudades y Pueblos';
    return 'Mazmorras y Cuevas';
  }

  function initWorldCanvas() {
    const container = document.getElementById('worldCanvasStage');
    if (!container || !window.TileMapRenderer) return;

    destroyWorld3D();
    if (worldTileRenderer && typeof worldTileRenderer.destroy === 'function') {
      worldTileRenderer.destroy();
      worldTileRenderer = null;
    }

    const fullMaps = {
      ...(window.HOENN_FULL_MAPS || {}),
      ...(window.HOENN_INTERIORS || {}),
      ...(window.EMERALD_REFERENCE_MAPS || {})
    };
    const mapData = fullMaps[activeMapKey] || fullMaps['littleroot_town'] || {};
    const fullMap = mapData;
    const localMap = mapData;

    const name = fullMap.name || localMap.name || activeMapKey;
    const subtitle = fullMap.subtitle || localMap.subtitle || '';
    const image = localMap.image || fullMap.image || null;
    const width = fullMap.width || localMap.width || 640;
    const height = fullMap.height || localMap.height || 512;

    const obstacles = fullMap.obstacles || localMap.obstacles || [];
    const npcs = fullMap.npcs || localMap.npcs || [];
    const signs = fullMap.signs || localMap.signs || [];
    const exits = fullMap.exits || localMap.exits || [];
    const flowerPatches = window.GrassPatches
      ? window.GrassPatches.ensure(fullMap)
      : (fullMap.flowerPatches || localMap.flowerPatches || []);
    const terrain = window.TerrainPatches ? window.TerrainPatches.ensure(fullMap) : null;

    // Items de la zona unificada
    const mapItems = (fullMap.items || []).map(item => {
      let x = item.x || 0;
      let y = item.y || 0;
      if (x < 0) x = (x + 500) * 4 + 1024;
      if (y < 0) y = (y + 500) * 4 + 1024;
      return {
        ...item,
        x, y,
        collected: !!collectedItems[item.id]
      };
    });

    worldTileRenderer = new window.TileMapRenderer('worldCanvasStage', {
      mapId: activeMapKey,
      name: name,
      subtitle: subtitle,
      image: image,
      playerSprite: window.EMERALD_ASSETS && window.EMERALD_ASSETS.playerSprite,
      encounterRate: fullMap.encounterRate || 0.14,
      tileset: fullMap.tileset || 'OverworldTrainers',
      width: width,
      height: height,
      spawn: { x: playerPos.x, y: playerPos.y, dir: playerPos.dir },
      obstacles: obstacles,
      npcs: npcs,
      signs: signs,
      exits: exits,
      stairs: fullMap.stairs || [],
      flowerPatches: flowerPatches,
      terrain: terrain,
      seats: fullMap.seats || localMap.seats || [],
      weather: fullMap.weather || localMap.weather || 'none',
      isDark: fullMap.isDark || localMap.isDark || false,
      items: mapItems,
      otherPlayers: window.MultiplayerClient ? window.MultiplayerClient.otherPlayers : new Map(),
      onPlayerMove: (pos, dir) => {
        playerPos.x = pos.x;
        playerPos.y = pos.y;
        playerPos.dir = dir;
        scheduleSave();
        if (window.MultiplayerClient) {
          window.MultiplayerClient.sendPosition(pos.x, pos.y, dir, activeMapKey);
        }
      },
      onPlayerInteract: (targetPlayer) => {
        if (window.LobbyManager) {
          window.LobbyManager.openPlayerContextMenu(targetPlayer);
        }
      },
      onSeatInteract: (seat) => {
        if (window.LobbyManager) {
          window.LobbyManager.sitDown(seat);
        }
      },
      onNpcInteract: (npc) => {
        App.interactWith(npc.id);
      },
      onWarp: (warp) => {
        App.switchTown(warp.targetMap, warp.targetX, warp.targetY, warp.type || 'route');
      },
      onEncounter: () => {
        App.triggerWildEncounter();
      },
      onBlocked: (dx, dy, targetX, targetY) => {
        if (!terrain || !window.TerrainPatches) return;
        const mountain = window.TerrainPatches.at(terrain, targetX + 8, targetY + 8, 0.95);
        if (!mountain) return;
        const now = Date.now();
        if (now - (App.__lastMountainBump || 0) < 3500) return;
        App.__lastMountainBump = now;
        App.showNotification('La ladera rocosa bloquea el paso. Busca otra ruta.', 'warning');
      },
      onItemCollect: (item) => {
        collectedItems[item.id] = true;
        trainerState.inventory.coins = (trainerState.inventory.coins || 0) + 50;
        if (!trainerState.inventory.items) trainerState.inventory.items = {};
        trainerState.inventory.items[item.name] = (trainerState.inventory.items[item.name] || 0) + 1;
        saveTrainerProgress();
      }
    });

    window.worldTileRenderer = worldTileRenderer;

    // Capa 3D: el motor GBA sigue controlando movimiento, colisiones y combate.
    initWorld3D(container, mapData, {
      mapId: activeMapKey,
      name: name,
      width: width,
      height: height,
      image: image,
      obstacles: obstacles,
      npcs: npcs,
      items: mapItems,
      exits: exits,
      signs: signs,
      seats: fullMap.seats || localMap.seats || [],
      flowerPatches: flowerPatches,
      terrain: terrain,
      isDark: !!(fullMap.isDark || localMap.isDark)
    });
    if (inMapBattle) initBattle3D();
    renderLobbyPlayers();
    if (window.MultiplayerClient && typeof window.MultiplayerClient.sendAvatarStyle === 'function') {
      window.MultiplayerClient.sendAvatarStyle(storedBandana());
    }

    if (activeDialog) {
      worldTileRenderer.avatarState = 'INTERACTING';
    } else if (inMapBattle) {
      worldTileRenderer.avatarState = 'IN_BATTLE';
    }

    if (window.MultiplayerClient) {
      window.MultiplayerClient.on('onPlayersUpdate', () => {
        if (worldTileRenderer) {
          worldTileRenderer.otherPlayers = window.MultiplayerClient.otherPlayers;
        }
        renderLobbyPlayers();
      });
    }
  }

  function centerCameraOnPlayer() {
    if (worldTileRenderer) {
      worldTileRenderer.centerOnPlayer();
    }
    if (world3dRenderer) {
      world3dRenderer.focusCamera();
    }
  }

  /* ============================================================
     7. VISTA PRINCIPAL: MUNDO HOENN (100% RECREADO)
     ============================================================ */
  function viewWorld() {
    const fullMaps = window.HOENN_FULL_MAPS || {};
    const localMaps = typeof HOENN_MAPS !== 'undefined' ? HOENN_MAPS : {};
    const interiorMaps = window.HOENN_INTERIORS || {};
    const activeStarter = (trainerState && trainerState.starter) ? trainerState.starter : { ...STARTERS[1], level: 5, currentHp: 86 };
    const referenceMaps = window.EMERALD_REFERENCE_MAPS || {};
    const map = fullMaps[activeMapKey] || localMaps[activeMapKey] || interiorMaps[activeMapKey] || referenceMaps[activeMapKey] || fullMaps['littleroot_town'] || localMaps['littleroot_town'] || { name: 'Hoenn', subtitle: '' };

    // Agrupar todas las 67+ zonas por categorías para el selector unificado
    const categories = {
      'Sala Unión MMO': [],
      'Mundo Principal': [],
      'Ciudades y Pueblos': [],
      'Rutas 101 - 117': [],
      'Rutas 118 - 134': [],
      'Mazmorras y Cuevas': [],
      'Ubicaciones Esmeralda': []
    };

    const allZonesMap = {
      ...localMaps,
      ...fullMaps,
      ...interiorMaps,
      ...(window.EMERALD_REFERENCE_MAPS || {})
    };
    Object.entries(allZonesMap).forEach(([id, m]) => {
      const cat = getZoneCategory(id);
      if (categories[cat]) {
        categories[cat].push({ id, name: (m.name || id).split(' (')[0] });
      }
    });

    const categoryOptGroups = Object.entries(categories).map(([catName, list]) => `
      <optgroup label="${catName}">
        ${list.map(item => `
          <option value="${item.id}" ${item.id === activeMapKey ? 'selected' : ''}>
            ${item.name}
          </option>
        `).join('')}
      </optgroup>
    `).join('');

    // Accesos rápidos a ciudades icónicas
    const quickKeys = ['grand_hotel_lobby', 'littleroot_town', 'petalburg_city', 'rustboro_city', 'dewford_town', 'slateport_city', 'mauville_city', 'lilycove_city', 'overworld'];
    const quickBadges = quickKeys.filter(k => allZonesMap[k]).map(k => `
      <button class="town-btn ${k === activeMapKey ? 'active' : ''}" onclick="App.switchTown('${k}')" style="font-size:0.75rem; padding:4px 8px;">
        <i class="fas ${k === 'grand_hotel_lobby' ? 'fa-hotel' : 'fa-location-dot'}"></i> ${(allZonesMap[k].name || k).split(' (')[0]}
      </button>
    `).join('');

    // Cuadro de diálogo
    const dialogHtml = activeDialog ? `
      <div class="hoenn-dialog-box">
        <div class="dialog-header">
          <span class="dialog-title">
            ${activeDialog.npcColorFilter ? `<span style="display:inline-block; vertical-align:middle; width:22px; height:22px; background-image:url('assets/sprites/brendan_spritesheet.png'); background-size:88px 88px; background-position:0px 0px; filter:${activeDialog.npcColorFilter}; border-radius:50%; margin-right:6px; border:1px solid rgba(255,255,255,0.4);"></span>` : '<i class="fas fa-comment-dots"></i>'} ${Validate.escHtml(activeDialog.title)}
          </span>
          <button class="btn btn-sm btn-outline" onclick="App.closeDialog()"><i class="fas fa-times"></i></button>
        </div>
        <div class="dialog-text">${Validate.escHtml(activeDialog.text)}</div>
        <div class="dialog-actions">
          ${activeDialog.canHeal ? `<button class="dialog-btn heal-btn" onclick="App.healTeam()"><i class="fas fa-heart"></i> Curar a todo mi equipo</button>` : ''}
          ${activeDialog.givesSupplies ? `<button class="dialog-btn heal-btn" onclick="App.claimSupplies()"><i class="fas fa-gift"></i> Recibir suministros</button>` : ''}
          ${activeDialog.isShop ? `<button class="dialog-btn heal-btn" onclick="App.openShop()"><i class="fas fa-shopping-cart"></i> Ver Tienda</button>` : ''}
          ${activeDialog.battleTrainerId ? `<button class="dialog-btn battle-btn" onclick="App.startTrainerBattle('${activeDialog.battleTrainerId}')"><i class="fas fa-bolt"></i> ¡Aceptar desafío de combate!</button>` : ''}
          ${activeDialog.battleOpponent ? `<button class="dialog-btn battle-btn" onclick="App.startInMapBattle('${activeDialog.battleOpponent.name}')"><i class="fas fa-bolt"></i> ¡Aceptar desafío de combate!</button>` : ''}
          <button class="dialog-btn" onclick="App.closeDialog()">Continuar (E)</button>
        </div>
      </div>
    ` : '';

    // Combate dentro del mapa (Overlay GBA)
    const battleOverlayHtml = inMapBattle ? renderInMapBattleHtml() : '';

    // Vista final
    return `
      <div class="hoenn-game-wrapper">
        <div class="hoenn-console-bezel">
          <!-- Barra de Localización y Fast Travel Unificado -->
          <div class="hoenn-town-bar" style="flex-wrap:wrap; gap:8px;">
            <div class="hoenn-town-info" style="min-width:180px;">
              <h3 style="margin:0;"><i class="fas fa-map-marked-alt" style="color:#2ecc71;"></i> ${map.name || activeMapKey}</h3>
              <span style="font-size:0.75rem; color:#b7e4c7;">${map.subtitle || 'Región Hoenn (Pokémon Esmeralda)'}</span>
            </div>
            <div class="hoenn-town-switcher" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <select id="zoneSelector" onchange="App.switchTown(this.value)" style="padding:5px 10px; border-radius:8px; border:2px solid #2ecc71; font-weight:700; font-size:0.8rem; background:#0d2818; color:#fff; cursor:pointer;">
                ${categoryOptGroups}
              </select>
              ${quickBadges}
              <button id="toggle3dBtn" class="btn btn-sm btn-outline" onclick="App.toggleWorld3D()" title="Activar el mapa 3D" style="padding:5px 10px; border-radius:8px; border:2px solid #e9b85e; background:#0d2818; color:#ffe8b0; font-weight:700; font-size:0.78rem;">
                <i class="fas fa-cube"></i> 3D
              </button>
            </div>
          </div>

          <!-- Viewport del Juego con Motor Canvas 2D Unificado -->
          <div class="hoenn-viewport" id="hoennViewport" style="position:relative; width:100%; height:calc(100vh - 220px); min-height:430px; max-height:600px; overflow:hidden;">
            <div id="worldCanvasStage" style="width:100%; height:100%; position:relative;"></div>
            <div class="world3d-hud" id="world3dHud">
              <span class="w3d-pill"><span class="w3d-live"></span><i class="fas fa-cube"></i> MUNDO 3D</span>
              <span class="w3d-pill"><i class="fas fa-users"></i> <b id="world3dOnline">—</b></span>
              <span class="w3d-pill w3d-wild" id="world3dWild" style="display:none"><i class="fas fa-seedling"></i> Pokémon salvajes</span>
              <span class="w3d-pill w3d-hint"><i class="fas fa-mouse"></i> Arrastra para girar · Rueda = zoom · R = cámara</span>
              <span class="w3d-pill w3d-hint" id="world3dFps">—</span>
            </div>
            ${activeMapKey === 'grand_hotel_lobby' ? `
            <div class="lobby-social-panel" id="lobbySocialPanel">
              <div class="lobby-social-head">
                <span><i class="fas fa-users"></i> Entrenadores <b id="lobbyOnlineCount">1</b></span>
                <span><span class="w3d-live"></span> En línea</span>
              </div>
              <div class="lobby-players" id="lobbyPlayersList"></div>
              <div class="lobby-chat-log" id="lobbyChatLog"></div>
            </div>` : ''}
            ${renderTeamPanelHtml('pvp-team-left', 'MI EQUIPO', myTeamList(), (trainerState && trainerState.starter && trainerState.starter.name) || null, 'No tienes Pokémon en tu equipo.')}
            ${renderTeamPanelHtml('pvp-team-right', 'EQUIPO RIVAL', pvpOpponentTeam, null, 'Sin rival aún. ¡Retalo en la Sala Unión!')}
            ${dialogHtml}
            ${battleOverlayHtml}
          </div>

          <!-- Barra de Chat y Acciones Multijugador estilo Habbo (Sala Unión MMO) -->
          <div class="lobby-chat-dock">
            <div class="lobby-chat-bar">
              <div class="lobby-chat-input-wrapper">
                <i class="fas fa-comment-dots chat-icon" style="color:#2ecc71;"></i>
                <input type="text" id="lobbyChatInput" placeholder="Hablar en la sala (estilo Habbo)... Presiona Enter para enviar" maxlength="120" autocomplete="off" onkeydown="if(event.key==='Enter') App.sendLobbyChat()">
                <button class="btn btn-sm btn-primary chat-send-btn" onclick="App.sendLobbyChat()"><i class="fas fa-paper-plane"></i> Enviar</button>
              </div>
              <div class="lobby-chat-quick-actions" style="display:flex; align-items:center;">
                <div id="defaultQuickActions" style="display:flex; gap:6px;">
                  <button class="btn btn-sm btn-outline chat-action-btn" onclick="LobbyManager.openHMMenu()" title="Máquinas Ocultas (Guías Nintendo)"><i class="fas fa-compact-disc" style="color:#2ecc71;"></i> MO</button>
                  <button class="btn btn-sm btn-outline chat-action-btn" onclick="LobbyManager.sitDown()" title="Sentarse / Levantarse"><i class="fas fa-chair" style="color:#f39c12;"></i> Sentarse</button>
                  <button class="btn btn-sm btn-outline chat-action-btn" onclick="App.switchTown('grand_hotel_lobby')" title="Ir a Sala Unión MMO"><i class="fas fa-hotel" style="color:#3498db;"></i> Sala Unión</button>
                  ${activeMapKey === 'grand_hotel_lobby' ? `
                  <div class="lobby3d-actions" title="Acciones del lobby 3D">
                    <div class="lobby3d-emotes" aria-label="Emotes rápidos">
                      <button type="button" onclick="App.lobbyEmote('👋')" title="Saludar">👋</button>
                      <button type="button" onclick="App.lobbyEmote('❤️')" title="Corazón">❤️</button>
                      <button type="button" onclick="App.lobbyEmote('😄')" title="Risa">😄</button>
                      <button type="button" onclick="App.lobbyEmote('⚡')" title="Energía">⚡</button>
                    </div>
                    <div class="lobby3d-swatches" aria-label="Color de bandana">
                      ${['#76bd45','#e66d61','#5da7e8','#a879d8','#e6ad45','#49bda7'].map((color, index) =>
                        `<button type="button" data-bandana="${index}" class="${storedBandana() === index ? 'selected' : ''}" style="--swatch:${color};" onclick="App.setBandana(${index})" title="Bandana ${index + 1}"></button>`
                      ).join('')}
                    </div>
                    <button type="button" class="btn btn-sm btn-outline chat-action-btn" onclick="App.openBandanaPicker()" title="Abrir terminal de estilo"><i class="fas fa-palette" style="color:#e6ad45;"></i> Estilo</button>
                  </div>` : ''}
                </div>
                <div id="playerInteractActions" style="display:none; gap:6px; align-items:center;">
                  <span id="piTargetName" style="color:#fff; font-weight:bold; font-size:0.8rem; margin-right:8px; background:rgba(0,0,0,0.5); padding:4px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.2);">Entrenador</span>
                  <button class="btn btn-sm btn-primary" onclick="App.sendDuelRequest()" style="background:#e74c3c; border-color:#c0392b; font-weight:bold; box-shadow:0 4px 10px rgba(231,76,60,0.4);"><i class="fas fa-bolt"></i> Retar</button>
                  <button class="btn btn-sm btn-primary" onclick="App.sendTradeRequest()" style="background:#3498db; border-color:#2980b9; font-weight:bold; box-shadow:0 4px 10px rgba(52,152,219,0.4);"><i class="fas fa-exchange-alt"></i> Intercambiar</button>
                  <button class="btn btn-sm btn-outline" onclick="App.closePlayerInteractMenu()" style="color:#ef5350; border-color:rgba(239,83,80,0.3);"><i class="fas fa-times"></i> Cancelar</button>
                </div>
                <div id="playerRespondActions" style="display:none; gap:6px; align-items:center;">
                  <span id="prTargetName" style="color:#fff; font-weight:bold; font-size:0.8rem; margin-right:8px; background:rgba(0,0,0,0.5); padding:4px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.2);">Entrenador</span>
                  <span id="prActionDesc" style="color:#fff; font-size:0.8rem; margin-right:4px;">quiere retarte</span>
                  <button class="btn btn-sm btn-primary" onclick="if(App._acceptCurrentRequest) App._acceptCurrentRequest()" style="background:#2ecc71; border-color:#27ae60; font-weight:bold;"><i class="fas fa-check"></i> Aceptar</button>
                  <button class="btn btn-sm btn-outline" onclick="if(App._declineCurrentRequest) App._declineCurrentRequest()" style="color:#ef5350; border-color:rgba(239,83,80,0.3);"><i class="fas fa-times"></i> Rechazar</button>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderInMapBattleHtml() {
    const b = inMapBattle;
    if (!b) return '';
    try {
    const starter = (b.playerPokemon && b.playerPokemon.name)
      ? b.playerPokemon
      : (trainerState.starter || { name: 'POKEMON', hp: 50, image: '', level: 5, moves: [] });
    if (starter.maxHp == null && starter.hp) starter.maxHp = starter.hp;
    if (!starter.image) starter.image = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#333"/><text x="60" y="68" font-size="36" text-anchor="middle" fill="#888">?</text></svg>');
    const opp = (b.opponent && b.opponent.name) ? b.opponent : { name: 'RIVAL', hp: 50, image: '', level: 5 };
    if (opp.maxHp == null && opp.hp) opp.maxHp = opp.hp;
    if (!opp.image) opp.image = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#333"/><text x="60" y="68" font-size="36" text-anchor="middle" fill="#888">?</text></svg>');
    b.opponent = opp;
    if (b.opponentHp == null) b.opponentHp = opp.maxHp || opp.hp || 50;
    const oppMax = opp.maxHp || opp.hp || 50;
    const oppPercent = Math.max(0, Math.round((b.opponentHp / oppMax) * 100));
    const starterMax = starter.maxHp || starter.hp || 50;
    if (b.playerHp == null) b.playerHp = starterMax;
    const playerPercent = Math.max(0, Math.round((b.playerHp / starterMax) * 100));

    const playerMoves = (starter && Array.isArray(starter.moves) && starter.moves.length)
      ? starter.moves
      : getMovesForMon(starter, starter.level || trainerState.level || 5).map(m => ({ ...m, currentPp: m.pp, maxPp: m.maxPp }));

    const MENU_STATE = b.menuState || 'MAIN';

    // ====== MENÚ WAITING_OPPONENT ======
    const waitingHtml = `
      <div class="em-main-menu" style="display:flex; justify-content:center; align-items:center;">
        <span style="color:#666; font-weight:bold;">ESPERANDO AL RIVAL...</span>
      </div>
    `;

    // ====== MENÚ PRINCIPAL: 4 BOTONES PvP (FIGHT / BAG / POKéMON / RENDIRSE) ======
    const mainMenuHtml = b.isPvp ? `
      <div class="em-main-menu">
        <button class="em-main-btn" onclick="App.setBattleMenuState('FIGHT')"><span class="em-arrow">►</span> FIGHT</button>
        <button class="em-main-btn" onclick="App.setBattleMenuState('BAG')"><span class="em-arrow">►</span> BAG</button>
        <button class="em-main-btn" onclick="App.setBattleMenuState('POKEMON')"><span class="em-arrow">►</span> POKéMON</button>
        <button class="em-main-btn em-btn-danger" onclick="App.pvpForfeit()"><span class="em-arrow">►</span> RENDIRSE</button>
      </div>
    ` : `
      <div class="em-main-menu">
        <button class="em-main-btn" onclick="App.setBattleMenuState('FIGHT')"><span class="em-arrow">►</span> FIGHT</button>
        <button class="em-main-btn" onclick="App.setBattleMenuState('BAG')"><span class="em-arrow">►</span> BAG</button>
        <button class="em-main-btn" onclick="App.setBattleMenuState('POKEMON')"><span class="em-arrow">►</span> POKéMON</button>
        <button class="em-main-btn" onclick="App.battleFlee()"><span class="em-arrow">►</span> RUN</button>
      </div>
    `;


    const typeClsOf = (m) => 'em-type-' + (m.type || 'Normal').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // ====== SUBMENÚ FIGHT: 4 MOVIMIENTOS EN CUADRÍCULA 2x2 ======
    const fightSubmenuHtml = `
      <div class="em-submenu-title">¿QUÉ HACER?</div>
      <div class="em-moves-grid">
        ${playerMoves.map((m, idx) => {
          const mType = m.type || m.elemental_type || 'Normal';
          const typeCls = 'em-type-' + mType.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const currentPpVal = m.currentPp != null ? m.currentPp : (m.current_pp != null ? m.current_pp : m.pp);
          const maxPpVal = m.maxPp != null ? m.maxPp : (m.max_pp != null ? m.max_pp : m.pp);
          const disabled = currentPpVal <= 0;
          return `
            <button class="em-move-cell ${disabled ? 'em-disabled' : ''}" onclick="App.executeBattleMove(${idx})" ${disabled ? 'disabled' : ''}>
              <span class="em-move-type ${typeCls}">${mType.toUpperCase()}</span>
              <span class="em-move-name">${Validate.escHtml(m.name)}</span>
              <span class="em-move-pp">${currentPpVal}/${maxPpVal}</span>
            </button>
          `;
        }).join('')}
      </div>
      <div class="em-fight-footer">
        <button class="em-status-btn" onclick="App.setBattleMenuState('MOVESTATUS')">◈ MOVE STATUS</button>
        <button class="em-cancel-btn" onclick="App.setBattleMenuState('MAIN')">◀ CANCEL</button>
      </div>
    `;

    // ====== SUBMENÚ MOVE STATUS: DETALLE DE LOS 4 MOVIMIENTOS ======
    const moveStatusHtml = `
      <div class="em-submenu-title">MOVE STATUS</div>
      <div class="em-move-status-list">
        ${playerMoves.map((m, idx) => {
          const typeCls = typeClsOf(m);
          const cat = m.category === 'estatus' ? 'ESTADO'
            : (m.category === 'especial' ? 'ESPECIAL'
              : (m.category === 'fisico' ? 'FÍSICO' : '—'));
          const pow = m.power ? m.power : '—';
          return `
            <div class="em-move-status-row">
              <span class="em-move-type ${typeCls}">${(m.type || 'Normal').toUpperCase()}</span>
              <span class="em-move-status-name">${Validate.escHtml(m.name)}</span>
              <span class="em-move-status-cat">${cat}</span>
              <span class="em-move-status-pow">POD ${pow}</span>
              <span class="em-move-status-pp">PP ${m.currentPp != null ? m.currentPp : m.pp}/${m.maxPp != null ? m.maxPp : m.pp}</span>
            </div>
          `;
        }).join('')}
      </div>
      <button class="em-cancel-btn" onclick="App.setBattleMenuState('FIGHT')">◀ VOLVER</button>
    `;

    // ====== SUBMENÚ BAG: OBJETOS (dinámico desde ITEMS_DATABASE) ======
    const DB = (typeof ITEMS_DATABASE !== 'undefined') ? ITEMS_DATABASE : {};
    const bagItems = Object.entries(trainerState.inventory.items || {})
      .filter(([, qty]) => qty > 0)
      .map(([name, qty]) => {
        const itemData = DB[name] || {};
        const cat = itemData.category || '';
        // Determinar si el item es usable en batalla
        const effect = itemData.effect || '';
        const isBall = itemData.type === 'pokeball';
        const isWild = !!(inMapBattle && inMapBattle.opponent && inMapBattle.opponent.isWild);
        const usableInBattle = isBall || ['heal','heal_full','heal_full_status','revive','revive_full',
          'restore_pp','restore_pp_full','restore_pp_all','restore_pp_all_full',
          'cure_status','cure_all_status','boost_attack','boost_defense','boost_speed',
          'boost_spatk','boost_crit','prevent_stat_drop'].includes(effect);
        const ballDisabled = isBall && !isWild;
        const disabled = (!usableInBattle || ballDisabled) ? 'disabled' : '';
        const onclickFn = isBall ? `App.battleThrowBall('${name}')` : `App.battleUseItem('${name}')`;
        const spriteUrl = itemData.sprite || '';
        const spriteHtml = spriteUrl
          ? `<img src="${spriteUrl}" alt="${name}" class="em-item-sprite" onerror="this.style.display='none'">`
          : `<span class="em-item-ico">▪</span>`;
        return `
          <button class="em-bag-item ${!usableInBattle ? 'em-disabled' : ''}" onclick="${onclickFn}" ${disabled}>
            ${spriteHtml}
            <span class="em-item-name">${Validate.escHtml(itemData.nameEs || name)}</span>
            <span class="em-item-count">x${qty}</span>
          </button>
        `;
      });
    const bagSubmenuHtml = `
      <div class="em-submenu-title">MOCHILA</div>
      <div class="em-bag-list">
        ${bagItems.length > 0 ? bagItems.join('') : '<p class="em-no-items">Mochila vacía</p>'}
      </div>
      <button class="em-cancel-btn" onclick="App.setBattleMenuState('MAIN')">◀ CANCEL</button>
    `;

    // ====== SUBMENÚ POKéMON: EQUIPO CON PS ======
    const partySubmenuHtml = `
      <div class="em-submenu-title">EQUIPO</div>
      <div class="em-party-list">
        ${trainerState.collection.map((p, idx) => {
          const pHp = p.currentHp != null ? p.currentHp : p.hp;
          const pMax = p.hp || p.maxHp || 1;
          const pHpPct = Math.max(0, Math.round((pHp / pMax) * 100));
          const isActive = trainerState.starter && trainerState.starter.name === p.name;
          return `
            <button class="em-party-item ${isActive ? 'em-active' : ''}" onclick="App.switchPokemon(${idx})" ${pHp <= 0 ? 'disabled' : ''}>
              <span class="em-party-arrow">${isActive ? '▶' : ' '}</span>
              <span class="em-party-name">${Validate.escHtml(p.name)}</span>
              <span class="em-party-level">Nv.${p.level || 5}</span>
              <span class="em-party-hp-track"><span class="em-party-hp-fill ${pHpPct < 25 ? 'em-low' : ''}" style="width:${pHpPct}%;"></span></span>
              <span class="em-party-hp-num">${pHp}/${pMax}</span>
            </button>
          `;
        }).join('')}
      </div>
      <button class="em-cancel-btn" onclick="App.setBattleMenuState('MAIN')">◀ CANCEL</button>
    `;

    // ====== SUBMENÚ APRENDIZAJE DE MOVIMIENTO (al subir de nivel) ======
    const learnSubmenuHtml = b.pendingLearn && b.pendingLearn.length ? (() => {
      const move = b.pendingLearn[0];
      const typeCls = typeClsOf(move);
      const currentMoves = (starter && Array.isArray(starter.moves) && starter.moves.length)
        ? starter.moves
        : [];
      return `
        <div class="em-submenu-title">¡NUEVO MOVIMIENTO!</div>
        <div class="em-learn-box">
          <div class="em-learn-move ${typeCls}">
            <strong>${Validate.escHtml(move.name)}</strong>
            <span>${move.type} · PODER ${move.power || '—'} · PP ${move.maxPp}</span>
          </div>
          <p>¿Reemplazar cuál movimiento?</p>
          ${currentMoves.map((cm, idx) => `
            <button class="em-learn-opt" onclick="App.learnMove(0, ${idx})">
              <span>${idx + 1}. ${Validate.escHtml(cm.name)}</span><span class="em-learn-replace">REEMPLAZAR</span>
            </button>
          `).join('')}
          <button class="em-cancel-btn" onclick="App.learnMove(0, null)">✕ NO APRENDER</button>
        </div>
      `;
    })() : '';

    // Caja de mensaje: muestra el log más reciente (línea 1) y los 2 anteriores más tenue
    const recentLogs = (b.logs || []).slice(0, 3);
    const messageText = b.mustSwitch
      ? `¡<strong>${Validate.escHtml(starter.name.toUpperCase())}</strong> está debilitado! Elige otro Pokémon.`
      : (recentLogs[0] || `¿Qué hará<br/><strong>${Validate.escHtml(starter.name.toUpperCase())}</strong>?`);
    const olderLogs = recentLogs.slice(1).map(l => `<span class="em-log-older">${Validate.escHtml(l)}</span>`).join('');

    const panelHtml = MENU_STATE === 'LEARN' ? learnSubmenuHtml
      : MENU_STATE === 'WAITING_OPPONENT' ? waitingHtml
      : MENU_STATE === 'FIGHT' ? fightSubmenuHtml
      : MENU_STATE === 'MOVESTATUS' ? moveStatusHtml
      : MENU_STATE === 'BAG' ? bagSubmenuHtml
      : MENU_STATE === 'POKEMON' ? partySubmenuHtml
      : mainMenuHtml;

    const oppLevel = b.opponent.level || 15;
    const playerLevel = starter.level || trainerState.level || 5;

    return `
      <div class="hoenn-battle-overlay">
        ${b.isPvp ? `<div class="em-pvp-banner">⚔️ PvP vs <strong>${Validate.escHtml(b.opponentName || 'Rival')}</strong> &nbsp;·&nbsp; Recompensa: <strong>${b.rewardCoins || 150} 💰</strong></div>` : ''}
        <div class="battle-arena-scene">
          <div class="battle3d-layer" id="battle3dLayer" aria-hidden="true"></div>
          <!-- Oponente -->
          <div class="battle-box-opponent">
            ${b.trainerName ? `<div class="em-enemy-trainer-tag">${Validate.escHtml(b.trainerName)} · ${(b.opponentTeam && b.opponentTeam.length ? b.opponentTeam.length + 1 : 1)} Pokémon</div>` : ''}
            <div class="battle-status-plate opponent-plate">
              <div class="plate-top-row">
                <strong class="plate-name">${Validate.escHtml(b.opponent.name.toUpperCase())}</strong>
                <span class="em-gender em-gender-male">♂</span>
                <span class="plate-level">Lv${oppLevel}</span>
              </div>
              <div class="plate-hp-row">
                <span class="em-hp-badge">HP</span>
                <div class="battle-hp-bar">
                  <div class="battle-hp-fill ${oppPercent < 25 ? 'red' : oppPercent < 50 ? 'yellow' : ''}" style="width: ${oppPercent}%;"></div>
                </div>
              </div>
              <small class="battle-hp-num">${b.opponentHp}/${b.opponent.maxHp} PS</small>
            </div>
            <div class="battle-podium opponent-podium">
              <img class="battle-pokemon-img" src="${b.opponent.image}" alt="${b.opponent.name}">
            </div>
          </div>

          <!-- Jugador -->
          <div class="battle-box-player">
            <div class="battle-status-plate player-plate">
              <div class="plate-top-row">
                <strong class="plate-name">${Validate.escHtml(starter.name.toUpperCase())}</strong>
                <span class="em-gender em-gender-male">♂</span>
                <span class="plate-level">Lv${playerLevel}</span>
              </div>
              <div class="plate-hp-row">
                <span class="em-hp-badge">HP</span>
                <div class="battle-hp-bar">
                  <div class="battle-hp-fill ${playerPercent < 25 ? 'red' : playerPercent < 50 ? 'yellow' : ''}" style="width: ${playerPercent}%;"></div>
                </div>
              </div>
              <small class="battle-hp-num">${b.playerHp}/${starter.hp} PS</small>
            </div>
            <div class="battle-podium player-podium">
              <img class="battle-pokemon-img" src="${starter.image}" alt="${starter.name}">
            </div>
          </div>
        </div>

        <!-- Panel Inferior Gen 3: Caja de Mensaje + Menú de Acción -->
        <div class="em-battle-panel">
          <div class="em-message-box">
            <div class="em-message-text">${messageText}</div>
            ${olderLogs ? `<div class="em-log-history">${olderLogs}</div>` : ''}
          </div>
          <div class="em-action-box">
            ${panelHtml}
          </div>
        </div>
      </div>
    `;
    } catch (err) {
      console.error('[PVP] Error renderizando overlay de batalla:', err);
      return `
        <div class="hoenn-battle-overlay">
          <div class="em-battle-panel">
            <div class="em-message-box">
              <div class="em-message-text">Batalla en curso... (detalles en consola F12)</div>
            </div>
            <div class="em-action-box">
              <div class="em-main-menu">
                <button class="em-main-btn" onclick="App.setBattleMenuState('FIGHT')"><span class="em-arrow">►</span> FIGHT</button>
                ${b && b.isPvp ? `<button class="em-main-btn" onclick="App.pvpForfeit()"><span class="em-arrow">►</span> RENDIRSE</button>` : `<button class="em-main-btn" onclick="App.battleFlee()"><span class="em-arrow">►</span> RUN</button>`}
              </div>
            </div>
          </div>
        `;
    }
  }

  /* ============================================================
     8. CONTROLADOR DE ACCIONES APP
     ============================================================ */
  window.App = window.App || {};

  let previousMapState = null;

  App.switchTown = function(townId, spawnX, spawnY, warpType = 'route') {
    const fullMaps = {
      ...(window.HOENN_FULL_MAPS || {}),
      ...(window.HOENN_INTERIORS || {}),
      ...(window.EMERALD_REFERENCE_MAPS || {})
    };
    const localMaps = typeof HOENN_MAPS !== 'undefined' ? HOENN_MAPS : {};
    const interiorMaps = window.HOENN_INTERIORS || {};

    let isDoor = warpType === 'door';

    if (townId === 'PREVIOUS' && previousMapState) {
      townId = previousMapState.mapKey;
      spawnX = previousMapState.x;
      spawnY = previousMapState.y;
      previousMapState = null;
      isDoor = true;
    } else if (interiorMaps[townId] && !interiorMaps[activeMapKey]) {
      previousMapState = {
        mapKey: activeMapKey,
        x: playerPos.x,
        y: playerPos.y + 20
      };
      isDoor = true;
    }

    const map = fullMaps[townId] || localMaps[townId] || interiorMaps[townId] || (window.EMERALD_REFERENCE_MAPS || {})[townId];
    if (!map) return;

    const doSwitch = () => {
      activeMapKey = townId;
      const spawn = {
        x: spawnX != null && spawnX !== 'RETURN' ? Math.round(spawnX / 16) * 16 : (map.spawn?.x != null ? Math.round(map.spawn.x / 16) * 16 : 240),
        y: spawnY != null && spawnY !== 'RETURN' ? Math.round(spawnY / 16) * 16 : (map.spawn?.y != null ? Math.round(map.spawn.y / 16) * 16 : 240),
        dir: map.spawn?.dir || 'down',
        moving: false
      };
      playerPos = { ...spawn };
      activeDialog = null;
      inMapBattle = null;
      if (!trainerState.visitedTowns.includes(townId) && !interiorMaps[townId]) {
        trainerState.visitedTowns.push(townId);
      }
      saveTrainerProgress();
      if (window.MultiplayerClient && window.MultiplayerClient.socket && window.MultiplayerClient.socket.readyState === 1) {
        window.MultiplayerClient.sendPosition(playerPos.x, playerPos.y, playerPos.dir, activeMapKey);
      }
      renderView('mundo');

      if (isDoor) {
        const stage = document.getElementById('worldCanvasStage');
        if (stage) {
          stage.classList.remove('fade-to-black');
          void stage.offsetWidth; 
          stage.classList.add('fade-to-black');
        }
      }
    };

    if (worldTileRenderer && worldTileRenderer.fadeState !== 'OUT' && !isDoor) {
      worldTileRenderer.startFadeOut(doSwitch);
    } else {
      // Si es una puerta, hacemos el switch directo porque la transición CSS la cubre
      if (isDoor) {
        const stage = document.getElementById('worldCanvasStage');
        if (stage) {
          stage.classList.remove('fade-to-black');
          void stage.offsetWidth; 
          stage.classList.add('fade-to-black');
        }
        setTimeout(() => doSwitch(), 400); // Cambiar de mapa a mitad del fundido
      } else {
        doSwitch();
      }
    }
  };

  App.movePlayer = function(dx, dy) {
    if (activeDialog || inMapBattle) return;
    if (worldTileRenderer && worldTileRenderer.avatarState === 'IDLE') {
      const dir = dy < 0 ? 'up' : (dy > 0 ? 'down' : (dx < 0 ? 'left' : 'right'));
      worldTileRenderer.playerDir = dir;
      const nextX = worldTileRenderer.startGridPos.x + dx * 16;
      const nextY = worldTileRenderer.startGridPos.y + dy * 16;
      if (worldTileRenderer.isBlocked(nextX, nextY)) {
        worldTileRenderer.avatarState = 'COLLIDING';
        worldTileRenderer.bumpFrame = 0;
        worldTileRenderer.bumpTarget = { dx, dy };
        worldTileRenderer.targetGridPos = { x: worldTileRenderer.playerPos.x, y: worldTileRenderer.playerPos.y };
      } else {
        worldTileRenderer.avatarState = 'WALKING';
        worldTileRenderer.stepProgress = 0;
        worldTileRenderer.startGridPos = { x: worldTileRenderer.playerPos.x, y: worldTileRenderer.playerPos.y };
        worldTileRenderer.targetGridPos = { x: nextX, y: nextY };
      }
    }
  };

  App.clickToMove = function(e) {
    if (activeDialog || inMapBattle || !worldTileRenderer) return;
    worldTileRenderer.interactNearby();
  };

  App.interactWith = function(npcId) {
    const fullMaps = (typeof window !== 'undefined' && window.HOENN_FULL_MAPS) ? window.HOENN_FULL_MAPS : {};
    const interiorMaps = window.HOENN_INTERIORS || {};
    const map = fullMaps[activeMapKey] || (typeof HOENN_MAPS !== 'undefined' ? HOENN_MAPS[activeMapKey] : null) || interiorMaps[activeMapKey];
    if (!map) return;
    const npc = (map.npcs || []).find(n => n.id === npcId);
    if (!npc) return;

    if (Math.abs(playerPos.x - npc.x) > Math.abs(playerPos.y - npc.y)) {
      npc.dir = playerPos.x > npc.x ? 'right' : 'left';
    } else {
      npc.dir = playerPos.y > npc.y ? 'down' : 'up';
    }

    let dialogLine = (npc.dialogs && npc.dialogs.length)
      ? npc.dialogs[Math.floor(Math.random() * npc.dialogs.length)]
      : '¡Hola! Bienvenido a la región de Hoenn.';

    let trainerId = npc.battleTrainerId || null;
    if (trainerId) {
      const cfg = findTrainerConfig(trainerId);
      if (cfg) {
        if (cfg.once && isTrainerDefeated(trainerId)) {
          trainerId = null;
          dialogLine = cfg.dialogoVictoria || '¡Gran batalla! Gracias por el entrenamiento.';
        } else if (cfg.dialogo) {
          dialogLine = cfg.dialogo;
        }
      }
    }

    activeDialog = {
      title: npc.name,
      text: dialogLine,
      canHeal: !!npc.canHeal,
      givesSupplies: !!npc.givesSupplies,
      isShop: !!npc.isShop,
      battleTrainerId: trainerId,
      battleOpponent: npc.battleOpponent || null,
      npcColorFilter: getNPCColorFilter(npc)
    };
    if (worldTileRenderer) {
      worldTileRenderer.avatarState = 'INTERACTING';
    }
    renderView('mundo');
  };

  App.readSign = function(idx) {
    const fullMaps = (typeof window !== 'undefined' && window.HOENN_FULL_MAPS) ? window.HOENN_FULL_MAPS : {};
    const map = fullMaps[activeMapKey] || (typeof HOENN_MAPS !== 'undefined' ? HOENN_MAPS[activeMapKey] : null);
    if (!map) return;
    const sign = (map.signs || [])[idx];
    if (!sign) return;
    activeDialog = {
      title: sign.label || 'Letrero',
      text: sign.text || '',
      canHeal: false,
      npcColorFilter: null
    };
    if (worldTileRenderer) {
      worldTileRenderer.avatarState = 'INTERACTING';
    }
    renderView('mundo');
  };

  App.readSignData = function(sign) {
    if (!sign) return;
    activeDialog = {
      title: sign.label || 'Letrero',
      text: sign.text || '',
      canHeal: false,
      npcColorFilter: null
    };
    if (worldTileRenderer) {
      worldTileRenderer.avatarState = 'INTERACTING';
    }
    renderView('mundo');
  };

  let interactTargetPlayer = null;

  App.openPlayerInteractMenu = function(player) {
    interactTargetPlayer = player;
    App._pendingInteractPlayer = player;
    const defaultActions = document.getElementById('defaultQuickActions');
    const interactActions = document.getElementById('playerInteractActions');
    const targetName = document.getElementById('piTargetName');
    
    if (defaultActions && interactActions && targetName) {
      targetName.textContent = player.name || 'Entrenador';
      defaultActions.style.display = 'none';
      interactActions.style.display = 'flex';
    }
  };

  App.sendDuelRequest = function() {
    if (!App._pendingInteractPlayer) return;
    window.MultiplayerClient.sendAction('CHALLENGE_TRAINER', {
      target_id: App._pendingInteractPlayer.id,
      team: App.getPvpTeamPayload()
    });
    App.showNotification(`¡Desafío enviado a ${App._pendingInteractPlayer.name}! Esperando respuesta...`, 'info');
    App.closePlayerInteractMenu();
  };

  App.sendTradeRequest = function() {
    if (!App._pendingInteractPlayer) return;
    window.MultiplayerClient.sendAction('TRADE_INVITE', { target_id: App._pendingInteractPlayer.id });
    App.closePlayerInteractMenu();
  };


  App.closePlayerInteractMenu = function() {
    interactTargetPlayer = null;
    const defaultActions = document.getElementById('defaultQuickActions');
    const interactActions = document.getElementById('playerInteractActions');
    if (defaultActions && interactActions) {
      defaultActions.style.display = 'flex';
      interactActions.style.display = 'none';
    }
  };

  App.interactNear = function() {
    if (worldTileRenderer) {
      worldTileRenderer.interactNearby();
      return;
    }
  };

  // --- MMO Request Toast Handling ---
  let pendingRequest = null;
  
  function showIncomingRequestHud(title, desc, onAccept, onDecline) {
    _closeIncomingRequestHud();

    App._acceptCurrentRequest = () => {
      if (onAccept) onAccept();
      _closeIncomingRequestHud();
    };

    App._declineCurrentRequest = () => {
      if (onDecline) onDecline();
      _closeIncomingRequestHud();
    };

    App._pendingDuelTimeout = setTimeout(() => {
      if (App._declineCurrentRequest) {
        App._declineCurrentRequest();
      }
    }, 15000);

    const defaultActions = document.getElementById('defaultQuickActions');
    const interactActions = document.getElementById('playerInteractActions');
    const respondActions = document.getElementById('playerRespondActions');
    const targetName = document.getElementById('prTargetName');
    const actionDesc = document.getElementById('prActionDesc');
    
    if (defaultActions && interactActions && respondActions && targetName && actionDesc) {
      defaultActions.style.display = 'none';
      interactActions.style.display = 'none';
      respondActions.style.display = 'flex';
      
      targetName.textContent = title;
      actionDesc.textContent = desc;
    }
  }

  App.acceptDuelRequest = function() {
    try {
      const challenge = App._pendingDuelChallenge;
      if (!challenge) return;
      const challengerId = challenge.challenger_id || challenge.from_trainer_id;
      const teamPayload = App.getPvpTeamPayload();
      console.log('[PVP] Enviando RESPOND_CHALLENGE accept=true a', challengerId, 'con', teamPayload.length, 'Pokémon');
      window.MultiplayerClient.sendAction('RESPOND_CHALLENGE', { challenge_id: challenge.challenge_id || challenge.id, accept: true, target_id: challengerId, team: teamPayload });
      _closeIncomingRequestHud();
    } catch (e) {
      alert("Error aceptando el duelo: " + e.message);
      console.error(e);
    }
  };

  App.declineDuelRequest = function() {
    const challenge = App._pendingDuelChallenge;
    if (!challenge) return;
    const challengerId = challenge.challenger_id || challenge.from_trainer_id;
    window.MultiplayerClient.sendAction('RESPOND_CHALLENGE', { challenge_id: challenge.challenge_id || challenge.id, accept: false, target_id: challengerId });
    _closeIncomingRequestHud();
  };

  function _closeIncomingRequestHud() {
    clearTimeout(App._pendingDuelTimeout);
    App._acceptCurrentRequest = null;
    App._declineCurrentRequest = null;
    pendingRequest = null;
    const defaultActions = document.getElementById('defaultQuickActions');
    const respondActions = document.getElementById('playerRespondActions');
    if (respondActions) respondActions.style.display = 'none';
    if (defaultActions) defaultActions.style.display = 'flex';
  }

  // Hook up MultiplayerLobbyClient events Si window.MultiplayerClient existe
  // Esto debe configurarse luego de instanciarlo, pero como `admin.js` se carga
  // después de `game_client.js`, `window.MultiplayerClient` está definido.
  if (window.MultiplayerClient) {
    window.MultiplayerClient.on('onDuelRequest', (challenge) => {
      if (pendingRequest) return;
      pendingRequest = challenge;
      const challengerName = challenge.challenger_name || challenge.from_trainer_name || 'Alguien';
      const challengerId = challenge.challenger_id || challenge.from_trainer_id;
      const teamPayload = App.getPvpTeamPayload();
      console.log('[PVP] Desafío recibido de', challengerName, '| challenge_id:', challenge.challenge_id || challenge.id, '| equipo enviado al aceptar:', teamPayload.length, 'Pokémon');
      showIncomingRequestHud(
        challenge.challenger_name || 'Alguien',
        `te desafía a un duelo (PvP) con ${challenge.team_size || 1} Pokémon`,
        () => { // onAccept
           try {
             const challengerId = challenge.challenger_id || challenge.from_trainer_id;
             const teamPayload = App.getPvpTeamPayload();
             console.log('[PVP] Enviando RESPOND_CHALLENGE accept=true a', challengerId, 'con', teamPayload.length, 'Pokémon');
             window.MultiplayerClient.sendAction('RESPOND_CHALLENGE', { challenge_id: challenge.challenge_id || challenge.id, accept: true, target_id: challengerId, team: teamPayload });
           } catch (e) {
             alert("Error aceptando el duelo: " + e.message);
             console.error(e);
           }
        },
        () => { // onDecline
           const challengerId = challenge.challenger_id || challenge.from_trainer_id;
           window.MultiplayerClient.sendAction('RESPOND_CHALLENGE', { challenge_id: challenge.challenge_id || challenge.id, accept: false, target_id: challengerId });
        }
      );

    });

    window.MultiplayerClient.on('onChallengeResponse', (res) => {
      if (res.error) {
        App.showNotification(res.error, 'error');
        return;
      }
      if (!res.accepted) {
        App.showNotification(`${res.responder_name} ha rechazado el desafío.`, 'error');
      }
    });

    window.MultiplayerClient.on('onPvpBattleStart', (data) => {
      console.log('[PVP] *** PVP_BATTLE_START recibido ***', data.battle_id, 'vs', data.opponent_name);
      try {
        pvpOpponentTeam = Array.isArray(data.opponent_team) ? data.opponent_team : [];
        // ── Datos del Pokemon propio ────────────────────────────────────────────
        const myRaw = data.my_pokemon || {};
        const localStarter = trainerState.starter || {};
        const myMax = myRaw.hp || localStarter.hp || 50;
        const myHp = (myRaw.current_hp != null ? myRaw.current_hp : (myRaw.hp || myMax));

        // Sincronizar HP local
        if (localStarter && localStarter.name) {
          localStarter.currentHp = Math.min(myHp, localStarter.hp || myMax);
          saveTrainerProgress();
        }

        const playerPokemon = (localStarter && localStarter.name) ? {
          name: localStarter.name,
          image: localStarter.image || myRaw.image || '',
          level: localStarter.level || myRaw.level || 5,
          hp: localStarter.hp || myMax,
          maxHp: localStarter.hp || myMax,
          currentHp: myHp,
          moves: (Array.isArray(localStarter.moves) && localStarter.moves.length)
            ? localStarter.moves
            : (Array.isArray(myRaw.moves) && myRaw.moves.length
                ? myRaw.moves.map(m => ({ ...m, currentPp: m.current_pp != null ? m.current_pp : (m.pp || 0), maxPp: m.max_pp || m.pp || 0 }))
                : getMovesForMon(localStarter, localStarter.level || 5))
        } : {
          name: myRaw.name || 'POKEMON',
          image: myRaw.image || '',
          level: myRaw.level || 5,
          hp: myMax,
          maxHp: myMax,
          currentHp: myHp,
          moves: (Array.isArray(myRaw.moves) && myRaw.moves.length)
            ? myRaw.moves.map(m => ({ ...m, currentPp: m.current_pp != null ? m.current_pp : (m.pp || 0), maxPp: m.max_pp || m.pp || 0 }))
            : [{ name: 'Placaje', type: 'Normal', category: 'fisico', power: 40, pp: 35, currentPp: 35, maxPp: 35 }]
        };

        // ── Datos del Pokemon rival ─────────────────────────────────────────────
        const oppRaw = data.opponent_pokemon || {};
        const opponent = {
          name: oppRaw.name || data.opponent_name || 'RIVAL',
          image: oppRaw.image || '',
          level: oppRaw.level || 5,
          hp: oppRaw.hp || 60,
          maxHp: oppRaw.hp || oppRaw.maxHp || 60,
          types: oppRaw.types || [oppRaw.primary_type || 'Normal'],
          moves: Array.isArray(oppRaw.moves) ? oppRaw.moves : [],
        };
        const oppHp = (oppRaw.current_hp != null ? oppRaw.current_hp : opponent.maxHp);

        const oppName = data.opponent_name || opponent.name || 'Rival';
        const plName = playerPokemon.name;

        inMapBattle = {
          isPvp: true,
          pvpBattleId: data.battle_id,
          opponentId: data.opponent_id,
          opponentName: oppName,
          trainerName: oppName,
          opponent: opponent,
          opponentHp: oppHp,
          playerPokemon: playerPokemon,
          playerHp: myHp,
          playerMaxHp: playerPokemon.maxHp,
          rewardCoins: data.reward_coins || 150,
          logs: [
            `¿Que hara ${plName.toUpperCase()}?`,
            `${plName} (Lv${playerPokemon.level}) vs ${opponent.name} (Lv${opponent.level})`,
            `¡Combate PvP contra ${oppName}!`
          ],
          menuState: 'MAIN'
        };

        console.log('[PVP] inMapBattle configurado, battle_id:', inMapBattle.pvpBattleId);

        // Forzar la vista al mundo y renderizar
        currentView = 'mundo';
        App.playPokemonCry(playerPokemon.name);
        App.playPokemonCry(opponent.name);
        renderView('mundo');

        // Mecanismo de reintento: verificar que el overlay aparecio en el DOM
        const ensureOverlay = (attempts) => {
          const overlay = document.querySelector('.hoenn-battle-overlay');
          console.log('[PVP] Overlay check (intento ' + (4 - attempts) + '):', !!overlay);
          if (overlay) {
            App.showNotification('⚔️ ¡Batalla PvP contra ' + oppName + ' iniciada!', 'success');
            return;
          }
          if (attempts <= 0) {
            // Inyeccion directa en el viewport si el ciclo normal fallo
            const viewport = document.getElementById('hoennViewport');
            if (viewport && inMapBattle) {
              const prev = viewport.querySelector('.hoenn-battle-overlay');
              if (prev) prev.remove();
              const div = document.createElement('div');
              div.innerHTML = renderInMapBattleHtml();
              const overlayEl = div.firstElementChild;
              if (overlayEl) { viewport.appendChild(overlayEl); console.log('[PVP] Overlay inyectado directamente en viewport'); }
            }
            App.showNotification('⚔️ ¡Batalla PvP iniciada!', 'success');
            return;
          }
          setTimeout(() => { currentView = 'mundo'; renderView('mundo'); ensureOverlay(attempts - 1); }, 200);
        };
        setTimeout(() => ensureOverlay(3), 80);

      } catch (err) {
        console.error('[PVP] Error al iniciar la batalla PvP:', err);
        // Fallback de emergencia para no bloquear al jugador
        const oppNameFb = (data && data.opponent_name) || 'Rival';
        inMapBattle = {
          isPvp: true,
          pvpBattleId: data && data.battle_id,
          opponentId: data && data.opponent_id,
          opponentName: oppNameFb,
          opponent: { name: oppNameFb, image: '', level: 5, hp: 50, maxHp: 50 },
          opponentHp: 50,
          playerPokemon: trainerState.starter || { name: 'POKEMON', image: '', level: 5, hp: 50, maxHp: 50, moves: [] },
          playerHp: (trainerState.starter || {}).currentHp || (trainerState.starter || {}).hp || 50,
          playerMaxHp: (trainerState.starter || {}).hp || 50,
          rewardCoins: 150,
          logs: ['¡Batalla iniciada! (datos parciales, ver F12)'],
          menuState: 'MAIN'
        };
        currentView = 'mundo';
        renderView('mundo');
      }
    });

    window.MultiplayerClient.on('onPvpBattleTurnResult', (res) => {
      if (!inMapBattle || !inMapBattle.isPvp) return;

      if (res.my_pokemon) {
        // Solo sincroniza los PS: nunca reemplaza el Pokémon local (perdería XP,
        // movimientos y evolución acumulados).
        const local = trainerState.starter;
        const hp = Number(res.my_pokemon.current_hp != null ? res.my_pokemon.current_hp : res.my_pokemon.hp);
        if (local && Number.isFinite(hp)) {
          const maxHp = Number(local.maxHp || local.hp) || hp;
          local.currentHp = Math.max(0, Math.min(maxHp, hp));
          inMapBattle.playerPokemon = {
            ...(inMapBattle.playerPokemon || {}),
            name: inMapBattle.playerPokemon?.name || local.name,
            image: inMapBattle.playerPokemon?.image || local.image,
            level: local.level,
            hp: maxHp,
            maxHp,
            currentHp: local.currentHp,
            moves: inMapBattle.playerPokemon?.moves || local.moves || []
          };
          inMapBattle.playerHp = local.currentHp;
        } else {
          inMapBattle.playerPokemon = res.my_pokemon;
          inMapBattle.playerHp = Number.isFinite(hp) ? hp : inMapBattle.playerHp;
        }
      } else {
        inMapBattle.playerHp = res.my_hp != null ? res.my_hp : inMapBattle.playerHp;
        if (trainerState.starter) {
          const maxHp = Number(trainerState.starter.maxHp || trainerState.starter.hp) || inMapBattle.playerHp;
          trainerState.starter.currentHp = Math.max(0, Math.min(maxHp, Number(inMapBattle.playerHp)));
        }
      }
      
      if (res.opponent_pokemon) {
        inMapBattle.opponent = { ...(inMapBattle.opponent || {}), ...res.opponent_pokemon };
        inMapBattle.opponentHp = res.opponent_pokemon.current_hp != null ? res.opponent_pokemon.current_hp : res.opponent_pokemon.hp;
      } else {
        inMapBattle.opponentHp = res.opponent_hp != null ? res.opponent_hp : inMapBattle.opponentHp;
      }
      
      if (res.my_team) {
        // Solo PS del equipo; conserva los objetos locales y su progresión.
        syncPartyHpFromServer(res.my_team);
      }
      saveTrainerProgress();

      // Mostrar los logs del turno secuencialmente
      const turnLogs = Array.isArray(res.logs) ? [...res.logs] : [];

      const showLogsSequentially = (logs, idx) => {
        if (!inMapBattle) return;
        if (idx >= logs.length) {
          // Todos los logs mostrados: gestionar fin o siguiente turno
          if (res.status && res.status !== 'ONGOING') {
            if (res.you_won) {
              const reward = res.reward_coins || inMapBattle.rewardCoins || 150;
              if (!trainerState.inventory) trainerState.inventory = {};
              trainerState.inventory.coins = (trainerState.inventory.coins || 0) + reward;
              saveTrainerProgress();
              inMapBattle.rewardPaid = true;
              grantPvpXp();
              inMapBattle.logs = [`¡VICTORIA! +${reward} monedas ♥`, ...inMapBattle.logs.slice(0, 4)];
              App.showNotification(`¡Has ganado y recibes ${reward} monedas!`, 'success');
            } else {
              inMapBattle.logs = ['Derrota... ¡A entrenar más!', ...inMapBattle.logs.slice(0, 4)];
              App.showNotification(`Has perdido el combate PvP.`, 'error');
            }
            inMapBattle.menuState = 'MAIN';
            inMapBattle.battleOver = true;
            renderView('mundo');
            setTimeout(() => {
              inMapBattle = null;
              renderView('mundo');
            }, 5000);
          } else {
            if (inMapBattle.playerHp <= 0) {
              inMapBattle.mustSwitch = true;
              inMapBattle.menuState = 'POKEMON';
              inMapBattle.logs = [`¡Tu Pokémon se debilitó! Elige a otro.`, ...inMapBattle.logs.slice(0, 3)];
            } else {
              inMapBattle.menuState = 'MAIN';
              inMapBattle.logs = turnLogs.length > 0
                ? [`¿Que hara ${(inMapBattle.playerPokemon || {}).name || 'POKEMON'}?`, ...inMapBattle.logs.slice(0, 3)]
                : inMapBattle.logs;
            }
            renderView('mundo');
          }
          return;
        }
        inMapBattle.logs = [logs[idx], ...inMapBattle.logs.slice(0, 3)];
        renderView('mundo');
        setTimeout(() => showLogsSequentially(logs, idx + 1), 900);
      };

      inMapBattle.menuState = 'WAITING_OPPONENT'; // bloquear menu mientras animan los logs
      showLogsSequentially(turnLogs, 0);
    });


    window.MultiplayerClient.on('onPvpBattleEnd', (data) => {
      if (inMapBattle && inMapBattle.isPvp) {
        if (data.you_won) {
          if (!inMapBattle.rewardPaid) {
            const reward = data.reward_coins || inMapBattle.rewardCoins || 150;
            if (!trainerState.inventory) trainerState.inventory = {};
            trainerState.inventory.coins = (trainerState.inventory.coins || 0) + reward;
            saveTrainerProgress();
            App.showNotification(`¡Ganaste el combate PvP y recibes ${reward} monedas!`, 'success');
          }
          grantPvpXp();
        } else {
          App.showNotification(`El combate PvP terminó. Ganó ${data.winner_name || 'tu rival'}.`, 'info');
        }
        inMapBattle = null;
        renderView('mundo');
      }
    });

    window.MultiplayerClient.on('onTradeInvite', (invite) => {
      if (pendingRequest) return;
      pendingRequest = invite;
      const fromName = invite.from_name || invite.from_trainer_name || 'Alguien';
      const fromId = invite.from_id || invite.from_trainer_id;
      showIncomingRequestHud(
        fromName,
        `quiere intercambiar contigo`,
        () => window.MultiplayerClient.sendAction('RESPOND_TRADE', { trade_id: invite.trade_id, accept: true, target_id: fromId }),
        () => window.MultiplayerClient.sendAction('RESPOND_TRADE', { trade_id: invite.trade_id, accept: false, target_id: fromId })
      );
    });

    window.MultiplayerClient.on('onTradeStarted', (trade) => {
      App.showNotification(`¡Intercambio iniciado!`, 'success');
      // lobby_view.js maneja el modal
    });
  }

  App.closeDialog = function() {
    activeDialog = null;
    if (worldTileRenderer) {
      worldTileRenderer.avatarState = 'IDLE';
    }
    renderView('mundo');
  };

  App.healTeam = function() {
    trainerState.starter.currentHp = trainerState.starter.hp;
    const restorePp = (mon) => {
      if (mon && Array.isArray(mon.moves)) {
        mon.moves.forEach(m => { m.currentPp = m.maxPp; });
      }
    };
    restorePp(trainerState.starter);
    if (Array.isArray(trainerState.collection)) trainerState.collection.forEach(restorePp);
    saveTrainerProgress();
    activeDialog = {
      title: 'Enfermería Pokémon',
      text: '¡Tu equipo ha sido sanado completamente! Todos los PS y PP están al máximo.',
      canHeal: false
    };
    renderView('mundo');
  };

  App.claimSupplies = async function() {
    if (!trainerState.inventory.items) trainerState.inventory.items = {};
    const gifts = {
      'Pokeball': 3,
      'Potion': 2,
      'Antidote': 1,
      'Repel': 1
    };
    Object.entries(gifts).forEach(([name, qty]) => {
      trainerState.inventory.items[name] = (trainerState.inventory.items[name] || 0) + qty;
    });
    saveTrainerProgress();
    activeDialog = {
      title: 'Poké Mart',
      text: '¡Recibiste suministros! 3 Poké Balls, 2 Pociones, 1 Antídoto y 1 Repelente añadidos a tu mochila.',
      givesSupplies: false
    };
    renderView('mundo');
  };

  App.openShop = function() {
    activeDialog = null; // Cierra el diálogo actual
    if (worldTileRenderer) {
      worldTileRenderer.avatarState = 'IDLE';
    }
    const modal = document.getElementById('shopModalOverlay');
    if (modal) {
      App.renderShopItems();
      modal.style.display = 'flex';
    } else {
      App.showNotification('Tienda no disponible', 'error');
    }
    renderView('mundo');
  };

  App.closeShop = function() {
    const modal = document.getElementById('shopModalOverlay');
    if (modal) modal.style.display = 'none';
  };

  App.renderShopItems = function() {
    const shopList = document.getElementById('shopItemsList');
    if (!shopList) return;
    const items = [
      { id: 'Pokeball', name: 'Poké Ball', price: 200, icon: 'assets/sprites/items/pokeball.png' },
      { id: 'Superball', name: 'Super Ball', price: 600, icon: 'assets/sprites/items/superball.png' },
      { id: 'Potion', name: 'Poción', price: 300, icon: 'assets/sprites/items/potion.png' },
      { id: 'Superpotion', name: 'Superpoción', price: 700, icon: 'assets/sprites/items/superpotion.png' }
    ];
    let html = '';
    items.forEach(item => {
      html += `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#1c2025; padding:8px; border-radius:6px; margin-bottom:6px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:32px; height:32px; background:#2c3e50; border-radius:4px; display:flex; align-items:center; justify-content:center;">
              <span style="font-size:1.2rem;">${item.id.includes('ball') ? '🔴' : '💊'}</span>
            </div>
            <div>
              <div style="font-weight:bold; color:#ecf0f1;">${item.name}</div>
              <div style="font-size:0.8rem; color:#f1c40f;">🪙 ${item.price}</div>
            </div>
          </div>
          <button class="btn btn-sm btn-primary" onclick="App.buyItem('${item.id}', ${item.price})">Comprar</button>
        </div>
      `;
    });
    const coinsStr = `<div style="margin-bottom:12px; font-weight:bold; color:#f1c40f;">Tus Monedas: 🪙 ${(trainerState.inventory && trainerState.inventory.coins) || 0}</div>`;
    shopList.innerHTML = coinsStr + html;
  };

  App.buyItem = function(itemId, price) {
    if (!trainerState.inventory) trainerState.inventory = { coins: 0, items: {} };
    if (!trainerState.inventory.coins) trainerState.inventory.coins = 0;
    if (trainerState.inventory.coins >= price) {
      trainerState.inventory.coins -= price;
      if (!trainerState.inventory.items) trainerState.inventory.items = {};
      trainerState.inventory.items[itemId] = (trainerState.inventory.items[itemId] || 0) + 1;
      saveTrainerProgress();
      App.showNotification(`Has comprado ${itemId} por ${price} monedas.`, 'success');
      App.renderShopItems(); // refresh coins
    } else {
      App.showNotification(`No tienes suficientes monedas.`, 'error');
    }
  };

  /* ============================================================
     9. COMBATE INTEGRADO EN EL MAPA (SIN OTRA PÁGINA)
     ============================================================ */
  App.showNotification = function(message, type = 'info') {
    let container = document.getElementById('pvpToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'pvpToastContainer';
      container.style.cssText = 'position:fixed; top:16px; right:16px; z-index:99999; display:flex; flex-direction:column; gap:8px; max-width:320px;';
      document.body.appendChild(container);
    }
    const colors = { info: '#2ecc71', success: '#27ae60', error: '#e74c3c', warning: '#f39c12' };
    const toast = document.createElement('div');
    toast.style.cssText = `background:rgba(13,40,24,0.96); color:#fff; border:1px solid ${colors[type] || colors.info}; border-left:6px solid ${colors[type] || colors.info}; border-radius:10px; padding:10px 14px; font-size:0.85rem; font-weight:600; box-shadow:0 6px 18px rgba(0,0,0,0.4); animation:pvpToastIn 0.25s ease;`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.4s';
      setTimeout(() => toast.remove(), 450);
    }, 4200);
    const style = document.createElement('style');
    style.textContent = '@keyframes pvpToastIn { from { transform: translateX(30px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }';
    document.head.appendChild(style);
  };

  // Serializa el equipo local (starter + colección) para enviarlo al servidor en el PvP
  App.getPvpTeamPayload = function() {
    const mons = [];
    const pushMon = (mon) => {
      if (!mon || !mon.name) return;
      const types = (Array.isArray(mon.types) && mon.types.length)
        ? mon.types.slice()
        : (mon.type ? String(mon.type).split('/').map(s => s.trim()).filter(Boolean) : ['Normal']);
      mons.push({
        name: mon.name,
        dexId: mon.dexId || mon.id || null,
        level: mon.level || trainerState.level || 5,
        hp: mon.hp || mon.maxHp || 50,
        current_hp: (mon.currentHp != null ? mon.currentHp : (mon.hp || 50)),
        attack: mon.attack || 16,
        defense: mon.defense || 18,
        sp_attack: mon.sp_attack || mon.attack || 16,
        sp_defense: mon.sp_defense || mon.defense || 18,
        speed: mon.speed || 40,
        types: types,
        primary_type: types[0],
        secondary_type: types[1] || null,
        image: mon.image || mon.sprite || mon.frontSprite || null,
        moves: ((Array.isArray(mon.moves) && mon.moves.length) ? mon.moves : getMovesForMon(mon, mon.level || trainerState.level || 5))
          .slice(0, 4)
          .map(m => ({
            name: m.name,
            power: m.power || 0,
            category: m.category || (m.power ? 'fisico' : 'estatus'),
            type: m.type || m.elemental_type || 'Normal',
            elemental_type: m.elemental_type || m.type || 'Normal',
            pp: m.maxPp || m.pp || 20,
            current_pp: (m.currentPp != null ? m.currentPp : (m.pp || 20)),
            max_pp: m.maxPp || m.pp || 20
          }))
      });
    };
    if (trainerState.starter) pushMon(trainerState.starter);
    if (Array.isArray(trainerState.collection)) {
      const activeName = trainerState.starter && trainerState.starter.name;
      trainerState.collection.forEach(p => {
        if (p && p.name !== activeName) pushMon(p);
      });
    }
    return mons;
  };

  App.pvpForfeit = function() {
    if (!inMapBattle || !inMapBattle.isPvp) return;
    if (window.MultiplayerClient) {
      window.MultiplayerClient.sendAction('PVP_BATTLE_FORFEIT', { battle_id: inMapBattle.pvpBattleId });
    }
    inMapBattle.menuState = 'WAITING_OPPONENT';
    inMapBattle.logs.unshift('¡Te has rendido! Esperando confirmación...');
    renderView('mundo');
  };
  // Rango de niveles salvajes por zona, ajustado al equipo para no bloquear la exploración.
  function zoneWildLevelRange(mapId, activeMap) {
    const party = (trainerState.collection || []).map(m => Number(m.level) || 5);
    const avg = party.length ? party.reduce((a, b) => a + b, 0) / party.length : 5;
    let min = 3;
    let max = 6;
    const routeMatch = /^route_(\d+)/.exec(String(mapId || ''));
    const routeNumber = routeMatch ? Number(routeMatch[1]) : 0;

    if (routeNumber >= 118) { min = 26; max = 32; }
    else if (routeNumber >= 110) { min = 20; max = 26; }
    else if (routeNumber >= 105) { min = 14; max = 20; }
    else if (routeNumber >= 103) { min = 7; max = 11; }
    else if (routeNumber > 0) { min = 3; max = 6; }
    else if (String(mapId || '').includes('cave') || String(mapId || '').includes('tunnel')) { min = 8; max = 13; }
    else if (String(mapId || '').match(/city|town/)) { min = 4; max = 8; }
    else { min = 5; max = 9; }

    // La zona nunca se aleja demasiado de tu equipo (mundo abierto, no un muro).
    min = Math.max(2, Math.min(min, Math.round(avg) + 2));
    max = Math.max(min + 1, Math.min(max, Math.round(avg) + 4));

    const badges = (trainerState.medals || []).length;
    if (badges > 0) {
      const bonus = Math.floor(badges / 2);
      min += bonus;
      max += bonus;
    }
    return { min, max };
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  App.triggerWildEncounter = function() {
    if (inMapBattle) return;
    // Encuentros salvajes POR RUTA: usa la lista de Pokémon de la ruta actual
    const fullMaps = (typeof window !== 'undefined' && window.HOENN_FULL_MAPS) ? window.HOENN_FULL_MAPS : {};
    const activeMap = fullMaps[activeMapKey] || (typeof HOENN_MAPS !== 'undefined' ? HOENN_MAPS[activeMapKey] : null) || fullMaps['route_101'] || null;
    const routeList = (activeMap && activeMap.encounters && Array.isArray(activeMap.encounters.pokemon) && activeMap.encounters.pokemon.length)
      ? activeMap.encounters.pokemon
      : null;
    let randomMon = routeList
      ? findCatalogMon(routeList[Math.floor(Math.random() * routeList.length)]) || null
      : null;
    if (!randomMon) randomMon = WILD_POKEMON[Math.floor(Math.random() * WILD_POKEMON.length)];

    const range = zoneWildLevelRange(activeMapKey, activeMap);
    const wildLevel = randomInt(range.min, range.max);

    let opponent;
    if (window.PokemonProgress && randomMon) {
      opponent = window.PokemonProgress.createMon(randomMon, wildLevel, { isWild: true });
    } else {
      const baseHp = randomMon.hp || (55 + ((randomMon.dexId || randomMon.id || 1) % 45));
      const baseAtk = randomMon.attack || (16 + ((randomMon.dexId || randomMon.id || 1) % 20));
      const wildHp = Math.max(30, Math.round(baseHp * (1 + (wildLevel - 5) * 0.10)));
      opponent = {
        name: randomMon.name,
        type: randomMon.types ? randomMon.types.slice().join('/') : (randomMon.type || 'Normal'),
        types: randomMon.types && randomMon.types.length ? randomMon.types.slice() : (randomMon.type ? [randomMon.type] : []),
        dexId: randomMon.dexId || randomMon.id,
        hp: wildHp,
        maxHp: wildHp,
        attack: Math.max(12, Math.round(baseAtk * (1 + (wildLevel - 5) * 0.10))),
        defense: randomMon.defense || 22,
        sp_attack: randomMon.sp_attack || baseAtk,
        sp_defense: randomMon.sp_defense || 22,
        speed: randomMon.speed || 50,
        image: randomMon.image || getPokemonSpriteUrl(randomMon.name, randomMon.dexId || randomMon.id),
        level: wildLevel,
        isWild: true
      };
    }
    opponent.isWild = true;
    opponent.moves = getMovesForMon(opponent, wildLevel).map(m => ({
      ...m,
      currentPp: m.pp,
      maxPp: m.maxPp
    }));

    const wildHp = opponent.maxHp || opponent.hp;
    inMapBattle = {
      menuState: 'MAIN',
      trainerId: null,
      trainerName: null,
      opponent,
      opponentTeam: [],
      opponentHp: wildHp,
      mustSwitch: false,
      playerHp: trainerState.starter.currentHp || trainerState.starter.hp,
      logs: [`¡Un ${opponent.name} salvaje (Nv. ${wildLevel}) apareció en ${(activeMap && activeMap.name) ? activeMap.name.split(' (')[0] : 'Hoenn'}!`]
    };
    activeDialog = null;
    renderView('mundo');
  };

  App.startInMapBattle = function(opponentName) {
    activeDialog = null;
    const level = opponentName.includes('Slaking') ? 16 : (opponentName.includes('Geodude') ? 15 : 12);
    const species = opponentName.includes('Slaking') ? 'Slaking' : (opponentName.includes('Geodude') ? 'Geodude' : 'Pikachu');
    const base = findCatalogMon(species);
    let opp = base && window.PokemonProgress
      ? window.PokemonProgress.createMon(base, level, { fullHp: true })
      : null;
    if (!opp) {
      opp = { name: species, type: 'Normal', dexId: 25, hp: 60, maxHp: 60, attack: 18, image: getPokemonSpriteUrl(species, 25), level };
    }
    opp.name = opponentName.includes('Slaking') || opponentName.includes('Geodude') ? species : opponentName;
    opp.badgeName = opponentName.includes('Slaking') ? 'Medalla Equilibrio' : (opponentName.includes('Geodude') ? 'Medalla Piedra' : null);
    opp.moves = getMovesForMon(opp, opp.level).map(m => ({
      ...m,
      currentPp: m.pp,
      maxPp: m.maxPp
    }));
    inMapBattle = {
      menuState: 'MAIN',
      trainerId: null,
      trainerName: null,
      opponent: opp,
      opponentTeam: [],
      opponentHp: opp.hp,
      mustSwitch: false,
      badgeName: opp.badgeName || null,
      playerHp: trainerState.starter.currentHp || trainerState.starter.hp,
      logs: [`¡Líder de Gimnasio te desafía con ${opp.name}!`]
    };
    App.playPokemonCry(trainerState.starter.name);
    App.playPokemonCry(opp.name);
    renderView('mundo');
  };

  // ===== Batalla contra entrenadores con EQUIPOS COMPLETOS (Rival, Líderes, Ruta) =====
  App.startTrainerBattle = function(trainerId) {
    activeDialog = null;
    if (!trainerId) return;
    const cfg = findTrainerConfig(trainerId);
    if (!cfg) {
      alert('Entrenador no encontrado: ' + trainerId);
      return;
    }
    if (cfg.once && isTrainerDefeated(trainerId)) {
      activeDialog = {
        title: cfg.nombre || 'Entrenador',
        text: cfg.dialogoVictoria || '¡Gracias por el entrenamiento!',
        canHeal: false,
        givesSupplies: false,
        battleTrainerId: null,
        battleOpponent: null,
        npcColorFilter: null
      };
      renderView('mundo');
      return;
    }

    let teamEntries = Array.isArray(cfg.equipo) ? cfg.equipo.slice() : [];
    if (!teamEntries.length && cfg.equipoPorInicial) {
      const dexId = trainerState.starter ? (trainerState.starter.dexId || trainerState.starter.id) : null;
      teamEntries = (cfg.equipoPorInicial && dexId != null && cfg.equipoPorInicial[String(dexId)])
        ? cfg.equipoPorInicial[String(dexId)].slice()
        : Object.values(cfg.equipoPorInicial || {})[0] || [];
    }
    const team = teamEntries.map(buildTrainerMon).filter(Boolean);
    if (!team.length) return;

    const [first, ...rest] = team;
    const trainerLabel = cfg.nombre || cfg.clase || 'Entrenador';
    inMapBattle = {
      menuState: 'MAIN',
      trainerId,
      trainerName: trainerLabel,
      opponent: first,
      opponentTeam: rest,
      opponentHp: first.hp,
      mustSwitch: false,
      badgeName: cfg.medalla || null,
      mt: cfg.mt || null,
      playerHp: trainerState.starter.currentHp || trainerState.starter.hp,
      logs: [`¡${trainerLabel} te desafía! Envía a ${first.name}.`]
    };
    if (worldTileRenderer) {
      worldTileRenderer.avatarState = 'IN_BATTLE';
    }
    App.playPokemonCry(trainerState.starter.name);
    App.playPokemonCry(first.name);
    renderView('mundo');
  };

  App.playPokemonCry = function(name) {
    if (!name) return;
    try {
      const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const audio = new Audio(`https://play.pokemonshowdown.com/audio/cries/${cleanName}.mp3`);
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch(e) {}
  };

  App.setBattleMenuState = function(state) {
    if (inMapBattle) {
      inMapBattle.menuState = state;
      renderView('mundo');
    }
  };

  App.switchPokemon = function(index) {
    if (!inMapBattle) return;
    const newStarter = trainerState.collection[index];
    if (inMapBattle.isPvp) {
      if (!newStarter || (newStarter.currentHp != null ? newStarter.currentHp : newStarter.hp) <= 0) {
        alert("Este Pokémon está debilitado o no es válido.");
        return;
      }
      // Evitar cambiar por el mismo
      if (trainerState.starter && trainerState.starter.name === newStarter.name && (trainerState.starter.currentHp > 0)) {
         alert("Este Pokémon ya está luchando.");
         return;
      }
      
      if (window.MultiplayerClient && window.MultiplayerClient.socket && window.MultiplayerClient.socket.readyState === WebSocket.OPEN) {
        window.MultiplayerClient.socket.send(JSON.stringify({
          action: 'PVP_BATTLE_MOVE',
          battle_id: inMapBattle.pvpBattleId,
          move_index: 'SWITCH:' + index
        }));
        App.playPokemonCry(newStarter.name);
        inMapBattle.menuState = 'WAITING_OPPONENT';
        inMapBattle.mustSwitch = false;
        inMapBattle.logs = [`Esperando al rival...`, ...(inMapBattle.logs || [])];
        renderView('mundo');
      }
      return;
    }
    
    if (!newStarter || (newStarter.currentHp != null ? newStarter.currentHp : newStarter.hp) <= 0) {
      alert("Este Pokémon está debilitado o no es válido.");
      return;
    }
    if (!(newStarter.moves && Array.isArray(newStarter.moves) && newStarter.moves.length)) {
      const level = newStarter.level || trainerState.level || 5;
      newStarter.moves = getMovesForMon(newStarter, level).map(m => ({ ...m, currentPp: m.pp, maxPp: m.maxPp }));
    }
    const wasForced = inMapBattle.mustSwitch;
    trainerState.starter = newStarter;
    inMapBattle.playerHp = newStarter.currentHp != null ? newStarter.currentHp : newStarter.hp;
    inMapBattle.mustSwitch = false;
    inMapBattle.logs.unshift(`¡Adelante ${newStarter.name}!`);
    inMapBattle.menuState = 'MAIN';
    saveTrainerProgress();
    // Si el cambio fue voluntario, el rival contraataca (gasta el turno)
    if (!wasForced && inMapBattle.opponent && !inMapBattle.opponent.isWild) {
      setTimeout(opponentTurn, 350);
      renderView('mundo');
      return;
    }
    renderView('mundo');
  };

  // Encuentra al siguiente Pokémon vivo del equipo rival y lo saca al combate
  function sendInNextOpponent() {
    const team = inMapBattle.opponentTeam || [];
    for (let i = 0; i < team.length; i++) {
      const m = team[i];
      const hp = m.currentHp != null ? m.currentHp : m.hp;
      if (hp > 0) {
        inMapBattle.opponentTeam.splice(i, 1);
        inMapBattle.opponent = m;
        inMapBattle.opponentHp = hp;
        const who = inMapBattle.trainerName ? inMapBattle.trainerName : 'El entrenador';
        inMapBattle.logs.unshift(`¡${who} envía a ${m.name}!`);
        return true;
      }
    }
    inMapBattle.opponentTeam = [];
    return false;
  }

  function playerHasAliveMon(excludeActive) {
    return (trainerState.collection || []).some(p => {
      if (excludeActive && p === trainerState.starter) return false;
      return (p.currentHp != null ? p.currentHp : p.hp) > 0;
    });
  }

  // Turno del oponente (contraataque con uno de sus movimientos reales)
  function opponentTurn() {
    if (!inMapBattle) return;
    const oppMon = inMapBattle.opponent;
    const playerMon = trainerState.starter;
    const oppMoves = (oppMon && Array.isArray(oppMon.moves) && oppMon.moves.length) ? oppMon.moves : [];
    const usableOpp = oppMoves.filter(m => (m.currentPp != null ? m.currentPp : m.pp) > 0);
    const oppMove = usableOpp.length ? usableOpp[Math.floor(Math.random() * usableOpp.length)] : null;

    const oppDmgResult = window.GameBattle ? window.GameBattle.calculateDamage({
      level: oppMon.level || 5,
      power: oppMove ? oppMove.power : 40,
      attack: oppMon.attack || 18,
      defense: playerMon.defense || 20,
      sp_attack: oppMon.sp_attack || 18,
      sp_defense: playerMon.sp_defense || 20,
      moveType: oppMove ? oppMove.type : (oppMon.type || 'Normal'),
      moveCategory: oppMove ? (oppMove.category || 'fisico') : 'fisico',
      attackerType: primaryTypeOf(oppMon),
      defenderTypes: playerMon.types && playerMon.types.length ? playerMon.types : (playerMon.type || 'Normal')
    }) : { damage: Math.max(6, Math.floor(oppMon.attack / 2 + Math.random() * 6)), modifier: 1, critical: false };

    const oppDmg = oppDmgResult.damage;
    inMapBattle.playerHp = Math.max(0, inMapBattle.playerHp - oppDmg);
    pendingBattleEffect = 'player';
    trainerState.starter.currentHp = inMapBattle.playerHp;

    const oppIsStatus = oppMove && (!oppMove.power || (oppMove.category && oppMove.category === 'estatus'));
    let oppLog = oppMove
      ? (oppIsStatus
          ? `¡${oppMon.name} usó ${oppMove.name}! (movimiento de estado)`
          : `¡${oppMon.name} usó ${oppMove.name} causando ${oppDmg} de daño!`)
      : `¡${oppMon.name} contraatacó causando ${oppDmg} de daño!`;
    if (!oppIsStatus && oppDmgResult.modifier > 1) oppLog += ' ¡Es muy eficaz!';
    if (oppDmgResult.critical) oppLog += ' ¡Un golpe crítico!';
    if (oppMove) oppMove.currentPp = (oppMove.currentPp != null ? oppMove.currentPp : oppMove.pp) - 1;
    inMapBattle.logs.unshift(oppLog);

    // El Pokémon activo del jugador se debilitó: cambiar o perder
    if (inMapBattle.playerHp <= 0) {
      trainerState.starter.currentHp = 0;
      if (playerHasAliveMon(true)) {
        inMapBattle.logs.unshift(`¡${trainerState.starter.name} se ha debilitado!`);
        for (let i = 0; i < trainerState.collection.length; i++) {
          const nextMon = trainerState.collection[i];
          const nextHp = nextMon.currentHp != null ? nextMon.currentHp : nextMon.hp;
          if (nextHp > 0) {
            if (!(nextMon.moves && Array.isArray(nextMon.moves) && nextMon.moves.length)) {
              const level = nextMon.level || trainerState.level || 5;
              nextMon.moves = getMovesForMon(nextMon, level).map(m => ({ ...m, currentPp: m.pp, maxPp: m.maxPp }));
            }
            trainerState.starter = nextMon;
            inMapBattle.playerHp = nextHp;
            inMapBattle.mustSwitch = false;
            inMapBattle.menuState = 'MAIN';
            inMapBattle.logs.unshift(`¡Adelante ${nextMon.name}!`);
            break;
          }
        }
        saveTrainerProgress();
        renderView('mundo');
        return;
      }
      inMapBattle.logs.unshift(`¡${trainerState.starter.name} ha caído debilitado!`);
      saveTrainerProgress();
      if (inMapBattle.onComplete) inMapBattle.onComplete({ victory: false });
      setTimeout(() => {
        alert('Tu equipo quedó debilitado. Visita al Prof. Abedul o al Centro Pokémon para recuperarte.');
        inMapBattle = null;
        if (worldTileRenderer) worldTileRenderer.avatarState = 'IDLE';
        renderView('mundo');
      }, 700);
      return;
    }
    saveTrainerProgress();
    renderView('mundo');
  }

  // Sincroniza solo los PS del equipo con el estado autoritativo del servidor PvP.
  function syncPartyHpFromServer(serverTeam) {
    if (!Array.isArray(serverTeam)) return;
    const locals = [];
    if (trainerState.starter) locals.push(trainerState.starter);
    (trainerState.collection || []).forEach(mon => {
      if (mon && mon !== trainerState.starter) locals.push(mon);
    });
    locals.forEach((mon, index) => {
      const remote = serverTeam[index];
      if (!remote) return;
      const hp = Number(remote.current_hp != null ? remote.current_hp : remote.currentHp);
      if (!Number.isFinite(hp)) return;
      const maxHp = Number(mon.maxHp || mon.hp) || hp;
      mon.currentHp = Math.max(0, Math.min(maxHp, hp));
    });
  }

  // XP de PvP: solo la primera vez por combate.
  function grantPvpXp() {
    if (!inMapBattle || !inMapBattle.isPvp || inMapBattle.xpGranted) return;
    inMapBattle.xpGranted = true;
    const opp = inMapBattle.opponent || {};
    const expGained = window.PokemonProgress
      ? window.PokemonProgress.xpYield({ ...opp, level: opp.level || 5 })
      : 40;
    const activeMon = trainerState.starter;
    const reports = window.PokemonProgress
      ? window.PokemonProgress.grantPartyXp(trainerState.collection, activeMon, expGained, {
          catalog: WILD_POKEMON,
          evolutions: EVOLUTIONS,
          benchShare: 0.5
        })
      : [];

    inMapBattle.logs = [`¡Ganaste ${expGained} XP en el duelo!`, ...(inMapBattle.logs || []).slice(0, 3)];
    reports.forEach(report => {
      const mon = report.mon;
      if (!mon) return;
      report.levels.forEach(level => {
        inMapBattle.logs.unshift(`¡${mon.name} subió al nivel ${level}!`);
      });
      if (report.evolution) {
        inMapBattle.logs.unshift(`¡${report.evolution.from} evolucionó a ${report.evolution.to}!`);
      }
      if (report.levels.length) {
        autoLearnMoves(mon, report.fromLevel, mon.level).forEach(moveName => {
          inMapBattle.logs.unshift(`¡${mon.name} aprendió ${moveName}!`);
        });
      }
    });
    if (activeMon) {
      inMapBattle.playerHp = activeMon.currentHp;
      trainerState.level = activeMon.level;
      trainerState.xp = activeMon.xp;
    }
    saveTrainerProgress();
    return reports;
  }

  // Aprende automáticamente movimientos nuevos si hay hueco libre.
  function autoLearnMoves(mon, fromLevel, toLevel) {
    if (!mon || !POKEMON_MOVES_DB || !POKEMON_MOVES_DB.pokemon) return [];
    const dexId = mon.dexId || mon.id;
    if (dexId == null) return [];
    const learnset = POKEMON_MOVES_DB.pokemon[String(dexId)] || [];
    if (!Array.isArray(mon.moves)) mon.moves = [];
    const learned = [];
    for (const entry of learnset) {
      const lvl = Number(entry.level) || 1;
      if (lvl <= fromLevel || lvl > toLevel) continue;
      const move = buildMoveFromEntry(entry);
      if (mon.moves.some(m => String(m.id) === String(move.id))) continue;
      if (mon.moves.length < 4) {
        mon.moves.push({ ...move, currentPp: move.maxPp, maxPp: move.maxPp });
        learned.push(move.name);
      }
    }
    return learned;
  }

  // Victoria de combate: XP por Pokémon, medallas, MT, niveles y evolución
  function finishWinBattle() {
    const opp = inMapBattle.opponent;
    const teamCount = inMapBattle.opponentTeam && inMapBattle.opponentTeam.length ? inMapBattle.opponentTeam.length + 1 : 1;
    const expGained = window.PokemonProgress
      ? window.PokemonProgress.xpYield(opp)
      : Math.max(1, Math.floor((((opp.hp || 50) + (opp.attack || 50) + (opp.defense || 50) +
          (opp.sp_attack || 50) + (opp.sp_defense || 50) + (opp.speed || 50)) * (opp.level || 5)) / 7));

    trainerState.inventory.coins += inMapBattle.opponent.isWild ? 40 : ((inMapBattle.trainerName ? 200 : 250) + teamCount * 80);

    const badgeName = inMapBattle.badgeName || opp.badgeName;
    if (badgeName && !trainerState.medals.includes(badgeName)) {
      trainerState.medals.push(badgeName);
    }

    // Premio MT del líder / rival (solo la primera vez)
    if (inMapBattle.mt && !isTrainerDefeated(inMapBattle.trainerId)) {
      if (!trainerState.inventory.items) trainerState.inventory.items = {};
      trainerState.inventory.items[inMapBattle.mt] = (trainerState.inventory.items[inMapBattle.mt] || 0) + 1;
      inMapBattle.logs.unshift(`¡Recibiste ${inMapBattle.mt}!`);
    }
    if (inMapBattle.trainerId && !isTrainerDefeated(inMapBattle.trainerId)) {
      trainerState.defeatedTrainers.push(inMapBattle.trainerId);
    }

    const activeMon = trainerState.starter;
    const reports = window.PokemonProgress
      ? window.PokemonProgress.grantPartyXp(trainerState.collection, activeMon, expGained, {
          catalog: WILD_POKEMON,
          evolutions: EVOLUTIONS,
          benchShare: 0.5
        })
      : [];

    inMapBattle.logs.unshift(`¡${opp.name} fue debilitado! Ganaste ${expGained} XP.`);
    reports.forEach(report => {
      const mon = report.mon;
      if (!mon) return;
      if (report.isActive) {
        inMapBattle.logs.unshift(`¡${mon.name} ganó ${report.xp} XP!`);
      }
      report.levels.forEach(level => {
        inMapBattle.logs.unshift(`¡${mon.name} subió al nivel ${level}!`);
      });
      if (report.evolution) {
        inMapBattle.logs.unshift(`¡${report.evolution.from} evolucionó a ${report.evolution.to}!`);
      }
      if (report.levels.length) {
        const learned = autoLearnMoves(mon, report.fromLevel, mon.level);
        learned.forEach(moveName => {
          inMapBattle.logs.unshift(`¡${mon.name} aprendió ${moveName}!`);
        });
      }
    });

    // El Pokémon activo puede querer aprender un movimiento con el set completo.
    if (activeMon && reports.some(r => r.isActive && r.levels.length)) {
      offerLevelUpMoves(activeMon, activeMon.level);
    }

    if (activeMon) {
      inMapBattle.playerHp = activeMon.currentHp;
      trainerState.level = activeMon.level;
      trainerState.xp = activeMon.xp;
    }
    saveTrainerProgress();

    if (inMapBattle.onComplete) {
      inMapBattle.onComplete({ victory: true, exp: expGained });
    }

    if (inMapBattle.pendingLearn) {
      inMapBattle.pendingVictory = true; // Esperar la decisión de aprendizaje
    } else {
      setTimeout(finishInMapVictory, 700);
    }
    renderView('mundo');
  }

  App.executeBattleMove = function(moveIndex) {
    if (!inMapBattle) return;
    
    if (inMapBattle.isPvp) {
        window.MultiplayerClient.sendAction('PVP_BATTLE_MOVE', {
            battle_id: inMapBattle.pvpBattleId,
            move_index: moveIndex
        });
        inMapBattle.menuState = 'WAITING_OPPONENT';
        inMapBattle.logs.unshift('Esperando a que el rival elija su movimiento...');
        renderView('mundo');
        return;
    }
    
    if (inMapBattle.mustSwitch) {
      inMapBattle.menuState = 'POKEMON';
      inMapBattle.logs.unshift('¡Primero elige un Pokémon para continuar!');
      renderView('mundo');
      return;
    }
    const playerMon = trainerState.starter;
    const oppMon = inMapBattle.opponent;
    if ((playerMon.currentHp != null ? playerMon.currentHp : playerMon.hp) <= 0) return;

    const moves = (playerMon && Array.isArray(playerMon.moves) && playerMon.moves.length)
      ? playerMon.moves
      : getMovesForMon(playerMon, playerMon.level || trainerState.level || 5).map(m => ({ ...m, currentPp: m.pp, maxPp: m.maxPp }));

    if (moveIndex >= moves.length) return;
    const move = moves[moveIndex] || moves[0];
    if (!move) return;
    
    // Normalize pp keys
    let curPp = move.currentPp != null ? move.currentPp : (move.current_pp != null ? move.current_pp : move.pp);
    if (curPp <= 0) return;
    
    // Decrease pp
    curPp -= 1;
    move.currentPp = curPp;
    move.current_pp = curPp;

    // Daño calculado con motor GBA Gen 3 (Efectividad + STAB + Crítico)
    const pDmgResult = window.GameBattle ? window.GameBattle.calculateDamage({
      level: playerMon.level || trainerState.level,
      power: move.power,
      attack: playerMon.attack,
      defense: oppMon.defense || 22,
      sp_attack: playerMon.sp_attack,
      sp_defense: oppMon.sp_defense || 22,
      moveType: move.type,
      moveCategory: move.category || 'fisico',
      attackerType: primaryTypeOf(playerMon),
      defenderTypes: oppMon.types && oppMon.types.length ? oppMon.types : (oppMon.type || 'Normal')
    }) : { damage: Math.max(8, Math.floor(move.power / 2.5 + playerMon.attack / 2 + Math.random() * 8)), modifier: 1, critical: false };

    const damage = pDmgResult.damage;
    inMapBattle.opponentHp = Math.max(0, inMapBattle.opponentHp - damage);

    const isStatusMove = !move.power || (move.category && move.category === 'estatus');
    if (!isStatusMove) pendingBattleEffect = 'opponent';
    let pLog = isStatusMove
      ? `¡${playerMon.name} usó ${move.name}! (movimiento de estado)`
      : `¡${playerMon.name} usó ${move.name}! Causó ${damage} de daño.`;
    if (!isStatusMove && pDmgResult.modifier > 1) pLog += ' ¡Es muy eficaz!';
    else if (!isStatusMove && pDmgResult.modifier < 1 && pDmgResult.modifier > 0) pLog += ' No es muy eficaz...';
    else if (!isStatusMove && pDmgResult.modifier === 0) pLog += ' No afecta al rival.';
    if (pDmgResult.critical) pLog += ' ¡Un golpe crítico!';
    inMapBattle.logs.unshift(pLog);
    inMapBattle.menuState = 'MAIN';

    // El Pokémon del rival se debilitó: sacar al siguiente de su equipo
    if (inMapBattle.opponentHp <= 0) {
      inMapBattle.logs.unshift(`¡${inMapBattle.opponent.name} rival ha sido debilitado!`);
      if (sendInNextOpponent()) {
        renderView('mundo');
        return;
      }
      finishWinBattle();
      return;
    }

    // Contraataque del oponente
    opponentTurn();
  };

  // ===== Aprendizaje de movimientos al subir de nivel =====
  function offerLevelUpMoves(mon, newLevel) {
    if (!mon || !POKEMON_MOVES_DB || !POKEMON_MOVES_DB.pokemon) return false;
    const dexId = mon.dexId || mon.id;
    if (dexId == null) return false;
    const learnset = POKEMON_MOVES_DB.pokemon[String(dexId)] || [];
    const candidates = learnset
      .filter(e => (e.level || 1) === newLevel)
      .map(buildMoveFromEntry)
      .filter(m => !(mon.moves || []).some(existing => String(existing.id) === String(m.id)));

    if (!candidates.length) return false;

    inMapBattle.pendingLearn = candidates;
    inMapBattle.menuState = 'LEARN';
    inMapBattle.logs.unshift(`¡${mon.name} quiere aprender ${candidates[0].name}!`);
    return true;
  }

  function finishInMapVictory() {
    if (!inMapBattle) return;
    const name = inMapBattle.trainerName || inMapBattle.opponent.name;
    const badge = inMapBattle.badgeName;
    let msg = `¡Victoria épica! ${name} fue derrotado.`;
    if (badge && trainerState.medals.includes(badge)) msg += `\n¡Has conseguido la ${badge}!`;
    alert(msg);
    inMapBattle = null;
    if (worldTileRenderer) worldTileRenderer.avatarState = 'IDLE';
    renderView('mundo');
  }

  App.learnMove = function(candidateIndex, replaceIndex) {
    if (!inMapBattle || !inMapBattle.pendingLearn) return;
    const mon = trainerState.starter;
    if (!mon) return;
    const learnList = inMapBattle.pendingLearn;
    const move = learnList[candidateIndex];
    // Asegurar que existan movimientos (aunque sean fallback)
    if (!Array.isArray(mon.moves) || !mon.moves.length) {
      mon.moves = getMovesForMon(mon, mon.level || trainerState.level || 5).map(m => ({ ...m, currentPp: m.pp, maxPp: m.maxPp }));
    }
    if (replaceIndex != null) {
      const oldMove = mon.moves[replaceIndex];
      mon.moves[replaceIndex] = { ...move, currentPp: move.maxPp, maxPp: move.maxPp };
      if (oldMove) {
        inMapBattle.logs.unshift(`¡${mon.name} olvidó ${oldMove.name} y aprendió ${move.name}!`);
      } else {
        inMapBattle.logs.unshift(`¡${mon.name} aprendió ${move.name}!`);
      }
    } else {
      inMapBattle.logs.unshift(`¡${mon.name} no aprendió ${move.name}!`);
    }
    learnList.splice(candidateIndex, 1);
    if (!learnList.length) {
      inMapBattle.pendingLearn = null;
      inMapBattle.menuState = 'MAIN';
      saveTrainerProgress();
      if (inMapBattle.pendingVictory) {
        inMapBattle.pendingVictory = false;
        setTimeout(finishInMapVictory, 300);
      }
    }
    renderView('mundo');
  };

  App.startIntegratedBattle = function(config, onComplete) {
    const opp = config.opponent || {};
    if (!(opp.moves && Array.isArray(opp.moves) && opp.moves.length)) {
      const level = opp.level || trainerState.level || 5;
      opp.moves = getMovesForMon(opp, level).map(m => ({ ...m, currentPp: m.pp, maxPp: m.maxPp }));
    }
    let team = Array.isArray(config.opponentTeam) ? config.opponentTeam.slice() : [];
    team = team.filter(m => m && m.name && m.level);
    inMapBattle = {
      menuState: 'MAIN',
      trainerId: config.trainerId || null,
      trainerName: config.trainerName || null,
      opponent: opp,
      opponentTeam: team,
      mustSwitch: false,
      badgeName: config.badgeName || null,
      mt: config.mt || null,
      playerHp: config.player?.currentHp || config.player?.hp || trainerState.starter.hp,
      opponentHp: opp?.hp || 60,
      logs: [`¡Comienza el combate contra ${opp.name}!`],
      onComplete: onComplete
    };
    activeDialog = null;
    if (worldTileRenderer) {
      worldTileRenderer.avatarState = 'IN_BATTLE';
    }
    renderView('mundo');
  };

  App.battleThrowBall = function(ballName) {
    if (!inMapBattle || !inMapBattle.opponent.isWild) {
      inMapBattle.logs.unshift('¡Solo puedes capturar Pokémon salvajes!');
      renderView('mundo');
      return;
    }
    const bName = ballName || 'Pokeball';
    pendingBattleEffect = 'throw';
    const DB = (typeof ITEMS_DATABASE !== 'undefined') ? ITEMS_DATABASE : {};
    const ballData = DB[bName] || {};
    const qty = (trainerState.inventory.items || {})[bName] || 0;
    if (qty <= 0) {
      inMapBattle.logs.unshift('¡No te quedan ' + (ballData.nameEs || bName) + '!');
      renderView('mundo');
      return;
    }
    trainerState.inventory.items[bName] = qty - 1;
    const hp_max = inMapBattle.opponent.maxHp || 60;
    const hp_current = inMapBattle.opponentHp;
    const rate_mod = inMapBattle.opponent.catch_rate || 255;
    const catchRateMult = ballData.catchRate || 1.0;
    const a = Math.max((3 * hp_max - 2 * hp_current) * rate_mod * catchRateMult / (3 * hp_max), 1);

    let caught = false;
    if (a >= 255) {
      caught = true;
    } else {
      const b = 1048560 / Math.sqrt(Math.sqrt(16711680 / a));
      caught = true;
      for (let i = 0; i < 4; i++) {
        if (Math.random() * 65535 >= b) { caught = false; break; }
      }
    }

    if (caught) {
      const caughtObj = { ...inMapBattle.opponent, hp: hp_max, currentHp: hp_max };
      trainerState.collection.push(caughtObj);
      saveTrainerProgress();
      inMapBattle.logs.unshift(`¡Gotcha! ¡${inMapBattle.opponent.name} fue capturado!`);
      setTimeout(() => { inMapBattle = null; renderView('mundo'); }, 1500);
      renderView('mundo');
    } else {
      inMapBattle.logs.unshift(`¡Oh no! ¡${inMapBattle.opponent.name} se liberó de la ${ballData.nameEs || bName}!`);
      renderView('mundo');
    }
  };

  // ====== USO GENÉRICO DE OBJETOS EN BATALLA ======
  App.battleUseItem = function(itemName) {
    if (!inMapBattle) return;
    const DB = (typeof ITEMS_DATABASE !== 'undefined') ? ITEMS_DATABASE : {};
    const itemData = DB[itemName];
    if (!itemData) { inMapBattle.logs.unshift('Objeto desconocido.'); renderView('mundo'); return; }

    const qty = (trainerState.inventory.items || {})[itemName] || 0;
    if (qty <= 0) {
      inMapBattle.logs.unshift(`¡No te quedan ${itemData.nameEs || itemName}!`);
      renderView('mundo'); return;
    }

    if (inMapBattle.isPvp) {
      trainerState.inventory.items[itemName] = qty - 1;
      const mon = trainerState.starter;
      const maxHp = mon.hp || 1;
      let hpHealed = 0;
      switch (itemData.effect) {
        case 'heal': hpHealed = itemData.value || 20; break;
        case 'heal_full':
        case 'heal_full_status': hpHealed = maxHp; break;
        case 'revive': hpHealed = Math.floor(maxHp / 2); break;
        case 'revive_full': hpHealed = maxHp; break;
      }
      if (window.MultiplayerClient && window.MultiplayerClient.socket && window.MultiplayerClient.socket.readyState === WebSocket.OPEN) {
        window.MultiplayerClient.socket.send(JSON.stringify({
          action: 'PVP_BATTLE_MOVE',
          battle_id: inMapBattle.pvpBattleId,
          move_index: `ITEM:${itemData.nameEs || itemName}:${hpHealed}`
        }));
        inMapBattle.menuState = 'WAITING_OPPONENT';
        inMapBattle.logs.unshift(`Usaste ${itemData.nameEs || itemName}. Esperando al rival...`);
        renderView('mundo');
      }
      return;
    }
    trainerState.inventory.items[itemName] = qty - 1;
    const mon = trainerState.starter;
    const maxHp = mon.hp || 1;
    let logMsg = `Usaste ${itemData.nameEs || itemName}.`;

    switch (itemData.effect) {
      case 'heal': {
        const restored = Math.min(maxHp - inMapBattle.playerHp, itemData.value || 20);
        inMapBattle.playerHp = Math.min(maxHp, inMapBattle.playerHp + (itemData.value || 20));
        mon.currentHp = inMapBattle.playerHp;
        logMsg = `${itemData.nameEs || itemName}: ¡${mon.name} recuperó ${restored} PS!`;
        break;
      }
      case 'heal_full': {
        const restored2 = maxHp - inMapBattle.playerHp;
        inMapBattle.playerHp = maxHp;
        mon.currentHp = maxHp;
        logMsg = `${itemData.nameEs || itemName}: ¡${mon.name} recuperó todos sus PS!`;
        break;
      }
      case 'heal_full_status': {
        inMapBattle.playerHp = maxHp;
        mon.currentHp = maxHp;
        mon.status = null;
        logMsg = `${itemData.nameEs || itemName}: ¡${mon.name} está totalmente curado!`;
        break;
      }
      case 'revive':
      case 'revive_full': {
        const revHp = itemData.effect === 'revive_full' ? maxHp : Math.floor(maxHp / 2);
        inMapBattle.playerHp = revHp;
        mon.currentHp = revHp;
        logMsg = `${itemData.nameEs || itemName}: ¡${mon.name} ha revivido con ${revHp} PS!`;
        break;
      }
      case 'cure_status': {
        if (mon.status === itemData.status || !itemData.status) {
          mon.status = null;
          logMsg = `${itemData.nameEs || itemName}: ¡${mon.name} se curó del estado alterado!`;
        } else {
          trainerState.inventory.items[itemName] = qty; // revert
          logMsg = `${mon.name} no tiene ese problema de estado.`;
        }
        break;
      }
      case 'cure_all_status': {
        mon.status = null;
        logMsg = `${itemData.nameEs || itemName}: ¡${mon.name} está curado de todos los estados!`;
        break;
      }
      case 'restore_pp': {
        const moves = mon.moves || [];
        if (moves.length > 0) {
          moves[0].currentPp = Math.min((moves[0].maxPp || moves[0].pp), (moves[0].currentPp ?? moves[0].pp) + (itemData.value || 10));
          logMsg = `${itemData.nameEs || itemName}: PP de ${moves[0].name} restaurados.`;
        }
        break;
      }
      case 'restore_pp_full': {
        const moves2 = mon.moves || [];
        if (moves2.length > 0) {
          moves2[0].currentPp = moves2[0].maxPp || moves2[0].pp;
          logMsg = `${itemData.nameEs || itemName}: ¡PP de ${moves2[0].name} al máximo!`;
        }
        break;
      }
      case 'restore_pp_all': {
        (mon.moves || []).forEach(m => { m.currentPp = Math.min(m.maxPp || m.pp, (m.currentPp ?? m.pp) + (itemData.value || 10)); });
        logMsg = `${itemData.nameEs || itemName}: ¡PP de todos los movimientos restaurados!`;
        break;
      }
      case 'restore_pp_all_full': {
        (mon.moves || []).forEach(m => { m.currentPp = m.maxPp || m.pp; });
        logMsg = `${itemData.nameEs || itemName}: ¡Todos los PP al máximo!`;
        break;
      }
      case 'boost_attack':
        inMapBattle.playerAtkBoost = (inMapBattle.playerAtkBoost || 0) + 1;
        logMsg = `${itemData.nameEs || itemName}: ¡ATAQUE de ${mon.name} aumentó!`;
        break;
      case 'boost_defense':
        inMapBattle.playerDefBoost = (inMapBattle.playerDefBoost || 0) + 1;
        logMsg = `${itemData.nameEs || itemName}: ¡DEFENSA de ${mon.name} aumentó!`;
        break;
      case 'boost_speed':
        inMapBattle.playerSpdBoost = (inMapBattle.playerSpdBoost || 0) + 1;
        logMsg = `${itemData.nameEs || itemName}: ¡VELOCIDAD de ${mon.name} aumentó!`;
        break;
      case 'boost_spatk':
        inMapBattle.playerSpAtkBoost = (inMapBattle.playerSpAtkBoost || 0) + 1;
        logMsg = `${itemData.nameEs || itemName}: ¡ATAQUE ESP. de ${mon.name} aumentó!`;
        break;
      case 'boost_crit':
        inMapBattle.playerCritBoost = (inMapBattle.playerCritBoost || 0) + 1;
        logMsg = `${itemData.nameEs || itemName}: ¡${mon.name} tiene ventaja crítica!`;
        break;
      default:
        logMsg = `${itemData.nameEs || itemName}: no tiene efecto en batalla.`;
        trainerState.inventory.items[itemName] = qty; // revert
    }

    inMapBattle.logs.unshift(logMsg);
    // Si curas/revives al activo debilitado, ya no hace falta cambiar
    if (inMapBattle.mustSwitch && inMapBattle.playerHp > 0) {
      inMapBattle.mustSwitch = false;
    }
    inMapBattle.menuState = 'MAIN';
    saveTrainerProgress();
    
    // Consumir el turno: el rival ataca
    if (inMapBattle.opponent) {
      setTimeout(opponentTurn, 350);
    }
    
    renderView('mundo');
  };

  // Compatibilidad legacy
  App.battleUsePotion = function() { App.battleUseItem('Potion'); };

  App.battleFlee = function() {
    if (!inMapBattle) return;
    if (inMapBattle.isPvp) {
      App.pvpForfeit();
      return;
    }
    inMapBattle = null;
    saveTrainerProgress();
    renderView('mundo');
  };

  /* ============================================================
     10. POKÉDEX (ELEGIR CRIATURA — 414 SPRITES ANIMADOS ESMERALDA)
     ============================================================ */
  let dexSearchTerm = '';
  let dexTypeFilter = 'all';
  let dexPage = 1;
  const DEX_PAGE_SIZE = 24;

  function getFilteredDex() {
    let filtered = WILD_POKEMON;
    if (dexSearchTerm) {
      filtered = filtered.filter(p => p.name.toLowerCase().includes(dexSearchTerm.toLowerCase()) || String(p.id) === dexSearchTerm);
    }
    if (dexTypeFilter && dexTypeFilter !== 'all') {
      filtered = filtered.filter(p => p.type.toLowerCase().includes(dexTypeFilter.toLowerCase()));
    }
    return filtered;
  }

  function renderDexPagination(total) {
    const pages = Math.max(1, Math.ceil(total / DEX_PAGE_SIZE));
    dexPage = Math.max(1, Math.min(dexPage, pages));
    const nav = document.getElementById('dexPagination');
    if (!nav) return;
    nav.innerHTML = `
      <button class="btn btn-sm btn-outline" ${dexPage === 1 ? 'disabled' : ''} onclick="App.changeDexPage(${dexPage - 1})">Anterior</button>
      <span style="font-weight:700; color:#1a2244;">Página ${dexPage} de ${pages}</span>
      <button class="btn btn-sm btn-primary" ${dexPage === pages ? 'disabled' : ''} onclick="App.changeDexPage(${dexPage + 1})">Siguiente</button>
    `;
  }

  function isPokemonOwned(pokemon) {
    const dex = Number(pokemon.dexId || pokemon.id);
    return (trainerState.collection || []).some(mon => mon && Number(mon.dexId || mon.id) === dex);
  }

  function dexCard(pokemon) {
    const owned = isPokemonOwned(pokemon);
    return `
      <div class="dex-pokemon" style="display:flex; flex-direction:column; align-items:center; padding:12px; border-radius:14px; background:#fff; box-shadow:0 3px 12px rgba(0,0,0,0.06); border:2px solid ${owned ? '#2ecc71' : '#e1e8ed'};">
        <span style="font-size:0.7rem; color:#888; align-self:flex-start; font-weight:700;">#${String(pokemon.id).padStart(3, '0')}</span>
        <img src="${pokemon.image}" alt="${pokemon.name}" style="height:76px; width:76px; object-fit:contain; image-rendering:pixelated; margin:8px 0;">
        <strong style="font-size:0.92rem; color:#1a2244; margin-bottom:2px;">${pokemon.name}</strong>
        <span class="badge em-type-${(pokemon.type || 'Normal').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}" style="font-size:0.68rem; margin:2px 0 10px; color:#fff;">${pokemon.type.toUpperCase()}</span>
        <div style="display:flex; gap:6px; width:100%;">
          <button class="btn btn-sm btn-outline" style="flex:1; font-size:0.72rem;" onclick="App.openPokedexDetail(${pokemon.id})">Ficha</button>
          <button class="btn btn-sm ${owned ? 'btn-primary' : 'btn-outline'}" style="flex:1; font-size:0.72rem;" onclick="App.selectPokemonAsActive(${pokemon.id})">${owned ? 'Usar' : 'No capturado'}</button>
        </div>
      </div>`;
  }

  function renderDexResults() {
    const filtered = getFilteredDex();
    const grid = document.getElementById('dexPokemonGrid');
    if (grid) {
      const start = (dexPage - 1) * DEX_PAGE_SIZE;
      grid.innerHTML = filtered.slice(start, start + DEX_PAGE_SIZE).map(dexCard).join('') ||
        '<p style="grid-column:1/-1; text-align:center; padding:40px; color:#888;">No se encontraron criaturas coincidentes.</p>';
    }
    renderDexPagination(filtered.length);
  }

  function viewChoosePokemon() {
    const filtered = getFilteredDex();
    const start = (dexPage - 1) * DEX_PAGE_SIZE;
    const cards = filtered.slice(start, start + DEX_PAGE_SIZE).map(dexCard).join('');
    const dexPages = Math.max(1, Math.ceil(filtered.length / DEX_PAGE_SIZE));

    return `
      <div class="choose-pokemon">
        <div class="choose-header" style="background:#fff; border-radius:16px; padding:22px; box-shadow:0 4px 18px rgba(0,0,0,0.06); margin-bottom:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div>
              <span class="eyebrow" style="color:#27ae60; font-weight:700; text-transform:uppercase; font-size:0.75rem;"><i class="fas fa-sparkles"></i> Catálogo Nacional Completo · Gen 1-9</span>
              <h2 style="color:#1a2244; margin:4px 0 6px;">Pokédex Nacional · ${WILD_POKEMON.length} Pokémon (${FULL_CATALOG_LOADED ? 'Stats reales Gen 1-9' : 'Sprites animados WikiDex'})</h2>
              <p style="color:#666; font-size:0.85rem; margin:0;">Todas las generaciones, estadísticas base reales, sprites animados WikiDex (Gen 1-3) y oficiales locales (Gen 4-9).</p>
            </div>
            <button class="btn btn-primary" onclick="renderView('mundo')"><i class="fas fa-gamepad"></i> Regresar al Mapa</button>
          </div>
          <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">
            <input id="dexSearchInput" type="text" placeholder="Buscar por nombre o número..." value="${Validate.escHtml(dexSearchTerm)}" oninput="App.onDexSearch(this.value)" style="flex:1; min-width:220px; padding:10px 14px; border:2px solid #ddd; border-radius:8px; font-size:0.9rem; outline:none;">
            <select id="dexTypeSelect" onchange="App.onDexTypeFilter(this.value)" style="padding:10px 14px; border:2px solid #ddd; border-radius:8px; font-size:0.9rem; background:#fff; outline:none; cursor:pointer;">
              <option value="all" ${dexTypeFilter==='all'?'selected':''}>Todos los Tipos (${WILD_POKEMON.length})</option>
              <option value="Normal" ${dexTypeFilter==='Normal'?'selected':''}>Normal</option>
              <option value="Fuego" ${dexTypeFilter==='Fuego'?'selected':''}>Fuego</option>
              <option value="Agua" ${dexTypeFilter==='Agua'?'selected':''}>Agua</option>
              <option value="Planta" ${dexTypeFilter==='Planta'?'selected':''}>Planta</option>
              <option value="Eléctrico" ${dexTypeFilter==='Eléctrico'?'selected':''}>Eléctrico</option>
              <option value="Hielo" ${dexTypeFilter==='Hielo'?'selected':''}>Hielo</option>
              <option value="Lucha" ${dexTypeFilter==='Lucha'?'selected':''}>Lucha</option>
              <option value="Veneno" ${dexTypeFilter==='Veneno'?'selected':''}>Veneno</option>
              <option value="Tierra" ${dexTypeFilter==='Tierra'?'selected':''}>Tierra</option>
              <option value="Volador" ${dexTypeFilter==='Volador'?'selected':''}>Volador</option>
              <option value="Psíquico" ${dexTypeFilter==='Psíquico'?'selected':''}>Psíquico</option>
              <option value="Bicho" ${dexTypeFilter==='Bicho'?'selected':''}>Bicho</option>
              <option value="Roca" ${dexTypeFilter==='Roca'?'selected':''}>Roca</option>
              <option value="Fantasma" ${dexTypeFilter==='Fantasma'?'selected':''}>Fantasma</option>
              <option value="Dragón" ${dexTypeFilter==='Dragón'?'selected':''}>Dragón</option>
              <option value="Siniestro" ${dexTypeFilter==='Siniestro'?'selected':''}>Siniestro</option>
              <option value="Acero" ${dexTypeFilter==='Acero'?'selected':''}>Acero</option>
              <option value="Hada" ${dexTypeFilter==='Hada'?'selected':''}>Hada</option>
            </select>
          </div>
        </div>
        <div class="dex-grid" id="dexPokemonGrid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(155px, 1fr)); gap:14px;">
          ${cards || '<p style="grid-column:1/-1; text-align:center; padding:40px; color:#888;">No se encontraron criaturas coincidentes.</p>'}
        </div>
        <div id="dexPagination" style="display:flex; justify-content:center; align-items:center; gap:16px; padding:20px 0;">
          <button class="btn btn-sm btn-outline" ${dexPage === 1 ? 'disabled' : ''} onclick="App.changeDexPage(${dexPage - 1})">Anterior</button>
          <span style="font-weight:700; color:#1a2244;">Página ${dexPage} de ${dexPages}</span>
          <button class="btn btn-sm btn-primary" ${dexPage === dexPages ? 'disabled' : ''} onclick="App.changeDexPage(${dexPage + 1})">Siguiente</button>
        </div>
      </div>
    `;
  }

  App.onDexSearch = function(val) {
    dexSearchTerm = val.trim();
    dexPage = 1;
    renderDexResults();
  };

  App.onDexTypeFilter = function(val) {
    dexTypeFilter = val;
    dexPage = 1;
    renderDexResults();
  };

  App.changeDexPage = function(page) {
    dexPage = page;
    renderDexResults();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  App.selectPokemonAsActive = function(id) {
    const mon = WILD_POKEMON.find(p => p.id === id || p.dexId === id);
    if (!mon) return;

    // Solo puedes usar Pokémon que ya forman parte de tu equipo/colección.
    const targetDex = Number(mon.dexId || mon.id);
    const existing = (trainerState.collection || []).find(c =>
      c && Number(c.dexId || c.id) === targetDex
    );
    if (!existing) {
      alert(`Aún no tienes a ${mon.name}. Encuéntralo explorando Hoenn y captúralo en combate.`);
      return;
    }

    trainerState.starter = existing;
    saveTrainerProgress();
    alert(`¡${trainerState.starter.name} (Nv. ${trainerState.starter.level || 1}) es ahora tu Pokémon acompañante activo!`);
    renderView('mundo');
  };

  App.openPokedexDetail = async function(id) {
    const mon = WILD_POKEMON.find(p => p.id === id);
    if (!mon) return;

    // Play cry
    try {
      const cleanName = mon.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const audio = new Audio(`https://play.pokemonshowdown.com/audio/cries/${cleanName}.mp3`);
      audio.volume = 0.5;
      audio.play().catch(e => console.log('Audio autoplay blocked', e));
    } catch(e) {}

    const modalOverlay = dom.modalOverlay;
    const modalBody = dom.modalBody;
    if (!modalOverlay || !modalBody) return;

    const cacheKey = `pkmn_dex_v2_${id}`;
    let enrichedData = null;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) enrichedData = JSON.parse(cached);
    } catch {}

    const hp = enrichedData?.stats?.hp || mon.hp || 50;
    const atk = enrichedData?.stats?.attack || mon.attack || 20;
    const def = enrichedData?.stats?.defense || Math.round(atk * 0.85);
    const spa = enrichedData?.stats?.sp_attack || Math.round(atk * 0.95);
    const spd = enrichedData?.stats?.sp_defense || Math.round(def * 0.95);
    const spe = enrichedData?.stats?.speed || Math.round(30 + (id % 60));
    const bst = enrichedData?.stats?.bst || (hp + atk + def + spa + spd + spe);

    const normalSprite = mon.image;
    const shinySprite = enrichedData?.sprites?.shiny || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${id}.png`;

    const typeName = (mon.type || 'Normal').split('/')[0].trim();
    const typeClass = `type-${typeName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")}`;

    modalBody.innerHTML = `
      <div class="pokedex-detail-modal">
        <div class="pokedex-detail-header">
          <div>
            <span class="dex-num">#${String(id).padStart(3, '0')} · GEN ${mon.generation || 1}</span>
            <h2>${mon.name}</h2>
            <div style="font-size:0.8rem; color:#aaa; margin-top:4px;">
               Región: <strong id="valRegion" style="color:#ecf0f1;">${mon.generation === 1 ? 'Kanto' : mon.generation === 2 ? 'Johto' : 'Hoenn'}</strong>
               | Peso: <strong id="valWeight" style="color:#ecf0f1;">${enrichedData?.weight ? (enrichedData.weight / 10) + ' kg' : '???'}</strong>
            </div>
          </div>
          <span class="type-pill ${typeClass}">${mon.type}</span>
        </div>

        <div class="pokedex-visual-box">
          <div class="sprite-wrapper">
            <img id="detailDexSprite" src="${normalSprite}" alt="${mon.name}">
          </div>

          <div class="shiny-toggle-control">
            <span class="shiny-badge-label"><i class="fas fa-sparkles"></i> MODO SHINY</span>
            <label class="retro-switch" title="Alternar Normal / Shiny">
              <input type="checkbox" id="detailShinyCheckbox" onchange="App.toggleDetailShiny(this.checked, '${normalSprite}', '${shinySprite}')">
              <span class="retro-slider"></span>
            </label>
          </div>
        </div>

        <div class="pokedex-stats-section">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3>Estadísticas Base</h3>
            <span style="font-size:0.78rem; font-weight:700; color:#27ae60;">BST Total: <strong id="valBst">${bst}</strong></span>
          </div>

          <div class="stat-row">
            <span class="stat-name">PS</span>
            <span class="stat-value" id="valHp">${hp}</span>
            <div class="stat-bar-track"><div class="stat-bar-fill hp" id="fillHp" style="width:${Math.min(100, (hp/200)*100)}%;"></div></div>
          </div>
          <div class="stat-row">
            <span class="stat-name">Ataque</span>
            <span class="stat-value" id="valAtk">${atk}</span>
            <div class="stat-bar-track"><div class="stat-bar-fill atk" id="fillAtk" style="width:${Math.min(100, (atk/180)*100)}%;"></div></div>
          </div>
          <div class="stat-row">
            <span class="stat-name">Defensa</span>
            <span class="stat-value" id="valDef">${def}</span>
            <div class="stat-bar-track"><div class="stat-bar-fill def" id="fillDef" style="width:${Math.min(100, (def/180)*100)}%;"></div></div>
          </div>
          <div class="stat-row">
            <span class="stat-name">Atq. Esp.</span>
            <span class="stat-value" id="valSpa">${spa}</span>
            <div class="stat-bar-track"><div class="stat-bar-fill spa" id="fillSpa" style="width:${Math.min(100, (spa/180)*100)}%;"></div></div>
          </div>
          <div class="stat-row">
            <span class="stat-name">Def. Esp.</span>
            <span class="stat-value" id="valSpd">${spd}</span>
            <div class="stat-bar-track"><div class="stat-bar-fill spd" id="fillSpd" style="width:${Math.min(100, (spd/180)*100)}%;"></div></div>
          </div>
          <div class="stat-row">
            <span class="stat-name">Velocidad</span>
            <span class="stat-value" id="valSpe">${spe}</span>
            <div class="stat-bar-track"><div class="stat-bar-fill spe" id="fillSpe" style="width:${Math.min(100, (spe/180)*100)}%;"></div></div>
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-top:8px;">
          <button class="btn btn-primary" style="flex:1; justify-content:center;" onclick="App.selectPokemonAsActive(${mon.id}); App.closeModal();">
            <i class="fas fa-check"></i> Elegir como Compañero
          </button>
        </div>
      </div>
    `;

    modalOverlay.style.display = 'flex';
    modalOverlay.classList.add('active');
    modalOverlay.classList.add('open');

    // Enriquecimiento asíncrono vía PokeAPI
    if (!enrichedData && id <= 386) {
      try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
        if (res.ok) {
          const apiMon = await res.json();
          const pStats = apiMon.stats || [];
          const newHp = pStats[0]?.base_stat || hp;
          const newAtk = pStats[1]?.base_stat || atk;
          const newDef = pStats[2]?.base_stat || def;
          const newSpa = pStats[3]?.base_stat || spa;
          const newSpd = pStats[4]?.base_stat || spd;
          const newSpe = pStats[5]?.base_stat || spe;
          const newBst = newHp + newAtk + newDef + newSpa + newSpd + newSpe;
          const newShiny = apiMon.sprites?.front_shiny || shinySprite;
          const newWeight = apiMon.weight || 0;

          const toSave = {
            stats: { hp: newHp, attack: newAtk, defense: newDef, sp_attack: newSpa, sp_defense: newSpd, speed: newSpe, bst: newBst },
            sprites: { shiny: newShiny },
            weight: newWeight
          };
          localStorage.setItem(cacheKey, JSON.stringify(toSave));

          const elHp = $('valHp'), elAtk = $('valAtk'), elDef = $('valDef'), elSpa = $('valSpa'), elSpd = $('valSpd'), elSpe = $('valSpe'), elBst = $('valBst');
          if (elHp) elHp.textContent = newHp;
          if (elAtk) elAtk.textContent = newAtk;
          if (elDef) elDef.textContent = newDef;
          if (elSpa) elSpa.textContent = newSpa;
          if (elSpd) elSpd.textContent = newSpd;
          if (elSpe) elSpe.textContent = newSpe;
          if (elBst) elBst.textContent = newBst;

          const fHp = $('fillHp'), fAtk = $('fillAtk'), fDef = $('fillDef'), fSpa = $('fillSpa'), fSpd = $('fillSpd'), fSpe = $('fillSpe');
          if (fHp) fHp.style.width = `${Math.min(100, (newHp/200)*100)}%`;
          if (fAtk) fAtk.style.width = `${Math.min(100, (newAtk/180)*100)}%`;
          if (fDef) fDef.style.width = `${Math.min(100, (newDef/180)*100)}%`;
          if (fSpa) fSpa.style.width = `${Math.min(100, (newSpa/180)*100)}%`;
          if (fSpd) fSpd.style.width = `${Math.min(100, (newSpd/180)*100)}%`;
          if (fSpe) fSpe.style.width = `${Math.min(100, (newSpe/180)*100)}%`;

          if (document.getElementById('valWeight') && newWeight > 0) {
            document.getElementById('valWeight').innerText = (newWeight / 10) + ' kg';
          }
        }
      } catch (e) {}
    }
  };

  App.toggleDetailShiny = function(isShiny, normalUrl, shinyUrl) {
    const img = document.getElementById('detailDexSprite');
    if (!img) return;
    img.style.opacity = '0';
    setTimeout(() => {
      img.src = isShiny ? shinyUrl : normalUrl;
      img.style.opacity = '1';
    }, 150);
  };

  App.closeModal = function() {
    if (dom.modalOverlay) {
      dom.modalOverlay.style.display = 'none';
      dom.modalOverlay.classList.remove('active');
      dom.modalOverlay.classList.remove('open');
    }
  };



  /* ============================================================
     12. MOCHILA E INVENTARIO
     ============================================================ */
  const BAG_CATEGORIES = [
    { key: 'all',        label: '🎒 Todo',       filter: () => true },
    { key: 'medicine',   label: '💊 Medicina',    filter: d => d.category === 'medicine' },
    { key: 'pokeball',   label: '⚪ Balls',       filter: d => d.type === 'pokeball' },
    { key: 'berry',      label: '🍇 Bayas',       filter: d => d.category === 'berry' },
    { key: 'battle',     label: '⚔️ Batalla',     filter: d => d.category === 'battle_item' },
    { key: 'evolution',  label: '✨ Evolución',   filter: d => d.category === 'evolution' },
    { key: 'treasure',   label: '💎 Tesoros',     filter: d => d.category === 'treasure' },
    { key: 'key',        label: '🔑 Clave',       filter: d => d.category === 'key' },
  ];
  let activeBagTab = 'all';

  function viewBackpack() {
    const DB = (typeof ITEMS_DATABASE !== 'undefined') ? ITEMS_DATABASE : {};
    const items = Object.entries(trainerState.inventory.items || {})
      .filter(([, qty]) => qty > 0);

    const catTab = BAG_CATEGORIES.find(c => c.key === activeBagTab) || BAG_CATEGORIES[0];

    const tabs = BAG_CATEGORIES.map(cat => {
      const hasItems = items.some(([name]) => cat.filter(DB[name] || {}));
      return `<button class="bag-tab ${activeBagTab === cat.key ? 'active' : ''}" onclick="App.setBagTab('${cat.key}')">${cat.label}</button>`;
    }).join('');

    const filteredItems = items.filter(([name]) => catTab.filter(DB[name] || {}));

    const itemCards = filteredItems.map(([name, qty]) => {
      const d = DB[name] || {};
      const spriteUrl = d.sprite || '';
      const spriteHtml = spriteUrl
        ? `<img src="${spriteUrl}" alt="${name}" class="bag-item-sprite" onerror="this.style.display='none'">`
        : `<div class="bag-item-sprite-fallback"><i class="fas fa-question"></i></div>`;
      const usableOutside = ['heal','heal_full','heal_full_status','cure_status','cure_all_status',
        'restore_pp','restore_pp_full','restore_pp_all','restore_pp_all_full',
        'ev_attack','ev_defense','ev_hp','ev_speed','ev_spatk','ev_spdef'].includes(d.effect);
      const isSellable = d.category === 'treasure' && d.sellPrice > 0;
      const useBtn = usableOutside
        ? `<button class="btn btn-sm btn-primary" onclick="App.useItemField('${name}')"><i class="fas fa-hand-paper"></i> Usar</button>`
        : '';
      const sellBtn = isSellable
        ? `<button class="btn btn-sm" style="background:#e67e22;color:#fff;" onclick="App.sellItem('${name}')"><i class="fas fa-coins"></i> Vender</button>`
        : '';
      return `
        <div class="bag-item-card">
          <div class="bag-item-header">
            ${spriteHtml}
            <div class="bag-item-info">
              <strong>${Validate.escHtml(d.nameEs || name)}</strong>
              <span class="bag-item-count">x${qty}</span>
            </div>
          </div>
          <p class="bag-item-desc">${Validate.escHtml(d.description || '')}</p>
          <div class="bag-item-actions">
            ${useBtn}
            ${sellBtn}
          </div>
        </div>
      `;
    }).join('');

    const totalItems = items.reduce((sum, [, qty]) => sum + qty, 0);

    return `
      <div class="bag-view" style="max-width:900px; margin:0 auto;">
        <div class="card-header" style="display:flex; align-items:center; justify-content:space-between; padding:16px 20px; background:linear-gradient(135deg,#1a4a2e,#0d2818); border-radius:16px 16px 0 0; border:2px solid #2ecc71;">
          <div>
            <span class="eyebrow" style="color:#7bed9f;">Inventario de Entrenador</span>
            <h2 style="color:#fff; margin:0;">🎒 Mochila Pokémon</h2>
            <button class="btn btn-sm btn-outline" onclick="LobbyManager.openHMMenu()" style="margin-top:6px; color:#2ecc71; border-color:#2ecc71;">
              <i class="fas fa-compact-disc"></i> Máquinas Ocultas (MO) de Hoenn
            </button>
          </div>
          <div style="text-align:right;">
            <strong style="font-size:1.1rem; color:#f1c40f;"><i class="fas fa-coins"></i> ${trainerState.inventory.coins}</strong><br>
            <small style="color:#b7e4c7;">${totalItems} objeto${totalItems !== 1 ? 's' : ''}</small>
          </div>
        </div>
        <div style="background:#0d1f17; border:2px solid #2ecc71; border-top:none; padding:16px; border-radius:0 0 16px 16px;">
          <div class="bag-tabs">${tabs}</div>
          <div class="bag-items-grid">
            ${filteredItems.length > 0 ? itemCards : '<div style="padding:32px; text-align:center; color:#7bed9f; opacity:0.6;"><i class="fas fa-box-open" style="font-size:2.5rem; margin-bottom:12px; display:block;"></i><p>No tienes objetos en esta categoría</p></div>'}
          </div>
        </div>
        <div style="margin-top:16px; display:flex; gap:10px; justify-content:flex-end;">
          <button class="btn btn-primary" onclick="renderView('mundo')"><i class="fas fa-gamepad"></i> Regresar al Mapa</button>
        </div>
      </div>
    `;
  }

  App.setBagTab = function(tab) {
    activeBagTab = tab;
    renderView('mochila');
  };

  App.useItemField = function(itemName) {
    const DB = (typeof ITEMS_DATABASE !== 'undefined') ? ITEMS_DATABASE : {};
    const itemData = DB[itemName];
    if (!itemData) return;
    const qty = (trainerState.inventory.items || {})[itemName] || 0;
    if (qty <= 0) return;

    const mon = trainerState.starter;
    if (!mon) { alert('No tienes un Pokémon activo.'); return; }
    const maxHp = mon.hp || 1;
    let logMsg = '';

    switch (itemData.effect) {
      case 'heal': {
        if (mon.currentHp >= maxHp) { alert(`¡${mon.name} ya tiene los PS llenos!`); return; }
        const restored = Math.min(maxHp - (mon.currentHp || maxHp), itemData.value || 20);
        mon.currentHp = Math.min(maxHp, (mon.currentHp || maxHp) + (itemData.value || 20));
        logMsg = `¡${mon.name} recuperó ${restored} PS con ${itemData.nameEs || itemName}!`;
        break;
      }
      case 'heal_full':
        mon.currentHp = maxHp;
        logMsg = `¡${mon.name} recuperó todos sus PS!`;
        break;
      case 'heal_full_status':
        mon.currentHp = maxHp;
        mon.status = null;
        logMsg = `¡${mon.name} está completamente curado!`;
        break;
      case 'cure_status':
        if (mon.status) { mon.status = null; logMsg = `¡${mon.name} se curó del estado alterado!`; }
        else { alert(`${mon.name} no tiene ningún estado alterado.`); return; }
        break;
      case 'cure_all_status':
        mon.status = null;
        logMsg = `¡${mon.name} curado de todos los estados!`;
        break;
      case 'restore_pp':
      case 'restore_pp_full':
      case 'restore_pp_all':
      case 'restore_pp_all_full': {
        const moves = mon.moves || [];
        if (itemData.effect.includes('all')) {
          moves.forEach(m => { m.currentPp = m.maxPp || m.pp; });
          logMsg = `¡Todos los PP de ${mon.name} restaurados!`;
        } else if (moves.length > 0) {
          moves[0].currentPp = itemData.effect === 'restore_pp_full' ? (moves[0].maxPp || moves[0].pp) : Math.min(moves[0].maxPp || moves[0].pp, (moves[0].currentPp ?? moves[0].pp) + 10);
          logMsg = `PP de ${moves[0].name} restaurados.`;
        }
        break;
      }
      default:
        alert(`${itemData.nameEs || itemName} no se puede usar fuera de batalla de esta forma.`);
        return;
    }
    trainerState.inventory.items[itemName] = qty - 1;
    saveTrainerProgress();
    alert(logMsg);
    renderView('mochila');
  };

  App.sellItem = function(itemName) {
    const DB = (typeof ITEMS_DATABASE !== 'undefined') ? ITEMS_DATABASE : {};
    const itemData = DB[itemName];
    if (!itemData || !itemData.sellPrice) return;
    const qty = (trainerState.inventory.items || {})[itemName] || 0;
    if (qty <= 0) return;
    if (!confirm(`¿Vender ${itemData.nameEs || itemName} por ${itemData.sellPrice} monedas?`)) return;
    trainerState.inventory.items[itemName] = qty - 1;
    trainerState.inventory.coins += itemData.sellPrice;
    saveTrainerProgress();
    renderView('mochila');
  };

  /* ============================================================
     12. ESTADÍSTICAS Y AJUSTES
     ============================================================ */
  function viewDashboard() {
    const active = trainerState.starter || {};
    const team = Array.isArray(trainerState.collection) ? trainerState.collection : [];
    const level = active.level || 5;
    const xp = Number(active.xp) || 0;
    const nextXp = window.PokemonProgress ? window.PokemonProgress.xpForLevel(level + 1) : Math.pow(level + 1, 3);
    const currentXp = window.PokemonProgress ? window.PokemonProgress.xpForLevel(level) : Math.pow(level, 3);
    const progress = level >= 100 ? 100 : Math.max(0, Math.min(100, Math.round(((xp - currentXp) / Math.max(1, nextXp - currentXp)) * 100)));
    const teamRows = team.map(mon => `
      <li style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #eee;">
        <span>${mon === active ? '⭐ ' : ''}<strong>${Validate.escHtml(mon.name || 'Pokémon')}</strong></span>
        <span>Nv. ${mon.level || 1} · PS ${mon.currentHp ?? mon.maxHp}/${mon.maxHp ?? mon.hp}</span>
      </li>`).join('');

    return `
      <div class="stats-grid">
        <div class="stat-card"><i class="fas fa-star" style="color:#f1c40f;"></i><div class="stat-info"><h4>Nivel del Compañero</h4><span>${level}</span></div></div>
        <div class="stat-card"><i class="fas fa-paw" style="color:#2ecc71;"></i><div class="stat-info"><h4>Criaturas en Equipo</h4><span>${team.length}</span></div></div>
        <div class="stat-card"><i class="fas fa-medal" style="color:#e67e22;"></i><div class="stat-info"><h4>Medallas Conquistadas</h4><span>${trainerState.medals.length}</span></div></div>
        <div class="stat-card"><i class="fas fa-map" style="color:#3498db;"></i><div class="stat-info"><h4>Ciudades Descubiertas</h4><span>${trainerState.visitedTowns.length}</span></div></div>
      </div>
      <div class="card" style="margin-top:20px;">
        <div class="card-header"><h3>🎮 Perfil de Aventura</h3></div>
        <p>Entrenador activo: <strong>${Validate.escHtml(currentUser?.username || 'Brendan')}</strong>.</p>
        <p>Pueblo de origen: <strong>Villa Raíz (Littleroot Town)</strong>.</p>
        <p>Compañero activo: <strong>${Validate.escHtml(active.name || '—')} (Nv. ${level})</strong> · XP ${xp} / ${nextXp}.</p>
        <div style="height:10px; background:#e5e7eb; border-radius:6px; overflow:hidden; margin:8px 0 18px;">
          <div style="height:100%; width:${progress}%; background:linear-gradient(90deg,#27ae60,#2ecc71);"></div>
        </div>
        ${teamRows ? `<h4 style="margin-bottom:6px;">Equipo</h4><ul style="list-style:none; padding:0; margin:0;">${teamRows}</ul>` : ''}
        <div style="margin-top:16px;">
          <button class="btn btn-primary" onclick="renderView('mundo')"><i class="fas fa-gamepad"></i> Continuar Exploración</button>
        </div>
      </div>
    `;
  }

  function viewUsuarios() {
    return `
      <div class="card" style="max-width:600px; margin:0 auto;">
        <div class="card-header"><h3>⚙️ Opciones de Juego</h3></div>
        <p>Puedes reiniciar el progreso de partida local y volver a la configuración inicial.</p>
        <div style="margin-top:20px;">
          <button class="btn btn-danger" onclick="App.resetSaveData()"><i class="fas fa-undo"></i> Reiniciar Partida Guardada</button>
        </div>
      </div>
    `;
  }

  App.resetSaveData = function() {
    if (!confirm('¿Deseas reiniciar tu progreso en Hoenn? Volverás a aparecer en Villa Raíz con un Pokémon inicial nuevo.')) return;

    // Guarda pendiente fuera: si el temporizador se dispara después, reescribiría la partida borrada.
    clearTimeout(saveTimer);
    try {
      localStorage.removeItem(trainerStorageKey());
      sessionStorage.removeItem(trainerStorageKey());
      sessionStorage.removeItem('hoennTrainer_guest');
    } catch { /* almacenamiento bloqueado */ }

    trainerState = createBaseTrainerState();
    window.trainerState = trainerState;
    activeMapKey = 'littleroot_town';
    playerPos = { x: 230, y: 240, dir: 'down', moving: false };

    loadTrainerState();
    saveTrainerProgress();
    renderView('mundo');
  };

  /* ============================================================
     13. ROUTER Y MENÚ POR ROL (SALA UNIÓN MMO + AVENTURA HOENN)
     ============================================================ */
  const MENU_ITEMS = [
    { id: 'mundo',     label: 'Aventura Hoenn', icon: 'fa-gamepad',         roles: ['entrenador', 'administrador'] },
    { id: 'lobby',     label: 'Sala Unión MMO', icon: 'fa-hotel',           roles: ['entrenador', 'administrador'] },
    { id: 'elegir',    label: 'Pokédex',        icon: 'fa-paw',             roles: ['entrenador', 'administrador'] },
    { id: 'mochila',   label: 'Mochila',        icon: 'fa-backpack',        roles: ['entrenador', 'administrador'] },
    { id: 'dashboard', label: 'Estadísticas',   icon: 'fa-chart-pie',       roles: ['administrador', 'entrenador'] },
    { id: 'usuarios',  label: 'Ajustes',        icon: 'fa-users-cog',       roles: ['administrador'] }
  ];

  const VIEW_TITLES = {
    mundo:     'Región Hoenn · Aventura RPG',
    lobby:     'Sala Unión MMO · Lobby Multijugador (Estilo Habbo 2D)',
    elegir:    'Pokédex Hoenn',
    mochila:   'Mochila completa',
    dashboard: 'Estadísticas del Entrenador',
    usuarios:  'Configuración'
  };

  function buildMenu() {
    if (!currentUser) return;
    const items = MENU_ITEMS.filter(m => m.roles.includes(currentUser.rol));
    dom.menuContainer.innerHTML = items.map(m => `
      <div class="menu-item ${m.id === currentView ? 'active' : ''}" data-view="${m.id}" role="button" tabindex="0">
        <i class="fas ${Validate.escHtml(m.icon)}"></i>
        <span>${Validate.escHtml(m.label)}</span>
      </div>
    `).join('');

    dom.menuContainer.querySelectorAll('.menu-item').forEach(el => {
      el.addEventListener('click', () => {
        renderView(el.dataset.view);
        if (window.innerWidth < 820) dom.sidebar.classList.remove('open');
      });
    });
  }

  function renderView(viewId) {
    if (!currentUser) { showLogin(); return; }
    if (viewId === 'lobby') {
      activeMapKey = 'grand_hotel_lobby';
      playerPos = { x: 400, y: 560, dir: 'up', moving: false };
      currentView = 'lobby';
    } else {
      currentView = viewId;
    }

    dom.viewTitle.textContent = VIEW_TITLES[currentView] || 'Hoenn RPG';
    dom.roleBadge.textContent = currentUser.rol ? currentUser.rol.toUpperCase() : 'ENTRENADOR';

    dom.menuContainer.querySelectorAll('.menu-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === currentView);
    });

    const views = {
      mundo: viewWorld,
      lobby: viewWorld,
      elegir: viewChoosePokemon,
      mochila: viewBackpack,
      dashboard: viewDashboard,
      usuarios: viewUsuarios
    };

    const renderer = views[currentView] || viewWorld;
    destroyWorld3D();
    dom.pageContent.innerHTML = `<div class="fade-in">${renderer()}</div>`;

    if (currentView === 'mundo' || currentView === 'lobby') {
      initWorldCanvas();
    } else {
      if (worldTileRenderer) {
        worldTileRenderer.destroy();
        worldTileRenderer = null;
      }
    }
  }

  App.sendLobbyChat = function() {
    const input = document.getElementById('lobbyChatInput');
    if (!input) return;
    const text = (input.value || '').trim();
    if (text && window.LobbyManager) {
      window.LobbyManager.sendChatMessage(text, 'ROOM');
      input.value = '';
    }
  };

  /* ============================================================
     14. LOGIN Y SESIÓN
     ============================================================ */
  function showLogin() {
    dom.sidebar.style.display = 'none';
    dom.pageContent.innerHTML = `
      <div class="card" style="max-width:460px; margin:50px auto; padding:32px 24px; text-align:center; border:3px solid #27ae60; border-radius:20px; box-shadow: 0 10px 30px rgba(0,0,0,0.15);">
        <div class="brendan-login-preview dir-down"></div>
        <h2 style="color:#1a2244; margin-bottom:6px;">PokéTrainer · Aventura Hoenn</h2>
        <p style="color:#555; font-size:0.85rem; margin-bottom:18px;">
          Conéctate como <strong>Brendan (Protagonista de Pokémon Esmeralda)</strong> para explorar Villa Raíz, combatir líderes y coleccionar las criaturas de la región.
        </p>
        <form id="startAdventureForm">
          <input id="playerNameInput" type="text" placeholder="Nombre de Entrenador" value="Brendan" required style="width:100%; padding:11px; border-radius:8px; border:2px solid #27ae60; font-size:1rem; margin-bottom:16px; text-align:center; font-weight:600;">
          <button type="submit" class="btn btn-primary" style="width:100%; padding:13px; font-size:1rem; justify-content:center;">
            <i class="fas fa-play"></i> Iniciar Aventura en Villa Raíz
          </button>
        </form>
      </div>
    `;

    $('startAdventureForm').addEventListener('submit', e => {
      e.preventDefault();
      const name = ($('playerNameInput').value || 'Brendan').trim();
      currentUser = {
        username: name,
        email: `${name.toLowerCase()}@hoenn.pkm`,
        rol: 'entrenador'
      };
      window.currentUser = currentUser;
      sessionStorage.setItem('hoennUser', JSON.stringify(currentUser));
      loadTrainerState();
      dom.sidebar.style.display = '';
      dom.userNameDisplay.textContent = currentUser.username;
      dom.userRoleDisplay.textContent = 'Entrenador';
      buildMenu();

      if (window.GameClient) {
        window.GameClient.checkHealth().then(online => {
          if (online) window.GameClient.registerPlayer(name, 2);
        }).catch(() => {});
      }
      if (window.MultiplayerClient) {
        window.MultiplayerClient.connect(name.toLowerCase(), name);
      }

      renderView('mundo');
    });
  }

  function doLogout() {
    // Guarda la partida antes de perder currentUser (la clave de guardado depende del usuario).
    clearTimeout(saveTimer);
    saveTrainerProgress();
    currentUser = null;
    window.currentUser = null;
    sessionStorage.removeItem('hoennUser');
    sessionStorage.removeItem('hoennTrainerToken');
    localStorage.removeItem(KEY_STORE);
    localStorage.removeItem('pokepoke_user');
    if (worldTileRenderer) {
      worldTileRenderer.destroy();
      worldTileRenderer = null;
    }

    // Limpia el estado en memoria para que no se muestre la partida anterior.
    trainerState = createBaseTrainerState();
    window.trainerState = trainerState;
    activeMapKey = 'littleroot_town';
    playerPos = { x: 230, y: 240, dir: 'down', moving: false };
    inMapBattle = null;
    activeDialog = null;

    showLogin();
  }

  /* ============================================================
     15. EVENTOS GLOBALES DE TECLADO Y MODALES
     ============================================================ */
  $('logoutBtn').addEventListener('click', doLogout);
  $('hamburgerBtn').addEventListener('click', () => dom.sidebar.classList.toggle('open'));

  dom.modalCloseBtn?.addEventListener('click', App.closeModal);
  dom.modalOverlay?.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) App.closeModal();
  });

  document.addEventListener('keydown', e => {
    if (currentView !== 'mundo' || !currentUser) return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    const moves = {
      w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0],
      W: [0, -1], A: [-1, 0], S: [0, 1], D: [1, 0],
      ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowRight: [1, 0]
    };

    if (moves[e.key]) {
      e.preventDefault();
      App.movePlayer(...moves[e.key]);
    } else if (e.key === 'e' || e.key === 'E' || e.code === 'KeyE' || e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      if (activeDialog) {
        App.closeDialog();
      } else {
        App.interactNear();
      }
    }
  });

  /* ============================================================
     16. INICIALIZACIÓN
     ============================================================ */

  // Recibe la sesión autenticada del módulo AuthScreen y arranca el juego
  window.onPlayerAuthenticated = function (session) {
    const username = session.username || 'Entrenador';
    const token    = session.token    || null;

    currentUser = {
      username,
      email: session.player?.name || '',
      rol:   'entrenador',
      token
    };
    window.currentUser = currentUser;
    sessionStorage.setItem('hoennUser', JSON.stringify(currentUser));

    // Propagar token al GameClient
    if (window.GameClient) window.GameClient.token = token;

    // Elección de inicial hecha en el registro (ids 1-3 del backend).
    const chosenStarterId = Number(session.player && session.player.team && session.player.team[0] && session.player.team[0].id);
    if ([1, 2, 3].includes(chosenStarterId)) window.__chosenStarterId = chosenStarterId;

    // Restaura la partida guardada (mapa, posición, equipo y niveles).
    // loadTrainerState solo sobrescribe mapa/posición si hay datos válidos guardados.
    loadTrainerState();

    dom.sidebar.style.display = '';
    dom.userNameDisplay.textContent = username;
    dom.userRoleDisplay.textContent = session.isGuest ? 'Invitado' : 'Entrenador';
    buildMenu();

    // Intentar registrar en el backend legacy también (backward compat)
    if (window.GameClient && !session.isGuest) {
      window.GameClient.checkHealth().then(online => {
        if (online && !token) window.GameClient.registerPlayer(username, 2);
      }).catch(() => {});
    }

    // Conectar al WebSocket del lobby con token auténtico
    if (window.MultiplayerClient) {
      const wsToken = token || null;
      const wsId    = username.toLowerCase();
      window.MultiplayerClient.connect(wsId, username, wsToken);

      // Enviar la posición inicial apenas el socket esté abierto
      const checkWs = setInterval(() => {
        if (window.MultiplayerClient.socket && window.MultiplayerClient.socket.readyState === 1) {
          window.MultiplayerClient.sendPosition(playerPos.x, playerPos.y, playerPos.dir, activeMapKey);
          clearInterval(checkWs);
        }
      }, 200);
    }

    renderView('mundo');
  };

  // Mostrar la pantalla de auth — si ya hay sesión válida la omite automáticamente
  if (window.AuthScreen) {
    AuthScreen.init();
  } else {
    // Fallback si auth_screen.js no cargó
    window.onPlayerAuthenticated({
      username: 'Brendan',
      token: sessionStorage.getItem('hoennTrainerToken') || null,
      isGuest: true
    });
  }

})();
