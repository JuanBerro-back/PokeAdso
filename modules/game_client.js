/**
 * modules/game_client.js — Cliente de Conexión Frontend ↔ Backend FastAPI
 * Maneja:
 * - Detección automática y resiliencia de servidor (Online / Offline Fallback)
 * - Autenticación y perfil de entrenador (/api/player/new, /api/player/me)
 * - Consulta de zonas y checklist de completitud (/api/map)
 * - Combate autoritativo con cálculo de STAB y efectividad (/api/battle/turn)
 * - Sincronización multijugador en tiempo real por WebSockets (/ws/lobby)
 */
"use strict";

(function (window) {
  // Normalización de tipos entre Frontend (GBA / Español), Backend (Pydantic) y Tipos.json
  const TYPE_MAP_TO_BACKEND = {
    'fuego': 'FUEGO', 'agua': 'AGUA', 'planta': 'PLANTA',
    'electrico': 'ELECTRICO', 'eléctrico': 'ELECTRICO',
    'tierra': 'TIERRA', 'volador': 'VOLADOR',
    'siniestro': 'SINIESTRO', 'psiquico': 'PSIQUICO', 'psíquico': 'PSIQUICO',
    'acero': 'ACERO', 'normal': 'NORMAL',
    'hielo': 'HIELO', 'lucha': 'LUCHA', 'veneno': 'VENENO',
    'bicho': 'BICHO', 'roca': 'ROCA', 'fantasma': 'FANTASMA',
    'dragon': 'DRAGON', 'dragón': 'DRAGON'
  };

  const STANDARD_TYPE_TABLE = {
    'Normal':   {'Roca':0.5,'Acero':0.5,'Fantasma':0},
    'Fuego':    {'Fuego':0.5,'Agua':0.5,'Planta':2,'Roca':0.5,'Acero':2,'Bicho':2,'Hielo':2},
    'Agua':     {'Fuego':2,'Agua':0.5,'Planta':0.5,'Tierra':2,'Roca':2,'Dragón':0.5},
    'Planta':   {'Fuego':0.5,'Agua':2,'Planta':0.5,'Tierra':2,'Roca':2,'Volador':0.5,'Veneno':0.5},
    'Eléctrico':{'Agua':2,'Planta':0.5,'Eléctrico':0.5,'Tierra':0,'Volador':2,'Dragón':0.5},
    'Hielo':    {'Fuego':0.5,'Agua':0.5,'Planta':2,'Tierra':2,'Volador':2,'Dragón':2,'Acero':0.5},
    'Lucha':    {'Normal':2,'Roca':2,'Acero':2,'Siniestro':2,'Hada':0.5,'Veneno':0.5,'Psíquico':0.5,'Volador':0.5,'Bicho':0.5,'Fantasma':0},
    'Veneno':   {'Planta':2,'Veneno':0.5,'Tierra':0.5,'Roca':0.5,'Fantasma':0.5,'Acero':0},
    'Tierra':   {'Fuego':2,'Eléctrico':2,'Veneno':2,'Roca':2,'Acero':2,'Planta':0.5,'Volador':0},
    'Volador':  {'Planta':2,'Lucha':2,'Bicho':2,'Eléctrico':0.5,'Roca':0.5,'Acero':0.5},
    'Psíquico': {'Lucha':2,'Veneno':2,'Psíquico':0.5,'Siniestro':0,'Acero':0.5},
    'Bicho':    {'Planta':2,'Psíquico':2,'Siniestro':2,'Hada':0.5,'Fuego':0.5,'Lucha':0.5,'Volador':0.5,'Veneno':0.5,'Fantasma':0.5,'Acero':0.5},
    'Roca':     {'Fuego':2,'Hielo':2,'Volador':2,'Bicho':2,'Lucha':0.5,'Tierra':0.5,'Acero':0.5},
    'Fantasma': {'Psíquico':2,'Fantasma':2,'Normal':0,'Siniestro':0.5},
    'Dragón':   {'Dragón':2,'Acero':0.5,'Hada':0},
    'Siniestro':{'Psíquico':2,'Fantasma':2,'Siniestro':0.5,'Lucha':0.5,'Hada':0.5},
    'Acero':    {'Hielo':2,'Roca':2,'Hada':2,'Fuego':0.5,'Agua':0.5,'Eléctrico':0.5,'Acero':0.5},
    'Hada':     {'Lucha':2,'Dragón':2,'Siniestro':2,'Fuego':0.5,'Veneno':0.5,'Acero':0.5}
  };

  class GameClient {
    constructor(baseUrl = '') {
      this.baseUrl = baseUrl || (window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : window.location.origin);
      this.token = sessionStorage.getItem('hoennTrainerToken') || null;
      this.isOnline = false;
      this.lastHealthCheck = 0;
    }

    normalizeType(typeStr) {
      if (!typeStr) return 'NEUTRAL';
      const clean = String(typeStr).split('/')[0].trim().toLowerCase();
      return TYPE_MAP_TO_BACKEND[clean] || 'NEUTRAL';
    }

    getTypeEffectiveness(moveType, targetType) {
      const cleanMove = moveType ? moveType.charAt(0).toUpperCase() + moveType.slice(1).toLowerCase() : 'Normal';
      const cleanTarget = targetType ? targetType.charAt(0).toUpperCase() + targetType.slice(1).toLowerCase() : 'Normal';
      return STANDARD_TYPE_TABLE[cleanMove]?.[cleanTarget] ?? 1.0;
    }

    async checkHealth() {
      const now = Date.now();
      if (now - this.lastHealthCheck < 10000) return this.isOnline;
      this.lastHealthCheck = now;
      try {
        const res = await fetch(`${this.baseUrl}/api/map`, {
          method: 'GET',
          headers: this.token ? { 'Authorization': `Bearer ${this.token}` } : {}
        });
        // Si responde 200 o 401 (el servidor existe y pide token)
        this.isOnline = res.status === 200 || res.status === 401;
      } catch {
        this.isOnline = false;
      }
      return this.isOnline;
    }

    async registerPlayer(name = 'Brendan', starterId = 2) {
      try {
        const res = await fetch(`${this.baseUrl}/api/player/new`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            starter_id: starterId,
            sprite: '/assets/sprites/brendan_spritesheet.png',
            text_speed: 'FAST'
          })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.token = data.token;
        sessionStorage.setItem('hoennTrainerToken', this.token);
        this.isOnline = true;
        return data;
      } catch (err) {
        console.warn('GameClient: Backend no disponible para registro, usando perfil local:', err);
        this.isOnline = false;
        return null;
      }
    }

    async getPlayerProfile() {
      if (!this.token) return null;
      try {
        const res = await fetch(`${this.baseUrl}/api/player/me`, {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }

    async fetchZones() {
      if (!this.token) return null;
      try {
        const res = await fetch(`${this.baseUrl}/api/map`, {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }

    async executeBattleTurn(actionPayload) {
      if (this.isOnline && this.token) {
        try {
          const res = await fetch(`${this.baseUrl}/api/battle/turn`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify(actionPayload)
          });
          if (res.ok) {
            return await res.json();
          }
        } catch (e) {
          console.warn('Fallo en combate remoto, ejecutando cálculo determinista local:', e);
        }
      }

      // Fallback local determinista auténtico de GBA
      return this.calculateLocalTurn(actionPayload);
    }

    calculateLocalTurn({ player, opponent, move, isPlayerTurn = true }) {
      const attacker = isPlayerTurn ? player : opponent;
      const defender = isPlayerTurn ? opponent : player;

      const power = move?.power || 40;
      const moveType = move?.type || 'Normal';
      const moveCategory = move?.categoria || move?.category || 'fisico';
      const defenderType = defender?.type || 'Normal';

      const effectiveness = this.getTypeEffectiveness(moveType, defenderType);
      const isCritical = Math.random() < 0.0625; // 6.25% crítico en Gen 3
      const stab = (attacker?.type && attacker.type.toLowerCase().includes(moveType.toLowerCase())) ? 1.5 : 1.0;
      const randomFactor = 0.85 + Math.random() * 0.15;

      const level = attacker?.level || 5;
      let attackStat = attacker?.attack || attacker?.ataque || 20;
      let defenseStat = defender?.defense || defender?.defensa || 18;

      if (moveCategory.toLowerCase() === 'especial' || moveCategory.toLowerCase() === 'special') {
        attackStat = attacker?.sp_attack || attacker?.ataqueEspecial || attackStat;
        defenseStat = defender?.sp_defense || defender?.defensaEspecial || defenseStat;
      }

      const baseDmg = ((2 * level / 5 + 2) * power * (attackStat / Math.max(1, defenseStat)) / 50 + 2);
      const finalDamage = Math.max(1, Math.floor(baseDmg * effectiveness * stab * (isCritical ? 1.5 : 1.0) * randomFactor));

      const newDefenderHp = Math.max(0, (defender.currentHp ?? defender.hp) - finalDamage);

      let log = `${attacker.name} usó ${move.name || 'Placaje'} causando ${finalDamage} PS de daño.`;
      if (effectiveness > 1) log += ' ¡Es muy eficaz!';
      else if (effectiveness < 1 && effectiveness > 0) log += ' No es muy eficaz...';
      else if (effectiveness === 0) log += ' No afecta al rival.';
      if (isCritical) log += ' ¡Un golpe crítico!';

      return {
        damage: finalDamage,
        newHp: newDefenderHp,
        isFainted: newDefenderHp <= 0,
        effectiveness,
        isCritical,
        log
      };
    }

    async register(username, password, starterId = 2, email = null, avatarStyle = 'brendan') {
      try {
        const res = await fetch(`${this.baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            password,
            email,
            starter_id: starterId,
            avatar_style: avatarStyle
          })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Error al registrar usuario');
        }
        const data = await res.json();
        this.token = data.token;
        sessionStorage.setItem('hoennTrainerToken', this.token);
        localStorage.setItem('pokepoke_user', JSON.stringify({ username: data.username, token: this.token }));
        this.isOnline = true;
        return data;
      } catch (err) {
        console.error('GameClient.register error:', err);
        throw err;
      }
    }

    async login(username, password) {
      try {
        const res = await fetch(`${this.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Credenciales inválidas');
        }
        const data = await res.json();
        this.token = data.token;
        sessionStorage.setItem('hoennTrainerToken', this.token);
        localStorage.setItem('pokepoke_user', JSON.stringify({ username: data.username, token: this.token }));
        this.isOnline = true;
        return data;
      } catch (err) {
        console.error('GameClient.login error:', err);
        throw err;
      }
    }

    async saveState(profileData) {
      if (!this.token) return false;
      try {
        const res = await fetch(`${this.baseUrl}/api/auth/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify(profileData)
        });
        return res.ok;
      } catch (err) {
        console.warn('Fallo al guardar en backend:', err);
        return false;
      }
    }

    async useHM(hmName, targetZone = null) {
      if (!this.token) throw new Error('Debes iniciar sesión para usar una MO.');
      try {
        const res = await fetch(`${this.baseUrl}/api/hm/use`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ hm: hmName, target_zone: targetZone })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail?.message || err.detail || 'No puedes usar esta MO aún.');
        }
        return await res.json();
      } catch (err) {
        console.error('Error usando MO:', err);
        throw err;
      }
    }
  }

  class MultiplayerLobbyClient {
    constructor(gameClient) {
      this.client = gameClient;
      this.socket = null;
      this.otherPlayers = new Map();
      this.listeners = {
        onPlayersUpdate: [],
        onPlayerMoved: [],
        onPlayerJoined: [],
        onPlayerLeft: [],
        onDuelRequest: [],
        onChallengeResponse: [],
        onChatMessage: [],
        onTradeInvite: [],
        onTradeStarted: [],
        onTradeSync: [],
        onTradeCompleted: [],
        onTradeCancelled: [],
        onTradeDeclined: [],
        onSeatUpdated: [],
        onPvpBattleStart: [],
        onPvpBattleTurnResult: [],
        onPvpBattleEnd: [],
      };
      this.lastPositionSent = 0;
    }

    on(event, callback) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(callback);
    }

    emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(cb => {
          try { cb(data); } catch (e) { console.error(e); }
        });
      }
    }

    connect(trainerId = 'brendan_guest', trainerName = 'Brendan', token = null) {
      if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
        if (trainerId === this._lastId && token === this._lastToken) {
          return; // Ya está conectado con la misma sesión
        }
        console.log('MultiplayerLobby: Cambiando de sesión, cerrando conexión anterior...');
        this.socket.close();
      }

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.protocol === 'file:' ? '127.0.0.1:8000' : window.location.host;

      let wsUrl = `${wsProtocol}//${wsHost}/ws/lobby?trainer_id=${encodeURIComponent(trainerId)}&trainer_name=${encodeURIComponent(trainerName)}`;
      if (token) wsUrl += `&token=${encodeURIComponent(token)}`;

      // Store for reconnect
      this._lastId   = trainerId;
      this._lastName = trainerName;
      this._lastToken = token;

      try {
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
          console.log('MultiplayerLobby: Conectado a la sala multijugador.');
          // Sincroniza el color de bandana elegido en el lobby 3D.
          try {
            const variant = Number(localStorage.getItem('pokepoke.bandana')) || 0;
            this.sendAvatarStyle(variant);
          } catch (error) { /* almacenamiento bloqueado */ }
        };

        this.socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            console.log('[WS DEBUG] RECV:', msg.type, msg);
            
            if (msg.type === 'ERROR' && msg.message === 'No autenticado') {
              console.error('Sesión inválida o expirada. Cerrando sesión...');
              localStorage.removeItem('pokepoke_user');
              window.location.reload();
              return;
            }

            this.handleMessage(msg);
          } catch (e) {
            console.error('MultiplayerLobby: Error parseando mensaje', e);
          }
        };

        this.socket.onclose = () => {
          this.socket = null;
          // Reintento silencioso en 15 segundos
          setTimeout(() => {
            if (!this.socket) this.connect(this._lastId, this._lastName, this._lastToken);
          }, 15000);
        };

        this.socket.onerror = () => {
          if (this.socket) this.socket.close();
        };
      } catch (err) {
        console.warn('MultiplayerLobby: Servidor WebSocket no alcanzable.', err);
      }
    }

    handleMessage(msg) {
      if (msg.type === 'LOBBY_PLAYERS_UPDATE') {
        this.otherPlayers.clear();
        (msg.players || []).forEach(p => {
          this.otherPlayers.set(p.id, p);
        });
        this.emit('onPlayersUpdate', Array.from(this.otherPlayers.values()));

      } else if (msg.type === 'PLAYER_JOINED') {
        this.otherPlayers.set(msg.id, msg);
        this.emit('onPlayersUpdate', Array.from(this.otherPlayers.values()));
        this.emit('onPlayerJoined', msg);

      } else if (msg.type === 'PLAYER_LEFT') {
        this.otherPlayers.delete(msg.id);
        this.emit('onPlayersUpdate', Array.from(this.otherPlayers.values()));
        this.emit('onPlayerLeft', msg);

      } else if (msg.type === 'PLAYER_MOVED') {
        this.otherPlayers.set(msg.id, { ...(this.otherPlayers.get(msg.id) || {}), ...msg });
        this.emit('onPlayerMoved', msg);

      } else if (msg.type === 'CHAT_MESSAGE_RECEIVED' || msg.type === 'CHAT_MESSAGE_SENT') {
        const sender = this.otherPlayers.get(msg.sender_id);
        if (sender) {
          sender.chat_bubble = msg.text;
          sender.chat_bubble_until = (Date.now() / 1000) + 6.0;
        }
        this.emit('onChatMessage', msg);

      } else if (msg.type === 'DUEL_REQUEST_RECEIVED') {
        this.emit('onDuelRequest', msg.challenge);
      } else if (msg.type === 'CHALLENGE_RESPONSE') {
        this.emit('onChallengeResponse', msg);
      } else if (msg.type === 'TRADE_INVITE_RECEIVED') {
        this.emit('onTradeInvite', msg);
      } else if (msg.type === 'TRADE_STARTED') {
        this.emit('onTradeStarted', msg.trade);
      } else if (msg.type === 'TRADE_SYNC') {
        this.emit('onTradeSync', msg);
      } else if (msg.type === 'TRADE_COMPLETED') {
        this.emit('onTradeCompleted', msg);
      } else if (msg.type === 'TRADE_CANCELLED' || msg.type === 'TRADE_CANCEL') {
        this.emit('onTradeCancelled', msg);
      } else if (msg.type === 'TRADE_DECLINED') {
        this.emit('onTradeDeclined', msg);
      } else if (msg.type === 'SEAT_UPDATED') {
        this.emit('onSeatUpdated', msg);
      } else if (msg.type === 'PVP_BATTLE_START') {
        console.log('[DEBUG] A punto de emitir onPvpBattleStart con listeners:', Object.keys(this.listeners), 'tiene listener?', !!this.listeners['onPvpBattleStart']);
        this.emit('onPvpBattleStart', msg);
        console.log('[DEBUG] emit finalizado');
      } else if (msg.type === 'PVP_BATTLE_TURN_RESULT') {
        this.emit('onPvpBattleTurnResult', msg);
      } else if (msg.type === 'PVP_BATTLE_END') {
        this.emit('onPvpBattleEnd', msg);
      }
    }

    sendAction(action, payload = {}) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        console.error('[WS] No se envió la acción:', action, '— socket no abierto (readyState=' + (this.socket ? this.socket.readyState : 'null') + ')');
        return;
      }
      this.socket.send(JSON.stringify({ action, ...payload }));
    }

    sendPosition(x, y, dir, mapId, state = 'EXPLORING', badges = 0) {
      const now = Date.now();
      if (now - this.lastPositionSent < 66) return; // 15 Hz para movimiento suave
      this.lastPositionSent = now;

      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          action: 'UPDATE_STATE',
          state: 'EXPLORING',
          x: Math.round(x),
          y: Math.round(y),
          dir: dir,
          mapId: mapId,
          avatar_style: this.getAvatarStyle()
        }));
      }
    }

    getAvatarStyle() {
      try {
        const variant = Number(localStorage.getItem('pokepoke.bandana')) || 0;
        return `brendan:${Math.max(0, Math.min(5, variant))}`;
      } catch (error) {
        return 'brendan:0';
      }
    }

    sendAvatarStyle(variant) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const renderer = window.worldTileRenderer;
      const position = (renderer && renderer.playerPos) || { x: 240, y: 240 };
      this.sendAction('UPDATE_STATE', {
        state: 'EXPLORING',
        x: Math.round(position.x),
        y: Math.round(position.y),
        dir: (renderer && renderer.playerDir) || 'down',
        mapId: (renderer && renderer.mapId) || 'grand_hotel_lobby',
        avatar_style: `brendan:${Math.max(0, Math.min(5, Number(variant) || 0))}`
      });
    }

    sendChat(text, scope = 'ROOM', targetId = null) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN && text) {
        this.socket.send(JSON.stringify({
          action: 'CHAT_MESSAGE',
          text: text,
          scope: scope,
          target_id: targetId
        }));
      }
    }

    interactSeat(seatId, sit = true, x = null, y = null, dir = 'down') {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          action: 'SEAT_INTERACT',
          seat_id: seatId,
          sit: !!sit,
          x: x,
          y: y,
          dir: dir
        }));
      }
    }

    sendTradeInvite(targetId) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          action: 'TRADE_INVITE',
          target_id: targetId
        }));
      }
    }

    respondTrade(tradeId, accept) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          action: 'RESPOND_TRADE',
          trade_id: tradeId,
          accept: !!accept
        }));
      }
    }

    sendTradeOffer(tradeId, pokemonIndex = null, pokemonSummary = null, items = {}) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          action: 'TRADE_OFFER',
          trade_id: tradeId,
          pokemon_index: pokemonIndex,
          pokemon_summary: pokemonSummary,
          items: items
        }));
      }
    }

    lockTrade(tradeId) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          action: 'TRADE_LOCK',
          trade_id: tradeId
        }));
      }
    }

    confirmTrade(tradeId) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          action: 'TRADE_CONFIRM',
          trade_id: tradeId
        }));
      }
    }

    cancelTrade(tradeId) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          action: 'TRADE_CANCEL',
          trade_id: tradeId
        }));
      }
    }

    sendChallenge(targetId) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        const team = window.App && window.App.getPvpTeamPayload ? window.App.getPvpTeamPayload() : null;
        this.socket.send(JSON.stringify({
          action: 'CHALLENGE_TRAINER',
          target_id: targetId,
          team: team
        }));
      }
    }

    respondChallenge(challengeId, accept) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          action: 'RESPOND_CHALLENGE',
          challenge_id: challengeId,
          accept: !!accept
        }));
      }
    }
  }

  window.GameClient = new GameClient();
  window.MultiplayerClient = new MultiplayerLobbyClient(window.GameClient);

})(window);
