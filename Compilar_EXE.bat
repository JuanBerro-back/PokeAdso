@echo off
title Compilador de JuegoPokemon.exe
echo ========================================================
echo   COMPILANDO JUEGO POKEMON A ARCHIVO EJECUTABLE .EXE
echo ========================================================
echo.

python -m PyInstaller --noconfirm --onefile --name "JuegoPokemon" ^
  --add-data "pokedex.html;." ^
  --add-data "admin.html;." ^
  --add-data "admin.css;." ^
  --add-data "admin.js;." ^
  --add-data "auth.js;." ^
  --add-data "assets;assets" ^
  --add-data "pokemon_kanto_background.jpg;." ^
  --add-data "modules;modules" ^
  --add-data "vendor;vendor" ^
  --add-data "data;data" ^
  --add-data "monster_engine;monster_engine" ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  launcher.py

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   COMPILACION EXITOSA!
    echo   Copiando JuegoPokemon.exe a la carpeta principal...
    copy /y "dist\JuegoPokemon.exe" ".\JuegoPokemon.exe"
    echo   Listo! Ya puedes ejecutar JuegoPokemon.exe
    echo ========================================================
) else (
    echo.
    echo [ERROR] Hubo un problema durante la compilacion.
)

pause
