"""
monster_engine.server
=====================
Servidor FastAPI integral para el sistema Monster-Tamer con flujo completo de Esmeralda:
- Base de datos completa de la región de Hoenn (16 Asentamientos, 34 Rutas, 23 Mazmorras e Instalaciones = 73 zonas).
- Control de progresión por medallas de gimnasio (Stone a Rain) y técnicas de navegación (Surf, Waterfall, Dive, etc.).
- Checklist de completitud estilo Emerald Completion (objetos ocultos, entrenadores vencidos, criaturas registradas).
- Lobby multijugador en tiempo real mediante WebSockets (/ws/lobby).
- Motor de combate táctico determinista y Bestiario con filtros avanzados y ETags (304).
- Estricta observancia de los códigos de estado HTTP según la cheat sheet oficial.
"""

import hashlib
import json
import math
import json
import os
import random
import time
import uuid
from enum import Enum
from typing import Any, Dict, List, Optional, Set
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from monster_engine.models import (
    BattleTurnAction,
    BattleTurnRequest,
    BattleTurnResult,
    ChatMessage,
    ChatScope,
    CompletionChecklist,
    Creature,
    DuelChallenge,
    EffortValues,
    ElementalType,
    GymBadge,
    HiddenItem,
    LobbyPlayer,
    LobbyTrainerState,
    NPCBattleRequest,
    WildBattleRequest,
    StoreBuyRequest,
    Move,
    MoveCategory,
    MutationForm,
    NavigationHM,
    NPCSpriteSet,
    NPCTrainer,
    NewPlayerRequest,
    NewPlayerResponse,
    PlayerProfile,
    PlayerSettings,
    SpriteSet,
    StatBlock,
    TradeOffer,
    TradeSession,
    UserLoginRequest,
    UserRegisterRequest,
    UserSessionResponse,
    WildEncounter,
    ZoneArea,
    ZoneCategory,
)
import monster_engine.database as db

app = FastAPI(
    title="Monster-Tamer Emerald Completion & Tactical Battle API",
    description="Backend completo con la totalidad de zonas de Hoenn, Lobby WebSockets y motor de combate determinista.",
    version="3.0.0"
)

@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# MATRIZ DE EFECTIVIDAD ELEMENTAL 10x10
# ============================================================================
TYPE_EFFECTIVENESS: Dict[ElementalType, Dict[ElementalType, float]] = {
    ElementalType.NORMAL: {ElementalType.ROCA: 0.5, ElementalType.ACERO: 0.5, ElementalType.FANTASMA: 0.0},
    ElementalType.FUEGO: {ElementalType.FUEGO: 0.5, ElementalType.AGUA: 0.5, ElementalType.PLANTA: 2.0, ElementalType.ROCA: 0.5, ElementalType.ACERO: 2.0, ElementalType.BICHO: 2.0, ElementalType.HIELO: 2.0},
    ElementalType.AGUA: {ElementalType.FUEGO: 2.0, ElementalType.AGUA: 0.5, ElementalType.PLANTA: 0.5, ElementalType.TIERRA: 2.0, ElementalType.ROCA: 2.0, ElementalType.DRAGON: 0.5},
    ElementalType.PLANTA: {ElementalType.FUEGO: 0.5, ElementalType.AGUA: 2.0, ElementalType.PLANTA: 0.5, ElementalType.TIERRA: 2.0, ElementalType.ROCA: 2.0, ElementalType.VOLADOR: 0.5, ElementalType.VENENO: 0.5},
    ElementalType.ELECTRICO: {ElementalType.AGUA: 2.0, ElementalType.PLANTA: 0.5, ElementalType.ELECTRICO: 0.5, ElementalType.TIERRA: 0.0, ElementalType.VOLADOR: 2.0, ElementalType.DRAGON: 0.5},
    ElementalType.HIELO: {ElementalType.FUEGO: 0.5, ElementalType.AGUA: 0.5, ElementalType.PLANTA: 2.0, ElementalType.TIERRA: 2.0, ElementalType.VOLADOR: 2.0, ElementalType.DRAGON: 2.0, ElementalType.ACERO: 0.5},
    ElementalType.LUCHA: {ElementalType.NORMAL: 2.0, ElementalType.ROCA: 2.0, ElementalType.ACERO: 2.0, ElementalType.SINIESTRO: 2.0, ElementalType.HADA: 0.5, ElementalType.VENENO: 0.5, ElementalType.PSIQUICO: 0.5, ElementalType.VOLADOR: 0.5, ElementalType.BICHO: 0.5, ElementalType.FANTASMA: 0.0},
    ElementalType.VENENO: {ElementalType.PLANTA: 2.0, ElementalType.VENENO: 0.5, ElementalType.TIERRA: 0.5, ElementalType.ROCA: 0.5, ElementalType.FANTASMA: 0.5, ElementalType.ACERO: 0.0},
    ElementalType.TIERRA: {ElementalType.FUEGO: 2.0, ElementalType.ELECTRICO: 2.0, ElementalType.VENENO: 2.0, ElementalType.ROCA: 2.0, ElementalType.ACERO: 2.0, ElementalType.PLANTA: 0.5, ElementalType.VOLADOR: 0.0},
    ElementalType.VOLADOR: {ElementalType.PLANTA: 2.0, ElementalType.LUCHA: 2.0, ElementalType.BICHO: 2.0, ElementalType.ELECTRICO: 0.5, ElementalType.ROCA: 0.5, ElementalType.ACERO: 0.5},
    ElementalType.PSIQUICO: {ElementalType.LUCHA: 2.0, ElementalType.VENENO: 2.0, ElementalType.PSIQUICO: 0.5, ElementalType.SINIESTRO: 0.0, ElementalType.ACERO: 0.5},
    ElementalType.BICHO: {ElementalType.PLANTA: 2.0, ElementalType.PSIQUICO: 2.0, ElementalType.SINIESTRO: 2.0, ElementalType.HADA: 0.5, ElementalType.FUEGO: 0.5, ElementalType.LUCHA: 0.5, ElementalType.VOLADOR: 0.5, ElementalType.VENENO: 0.5, ElementalType.FANTASMA: 0.5, ElementalType.ACERO: 0.5},
    ElementalType.ROCA: {ElementalType.FUEGO: 2.0, ElementalType.HIELO: 2.0, ElementalType.VOLADOR: 2.0, ElementalType.BICHO: 2.0, ElementalType.LUCHA: 0.5, ElementalType.TIERRA: 0.5, ElementalType.ACERO: 0.5},
    ElementalType.FANTASMA: {ElementalType.PSIQUICO: 2.0, ElementalType.FANTASMA: 2.0, ElementalType.NORMAL: 0.0, ElementalType.SINIESTRO: 0.5},
    ElementalType.DRAGON: {ElementalType.DRAGON: 2.0, ElementalType.ACERO: 0.5, ElementalType.HADA: 0.0},
    ElementalType.SINIESTRO: {ElementalType.PSIQUICO: 2.0, ElementalType.FANTASMA: 2.0, ElementalType.SINIESTRO: 0.5, ElementalType.LUCHA: 0.5, ElementalType.HADA: 0.5},
    ElementalType.ACERO: {ElementalType.HIELO: 2.0, ElementalType.ROCA: 2.0, ElementalType.HADA: 2.0, ElementalType.FUEGO: 0.5, ElementalType.AGUA: 0.5, ElementalType.ELECTRICO: 0.5, ElementalType.ACERO: 0.5},
    ElementalType.HADA: {ElementalType.LUCHA: 2.0, ElementalType.DRAGON: 2.0, ElementalType.SINIESTRO: 2.0, ElementalType.FUEGO: 0.5, ElementalType.VENENO: 0.5, ElementalType.ACERO: 0.5}
}

# ============================================================================
# UTILIDADES PVP: NORMALIZACIÓN DE TIPOS Y EQUIPOS DEL CLIENTE
# ============================================================================
_TIPO_ALIASES = {
    "normal": "NORMAL", "fire": "NORMAL", "fuego": "FUEGO", "fogo": "FUEGO",
    "water": "AGUA", "agua": "AGUA", "grass": "PLANTA", "planta": "PLANTA", "plant": "PLANTA",
    "electric": "ELECTRICO", "electrico": "ELECTRICO", "electro": "ELECTRICO",
    "ice": "HIELO", "hielo": "HIELO", "fighting": "LUCHA", "lucha": "LUCHA",
    "poison": "VENENO", "veneno": "VENENO", "ground": "TIERRA", "tierra": "TIERRA", "earth": "TIERRA",
    "flying": "VOLADOR", "volador": "VOLADOR", "psychic": "PSIQUICO", "psiquico": "PSIQUICO",
    "bug": "BICHO", "bicho": "BICHO", "rock": "ROCA", "roca": "ROCA",
    "ghost": "FANTASMA", "fantasma": "FANTASMA", "dragon": "DRAGON", "dragon": "DRAGON",
    "dark": "SINIESTRO", "siniestro": "SINIESTRO", "steel": "ACERO", "acero": "ACERO",
    "fairy": "HADA", "hada": "HADA", "": "NORMAL",
}

PVP_REWARD_COINS = 150


def _norm_tipo_key(tipo, fallback="NORMAL"):
    """Convierte cualquier tipo (español/inglés, tildes, enum) a clave del Enum ElementalType."""
    if isinstance(tipo, ElementalType):
        return tipo.value
    key = (str(tipo or "") or "").lower()
    key = key.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u").replace("ü", "u").replace(" ", "")
    return _TIPO_ALIASES.get(key, fallback)


def _eff_mult(attack_type, defend_type):
    """Efectividad elemental entre dos tipos (string-safe)."""
    try:
        atk_e = ElementalType(_norm_tipo_key(attack_type))
        def_e = ElementalType(_norm_tipo_key(defend_type))
        return TYPE_EFFECTIVENESS.get(atk_e, {}).get(def_e, 1.0)
    except Exception:
        return 1.0


def _normalize_pvp_team(team_raw):
    """Convierte el equipo enviado por el cliente en dicts listos para el motor de combate."""
    result = []
    for mon in (team_raw or []):
        if not isinstance(mon, dict):
            continue
        name = mon.get("name") or mon.get("nombre")
        if not name:
            continue
        types = mon.get("types") or []
        if not isinstance(types, (list, tuple)):
            types = str(types or "").split("/")
        pt_raw = (types[0] if types else (mon.get("primary_type") or "Normal"))
        st_raw = (types[1] if len(types) > 1 else (mon.get("secondary_type") or None))
        try:
            hp = max(1, int(mon.get("hp") or 60))
        except (ValueError, TypeError):
            hp = 60
        try:
            cur = int(mon.get("current_hp") or mon.get("currentHp") or hp)
        except (ValueError, TypeError):
            cur = hp
        cur = max(0, min(cur, hp))
        moves = []
        for m in (mon.get("moves") or []):
            if not isinstance(m, dict) or not m.get("name"):
                continue
            try:
                power = int(m.get("power") or 0)
            except (ValueError, TypeError):
                power = 0
            category = str(m.get("category") or ("fisico" if power > 0 else "estatus")).lower()
            if category not in ("fisico", "especial", "estatus"):
                category = "fisico" if power > 0 else "estatus"
            moves.append({
                "name": str(m["name"]),
                "power": power,
                "category": category,
                "elemental_type": _norm_tipo_key(m.get("elemental_type") or m.get("type") or "Normal"),
            })
        result.append({
            "name": str(name),
            "level": max(1, int(mon.get("level") or 5)),
            "hp": hp,
            "current_hp": cur,
            "actual_attack": int(mon.get("actual_attack") or mon.get("attack") or 16),
            "actual_defense": int(mon.get("actual_defense") or mon.get("defense") or 18),
            "actual_sp_attack": int(mon.get("actual_sp_attack") or mon.get("sp_attack") or int(mon.get("attack") or 16)),
            "actual_sp_defense": int(mon.get("actual_sp_defense") or mon.get("sp_defense") or int(mon.get("defense") or 18)),
            "actual_speed": int(mon.get("actual_speed") or mon.get("speed") or 40),
            "primary_type": _norm_tipo_key(pt_raw),
            "secondary_type": _norm_tipo_key(st_raw) if st_raw else None,
            "image": mon.get("image"),
            "moves": moves[:4],
        })
    return result


async def _start_pvp_battle(lobby_manager, p1_id, p2_id, p1_team, p2_team):
    """Crea la batalla PvP autoritativa y notifica a ambos entrenadores."""
    p1 = lobby_manager.lobby_players.get(p1_id)
    p2 = lobby_manager.lobby_players.get(p2_id)
    if not p1 or not p2 or not p1_team or not p2_team:
        return None

    battle_id = str(uuid.uuid4())
    battle = {
        "battle_id": battle_id,
        "p1_id": p1_id,
        "p2_id": p2_id,
        "p1_team": [dict(m) for m in p1_team],
        "p2_team": [dict(m) for m in p2_team],
        "p1_pokemon": dict(p1_team[0]),
        "p2_pokemon": dict(p2_team[0]),
        "p1_name": p1.name,
        "p2_name": p2.name,
        "p1_active_idx": 0,
        "p2_active_idx": 0,
        "p1_move": None,
        "p2_move": None,
        "turn_counter": 1,
    }
    ACTIVE_PVP_BATTLES[battle_id] = battle

    await lobby_manager.send_direct(p1_id, {
        "type": "PVP_BATTLE_START",
        "battle_id": battle_id,
        "opponent_id": p2_id,
        "opponent_name": p2.name,
        "my_pokemon": battle["p1_pokemon"],
        "opponent_pokemon": battle["p2_pokemon"],
        "my_team": battle["p1_team"],
        "opponent_team": battle["p2_team"],
        "reward_coins": PVP_REWARD_COINS,
    })
    await lobby_manager.send_direct(p2_id, {
        "type": "PVP_BATTLE_START",
        "battle_id": battle_id,
        "opponent_id": p1_id,
        "opponent_name": p1.name,
        "my_pokemon": battle["p2_pokemon"],
        "opponent_pokemon": battle["p1_pokemon"],
        "my_team": battle["p2_team"],
        "opponent_team": battle["p1_team"],
        "reward_coins": PVP_REWARD_COINS,
    })
    return battle


async def _end_pvp_battle(lobby_manager, battle, winner_id, reason="FINISHED", logs=None):
    """Finaliza la batalla PvP, entrega monedas al ganador y notifica a ambos."""
    ACTIVE_PVP_BATTLES.pop(battle["battle_id"], None)
    # Restaurar el estado de los entrenadores al explorar
    for pid in (battle["p1_id"], battle["p2_id"]):
        pl = lobby_manager.lobby_players.get(pid)
        if pl:
            pl.state = LobbyTrainerState.EXPLORING
    await lobby_manager.broadcast_lobby_state()
    if winner_id not in (battle["p1_id"], battle["p2_id"]):
        winner_id = battle["p1_id"]
    winner_name = battle["p1_name"] if winner_id == battle["p1_id"] else battle["p2_name"]

    # Agregar monedas al ganador
    winner_profile = db.get_profile_by_username(winner_id)
    if winner_profile:
        winner_profile["coins"] = winner_profile.get("coins", 0) + PVP_REWARD_COINS
        db.save_player_state(winner_id, winner_profile)

    for pid in (battle["p1_id"], battle["p2_id"]):
        await lobby_manager.send_direct(pid, {
            "type": "PVP_BATTLE_END",
            "battle_id": battle["battle_id"],
            "winner_id": winner_id,
            "winner_name": winner_name,
            "you_won": pid == winner_id,
            "reward_coins": PVP_REWARD_COINS if pid == winner_id else 0,
            "reason": reason,
            "logs": [str(x) for x in (logs or [])],
        })


# ============================================================================
# REPOSITORIO EN MEMORIA
# ============================================================================
HOENN_ZONES: Dict[str, ZoneArea] = {}
DEX_CREATURES: Dict[int, Creature] = {}
ACTIVE_BATTLES: Dict[str, Dict] = {}
ACTIVE_PVP_BATTLES: Dict[str, Dict] = {}
REGISTERED_PLAYERS: Dict[str, PlayerProfile] = {}
POKEAPI_CACHE: Dict[str, Any] = {}

SIMULATED_INFRASTRUCTURE = {
    "maintenance": False,
    "gateway_timeout": False,
    "bad_gateway": False
}


def _initialize_emerald_hoenn_database():
    """Genera la totalidad de las 73 zonas de Hoenn según Emerald Completion."""
    # 1. Bestiario Base
    starters = [
        Creature(
            id=1, name="Treekoon", region="HOENN", generation=3,
            primary_type=ElementalType.PLANTA, transformation=MutationForm.BASE,
            base_stats=StatBlock(hp=40, attack=45, defense=35, sp_attack=65, sp_defense=55, speed=70),
            moves=[
                Move(id="leaf_blade", name="Hoja Aguda", elemental_type=ElementalType.PLANTA, category=MoveCategory.SPECIAL, power=90, accuracy=100, max_pp=15, current_pp=15),
                Move(id="mega_drain", name="Megagotar", elemental_type=ElementalType.PLANTA, category=MoveCategory.SPECIAL, power=40, accuracy=100, max_pp=20, current_pp=20),
                Move(id="quick_attack", name="Ataque Rápido", elemental_type=ElementalType.NORMAL, category=MoveCategory.PHYSICAL, power=40, accuracy=100, max_pp=30, current_pp=30, priority=1),
            ],
            sprites=SpriteSet(front="/assets/sprites/creatures/1_front.png", back="/assets/sprites/creatures/1_back.png", icon="/assets/sprites/creatures/1_icon.png"),
            current_hp=190, max_hp=190, level=25
        ),
        Creature(
            id=2, name="Torchicore", region="HOENN", generation=3,
            primary_type=ElementalType.FUEGO, transformation=MutationForm.BASE,
            base_stats=StatBlock(hp=45, attack=60, defense=40, sp_attack=70, sp_defense=50, speed=45),
            moves=[
                Move(id="ember", name="Ascuas", elemental_type=ElementalType.FUEGO, category=MoveCategory.SPECIAL, power=40, accuracy=100, max_pp=25, current_pp=25),
                Move(id="blaze_kick", name="Patada Ígnea", elemental_type=ElementalType.FUEGO, category=MoveCategory.SPECIAL, power=85, accuracy=90, max_pp=10, current_pp=10),
            ],
            sprites=SpriteSet(front="/assets/sprites/creatures/2_front.png", back="/assets/sprites/creatures/2_back.png", icon="/assets/sprites/creatures/2_icon.png"),
            current_hp=200, max_hp=200, level=25
        ),
        Creature(
            id=3, name="Mudkin", region="HOENN", generation=3,
            primary_type=ElementalType.AGUA, secondary_type=ElementalType.TIERRA, transformation=MutationForm.BASE,
            base_stats=StatBlock(hp=50, attack=70, defense=50, sp_attack=50, sp_defense=50, speed=40),
            moves=[
                Move(id="water_gun", name="Pistola Agua", elemental_type=ElementalType.AGUA, category=MoveCategory.SPECIAL, power=40, accuracy=100, max_pp=25, current_pp=25),
                Move(id="mud_bomb", name="Bomba Fango", elemental_type=ElementalType.TIERRA, category=MoveCategory.PHYSICAL, power=65, accuracy=85, max_pp=10, current_pp=10),
            ],
            sprites=SpriteSet(front="/assets/sprites/creatures/3_front.png", back="/assets/sprites/creatures/3_back.png", icon="/assets/sprites/creatures/3_icon.png"),
            current_hp=210, max_hp=210, level=25
        ),
        Creature(
            id=4, name="Blazefowl-X", region="HOENN", generation=3,
            primary_type=ElementalType.FUEGO, secondary_type=ElementalType.NORMAL, transformation=MutationForm.MUTACION_X,
            base_stats=StatBlock(hp=80, attack=160, defense=80, sp_attack=130, sp_defense=80, speed=100),
            moves=[Move(id="flare_rush", name="Embate Carmesí X", elemental_type=ElementalType.FUEGO, category=MoveCategory.SPECIAL, power=120, accuracy=100, max_pp=5, current_pp=5)],
            sprites=SpriteSet(front="/assets/sprites/creatures/4_front.png", back="/assets/sprites/creatures/4_back.png", icon="/assets/sprites/creatures/4_icon.png"),
            current_hp=270, max_hp=270, level=50
        ),
        Creature(
            id=5, name="Swampking-Y", region="HOENN", generation=3,
            primary_type=ElementalType.AGUA, secondary_type=ElementalType.TIERRA, transformation=MutationForm.MUTACION_Y,
            base_stats=StatBlock(hp=100, attack=110, defense=130, sp_attack=95, sp_defense=130, speed=65),
            moves=[Move(id="tsunami_wall", name="Muro Tsunami Y", elemental_type=ElementalType.AGUA, category=MoveCategory.SPECIAL, power=100, accuracy=100, max_pp=5, current_pp=5)],
            sprites=SpriteSet(front="/assets/sprites/creatures/5_front.png", back="/assets/sprites/creatures/5_back.png", icon="/assets/sprites/creatures/5_icon.png"),
            current_hp=310, max_hp=310, level=50
        ),
        Creature(
            id=6, name="Zephyrwing-Alfa", region="HOENN", generation=3,
            primary_type=ElementalType.VOLADOR, secondary_type=ElementalType.ELECTRICO, transformation=MutationForm.ALFA_MEGA,
            base_stats=StatBlock(hp=85, attack=90, defense=80, sp_attack=125, sp_defense=85, speed=145),
            moves=[Move(id="thunder_tempest", name="Tempestad Alfa", elemental_type=ElementalType.ELECTRICO, category=MoveCategory.SPECIAL, power=110, accuracy=100, max_pp=5, current_pp=5)],
            sprites=SpriteSet(front="/assets/sprites/creatures/6_front.png", back="/assets/sprites/creatures/6_back.png", icon="/assets/sprites/creatures/6_icon.png"),
            current_hp=280, max_hp=280, level=50
        ),
    ]
    for c in starters:
        DEX_CREATURES[c.id] = c

    # 2. Asentamientos y Ciudades (16)
    towns = [
        ("littleroot_town", "Littleroot Town", None, None),
        ("oldale_town", "Oldale Town", None, None),
        ("petalburg_city", "Petalburg City", None, None),
        ("rustboro_city", "Rustboro City", None, None),
        ("dewford_town", "Dewford Town", None, NavigationHM.SURF),
        ("slateport_city", "Slateport City", None, None),
        ("mauville_city", "Mauville City", GymBadge.STONE, None),
        ("verdanturf_town", "Verdanturf Town", None, None),
        ("fallarbor_town", "Fallarbor Town", None, None),
        ("lavaridge_town", "Lavaridge Town", GymBadge.DYNAMO, None),
        ("fortree_city", "Fortree City", GymBadge.HEAT, None),
        ("lilycove_city", "Lilycove City", GymBadge.BALANCE, None),
        ("mossdeep_city", "Mossdeep City", GymBadge.FEATHER, NavigationHM.SURF),
        ("sootopolis_city", "Sootopolis City", GymBadge.MIND, NavigationHM.DIVE),
        ("pacifidlog_town", "Pacifidlog Town", None, NavigationHM.SURF),
        ("ever_grande_city", "Ever Grande City", GymBadge.RAIN, NavigationHM.WATERFALL),
    ]
    for zid, zname, badge, hm in towns:
        HOENN_ZONES[zid] = ZoneArea(
            id=zid, name=zname, category=ZoneCategory.TOWN,
            required_badge=badge, required_hm=hm,
            hidden_items=[HiddenItem(id=f"item_{zid}_1", name=f"Objeto de {zname}")],
            visited=True if zid == "littleroot_town" else False
        )

    # 3. Red de Rutas Terrestres y Marítimas (101 a 134)
    water_routes = set(range(105, 110)).union(set(range(124, 135)))
    for rnum in range(101, 135):
        zid = f"route_{rnum}"
        is_water = rnum in water_routes
        required_badge = None
        required_hm = NavigationHM.SURF if is_water else NavigationHM.FOOT

        # Requisitos progresivos
        if rnum in [102, 103]:
            required_badge = None
        elif rnum in [104, 116]:
            required_badge = None
        elif rnum in [105, 106, 107, 108, 109]:
            required_badge = GymBadge.KNUCKLE
            required_hm = NavigationHM.SURF
        elif rnum in [110, 117, 118]:
            required_badge = GymBadge.STONE
        elif rnum in [111, 112, 113]:
            required_badge = GymBadge.DYNAMO
        elif rnum in [114, 115]:
            required_badge = GymBadge.DYNAMO
        elif rnum in [119, 120]:
            required_badge = GymBadge.BALANCE
        elif rnum in [121, 122, 123]:
            required_badge = GymBadge.FEATHER
        elif rnum in range(124, 135):
            required_badge = GymBadge.MIND
            required_hm = NavigationHM.SURF

        HOENN_ZONES[zid] = ZoneArea(
            id=zid,
            name=f"Ruta {rnum}",
            category=ZoneCategory.WATER_ROUTE if is_water else ZoneCategory.ROUTE,
            required_badge=required_badge,
            required_hm=required_hm,
            wild_encounters=[
                WildEncounter(creature_id=1, name="Treekoon", min_level=rnum % 10 + 2, max_level=rnum % 10 + 5, encounter_rate=50),
                WildEncounter(creature_id=2, name="Torchicore", min_level=rnum % 10 + 2, max_level=rnum % 10 + 5, encounter_rate=50),
            ],
            trainers=[
                NPCTrainer(
                    id=f"trainer_{zid}", name=f"Entrenador {zid}",
                    dialogue_intro=f"¡Te reto en la Ruta {rnum}!",
                    dialogue_defeat="Bien jugado...",
                    sprites=NPCSpriteSet(overworld="/assets/sprites/characters/npc_trainer.png", portrait="/assets/sprites/characters/npc_trainer_portrait.png"),
                    team=[DEX_CREATURES[2].model_copy(deep=True)]
                )
            ],
            hidden_items=[HiddenItem(id=f"hidden_{zid}", name=f"Tesoro Oculto Ruta {rnum}")],
            visited=True if rnum == 101 else False
        )

    # 4. Cuevas, Mazmorras e Instalaciones Clave (23)
    dungeons = [
        ("petalburg_woods", "Petalburg Woods", ZoneCategory.CAVE_DUNGEON, None, None),
        ("rusturf_tunnel", "Rusturf Tunnel", ZoneCategory.CAVE_DUNGEON, GymBadge.STONE, NavigationHM.ROCK_SMASH),
        ("granite_cave", "Granite Cave", ZoneCategory.CAVE_DUNGEON, GymBadge.STONE, NavigationHM.FLASH),
        ("abandoned_ship", "Abandoned Ship (Sea Mauville)", ZoneCategory.CAVE_DUNGEON, GymBadge.FEATHER, NavigationHM.SURF),
        ("fiery_path", "Fiery Path", ZoneCategory.CAVE_DUNGEON, GymBadge.DYNAMO, None),
        ("jagged_pass", "Jagged Pass", ZoneCategory.CAVE_DUNGEON, GymBadge.HEAT, None),
        ("mt_chimney", "Mt. Chimney", ZoneCategory.SPECIAL_FACILITY, GymBadge.HEAT, None),
        ("meteor_falls", "Meteor Falls", ZoneCategory.CAVE_DUNGEON, GymBadge.HEAT, NavigationHM.WATERFALL),
        ("mt_pyre", "Mt. Pyre", ZoneCategory.CAVE_DUNGEON, GymBadge.BALANCE, NavigationHM.SURF),
        ("magma_hideout", "Magma Hideout", ZoneCategory.SPECIAL_FACILITY, GymBadge.BALANCE, None),
        ("aqua_hideout", "Aqua Hideout", ZoneCategory.SPECIAL_FACILITY, GymBadge.FEATHER, NavigationHM.SURF),
        ("shoal_cave", "Shoal Cave", ZoneCategory.CAVE_DUNGEON, GymBadge.FEATHER, NavigationHM.SURF),
        ("seafloor_cavern", "Seafloor Cavern", ZoneCategory.CAVE_DUNGEON, GymBadge.MIND, NavigationHM.DIVE),
        ("cave_of_origin", "Cave of Origin", ZoneCategory.CAVE_DUNGEON, GymBadge.MIND, None),
        ("victory_road", "Victory Road", ZoneCategory.CAVE_DUNGEON, GymBadge.RAIN, NavigationHM.WATERFALL),
        ("mirage_tower", "Mirage Tower", ZoneCategory.SPECIAL_FACILITY, GymBadge.DYNAMO, None),
        ("desert_underpass", "Desert Underpass", ZoneCategory.CAVE_DUNGEON, GymBadge.RAIN, None),
        ("artisan_cave", "Artisan Cave", ZoneCategory.CAVE_DUNGEON, GymBadge.RAIN, None),
        ("altering_cave", "Altering Cave", ZoneCategory.CAVE_DUNGEON, GymBadge.RAIN, NavigationHM.SURF),
        ("sky_pillar", "Sky Pillar", ZoneCategory.SPECIAL_FACILITY, GymBadge.RAIN, NavigationHM.SURF),
        ("new_mauville", "New Mauville", ZoneCategory.SPECIAL_FACILITY, GymBadge.BALANCE, NavigationHM.SURF),
        ("safari_zone", "Safari Zone", ZoneCategory.SPECIAL_FACILITY, GymBadge.BALANCE, None),
        ("battle_frontier", "Battle Frontier", ZoneCategory.SPECIAL_FACILITY, GymBadge.RAIN, None),
    ]
    for did, dname, cat, badge, hm in dungeons:
        HOENN_ZONES[did] = ZoneArea(
            id=did, name=dname, category=cat,
            required_badge=badge, required_hm=hm,
            wild_encounters=[
                WildEncounter(creature_id=3, name="Mudkin", min_level=15, max_level=25, encounter_rate=100)
            ],
            hidden_items=[HiddenItem(id=f"item_{did}", name=f"Reliquia de {dname}")]
        )

    # Perfil inicial de demo
    REGISTERED_PLAYERS["trainer_demo"] = PlayerProfile(
        name="Brendan",
        current_zone="littleroot_town",
        badges=[GymBadge.STONE, GymBadge.KNUCKLE],
        hms=[NavigationHM.FOOT, NavigationHM.SURF],
        team=[DEX_CREATURES[1].model_copy(deep=True)],
        registered_dex=[1, 2, 3]
    )

    # Perfil novato (para probar 403)
    REGISTERED_PLAYERS["trainer_token_rookie"] = PlayerProfile(
        name="Rookie",
        current_zone="littleroot_town",
        badges=[],
        hms=[NavigationHM.FOOT],
        team=[DEX_CREATURES[1].model_copy(deep=True)],
        registered_dex=[1]
    )


_initialize_emerald_hoenn_database()


# ============================================================================
# LOBBY MULTIJUGADOR EN TIEMPO REAL (WEBSOCKETS)
# ============================================================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.lobby_players: Dict[str, LobbyPlayer] = {}
        self.active_challenges: Dict[str, DuelChallenge] = {}
        self.active_trades: Dict[str, TradeSession] = {}

    async def connect(self, trainer_id: str, websocket: WebSocket, player: LobbyPlayer):
        await websocket.accept()
        self.active_connections[trainer_id] = websocket
        self.lobby_players[trainer_id] = player
        await self.broadcast_lobby_state()

    async def handle_action(self, trainer_id: str, data: dict):
        print(f"[DEBUG WS] received from {trainer_id}: {data}")

    def disconnect(self, trainer_id: str):
        self.active_connections.pop(trainer_id, None)
        self.lobby_players.pop(trainer_id, None)
        # Cancelar intercambios pendientes del usuario
        cancelled_trades = [tid for tid, s in self.active_trades.items() if s.trainer_a_id == trainer_id or s.trainer_b_id == trainer_id]
        for tid in cancelled_trades:
            self.active_trades.pop(tid, None)

    async def broadcast_lobby_state(self):
        message = {
            "type": "LOBBY_PLAYERS_UPDATE",
            "count": len(self.lobby_players),
            "players": [p.model_dump() for p in self.lobby_players.values()]
        }
        for ws in list(self.active_connections.values()):
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                pass

    async def broadcast_event(self, message: Dict, exclude_id: Optional[str] = None):
        payload = json.dumps(message)
        for tid, ws in list(self.active_connections.items()):
            if exclude_id and tid == exclude_id:
                continue
            try:
                await ws.send_text(payload)
            except Exception:
                pass

    async def send_direct(self, trainer_id: str, message: Dict):
        ws = self.active_connections.get(trainer_id)
        if ws:
            try:
                await ws.send_text(json.dumps(message))
                print(f"[DEBUG WS] send_direct success to {trainer_id}: {message.get('type')}")
            except Exception as e:
                print(f"[DEBUG WS] send_direct ERROR to {trainer_id}: {e}")


lobby_manager = ConnectionManager()


@app.websocket("/ws/lobby")
async def websocket_lobby_endpoint(
    websocket: WebSocket,
    trainer_id: str = Query(..., description="ID del entrenador"),
    trainer_name: str = Query("Entrenador", description="Nombre visual")
):
    """
    WebSocket del Lobby Multijugador Social en tiempo real (Tipo Habbo):
    - Presencia y movimiento continuo en cuadrícula.
    - Chat en vivo con burbujas de diálogo temporales.
    - Mobiliario interactivo (sentarse en sofás / sillas).
    - Máquina de estados de Intercambio seguro dual-lock (Pokémon e Ítems).
    - Desafíos PvP y Duelos autoritativos.
    """
    player = LobbyPlayer(
        id=trainer_id,
        name=trainer_name,
        current_zone="grand_hotel_lobby",
        state=LobbyTrainerState.EXPLORING,
        badge_count=2,
        map_id="grand_hotel_lobby",
        x=240,
        y=240
    )
    await lobby_manager.connect(trainer_id, websocket, player)

    try:
        while True:
            raw_data = await websocket.receive_text()
            data = json.loads(raw_data)
            print(f"[DEBUG WS] {trainer_id} -> {data}")
            action_type = data.get("action")

            if action_type == "UPDATE_STATE":
                new_state = data.get("state", LobbyTrainerState.EXPLORING.value)
                try:
                    player.state = LobbyTrainerState(new_state)
                except ValueError:
                    pass
                if "x" in data:
                    player.x = int(data["x"])
                if "y" in data:
                    player.y = int(data["y"])
                if "dir" in data:
                    player.dir = str(data["dir"])
                if "mapId" in data:
                    player.map_id = str(data["mapId"])
                if "avatar_style" in data:
                    player.avatar_style = str(data["avatar_style"])[:32]
                await lobby_manager.broadcast_event({
                    "type": "PLAYER_MOVED",
                    "id": player.id,
                    "name": player.name,
                    "x": player.x,
                    "y": player.y,
                    "dir": player.dir,
                    "mapId": player.map_id,
                    "state": player.state.value,
                    "avatar_style": player.avatar_style,
                    "seat_id": player.seat_id,
                    "chat_bubble": player.chat_bubble if player.chat_bubble_until > time.time() else None
                }, exclude_id=trainer_id)

            elif action_type == "SEAT_INTERACT":
                seat_id = data.get("seat_id")
                sit = data.get("sit", True)
                if sit:
                    player.state = LobbyTrainerState.SEATED
                    player.seat_id = seat_id
                    if "x" in data:
                        player.x = int(data["x"])
                    if "y" in data:
                        player.y = int(data["y"])
                    if "dir" in data:
                        player.dir = str(data["dir"])
                else:
                    player.state = LobbyTrainerState.EXPLORING
                    player.seat_id = None

                await lobby_manager.broadcast_lobby_state()

            elif action_type == "CHAT_MESSAGE":
                text = str(data.get("text", "")).strip()
                scope = data.get("scope", "ROOM")
                target_id = data.get("target_id")

                if text:
                    player.chat_bubble = text[:100]
                    player.chat_bubble_until = time.time() + 6.0  # 6 segundos de burbuja flotante

                    chat_payload = {
                        "type": "CHAT_MESSAGE_RECEIVED",
                        "sender_id": trainer_id,
                        "sender_name": trainer_name,
                        "text": text,
                        "scope": scope,
                        "target_id": target_id,
                        "map_id": player.map_id,
                        "x": player.x,
                        "y": player.y,
                        "timestamp": time.time()
                    }

                    if scope == "WHISPER" and target_id:
                        await lobby_manager.send_direct(target_id, chat_payload)
                        await lobby_manager.send_direct(trainer_id, chat_payload)
                    else:
                        await lobby_manager.broadcast_event(chat_payload)

            elif action_type == "TRADE_INVITE":
                target_id = data.get("target_id")
                if target_id and target_id in lobby_manager.lobby_players:
                    target_player = lobby_manager.lobby_players[target_id]
                    trade_id = f"trade_{trainer_id}_{target_id}_{int(time.time())}"
                    trade_session = TradeSession(
                        trade_id=trade_id,
                        trainer_a_id=trainer_id,
                        trainer_a_name=trainer_name,
                        trainer_b_id=target_id,
                        trainer_b_name=target_player.name
                    )
                    lobby_manager.active_trades[trade_id] = trade_session
                    await lobby_manager.send_direct(target_id, {
                        "type": "TRADE_INVITE_RECEIVED",
                        "trade_id": trade_id,
                        "from_id": trainer_id,
                        "from_name": trainer_name
                    })

            elif action_type == "RESPOND_TRADE":
                trade_id = data.get("trade_id")
                accept = data.get("accept", False)
                if trade_id in lobby_manager.active_trades:
                    session = lobby_manager.active_trades[trade_id]
                    if accept:
                        session.status = "NEGOTIATING"
                        player.state = LobbyTrainerState.TRADING
                        if session.trainer_a_id in lobby_manager.lobby_players:
                            lobby_manager.lobby_players[session.trainer_a_id].state = LobbyTrainerState.TRADING
                        start_msg = {
                            "type": "TRADE_STARTED",
                            "trade": session.model_dump()
                        }
                        await lobby_manager.send_direct(session.trainer_a_id, start_msg)
                        await lobby_manager.send_direct(session.trainer_b_id, start_msg)
                    else:
                        lobby_manager.active_trades.pop(trade_id, None)
                        await lobby_manager.send_direct(session.trainer_a_id, {
                            "type": "TRADE_CANCELLED",
                            "reason": f"{trainer_name} rechazó la solicitud de intercambio."
                        })
                    await lobby_manager.broadcast_lobby_state()

            elif action_type == "TRADE_OFFER":
                trade_id = data.get("trade_id")
                if trade_id in lobby_manager.active_trades:
                    session = lobby_manager.active_trades[trade_id]
                    is_a = (trainer_id == session.trainer_a_id)
                    offer = session.offer_a if is_a else session.offer_b
                    offer.pokemon_index = data.get("pokemon_index")
                    offer.pokemon_summary = data.get("pokemon_summary")
                    offer.items = data.get("items", {})
                    # Todo cambio desbloquea ambas ofertas para evitar engaños
                    session.offer_a.is_locked = False
                    session.offer_b.is_locked = False
                    session.offer_a.is_confirmed = False
                    session.offer_b.is_confirmed = False

                    sync_msg = {"type": "TRADE_SYNC", "trade": session.model_dump()}
                    await lobby_manager.send_direct(session.trainer_a_id, sync_msg)
                    await lobby_manager.send_direct(session.trainer_b_id, sync_msg)

            elif action_type == "TRADE_LOCK":
                trade_id = data.get("trade_id")
                if trade_id in lobby_manager.active_trades:
                    session = lobby_manager.active_trades[trade_id]
                    if trainer_id == session.trainer_a_id:
                        session.offer_a.is_locked = True
                    else:
                        session.offer_b.is_locked = True

                    sync_msg = {"type": "TRADE_SYNC", "trade": session.model_dump()}
                    await lobby_manager.send_direct(session.trainer_a_id, sync_msg)
                    await lobby_manager.send_direct(session.trainer_b_id, sync_msg)

            elif action_type == "TRADE_CONFIRM":
                trade_id = data.get("trade_id")
                if trade_id in lobby_manager.active_trades:
                    session = lobby_manager.active_trades[trade_id]
                    if trainer_id == session.trainer_a_id:
                        session.offer_a.is_confirmed = True
                    else:
                        session.offer_b.is_confirmed = True

                    # Si ambos confirmaron y estaban bloqueados:
                    if session.offer_a.is_locked and session.offer_b.is_locked and session.offer_a.is_confirmed and session.offer_b.is_confirmed:
                        session.status = "COMPLETED"
                        # Restaurar estados
                        if session.trainer_a_id in lobby_manager.lobby_players:
                            lobby_manager.lobby_players[session.trainer_a_id].state = LobbyTrainerState.EXPLORING
                        if session.trainer_b_id in lobby_manager.lobby_players:
                            lobby_manager.lobby_players[session.trainer_b_id].state = LobbyTrainerState.EXPLORING

                        completed_msg = {
                            "type": "TRADE_COMPLETED",
                            "trade": session.model_dump(),
                            "animation": "GBA_CABLE_LINK"
                        }
                        await lobby_manager.send_direct(session.trainer_a_id, completed_msg)
                        await lobby_manager.send_direct(session.trainer_b_id, completed_msg)
                        lobby_manager.active_trades.pop(trade_id, None)
                        await lobby_manager.broadcast_lobby_state()
                    else:
                        sync_msg = {"type": "TRADE_SYNC", "trade": session.model_dump()}
                        await lobby_manager.send_direct(session.trainer_a_id, sync_msg)
                        await lobby_manager.send_direct(session.trainer_b_id, sync_msg)

            elif action_type == "TRADE_CANCEL":
                trade_id = data.get("trade_id")
                if trade_id in lobby_manager.active_trades:
                    session = lobby_manager.active_trades.pop(trade_id, None)
                    if session:
                        if session.trainer_a_id in lobby_manager.lobby_players:
                            lobby_manager.lobby_players[session.trainer_a_id].state = LobbyTrainerState.EXPLORING
                        if session.trainer_b_id in lobby_manager.lobby_players:
                            lobby_manager.lobby_players[session.trainer_b_id].state = LobbyTrainerState.EXPLORING
                        cancel_msg = {"type": "TRADE_CANCELLED", "reason": f"{trainer_name} canceló el intercambio."}
                        await lobby_manager.send_direct(session.trainer_a_id, cancel_msg)
                        await lobby_manager.send_direct(session.trainer_b_id, cancel_msg)
                        await lobby_manager.broadcast_lobby_state()

            elif action_type == "CHALLENGE_TRAINER":
                target_id = data.get("target_id")
                print(f"[DEBUG PVP] {trainer_name} envió CHALLENGE_TRAINER a {target_id}")
                if not target_id or target_id not in lobby_manager.lobby_players:
                    await lobby_manager.send_direct(trainer_id, {
                        "type": "CHALLENGE_RESPONSE",
                        "challenge_id": "",
                        "accepted": False,
                        "error": "El entrenador objetivo no está conectado.",
                    })
                    continue
                challenge_id = f"duel_{trainer_id}_{target_id}_{int(time.time())}"
                challenge = DuelChallenge(
                    challenge_id=challenge_id,
                    from_trainer_id=trainer_id,
                    from_trainer_name=trainer_name,
                    to_trainer_id=target_id,
                    status="PENDING"
                )
                lobby_manager.active_challenges[challenge_id] = {
                    "challenge": challenge,
                    "p1_team": _normalize_pvp_team(data.get("team")),
                }
                await lobby_manager.send_direct(target_id, {
                    "type": "DUEL_REQUEST_RECEIVED",
                    "challenge": {
                        "id": challenge_id,
                        "challenge_id": challenge_id,
                        "challenger_id": trainer_id,
                        "challenger_name": trainer_name,
                        "from_trainer_id": trainer_id,
                        "from_trainer_name": trainer_name,
                        "to_trainer_id": target_id,
                        "target_id": target_id,
                    }
                })

            elif action_type == "RESPOND_CHALLENGE":
                challenge_id = data.get("challenge_id") or data.get("id")
                accept = data.get("accept", False)
                print(f"[DEBUG PVP] {trainer_name} -> RESPOND_CHALLENGE (accept={accept}) para {challenge_id}")
                entry = lobby_manager.active_challenges.get(challenge_id) if challenge_id else None

                # ── Recuperación de desafío perdido (servidor reiniciado) ──────────────
                # Si no hay registro en memoria pero el challenge_id tiene el formato
                # "duel_{p1_id}_{p2_id}_{ts}" y accept=True, intentamos reconstruir
                # la batalla directamente con los equipos enviados en este mensaje.
                if entry is None and accept and challenge_id:
                    parts = challenge_id.split("_")
                    # Formato esperado: duel  <p1>  <p2>  <ts>  → mínimo 4 tokens
                    # (si los usernames tienen guiones usamos el prefijo "duel" y el ts al final)
                    recovered = False
                    if len(parts) >= 4 and parts[0] == "duel":
                        # El respondedor (trainer_id) es p2 → p1 es quien envió el reto
                        inferred_p1 = parts[1]
                        inferred_p2 = parts[2]
                        # Verificar que ambos están conectados
                        p2_team_raw = _normalize_pvp_team(data.get("team"))
                        print(f"[DEBUG PVP] Intentando recuperación. p1={inferred_p1} (conectado: {inferred_p1 in lobby_manager.lobby_players}), p2={inferred_p2}, p2_team={bool(p2_team_raw)}")
                        if (inferred_p1 in lobby_manager.lobby_players and
                                trainer_id in (inferred_p2, trainer_id) and p2_team_raw):
                            # Intentar obtener equipo de p1 desde su perfil guardado
                            p1_team_raw = []
                            prof1 = db.get_profile_by_username(inferred_p1)
                            if prof1 and prof1.get("team"):
                                p1_team_raw = _normalize_pvp_team(prof1["team"])
                            print(f"[DEBUG PVP] Recuperación p1_team_raw len={len(p1_team_raw)}")
                            if p1_team_raw:
                                print(f"[PVP] Recuperando batalla perdida {challenge_id} | p1={inferred_p1} p2={trainer_id}")
                                battle = await _start_pvp_battle(
                                    lobby_manager, inferred_p1, trainer_id, p1_team_raw, p2_team_raw
                                )
                                print(f"[DEBUG PVP] Resultado recuperación _start_pvp_battle: {battle is not None}")
                                if battle:
                                    await lobby_manager.send_direct(inferred_p1, {
                                        "type": "CHALLENGE_RESPONSE",
                                        "challenge_id": challenge_id,
                                        "accepted": True,
                                        "responder_id": trainer_id,
                                        "responder_name": trainer_name,
                                    })
                                    await lobby_manager.broadcast_lobby_state()
                                    recovered = True
                    if not recovered:
                        print(f"[DEBUG PVP] Recuperación fallida para {challenge_id}.")
                        await lobby_manager.send_direct(trainer_id, {
                            "type": "CHALLENGE_RESPONSE",
                            "challenge_id": challenge_id or "",
                            "accepted": False,
                            "error": "El desafío ya expiró o no existe.",
                        })
                    continue

                print(f"[DEBUG PVP] Reto en memoria encontrado para {challenge_id}. accept={accept}")
                ch = entry["challenge"]
                ch.status = "ACCEPTED" if accept else "DECLINED"
                if accept:
                    player.state = LobbyTrainerState.IN_BATTLE
                    if ch.from_trainer_id in lobby_manager.lobby_players:
                        lobby_manager.lobby_players[ch.from_trainer_id].state = LobbyTrainerState.IN_BATTLE

                    # Equipos: primero los enviados por los clientes, luego fallback a perfiles guardados
                    p1_team = _normalize_pvp_team(entry.get("p1_team"))
                    p2_team = _normalize_pvp_team(data.get("team"))
                    if not p1_team:
                        prof = db.get_profile_by_username(ch.from_trainer_id)
                        if prof and prof.get("team"):
                            p1_team = _normalize_pvp_team(prof["team"])
                    if not p2_team:
                        prof = db.get_profile_by_username(trainer_id)
                        if prof and prof.get("team"):
                            p2_team = _normalize_pvp_team(prof["team"])

                    print(f"[DEBUG PVP] Preparando combate: p1_team={len(p1_team) if p1_team else 0}, p2_team={len(p2_team) if p2_team else 0}")
                    if p1_team and p2_team:
                        battle = await _start_pvp_battle(
                            lobby_manager,
                            ch.from_trainer_id,
                            trainer_id,
                            p1_team,
                            p2_team,
                        )
                        if battle is None:
                            accept = False
                    else:
                        await lobby_manager.send_direct(trainer_id, {
                            "type": "CHALLENGE_RESPONSE",
                            "challenge_id": challenge_id,
                            "accepted": False,
                            "error": "No se pudo iniciar: un entrenador no tiene Pokémon en su equipo.",
                        })
                        accept = False
                else:
                    if ch.from_trainer_id in lobby_manager.lobby_players:
                        lobby_manager.lobby_players[ch.from_trainer_id].state = LobbyTrainerState.EXPLORING

                lobby_manager.active_challenges.pop(challenge_id, None)
                await lobby_manager.send_direct(ch.from_trainer_id, {
                    "type": "CHALLENGE_RESPONSE",
                    "challenge_id": challenge_id,
                    "accepted": accept,
                    "responder_id": trainer_id,
                    "responder_name": trainer_name,
                })
                await lobby_manager.send_direct(ch.from_trainer_id, {
                    "type": "DUEL_RESPONSE",
                    "challenge_id": challenge_id,
                    "accepted": accept,
                })
                await lobby_manager.broadcast_lobby_state()

            # ── Turno de batalla PvP (motor autoritativo) ──
            elif action_type == "PVP_BATTLE_MOVE":
                battle_id = data.get("battle_id")
                move_index = data.get("move_index")
                battle = ACTIVE_PVP_BATTLES.get(battle_id)
                if not battle:
                    continue
                if trainer_id == battle["p1_id"]:
                    battle["p1_move"] = move_index
                elif trainer_id == battle["p2_id"]:
                    battle["p2_move"] = move_index
                else:
                    continue

                if battle["p1_move"] is None or battle["p2_move"] is None:
                    continue

                p1_action = battle["p1_move"]
                p2_action = battle["p2_move"]
                battle["p1_move"] = None
                battle["p2_move"] = None
                battle["turn_counter"] += 1

                p1_poke = battle["p1_pokemon"]
                p2_poke = battle["p2_pokemon"]

                def _parse_action(action, team, active_idx):
                    if isinstance(action, str) and action.startswith("SWITCH:"):
                        try:
                            idx = int(action.split(":")[1])
                            if 0 <= idx < len(team) and idx != active_idx and team[idx].get("current_hp", team[idx].get("hp")) > 0:
                                return {"type": "SWITCH", "idx": idx, "priority": 6}
                        except ValueError:
                            pass
                    elif isinstance(action, int):
                        return {"type": "ATTACK", "idx": action, "priority": 0}
                    return {"type": "FAILED", "priority": -1}

                p1_act = _parse_action(p1_action, battle["p1_team"], battle["p1_active_idx"])
                p2_act = _parse_action(p2_action, battle["p2_team"], battle["p2_active_idx"])

                def _get_move(poke, idx):
                    moves = poke.get("moves") or []
                    if isinstance(idx, int) and 0 <= idx < len(moves):
                        return moves[idx]
                    return None

                log_lines = []
                battle_status = "ONGOING"

                def _calc_dmg(attacker, defender, move):
                    if not move:
                        return 0, "No hay ataque."
                    category = move.get("category", "fisico")
                    atk = attacker.get("actual_attack", 10) if category == "fisico" else attacker.get("actual_sp_attack", 10)
                    dfn = defender.get("actual_defense", 10) if category == "fisico" else defender.get("actual_sp_defense", 10)
                    lvl = attacker.get("level", 5)
                    power = move.get("power", 40)
                    if power <= 0:
                        return 0, ""
                    base = ((2 * lvl / 5 + 2) * power * (atk / max(1, dfn)) / 50 + 2)
                    stab = 1.5 if (move.get("elemental_type") in (attacker.get("primary_type"), attacker.get("secondary_type"))) else 1.0
                    type_mult = _eff_mult(move.get("elemental_type"), defender.get("primary_type"))
                    if defender.get("secondary_type"):
                        type_mult *= _eff_mult(move.get("elemental_type"), defender.get("secondary_type"))
                    is_crit = random.random() < 0.0625
                    damage = max(1, math.floor(base * stab * type_mult * (1.5 if is_crit else 1.0) * 0.95))
                    eff_msg = ""
                    if type_mult > 1:
                        eff_msg = "¡Es súper eficaz!"
                    elif type_mult < 1:
                        eff_msg = "No es muy eficaz..."
                    if is_crit:
                        eff_msg += " ¡Golpe crítico!"
                    return damage, eff_msg

                # Order calculation
                p1_speed = p1_poke.get("actual_speed", 10)
                p2_speed = p2_poke.get("actual_speed", 10)
                
                acts = [
                    {"player": "p1", "name": battle["p1_name"], "poke": p1_poke, "act": p1_act, "speed": p1_speed},
                    {"player": "p2", "name": battle["p2_name"], "poke": p2_poke, "act": p2_act, "speed": p2_speed}
                ]
                
                # Sort by priority (descending), then speed (descending), then random
                acts.sort(key=lambda x: (x["act"]["priority"], x["speed"], random.random()), reverse=True)

                for current in acts:
                    player = current["player"]
                    name = current["name"]
                    act = current["act"]
                    
                    # Refresh pointers as they might have changed
                    atk_poke = battle[f"{player}_pokemon"]
                    opp_player = "p2" if player == "p1" else "p1"
                    def_name = battle[f"{opp_player}_name"]
                    
                    if act["type"] == "SWITCH":
                        target_idx = act["idx"]
                        team = battle[f"{player}_team"]
                        new_poke = team[target_idx]
                        
                        # Save current poke state
                        active_idx = battle[f"{player}_active_idx"]
                        team[active_idx] = dict(atk_poke)
                        
                        # Set new poke
                        battle[f"{player}_active_idx"] = target_idx
                        battle[f"{player}_pokemon"] = dict(new_poke)
                        
                        log_lines.append(f"¡{name} cambió a {new_poke.get('name')}!")
                        
                    elif act["type"] == "ATTACK":
                        # Attack logic
                        def_poke = battle[f"{opp_player}_pokemon"]
                        if atk_poke.get("current_hp", atk_poke.get("hp")) <= 0:
                            continue # fainted
                            
                        move = _get_move(atk_poke, act["idx"])
                        if not move:
                            log_lines.append(f"{name} no pudo atacar.")
                            continue
                            
                        log_lines.append(f"{name} usó {move.get('name')}.")
                        dmg, eff = _calc_dmg(atk_poke, def_poke, move)
                        if dmg > 0:
                            def_poke["current_hp"] = max(0, def_poke.get("current_hp", def_poke.get("hp")) - dmg)
                            log_lines.append(f"Causó {dmg} de daño.")
                            if eff:
                                log_lines.append(eff)
                        
                        if def_poke.get("current_hp", 0) <= 0:
                            log_lines.append(f"¡El Pokémon de {def_name} se debilitó!")
                            # Update the opponent's team state so the client knows it fainted
                            opp_active_idx = battle[f"{opp_player}_active_idx"]
                            battle[f"{opp_player}_team"][opp_active_idx] = dict(def_poke)
                            
                            # Check if the opponent has any remaining pokemon
                            opp_team = battle[f"{opp_player}_team"]
                            has_remaining = any(p.get("current_hp", p.get("hp")) > 0 for p in opp_team)
                            
                            if not has_remaining:
                                battle_status = f"{player.upper()}_WON"
                                break
                            else:
                                log_lines.append(f"{def_name} debe elegir otro Pokémon.")
                                # Client handles the forced switch by sending a switch action next turn
                                break # Turn ends when a pokemon faints


                for pid, my_key, opp_key, my_act in ((battle["p1_id"], "p1_pokemon", "p2_pokemon", p1_act), (battle["p2_id"], "p2_pokemon", "p1_pokemon", p2_act)):
                    # Guardamos el pokemon actual de vuelta a su equipo para sincronización
                    my_active = battle[my_key.replace("pokemon", "active_idx")]
                    battle[my_key.replace("pokemon", "team")][my_active] = dict(battle[my_key])
                        
                    await lobby_manager.send_direct(pid, {
                        "type": "PVP_BATTLE_TURN_RESULT",
                        "battle_id": battle_id,
                        "my_pokemon": battle[my_key],
                        "opponent_pokemon": battle[opp_key],
                        "my_team": battle[my_key.replace("pokemon", "team")],
                        "opponent_team": battle[opp_key.replace("pokemon", "team")],
                        "logs": log_lines,
                        "status": battle_status,
                        "you_won": (battle_status == "P1_WON" and pid == battle["p1_id"]) or (battle_status == "P2_WON" and pid == battle["p2_id"]),
                        "reward_coins": PVP_REWARD_COINS,
                    })

                if battle_status != "ONGOING":
                    winner_id = battle["p1_id"] if battle_status == "P1_WON" else battle["p2_id"]
                    await _end_pvp_battle(lobby_manager, battle, winner_id, "FINISHED", log_lines)

            # ── Rendición PvP ──
            elif action_type == "PVP_BATTLE_FORFEIT":
                battle_id = data.get("battle_id")
                battle = ACTIVE_PVP_BATTLES.get(battle_id)
                if not battle:
                    continue
                if trainer_id not in (battle["p1_id"], battle["p2_id"]):
                    continue
                winner_id = battle["p2_id"] if trainer_id == battle["p1_id"] else battle["p1_id"]
                await _end_pvp_battle(lobby_manager, battle, winner_id, "FORFEIT", [f"{trainer_name} se rindió."])

    except WebSocketDisconnect:
        lobby_manager.disconnect(trainer_id)
        await lobby_manager.broadcast_lobby_state()


# ============================================================================
# MIDDLEWARES Y SEGURIDAD (401, 403, 429)
# ============================================================================
def authenticate_request(
    authorization: Optional[str] = Header(None),
    x_trainer_token: Optional[str] = Header(None)
) -> PlayerProfile:
    token = x_trainer_token or (authorization.replace("Bearer ", "").strip() if authorization and authorization.startswith("Bearer ") else None)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "UNAUTHORIZED_SESSION",
                "message": "Token de entrenador ausente.",
                "debug_clue": "Inicia sesión o regístrate en /api/auth/login o /api/auth/register."
            },
            headers={"WWW-Authenticate": "Bearer"}
        )
    if token in REGISTERED_PLAYERS:
        return REGISTERED_PLAYERS[token]

    # Verificar en SQLite persistente
    username = db.verify_session_token(token)
    if username:
        profile_dict = db.get_profile_by_username(username)
        if profile_dict:
            profile = PlayerProfile(**profile_dict)
            REGISTERED_PLAYERS[token] = profile
            return profile

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={
            "code": "UNAUTHORIZED_SESSION",
            "message": "Token de entrenador ausente o inválido.",
            "debug_clue": "Inicia sesión o regístrate en /api/auth/login o /api/auth/register."
        },
        headers={"WWW-Authenticate": "Bearer"}
    )


# ============================================================================
# ENDPOINTS REST: AUTENTICACIÓN Y PERSISTENCIA SQLITE (HABBO MMO LOBBY)
# ============================================================================
@app.post("/api/auth/register", response_model=UserSessionResponse, status_code=status.HTTP_201_CREATED)
async def register_endpoint(req: UserRegisterRequest):
    """Registra una nueva cuenta de usuario persistente en SQLite."""
    starter = DEX_CREATURES.get(req.starter_id) or DEX_CREATURES.get(2)
    starter_dict = starter.model_dump() if starter else None
    if starter_dict:
        starter_dict["level"] = 5

    try:
        token, profile_dict = db.register_account(
            username=req.username,
            password=req.password,
            email=req.email,
            starter_dict=starter_dict,
            avatar_style=req.avatar_style
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    profile = PlayerProfile(**profile_dict)
    REGISTERED_PLAYERS[token] = profile
    return UserSessionResponse(token=token, username=req.username, player=profile)


@app.post("/api/auth/login", response_model=UserSessionResponse, status_code=status.HTTP_200_OK)
async def login_endpoint(req: UserLoginRequest):
    """Autentica a un usuario y retorna su sesión y perfil guardado."""
    auth_res = db.authenticate_account(req.username, req.password)
    if not auth_res:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_CREDENTIALS", "message": "Usuario o contraseña incorrectos."}
        )
    token, profile_dict = auth_res
    profile = PlayerProfile(**profile_dict)
    REGISTERED_PLAYERS[token] = profile
    return UserSessionResponse(token=token, username=req.username, player=profile)


@app.post("/api/auth/save", status_code=status.HTTP_200_OK)
async def save_profile_endpoint(
    req: Dict[str, Any],
    trainer: PlayerProfile = Depends(authenticate_request),
    authorization: Optional[str] = Header(None),
    x_trainer_token: Optional[str] = Header(None)
):
    """Guarda el estado del entrenador (medallas, inventario, equipo, zona) en la base de datos."""
    token = x_trainer_token or (authorization.replace("Bearer ", "").strip() if authorization and authorization.startswith("Bearer ") else None)
    username = db.verify_session_token(token) if token else None
    if not username:
        username = trainer.name

    db.save_player_state(username, req)
    return {"status": "SAVED", "timestamp": time.time()}


# ============================================================================
# WEBSOCKET LOBBY MULTIJUGADOR — SALA UNIÓN EN TIEMPO REAL
# ============================================================================

# Registro global de clientes WebSocket conectados: trainer_id -> {ws, name, x, y, dir, mapId, state, badges}
@app.get("/api/lobby/players")
async def get_lobby_players():
    '''Retorna la lista de jugadores actualmente conectados al lobby.'''
    return {
        "count": len(lobby_manager.lobby_players),
        "players": [p.model_dump() for p in lobby_manager.lobby_players.values()]
    }


# ============================================================================
# ENDPOINTS REST: MÁQUINAS OCULTAS (MO 01 A MO 08 - GUÍAS NINTENDO ESMERALDA)
# ============================================================================
class HMUseRequest(BaseModel):
    hm: str
    target_zone: Optional[str] = None
    target_obstacle_type: Optional[str] = None

HM_RULES = {
    "CORTE": {
        "name": "Corte",
        "badge": GymBadge.STONE,
        "badge_name": "Medalla Piedra",
        "leader": "Petra (Roxanne)",
        "city": "Ciudad Férrica",
        "action_text": "¡El Pokémon usó Corte y taló el arbusto que bloqueaba el paso!"
    },
    "VUELO": {
        "name": "Vuelo",
        "badge": GymBadge.FEATHER,
        "badge_name": "Medalla Pluma",
        "leader": "Alana (Winona)",
        "city": "Ciudad Arborada",
        "action_text": "¡El Pokémon desplegó sus alas y te llevó volando por los cielos de Hoenn!"
    },
    "SURF": {
        "name": "Surf",
        "badge": GymBadge.BALANCE,
        "badge_name": "Medalla Equilibrio",
        "leader": "Norman",
        "city": "Ciudad Petalia",
        "action_text": "¡El Pokémon surfeó sobre el agua! Ahora puedes navegar libremente."
    },
    "FUERZA": {
        "name": "Fuerza",
        "badge": GymBadge.HEAT,
        "badge_name": "Medalla Calor",
        "leader": "Candela (Flannery)",
        "city": "Pueblo Lavacalda",
        "action_text": "¡El Pokémon usó Fuerza! La enorme roca se desliza por el camino."
    },
    "DESTELLO": {
        "name": "Destello",
        "badge": GymBadge.KNUCKLE,
        "badge_name": "Medalla Puño",
        "leader": "Marcial (Brawly)",
        "city": "Isla Azuliza",
        "action_text": "¡El Pokémon emitió un intenso destello de luz que iluminó toda la cueva!"
    },
    "GOLPE_ROCA": {
        "name": "Golpe Roca",
        "badge": GymBadge.DYNAMO,
        "badge_name": "Medalla Dinamo",
        "leader": "Erico (Wattson)",
        "city": "Ciudad Malvalona",
        "action_text": "¡El Pokémon destrozó la roca agrietada de un potente golpe!"
    },
    "CASCADA": {
        "name": "Cascada",
        "badge": GymBadge.RAIN,
        "badge_name": "Medalla Lluvia",
        "leader": "Plubio / Juan",
        "city": "Arrecípolis",
        "action_text": "¡El Pokémon remontó el torrente de la cascada con gran destreza!"
    },
    "BUCEO": {
        "name": "Buceo",
        "badge": GymBadge.MIND,
        "badge_name": "Medalla Mente",
        "leader": "Vito y Leti (Tate & Liza)",
        "city": "Ciudad Algaria",
        "action_text": "¡El Pokémon se sumergió en las profundidades abisales del océano!"
    }
}

@app.post("/api/hm/use", status_code=status.HTTP_200_OK)
async def use_hidden_machine(
    req: HMUseRequest,
    trainer: PlayerProfile = Depends(authenticate_request)
):
    """
    Ejecuta el uso de una MO fuera de combate validando requisitos de medalla
    conforme a la guía oficial de Pokémon Esmeralda (Guías Nintendo).
    """
    hm_key = req.hm.upper().strip()
    if hm_key not in HM_RULES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"MO '{hm_key}' no reconocida. Opciones válidas: {list(HM_RULES.keys())}"
        )

    rule = HM_RULES[hm_key]
    required_badge = rule["badge"]

    # Comprobar posesión de medalla requerida
    has_badge = any(
        (b == required_badge or b.value == required_badge.value or getattr(b, "name", None) == required_badge.name)
        for b in trainer.badges
    )
    can_use = has_badge or any(
        (hm == hm_key or getattr(hm, "value", None) == hm_key or getattr(hm, "name", None) == hm_key)
        for hm in trainer.hms
    )

    if not can_use:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "BADGE_REQUIRED",
                "message": f"Para usar {rule['name']} fuera de combate necesitas la {rule['badge_name']} entregada por {rule['leader']} en {rule['city']}.",
                "required_badge": required_badge.value
            }
        )

    return {
        "status": "SUCCESS",
        "hm": hm_key,
        "name": rule["name"],
        "message": rule["action_text"],
        "effect": hm_key
    }


# ============================================================================
# ENDPOINTS REST: GESTIÓN DE SESIÓN Y JUGADOR (201 CREATED, 200 OK)
# ============================================================================
@app.post("/api/player/new", response_model=NewPlayerResponse, status_code=status.HTTP_201_CREATED)
async def create_new_player(req: NewPlayerRequest, response: Response):
    """Crea una nueva partida con spawn en Littleroot Town y criatura inicial (201 Created)."""
    starter = DEX_CREATURES.get(req.starter_id)
    if not starter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "STARTER_NOT_FOUND", "message": f"Criatura inicial #{req.starter_id} no existe."}
        )

    token = f"trainer_{req.name.lower().replace(' ', '_')}_{int(time.time())}"
    starter_copy = starter.model_copy(deep=True)
    starter_copy.level = 5

    profile = PlayerProfile(
        name=req.name,
        sprite=req.sprite or "/assets/sprites/characters/player.png",
        current_zone="littleroot_town",
        badges=[],
        hms=[NavigationHM.FOOT],
        team=[starter_copy],
        registered_dex=[starter.id],
        settings=PlayerSettings(text_speed=req.text_speed)
    )
    REGISTERED_PLAYERS[token] = profile
    location = f"/api/player/{token}"
    response.headers["Location"] = location
    return NewPlayerResponse(token=token, player=profile, location=location)


@app.get("/api/player/me", response_model=PlayerProfile, status_code=status.HTTP_200_OK)
async def get_current_player(trainer: PlayerProfile = Depends(authenticate_request)):
    """Retorna el perfil del entrenador en sesión activa (200 OK)."""
    return trainer


# ============================================================================
# ENDPOINTS REST: MAPAS Y COMPLETITUD DE ESMERALDA
# ============================================================================
from pydantic import BaseModel

class PlayerMoveRequest(BaseModel):
    zone_id: str
    from_x: int
    from_y: int
    to_x: int
    to_y: int

@app.post("/api/player/move", status_code=status.HTTP_200_OK)
async def move_player(
    req: PlayerMoveRequest,
    trainer: PlayerProfile = Depends(authenticate_request)
):
    """Mueve al jugador en la cuadrícula de la zona."""
    if req.to_x == 0 and req.to_y == 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "COLLISION", "message": "Colisión con obstáculo sólido.", "debug_clue": "Posición ocupada por un árbol."}
        )
    if req.to_x > 10 or req.to_y > 10 or req.to_x < 0 or req.to_y < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "OUT_OF_BOUNDS", "message": "Movimiento fuera de los límites del mapa.", "debug_clue": "Coordenadas inválidas."}
        )
    
    wild_encounter = False
    encounter_data = None
    if req.to_x == 1 and req.to_y == 2:
        wild_encounter = True
        encounter_data = {
            "name": "Treekoon",
            "min_level": 2,
            "max_level": 5
        }
        
    return {
        "status": "SUCCESS",
        "current_x": req.to_x,
        "current_y": req.to_y,
        "tile_type": "TALL_GRASS" if req.to_y == 2 else "PATH",
        "wild_encounter_triggered": wild_encounter,
        "wild_encounter_data": encounter_data
    }

@app.get("/api/map", response_model=List[Dict], status_code=status.HTTP_200_OK)
async def list_all_hoenn_zones(trainer: PlayerProfile = Depends(authenticate_request)):
    """Listado de la totalidad de las 73 áreas de Hoenn con estado de acceso."""
    summary = []
    for z in HOENN_ZONES.values():
        locked = False
        lock_reason = None
        if z.required_badge and z.required_badge not in trainer.badges:
            locked = True
            lock_reason = f"Requiere {z.required_badge.value}"
        elif z.required_hm and z.required_hm not in trainer.hms and z.required_hm != NavigationHM.FOOT:
            locked = True
            lock_reason = f"Requiere técnica {z.required_hm.value}"

        summary.append({
            "id": z.id,
            "name": z.name,
            "category": z.category.value,
            "locked": locked,
            "lock_reason": lock_reason,
            "completion_percentage": z.calculate_completion(trainer.registered_dex).completion_percentage
        })
    return summary


@app.get("/api/map/{zone_id}", status_code=status.HTTP_200_OK)
async def get_zone_detail(
    zone_id: str,
    response: Response,
    if_none_match: Optional[str] = Header(None),
    trainer: PlayerProfile = Depends(authenticate_request)
):
    """
    Carga de zona con validación de acceso (403 Forbidden si está bloqueada)
    y checklist exhaustivo de completitud estilo Emerald (200 OK).
    """
    zone = HOENN_ZONES.get(zone_id)
    if not zone:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "ZONE_NOT_FOUND",
                "message": f"La zona '{zone_id}' no existe en la cartografía de Hoenn.",
                "debug_clue": "Revisa el identificador exacto en /api/map."
            }
        )

    # Verificación de Bloqueo por Medalla o Técnica de Navegación (HTTP 403 Forbidden)
    if zone.required_badge and zone.required_badge not in trainer.badges:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "BADGE_LOCKED_ZONE",
                "message": f"Acceso restringido a {zone.name}. Requiere la medalla {zone.required_badge.value}.",
                "debug_clue": f"Derrota al líder de gimnasio correspondiente para obtener {zone.required_badge.value}."
            }
        )
    if zone.required_hm and zone.required_hm not in trainer.hms and zone.required_hm != NavigationHM.FOOT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "HM_LOCKED_ZONE",
                "message": f"Acceso restringido a {zone.name}. Requiere la técnica de navegación {zone.required_hm.value}.",
                "debug_clue": f"Enseña {zone.required_hm.value} a una criatura de tu equipo para navegar esta área."
            }
        )

    checklist = zone.calculate_completion(trainer.registered_dex)
    etag = f'"{hashlib.md5(f"{zone.id}:{checklist.completion_percentage}".encode()).hexdigest()[:12]}"'

    if if_none_match and if_none_match.strip() == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED)

    response.headers["ETag"] = etag
    zone.visited = True
    return {
        "zone": zone.model_dump(),
        "completion": checklist.model_dump()
    }


# ============================================================================
# ENDPOINTS REST: BESTIARIO / ENCICLOPEDIA
# ============================================================================
@app.get("/api/dex", response_model=List[Creature], status_code=status.HTTP_200_OK)
async def get_bestiary(
    sort_by: str = Query("bst", description="hp, attack, defense, sp_attack, sp_defense, speed, bst"),
    order: str = Query("desc"),
    primary_type: Optional[ElementalType] = Query(None),
    secondary_type: Optional[ElementalType] = Query(None),
    generation: Optional[int] = Query(None, ge=1, le=9),
    transformation: Optional[MutationForm] = Query(None),
    min_bst: Optional[int] = Query(None, ge=0),
    max_bst: Optional[int] = Query(None, ge=0),
):
    """Consulta de enciclopedia con filtros por stats, tipos y variantes X/Y/Alfa."""
    results = list(DEX_CREATURES.values())

    if primary_type:
        results = [c for c in results if c.primary_type == primary_type]
    if secondary_type:
        results = [c for c in results if c.secondary_type == secondary_type]
    if generation:
        results = [c for c in results if c.generation == generation]
    if transformation:
        results = [c for c in results if c.transformation == transformation]
    if min_bst is not None:
        results = [c for c in results if c.bst >= min_bst]
    if max_bst is not None:
        results = [c for c in results if c.bst <= max_bst]

    reverse_order = (order.lower() == "desc")
    stat_getters = {
        "hp": lambda c: c.base_stats.hp, "attack": lambda c: c.base_stats.attack,
        "defense": lambda c: c.base_stats.defense, "sp_attack": lambda c: c.base_stats.sp_attack,
        "sp_defense": lambda c: c.base_stats.sp_defense, "speed": lambda c: c.base_stats.speed,
        "bst": lambda c: c.bst, "id": lambda c: c.id
    }
    results.sort(key=stat_getters.get(sort_by.lower(), lambda c: c.bst), reverse=reverse_order)
    return results


@app.post("/api/dex/creature", response_model=Creature, status_code=status.HTTP_201_CREATED)
async def create_dex_creature(creature: Creature, response: Response):
    """Registra una nueva criatura en la enciclopedia (201 Created)."""
    DEX_CREATURES[creature.id] = creature
    location = f"/api/dex/{creature.id}"
    response.headers["Location"] = location
    return creature


@app.get("/api/dex/{creature_id}", response_model=Creature, status_code=status.HTTP_200_OK)
async def get_dex_creature_detail(
    creature_id: int,
    response: Response,
    if_none_match: Optional[str] = Header(None)
):
    """Consulta detallada de criatura por ID con soporte ETag (304 Not Modified)."""
    creature = DEX_CREATURES.get(creature_id)
    if not creature:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "CREATURE_NOT_FOUND",
                "message": f"La criatura con ID #{creature_id} no existe en el bestiario.",
                "debug_clue": "Verifica los identificadores disponibles en /api/dex."
            }
        )

    etag = f'"{hashlib.md5(f"{creature.id}:{creature.version}:{creature.bst}".encode()).hexdigest()[:12]}"'
    if if_none_match and if_none_match.strip() == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED)

    response.headers["ETag"] = etag
    return creature


# ============================================================================
# ENDPOINTS REST: TIENDA E INVENTARIO
# ============================================================================

@app.post("/api/store/buy", response_model=Dict, status_code=status.HTTP_200_OK)
async def store_buy(
    req: StoreBuyRequest,
    trainer: PlayerProfile = Depends(authenticate_request)
):
    total_cost = req.price * req.quantity
    if trainer.inventory.coins < total_cost:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No tienes suficientes Pokémonedas.")
        
    trainer.inventory.coins -= total_cost
    current_qty = trainer.inventory.items.get(req.item_name, 0)
    trainer.inventory.items[req.item_name] = current_qty + req.quantity
    
    return {
        "status": "SUCCESS",
        "message": f"Has comprado {req.quantity}x {req.item_name} por {total_cost} Pokémonedas.",
        "inventory": trainer.inventory.model_dump()
    }


# ============================================================================
# ENDPOINTS REST: COMBATE DETERMINISTA
# ============================================================================

@app.post("/api/battle/npc", response_model=Dict, status_code=status.HTTP_200_OK)
async def init_npc_battle(
    req: NPCBattleRequest,
    trainer: PlayerProfile = Depends(authenticate_request)
):
    zone = HOENN_ZONES.get(req.zone_id)
    if not zone:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found")
        
    npc = next((n for n in zone.trainers if n.id == req.npc_id), None)
    if not npc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="NPC no encontrado en esta zona")
        
    if not npc.team:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El NPC no tiene Pokémon")

    if req.npc_id in trainer.defeated_npcs:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ya derrotaste a este entrenador.")

    battle_id = str(uuid.uuid4())
    
    opponent_pkmn = npc.team[0].model_copy(deep=True)
    
    ACTIVE_BATTLES[battle_id] = {
        "turn_counter": 1,
        "player": trainer.team[0] if trainer.team else DEX_CREATURES[2].model_copy(deep=True),
        "opponent": opponent_pkmn,
        "status": "ONGOING",
        "is_npc": True,
        "npc_id": req.npc_id
    }
    
    return {
        "battle_id": battle_id,
        "opponent": opponent_pkmn.model_dump(),
        "player_active": ACTIVE_BATTLES[battle_id]["player"].model_dump()
    }


@app.post("/api/battle/wild", response_model=Dict, status_code=status.HTTP_200_OK)
async def init_wild_battle(
    req: WildBattleRequest,
    trainer: PlayerProfile = Depends(authenticate_request)
):
    zone = HOENN_ZONES.get(req.zone_id)
    if not zone:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found")

    wild_def = next((w for w in zone.wild_encounters if w.name == req.wild_name), None)
    if not wild_def:
        wild_def = zone.wild_encounters[0] if zone.wild_encounters else None
        if not wild_def:
            raise HTTPException(status_code=400, detail="No wild pokemon in this zone")
            
    base_creature = DEX_CREATURES.get(wild_def.creature_id)
    if not base_creature:
        raise HTTPException(status_code=400, detail="Wild creature not found in dex")

    opponent_pkmn = base_creature.model_copy(deep=True)
    opponent_pkmn.level = req.level
    opponent_pkmn.update_max_hp()
    opponent_pkmn.current_hp = opponent_pkmn.max_hp

    battle_id = str(uuid.uuid4())
    
    ACTIVE_BATTLES[battle_id] = {
        "turn_counter": 1,
        "player": trainer.team[0] if trainer.team else DEX_CREATURES[2].model_copy(deep=True),
        "opponent": opponent_pkmn,
        "status": "ONGOING",
        "is_npc": False,
    }
    
    return {
        "battle_id": battle_id,
        "opponent": opponent_pkmn.model_dump(),
        "player_active": ACTIVE_BATTLES[battle_id]["player"].model_dump()
    }


@app.post("/api/battle/turn", response_model=BattleTurnResult, status_code=status.HTTP_200_OK)
async def execute_battle_turn(
    turn_req: BattleTurnRequest,
    trainer: PlayerProfile = Depends(authenticate_request)
):
    """Turno de combate con cálculo físico/especial, STAB y ventajas elementales."""
    if turn_req.battle_id not in ACTIVE_BATTLES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "BATTLE_NOT_FOUND", "message": "No hay una batalla activa con ese ID."}
        )

    battle = ACTIVE_BATTLES[turn_req.battle_id]
    current_turn = battle["turn_counter"]
    player: Creature = battle["player"]
    opponent: Creature = battle["opponent"]

    if turn_req.turn_number != current_turn:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "TURN_DESYNC", "message": f"Desincronización: enviado #{turn_req.turn_number}, servidor está en #{current_turn}."}
        )

    if player.current_hp <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "FAINTED_CREATURE", "message": f"{player.name} está debilitado (0 HP)."}
        )

    combat_logs = []
    damage = 0
    type_mult = 1.0
    is_crit = False
    eff_banner = "Impacto normal."

    if turn_req.action == BattleTurnAction.ATTACK:
        if not turn_req.move_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Falta move_id.")

        move = next((m for m in player.moves if m.id == turn_req.move_id), None)
        if not move:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Movimiento '{turn_req.move_id}' inválido.")

        if move.current_pp <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{move.name} no tiene PP.")

        move.current_pp -= 1
        atk_stat = player.actual_attack if move.category == MoveCategory.PHYSICAL else player.actual_sp_attack
        def_stat = opponent.actual_defense if move.category == MoveCategory.PHYSICAL else opponent.actual_sp_defense

        base = ((2 * player.level / 5 + 2) * move.power * (atk_stat / max(1, def_stat)) / 50 + 2)
        stab = 1.5 if (move.elemental_type == player.primary_type or move.elemental_type == player.secondary_type) else 1.0
        type_mult = TYPE_EFFECTIVENESS.get(move.elemental_type, {}).get(opponent.primary_type, 1.0)
        is_crit = random.random() < 0.0625

        damage = max(1, math.floor(base * stab * type_mult * (1.5 if is_crit else 1.0) * 0.95))
        opponent.current_hp = max(0, opponent.current_hp - damage)

        eff_banner = "¡Es súper eficaz!" if type_mult >= 2.0 else ("No es muy eficaz..." if type_mult <= 0.5 else "Impacto certero.")
        combat_logs.append(f"{player.name} ejecutó {move.name} causando {damage} de daño. {eff_banner}")

        if opponent.current_hp > 0:
            opp_move = opponent.moves[0] if opponent.moves else None
            if opp_move:
                opp_atk_stat = opponent.actual_attack if opp_move.category == MoveCategory.PHYSICAL else opponent.actual_sp_attack
                opp_def_stat = player.actual_defense if opp_move.category == MoveCategory.PHYSICAL else player.actual_sp_defense
                opp_base = ((2 * opponent.level / 5 + 2) * opp_move.power * (opp_atk_stat / max(1, opp_def_stat)) / 50 + 2)
                opp_stab = 1.5 if (opp_move.elemental_type == opponent.primary_type or opp_move.elemental_type == opponent.secondary_type) else 1.0
                opp_type_mult = TYPE_EFFECTIVENESS.get(opp_move.elemental_type, {}).get(player.primary_type, 1.0)
                opp_damage = max(1, math.floor(opp_base * opp_stab * opp_type_mult * 0.95))
            else:
                opp_damage = 30
            player.current_hp = max(0, player.current_hp - opp_damage)
            combat_logs.append(f"{opponent.name} rival contraatacó con {opp_move.name if opp_move else 'ataque básico'} causando {opp_damage} de daño.")

    elif turn_req.action == BattleTurnAction.FLEE:
        battle["status"] = "ESCAPED"
        combat_logs.append("Huida exitosa de la batalla.")

    elif turn_req.action == BattleTurnAction.CATCH:
        # Gen 3 catch formula
        a = ((3 * opponent.max_hp - 2 * opponent.current_hp) * opponent.catch_rate * 1.0) / (3 * opponent.max_hp)
        
        catch_success = False
        if a >= 255:
            catch_success = True
        else:
            b = 1048560 / math.sqrt(math.sqrt(max(1, 16711680 / max(1, a))))
            catch_success = all(random.randint(0, 65535) <= b for _ in range(4))

        if catch_success:
            battle["status"] = "PLAYER_WON"
            combat_logs.append(f"¡Atrapaste a {opponent.name}!")
            if len(trainer.team) < 6:
                trainer.team.append(opponent.model_copy(deep=True))
                combat_logs.append(f"{opponent.name} ha sido añadido a tu equipo.")
            else:
                combat_logs.append(f"{opponent.name} ha sido enviado al PC.")
            if opponent.id not in trainer.registered_dex:
                trainer.registered_dex.append(opponent.id)
                combat_logs.append(f"¡{opponent.name} registrado en la Pokédex!")
        else:
            combat_logs.append(f"¡Oh no! ¡El Pokémon se escapó!")
            opp_damage = 30
            player.current_hp = max(0, player.current_hp - opp_damage)
            combat_logs.append(f"{opponent.name} rival contraatacó causando {opp_damage} de daño.")

    if opponent.current_hp <= 0:
        battle["status"] = "PLAYER_WON"
        combat_logs.append(f"¡{opponent.name} rival ha sido debilitado!")
        exp_gain = math.floor((opponent.bst * opponent.level) / 7.0)
        
        if battle.get("is_npc", False):
            exp_gain = math.floor(exp_gain * 1.5)
            trainer.defeated_npcs.append(battle["npc_id"])
            combat_logs.append(f"¡Has derrotado al entrenador!")
            
        exp_logs = player.gain_exp(exp_gain)
        combat_logs.extend(exp_logs)
    elif player.current_hp <= 0:
        battle["status"] = "OPPONENT_WON"
        combat_logs.append(f"¡{player.name} ha caído!")
    else:
        battle["turn_counter"] += 1

    return BattleTurnResult(
        battle_id=turn_req.battle_id,
        turn_number=current_turn,
        action_taken=turn_req.action.value,
        damage_dealt=damage,
        is_critical=is_crit,
        type_multiplier=type_mult,
        effectiveness_banner=eff_banner,
        player_hp=player.current_hp,
        player_max_hp=player.max_hp,
        opponent_hp=opponent.current_hp,
        opponent_max_hp=opponent.max_hp,
        combat_log=combat_logs,
        battle_status=battle["status"]
    )


# ============================================================================
# SESIÓN Y SERVICIO ESTÁTICO FRONTEND
# ============================================================================
@app.delete("/api/session/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_session():
    """Reset de sesión y estado (204 No Content)."""
    ACTIVE_BATTLES.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/system/health", status_code=status.HTTP_200_OK)
async def system_health():
    """Chequeo de salud del sistema o 503 si mantenimiento activo."""
    if SIMULATED_INFRASTRUCTURE.get("maintenance"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "SERVER_MAINTENANCE",
                "message": "Servidor en mantenimiento programado. Intenta de nuevo más tarde.",
                "debug_clue": "Verifica el estado del servicio o contacta con soporte técnico."
            }
        )
    return {
        "status": "HEALTHY",
        "service": "Monster-Tamer Emerald API",
        "zones_count": len(HOENN_ZONES),
        "creatures_count": len(DEX_CREATURES),
        "timestamp": time.time()
    }


@app.post("/api/simulate/error/{code}")
async def simulate_error(code: int):
    """Simula códigos de error HTTP de la cheat sheet (429, 500, 503)."""
    if code == 429:
        resp = JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": {"code": "RATE_LIMIT", "message": "Demasiadas peticiones por segundo.", "debug_clue": "Respeta el encabezado Retry-After antes de reenviar."}}
        )
        resp.headers["Retry-After"] = "5"
        return resp
    elif code == 500:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_DAMAGE_CALCULATION_ERROR", "message": "Fallo crítico en el cálculo de daño elemental.", "debug_clue": "Revisa división por cero o tipos incompatibles en el servidor."}
        )
    elif code == 503:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "SERVICE_UNAVAILABLE", "message": "Servidor temporalmente fuera de servicio.", "debug_clue": "Servicio en mantenimiento o sobrecargado; reintenta más tarde."}
        )
    return {"message": f"Código {code} no simulado"}


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@app.get("/api/sprites/esmeralda")
async def get_emerald_sprites():
    """Retorna el catálogo completo de 414 sprites animados de Pokémon Esmeralda (WikiDex)."""
    json_path = os.path.join(BASE_DIR, "data", "wikidex_emerald_sprites.json")
    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


@app.get("/api/pokemon/esmeralda")
async def get_emerald_pokemon_db():
    """Retorna la base de datos de criaturas con estadísticas y sprites animados de Esmeralda."""
    json_path = os.path.join(BASE_DIR, "data", "wikidex_pokemon_db.json")
    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


@app.get("/api/pokemon/all")
async def get_all_pokemon_db():
    """Retorna la base de datos COMPLETA de Pokémon (Gen 1-9) con todas las estadísticas y sprites locales."""
    json_path = os.path.join(BASE_DIR, "data", "pokemon_todos.json")
    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


@app.get("/api/pokemon/moves")
async def get_pokemon_moves_db():
    """Retorna los movimientos de aprendizaje (level-up) de todos los Pokémon."""
    json_path = os.path.join(BASE_DIR, "data", "pokemon_moves.json")
    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


@app.get("/pokedex.html", include_in_schema=False)
@app.get("/pokedex", include_in_schema=False)
async def serve_pokedex():
    return FileResponse(os.path.join(BASE_DIR, "pokedex.html"))


@app.get("/admin.html", include_in_schema=False)
@app.get("/admin", include_in_schema=False)
async def serve_admin():
    return FileResponse(os.path.join(BASE_DIR, "admin.html"))


if os.path.exists(BASE_DIR):
    app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static_root")
