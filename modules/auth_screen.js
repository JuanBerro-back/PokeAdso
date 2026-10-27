/**
 * modules/auth_screen.js
 * Pantalla de inicio GBA — Login / Registro real contra la API FastAPI.
 * Llama a window.onPlayerAuthenticated(session) al autenticar.
 */
"use strict";
(function (window) {
  /**
   * Base de la API. En GitHub Pages (hosting estático) no existe /api, así que
   * se puede apuntar a un backend real con:
   *   - <meta name="pokepoke-api" content="https://mi-backend.onrender.com">
   *   - window.POKEPOKE_API_BASE = 'https://...'
   *   - localStorage.setItem('pokepoke.apiBase', 'https://...')
   * Si no hay backend, la pantalla funciona con cuentas locales del navegador.
   */
  function resolveApiBase() {
    let stored = null;
    try { stored = localStorage.getItem('pokepoke.apiBase'); } catch { /* modo privado */ }
    const meta = document.querySelector('meta[name="pokepoke-api"]');
    const override = window.POKEPOKE_API_BASE || (meta && meta.content) || stored;
    if (override) return String(override).trim().replace(/\/+$/, '');
    if (window.location.protocol === 'file:') return 'http://127.0.0.1:8000';
    return window.location.origin;
  }
  const BASE_URL = resolveApiBase();

  const LOCAL_ACCOUNTS_KEY = 'pokepoke.localAccounts';
  let serverOnline = false;

  class ApiOfflineError extends Error {}

  /** fetch a la API que distingue "sin backend" (HTML) de un error real (JSON). */
  async function apiJson(path, options = {}) {
    let res;
    try {
      res = await fetch(`${BASE_URL}${path}`, options);
    } catch {
      throw new ApiOfflineError('No se pudo conectar con el servidor del juego.');
    }
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) {
      throw new ApiOfflineError('Esta dirección solo sirve archivos estáticos: no hay servidor del juego para cuentas y MMO.');
    }
    let body = null;
    try { body = await res.json(); } catch { throw new ApiOfflineError('El servidor devolvió una respuesta no válida.'); }
    if (!res.ok) {
      const detail = body && body.detail;
      const message = typeof detail === 'string'
        ? detail
        : (detail && detail.message) || (detail && detail[0] && detail[0].msg) || 'Error del servidor.';
      throw new Error(message);
    }
    return body;
  }

  function readLocalAccounts() {
    try {
      const raw = localStorage.getItem(LOCAL_ACCOUNTS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  }

  function writeLocalAccounts(map) {
    try { localStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(map)); } catch { /* sin espacio */ }
  }

  async function hashPassword(password) {
    const text = `pokepoke:${password}`;
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      try {
        const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch { /* usar el hash simple */ }
    }
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    return `h${hash.toString(16)}`;
  }

  function localSession(account) {
    return {
      token: `local-${account.username}-${Date.now().toString(36)}`,
      username: account.username,
      email: account.email || '',
      starter_id: account.starterId,
      avatar_style: account.avatarStyle,
      isLocal: true,
    };
  }

  async function registerLocally(u, p, e) {
    const accounts = readLocalAccounts();
    const key = u.toLowerCase();
    if (accounts[key]) throw new Error('Ya existe una cuenta con ese nombre en este navegador.');
    accounts[key] = {
      username: u,
      email: e,
      passwordHash: await hashPassword(p),
      starterId: selStarter,
      avatarStyle: selAvatar,
      createdAt: Date.now(),
    };
    writeLocalAccounts(accounts);
    return localSession(accounts[key]);
  }

  async function loginLocally(u, p) {
    const accounts = readLocalAccounts();
    const account = accounts[u.toLowerCase()];
    if (!account) throw new Error('No hay ninguna cuenta con ese nombre en este navegador.');
    if (account.passwordHash !== await hashPassword(p)) throw new Error('Contraseña incorrecta.');
    return localSession(account);
  }

  const CSS = `
    #authScreen{position:fixed;inset:0;z-index:99999;background:radial-gradient(ellipse at 60% 40%,#0d1b3e 0%,#060c1a 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Inter','Segoe UI',sans-serif;overflow:hidden;color:#e8eaf6;transition:opacity .6s ease;}
    #authScreen.fade-out{opacity:0;pointer-events:none;}
    .auth-stars{position:absolute;inset:0;pointer-events:none;overflow:hidden;}
    .auth-star{position:absolute;border-radius:50%;background:#fff;opacity:0;animation:twinkle var(--dur,3s) ease-in-out infinite var(--delay,0s);}
    @keyframes twinkle{0%,100%{opacity:0}50%{opacity:var(--op,.8)}}
    .auth-ball-deco{width:90px;height:90px;border-radius:50%;background:linear-gradient(to bottom,#e53935 50%,#fff 50%);border:3px solid #111;position:relative;margin-bottom:10px;box-shadow:0 0 40px rgba(229,57,53,.6);animation:float 3s ease-in-out infinite;}
    .auth-ball-deco::before{content:'';position:absolute;width:100%;height:3px;background:#111;top:calc(50% - 1.5px);left:0;}
    .auth-ball-deco::after{content:'';position:absolute;width:22px;height:22px;border-radius:50%;background:#fff;border:3px solid #111;top:50%;left:50%;transform:translate(-50%,-50%);}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
    .auth-title{font-size:clamp(1.6rem,5vw,2.4rem);font-weight:800;letter-spacing:.08em;text-align:center;background:linear-gradient(135deg,#82b1ff,#ffffff,#ff6f00);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin:0 0 4px;}
    .auth-subtitle{font-size:.82rem;color:#7986cb;letter-spacing:.15em;text-transform:uppercase;margin-bottom:24px;text-align:center;}
    .auth-panel{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);backdrop-filter:blur(18px);border-radius:20px;padding:28px 32px;width:min(420px,92vw);box-shadow:0 8px 60px rgba(0,0,0,.5);position:relative;}
    .auth-tabs{display:flex;gap:4px;background:rgba(255,255,255,.05);border-radius:12px;padding:4px;margin-bottom:20px;}
    .auth-tab{flex:1;padding:9px;border:none;border-radius:9px;background:transparent;color:#7986cb;font-size:.88rem;font-weight:600;cursor:pointer;transition:all .2s;}
    .auth-tab.active{background:linear-gradient(135deg,#3f51b5,#1a237e);color:#fff;box-shadow:0 2px 12px rgba(63,81,181,.4);}
    .auth-form-section{display:none;}
    .auth-form-section.active{display:flex;flex-direction:column;gap:14px;}
    .auth-field label{display:block;font-size:.75rem;color:#7986cb;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px;}
    .auth-field input,.auth-field select{width:100%;padding:11px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#e8eaf6;font-size:.92rem;outline:none;transition:border .2s,box-shadow .2s;box-sizing:border-box;}
    .auth-field input:focus{border-color:#5c6bc0;box-shadow:0 0 0 3px rgba(92,107,192,.25);}
    .starter-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
    .starter-card{background:rgba(255,255,255,.04);border:2px solid rgba(255,255,255,.10);border-radius:12px;padding:10px 6px;text-align:center;cursor:pointer;transition:all .2s;}
    .starter-card:hover,.starter-card.selected{border-color:#5c6bc0;background:rgba(92,107,192,.15);transform:translateY(-3px);box-shadow:0 6px 20px rgba(92,107,192,.3);}
    .starter-card img{width:56px;height:56px;image-rendering:pixelated;}
    .starter-card .s-name{font-size:.78rem;font-weight:700;color:#c5cae9;}
    .starter-card .s-type{font-size:.68rem;color:#7986cb;}
    .avatar-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
    .avatar-opt{background:rgba(255,255,255,.04);border:2px solid rgba(255,255,255,.10);border-radius:10px;padding:8px 4px;text-align:center;cursor:pointer;transition:all .2s;font-size:.75rem;color:#9fa8da;}
    .avatar-opt:hover,.avatar-opt.selected{border-color:#66bb6a;background:rgba(102,187,106,.15);color:#a5d6a7;}
    .avatar-opt span{display:block;font-size:1.5rem;}
    .auth-submit{padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,#3f51b5,#303f9f);color:#fff;font-size:1rem;font-weight:700;cursor:pointer;transition:all .2s;box-shadow:0 4px 20px rgba(63,81,181,.4);letter-spacing:.04em;width:100%;}
    .auth-submit:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 28px rgba(63,81,181,.6);}
    .auth-submit:disabled{opacity:.5;cursor:not-allowed;transform:none;}
    .auth-guest-link{text-align:center;font-size:.8rem;color:#546e7a;margin-top:8px;cursor:pointer;text-decoration:underline;transition:color .2s;}
    .auth-guest-link:hover{color:#90a4ae;}
    .auth-msg{padding:10px 14px;border-radius:10px;font-size:.82rem;display:none;text-align:center;font-weight:600;margin-bottom:4px;}
    .auth-msg.error{background:rgba(229,57,53,.15);color:#ef9a9a;border:1px solid #b71c1c;display:block;}
    .auth-msg.success{background:rgba(102,187,106,.12);color:#a5d6a7;border:1px solid #2e7d32;display:block;}
    .auth-online-badge{position:absolute;top:14px;right:16px;display:flex;align-items:center;gap:5px;font-size:.72rem;color:#66bb6a;}
    .auth-online-badge .dot{width:8px;height:8px;border-radius:50%;background:#66bb6a;animation:pulse 1.5s ease-in-out infinite;}
    .auth-online-badge.offline{color:#ef5350;}
    .auth-online-badge.offline .dot{background:#ef5350;animation:none;}
    @keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:.7}}
    .auth-spinner{display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px;}
    @keyframes spin{to{transform:rotate(360deg)}}
    .auth-players-count{text-align:center;font-size:.8rem;color:#546e7a;margin-top:12px;}
    .auth-players-count strong{color:#66bb6a;}
  `;

  const STARTERS = [
    { id:1, name:'Treecko', type:'Planta', img:'https://images.wikidexcdn.net/mwuploads/wikidex/0/08/latest/20080926023345/Treecko_E.gif' },
    { id:2, name:'Torchic', type:'Fuego',  img:'https://images.wikidexcdn.net/mwuploads/wikidex/d/d3/latest/20090206005624/Torchic_E.gif' },
    { id:3, name:'Mudkip',  type:'Agua',   img:'https://images.wikidexcdn.net/mwuploads/wikidex/7/71/latest/20091217193111/Mudkip_E.gif' },
  ];
  const AVATARS = [
    {id:'brendan',icon:'🧑',label:'Brendan'},
    {id:'may',    icon:'👧',label:'May'},
    {id:'wally',  icon:'🧒',label:'Wally'},
    {id:'steven', icon:'👨',label:'Steven'},
  ];

  let selStarter = 2;
  let selAvatar  = 'brendan';

  function inject() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'authScreen';
    el.innerHTML = buildHTML();
    document.body.insertBefore(el, document.body.firstChild);

    generateStars();
    bindEvents();
    checkServer();
  }

  function buildHTML() {
    const sc = STARTERS.map(s =>
      `<div class="starter-card ${s.id===selStarter?'selected':''}" data-starter="${s.id}" tabindex="0">
        <img src="${s.img}" alt="${s.name}">
        <div class="s-name">${s.name}</div><div class="s-type">${s.type}</div>
      </div>`).join('');
    const av = AVATARS.map(a =>
      `<div class="avatar-opt ${a.id===selAvatar?'selected':''}" data-avatar="${a.id}" tabindex="0">
        <span>${a.icon}</span>${a.label}
      </div>`).join('');
    return `
      <div class="auth-stars" id="authStars"></div>
      <div class="auth-ball-deco"></div>
      <h1 class="auth-title">PokéTrainer MMO</h1>
      <p class="auth-subtitle">Hoenn · Esmeralda Multijugador</p>
      <div class="auth-panel">
        <div class="auth-online-badge offline" id="authBadge"><div class="dot"></div><span>Verificando…</span></div>
        <div class="auth-tabs">
          <button class="auth-tab active" id="tabL" onclick="AuthScreen.showTab('login')">🔑 Iniciar sesión</button>
          <button class="auth-tab"        id="tabR" onclick="AuthScreen.showTab('register')">✨ Registrarse</button>
        </div>
        <div id="authMsg" class="auth-msg"></div>
        <div class="auth-form-section active" id="secLogin">
          <div class="auth-field"><label for="lUser">Nombre de entrenador</label>
            <input id="lUser" type="text" placeholder="Brendan" autocomplete="username" maxlength="32"></div>
          <div class="auth-field"><label for="lPass">Contraseña</label>
            <input id="lPass" type="password" placeholder="••••••••" autocomplete="current-password"></div>
          <button class="auth-submit" id="loginBtn" onclick="AuthScreen.doLogin()">Iniciar aventura</button>
        </div>
        <div class="auth-form-section" id="secReg">
          <div class="auth-field"><label for="rUser">Nombre de entrenador</label>
            <input id="rUser" type="text" placeholder="Brendan" maxlength="32" autocomplete="username"></div>
          <div class="auth-field"><label for="rPass">Contraseña (mín. 6)</label>
            <input id="rPass" type="password" placeholder="••••••••" autocomplete="new-password"></div>
          <div class="auth-field"><label for="rEmail">Email (opcional)</label>
            <input id="rEmail" type="email" placeholder="entrenador@hoenn.net"></div>
          <div class="auth-field"><label>Pokémon inicial</label>
            <div class="starter-grid" id="starterGrid">${sc}</div></div>
          <div class="auth-field"><label>Avatar</label>
            <div class="avatar-grid" id="avatarGrid">${av}</div></div>
          <button class="auth-submit" id="regBtn" onclick="AuthScreen.doRegister()">Comenzar mi aventura ✨</button>
        </div>
        <p class="auth-guest-link" onclick="AuthScreen.continueAsGuest()">
          Entrar como invitado (sin guardar progreso)
        </p>
      </div>
      <p class="auth-players-count" id="authOnline">Cargando jugadores…</p>`;
  }

  function generateStars() {
    const c = document.getElementById('authStars');
    if (!c) return;
    for (let i=0;i<70;i++){
      const s=document.createElement('div');
      s.className='auth-star';
      const sz=Math.random()*2.5+0.5;
      s.style.cssText=`width:${sz}px;height:${sz}px;top:${Math.random()*100}%;left:${Math.random()*100}%;--dur:${(Math.random()*4+2).toFixed(1)}s;--delay:${(Math.random()*5).toFixed(1)}s;--op:${(Math.random()*.6+.2).toFixed(2)};`;
      c.appendChild(s);
    }
  }

  function bindEvents() {
    document.querySelectorAll('.starter-card').forEach(el=>{
      el.addEventListener('click',()=>{
        selStarter=+el.dataset.starter;
        document.querySelectorAll('.starter-card').forEach(c=>c.classList.remove('selected'));
        el.classList.add('selected');
      });
      el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')el.click();});
    });
    document.querySelectorAll('.avatar-opt').forEach(el=>{
      el.addEventListener('click',()=>{
        selAvatar=el.dataset.avatar;
        document.querySelectorAll('.avatar-opt').forEach(c=>c.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
    ['lUser','lPass'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.addEventListener('keydown',e=>{if(e.key==='Enter') doLogin();});
    });
    ['rUser','rPass','rEmail'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.addEventListener('keydown',e=>{if(e.key==='Enter') doRegister();});
    });
  }

  async function checkServer() {
    try {
      await apiJson('/api/system/health', { signal: AbortSignal.timeout(4000) });
      serverOnline = true;
      const badge=document.getElementById('authBadge');
      if(badge){badge.className='auth-online-badge';badge.innerHTML='<div class="dot"></div><span>Servidor en línea ✓</span>';}
      try {
        const d = await apiJson('/api/lobby/players', { signal: AbortSignal.timeout(2000) });
        const c=document.getElementById('authOnline');
        if(c&&d&&typeof d.count==='number')c.innerHTML=`<strong>${d.count}</strong> entrenador${d.count!==1?'es':''} conectado${d.count!==1?'s':''} ahora mismo`;
      } catch {}
    } catch {
      serverOnline = false;
      const badge=document.getElementById('authBadge');
      if(badge){badge.className='auth-online-badge offline';badge.innerHTML='<div class="dot"></div><span>Modo local (sin servidor)</span>';}
      const c=document.getElementById('authOnline');
      if(c)c.textContent='Sin servidor MMO: puedes crear una cuenta local que se guarda en este navegador.';
    }
  }

  function showMsg(txt,type='error'){
    const el=document.getElementById('authMsg');
    if(el){el.textContent=txt;el.className='auth-msg '+type;}
  }
  function clearMsg(){const el=document.getElementById('authMsg');if(el){el.textContent='';el.className='auth-msg';}}

  function setLoading(id,on){
    const b=document.getElementById(id);
    if(!b) return;
    b.disabled=on;
    b.innerHTML=on?'<span class="auth-spinner"></span>Un momento…':(id==='loginBtn'?'Iniciar aventura':'Comenzar mi aventura ✨');
  }

  function dismiss(){
    const el=document.getElementById('authScreen');
    if(el){el.classList.add('fade-out');setTimeout(()=>el.remove(),700);}
  }

  function onAuth(session){
    sessionStorage.setItem('hoennTrainerToken', session.token||'');
    sessionStorage.setItem('hoennUser', JSON.stringify({username:session.username,email:session.email||'',rol:'entrenador',token:session.token||''}));
    if(session.token) localStorage.setItem('pokepoke_user',JSON.stringify({username:session.username,token:session.token}));
    if(window.GameClient) window.GameClient.token = session.token||null;
    dismiss();
    if(typeof window.onPlayerAuthenticated==='function') window.onPlayerAuthenticated(session);
  }

  async function doLogin(){
    clearMsg();
    const u=(document.getElementById('lUser')?.value||'').trim();
    const p=(document.getElementById('lPass')?.value||'').trim();
    if(!u) return showMsg('Escribe tu nombre de entrenador.');
    if(!p) return showMsg('Introduce tu contraseña.');
    setLoading('loginBtn',true);
    try {
      let body;
      try {
        body=await apiJson('/api/auth/login',{
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({username:u,password:p}),
          signal:AbortSignal.timeout(8000)
        });
      } catch (apiErr) {
        if (!(apiErr instanceof ApiOfflineError)) throw apiErr;
        body=await loginLocally(u,p);
        showMsg(`Sesión local iniciada, ${body.username}. Sin MMO en esta dirección. 🎮`,'success');
        setTimeout(()=>onAuth({...body,isGuest:false}),900);
        return;
      }
      showMsg(`¡Bienvenido de vuelta, ${body.username}! 🎮`,'success');
      setTimeout(()=>onAuth({...body,isGuest:false}),900);
    } catch(err) {
      showMsg(err.message||'No se pudo conectar.');
    } finally { setLoading('loginBtn',false); }
  }

  async function doRegister(){
    clearMsg();
    const u=(document.getElementById('rUser')?.value||'').trim();
    const p=(document.getElementById('rPass')?.value||'').trim();
    const e=(document.getElementById('rEmail')?.value||'').trim()||null;
    if(!u||u.length<3) return showMsg('El nombre debe tener al menos 3 caracteres.');
    if(!p||p.length<6) return showMsg('La contraseña debe tener al menos 6 caracteres.');
    if(!/^[a-zA-ZÀ-ÿ0-9_\-.]+$/.test(u)) return showMsg('Solo letras, números, _ o - en el nombre.');
    setLoading('regBtn',true);
    try {
      let body;
      try {
        body=await apiJson('/api/auth/register',{
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({username:u,password:p,email:e,starter_id:selStarter,avatar_style:selAvatar}),
          signal:AbortSignal.timeout(8000)
        });
      } catch (apiErr) {
        if (!(apiErr instanceof ApiOfflineError)) throw apiErr;
        body=await registerLocally(u,p,e);
        showMsg(`¡Cuenta local creada! ${body.username}, tu progreso se guardará en este navegador. 🌟`,'success');
        setTimeout(()=>onAuth({...body,isGuest:false}),1200);
        return;
      }
      showMsg(`¡Cuenta creada! ¡Bienvenido a Hoenn, ${body.username}! 🌟`,'success');
      setTimeout(()=>onAuth({...body,isGuest:false}),1100);
    } catch(err) {
      showMsg(err.message||'Error al registrarse.');
    } finally { setLoading('regBtn',false); }
  }

  function continueAsGuest(){
    const name='Viajero_'+Math.floor(Math.random()*9000+1000);
    onAuth({token:null,username:name,isGuest:true});
  }

  const AuthScreen = {
    init() {
      const stored=sessionStorage.getItem('hoennUser');
      const token=sessionStorage.getItem('hoennTrainerToken');
      if(stored&&token){
        try{
          const u=JSON.parse(stored);
          if(u.username&&u.token){
            const restore=()=>{
              if(window.GameClient) window.GameClient.token=token;
              if(typeof window.onPlayerAuthenticated==='function')
                window.onPlayerAuthenticated({token,username:u.username,isGuest:false});
            };
            // Las cuentas locales del navegador no necesitan backend.
            if(String(token).startsWith('local-')){
              if(readLocalAccounts()[u.username.toLowerCase()]){ restore(); return; }
            }
            apiJson('/api/system/health',{signal:AbortSignal.timeout(3000)})
              .then(()=>restore())
              .catch(()=>inject());
            return;
          }
        } catch {}
      }
      inject();
    },
    showTab(tab){
      clearMsg();
      const is_login=tab==='login';
      document.getElementById('secLogin')?.classList[is_login?'add':'remove']('active');
      document.getElementById('secReg')?.classList[is_login?'remove':'add']('active');
      document.getElementById('tabL')?.classList[is_login?'add':'remove']('active');
      document.getElementById('tabR')?.classList[is_login?'remove':'add']('active');
    },
    doLogin, doRegister, continueAsGuest,
  };

  window.AuthScreen = AuthScreen;
})(window);
