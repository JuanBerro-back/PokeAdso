# 🎮 PokéTrainer / PokePoke RPG (Hoenn Emerald Edition)

Un RPG de Pokémon en HTML5 / Canvas / JavaScript con backend en Python (FastAPI / Uvicorn), mapa completo de Hoenn (Pokémon Esmeralda), Pokédex interactiva con más de 400 sprites animados, sistema de combate por turnos y compilador a ejecutable `.exe` para Windows.

---

## 🌟 Características Principales

- **🗺️ Mapa Completo de Hoenn (Pokémon Esmeralda)**:
  - 67 ubicaciones detalladas (16 pueblos/ciudades, rutas 101 a 134, mazmorras y cuevas tanto de Overworld como Underwater).
  - Renderizado de tiles de alta resolución en HTML5 Canvas con soporte para arrastre y zoom suave.
  - Enfoque continuo y seguimiento suave de cámara sobre el personaje (Brendan / Bruno).
  - **Zoom dinámico**: Acercamiento automático estilo GBA al caminar.
  - **Zonas de Pokémon salvajes visibles**: cada ruta con encuentros muestra sus parches de hierba alta (arbustos) en 2D y 3D; al pisarlos, el HUD avisa con la pastilla **“Pokémon salvajes”**.
  - **HUD Auténtico de Pokémon Esmeralda**: Banner de localización animado, PokéNav con radar/coordenadas y barra de controles GBA.
  - **Recolección de Objetos**: 94 sprites de items auténticos distribuidos en el mapa, con recompensa de +50 monedas y registro en inventario.

- **⚔️ Sistema de Combates por Turnos**:
  - Batallas Pokémon completas con cálculo de efectividad de tipos, estadísticas, barras de vida animadas y captura.
  - Generación de encuentros según la zona y ruta actual.

- **📖 Pokédex Dinámica**:
  - Base de datos con más de 400 Pokémon, animaciones y tipos.

- **⚙️ Backend y Empaquetado**:
  - Servidor ligero en Python (FastAPI / Uvicorn).
  - Lanzador unificado (`launcher.py`) con detección automática de puertos y apertura en navegador.
  - Script para compilar a ejecutable independiente (`Compilar_EXE.bat` con PyInstaller).

- **🧊 Modo 3D universal (nuevo)**:
  - **Todos los mapas** (ciudades, rutas, cuevas, interiores, rutas marinas, Underwater y el mapa general de Hoenn) se pueden explorar como dioramas 3D con cámara orbital, sombras, clima y vegetación.
  - El arte GBA original se conserva como suelo; encima se levantan edificios, muros, árboles, flores, items, carteles y salidas en 3D.
  - Jugador, NPCs y entrenadores conectados se dibujan con el spritesheet animado de Brendan, etiquetas de nombre y burbujas de chat.
  - Botón **3D / 2D** en la barra del mapa para alternar en cualquier momento (la preferencia se guarda en el navegador).
  - Controles 3D: arrastrar para rotar, rueda para zoom, **R** para recentrar la cámara; el movimiento sigue siendo **WASD / flechas / Shift**.

- **🏨 Sala Unión MMO 3D (integrada desde el lobby de Kimi Agent)**:
  - Recepción, bar de bayas, mesas de intercambio, sofás, fuente, terminal de estilo, lámparas, coliseo central y letrero del hotel construidos en 3D.
  - Panel social con entrenadores conectados, chat en vivo y burbujas sobre los personajes.
  - Emotes rápidos (👋 ❤️ 😄 ⚡), seis colores de bandana sincronizados con el avatar 3D y terminal de personalización.
  - La presencia, el movimiento y el chat siguen viajando por el WebSocket existente (`/ws/lobby`); no se necesita un servidor Node adicional.

- **🏟️ Combates 3D**:
  - Los combates conservan el HUD y los menús GBA, pero se libran sobre un estadio 3D con plataformas, focos, público, banderines y efectos de impacto.
  - La captura, los movimientos y los cálculos de daño no cambian: la arena 3D es una capa visual.

---

## 🕹️ Controles del Juego

| Tecla / Acción | Función |
| :--- | :--- |
| **`W, A, S, D`** o **`Flechas`** | Mover al personaje por el mapa (aplica zoom dinámico y centra cámara) |
| **`Shift` (mantener)** | Activar **Zapatillas de Correr** (doble velocidad de desplazamiento) |
| **Click y arrastre del ratón** | En 2D, explorar el mapa; en 3D, rotar la cámara |
| **Rueda del ratón** | Zoom in / Zoom out manual (en 2D y 3D) |
| **`R`** | Recentrar la cámara 3D detrás del entrenador |
| **`E`** | Interactuar con NPCs, recepción, terminal o entrenadores cercanos |
| **Botón "Centrar" (PokéNav)** | Re-centrar la cámara y re-bloquear el enfoque en el personaje |
| **Botón `3D / 2D`** | Alternar entre el diorama 3D y el mapa GBA clásico |

---

## 🚀 Cómo Ejecutar el Proyecto

### Requisitos Previos
- **Python 3.10+** instalado en el sistema.
- Dependencias de Python:
  ```bash
  pip install fastapi uvicorn
  ```
  *(Opcional para compilar a .exe: `pip install pyinstaller`)*

### Inicio Rápido
1. Ejecuta el lanzador unificado:
   ```bash
   python launcher.py
   ```
2. El lanzador iniciará el servidor backend y abrirá automáticamente en tu navegador la interfaz:
   ```
   http://127.0.0.1:8000/admin.html
   ```
3. En el menú lateral, selecciona **"🗺️ Mapa Completo"** para disfrutar de Hoenn y todas sus funciones.

### Publicación estática (GitHub Pages)

La interfaz (`admin.html` + `modules/` + `data/` + `assets/`) funciona sin backend. En ese caso:

- Las cuentas se crean **en el propio navegador** (`pokepoke.localAccounts`, contraseña hasheada con SHA-256) y la pantalla de acceso indica **“Modo local (sin servidor)”**.
- El MMO, el chat y la presencia por WebSocket se desactivan (no hay `/ws/lobby`).
- Si alojas la API en otro dominio, indícalo con `<meta name="pokepoke-api" content="https://tu-api">` en `admin.html` o con `localStorage.setItem('pokepoke.apiBase', 'https://tu-api')`.

---

## 📦 Compilación a `.exe` (Windows)

Para generar un ejecutable `.exe` portable sin necesidad de que otros usuarios tengan Python instalado:
1. Haz doble clic en `Compilar_EXE.bat`.
2. El instalador compilará todo el motor y los recursos usando PyInstaller.
3. El archivo `JuegoPokemon.exe` se generará automáticamente en la raíz del proyecto.

---

## 📂 Estructura del Repositorio

```text
├── assets/             # Sprites de personajes, tilesets e imágenes
├── data/               # hoenn_maps.js y bases de datos del juego
├── item_sprites/       # Sprites individuales de items (94 objetos de Hoenn)
├── map_tiles/          # Tiles del mapa de Hoenn (Overworld y Underwater)
├── marker_icons/       # Iconos de marcadores (entradas, entrenadores, items)
├── modules/            # Motores de renderizado (tilemap_renderer.js, etc.)
├── modules/grass_patches.js  # Zonas deterministas de hierba alta / encuentros
├── modules/world3d.js  # Dioramas 3D para todos los mapas
├── modules/battle3d.js # Arena 3D de combate
├── modules/world3d.css # HUD, panel social y estilos 3D
├── vendor/three.min.js # three.js vendorizado (sin build ni CDN)
├── monster_engine/     # Servidor backend en FastAPI, lógica de simulación y API
├── admin.html          # Interfaz principal del juego y mapa
├── admin.js            # Controlador de la aplicación web y HUD
├── admin.css           # Estilos de la interfaz
├── launcher.py         # Punto de entrada unificado y auto-apertura de navegador
├── Compilar_EXE.bat    # Script de compilación a binario Windows .exe
└── README.md           # Documentación del proyecto
```

---

## 🧩 Notas del modo 3D

- Requiere WebGL. Si el navegador no lo soporta (o falla la inicialización), el juego cae automáticamente al mapa 2D sin bloquear la partida.
- El modo se activa por defecto y se recuerda en `localStorage` (`pokepoke.world3d`); la bandana elegida se guarda en `pokepoke.bandana`.
- La lógica de movimiento, colisiones, encuentros y combate permanece en el motor GBA (`tilemap_renderer.js` + `admin.js`). `world3d.js` y `battle3d.js` solo leen ese estado y dibujan la capa 3D, de modo que apagar el 3D no cambia la jugabilidad.
- No hay que instalar Node ni ejecutar un build: `three.min.js` está vendorizado y se sirve junto al resto de módulos estáticos.
- **Hierba alta / zonas de encuentro**: `grass_patches.js` genera zonas deterministas por mapa (semilla = id del mapa) y las reutiliza para pintar los arbustos, marcar los tiles `TALL_GRASS` y decidir los encuentros. Los mapas sin `encounters` sólo muestran flores decorativas.
- La vegetación 3D se dibuja con `InstancedMesh` (una malla por tono) y la densidad se ajusta según el área del mapa para que el Overworld completo no sature la GPU.
- El lobby 3D toma como referencia visual el template **PokePoke Multiplayer Lobby (Kimi Agent)**, adaptando su estética de hotel, avatares y terminal de bandana al WebSocket y al backend Python ya existentes.

---
## 📝 Licencia
Este proyecto fue creado con fines educativos y de entretenimiento. Pokémon y sus activos visuales son marcas registradas de Nintendo, Game Freak y Creatures Inc.
