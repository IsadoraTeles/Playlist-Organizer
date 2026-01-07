@echo off
title Playlist Sorter Launcher
setlocal

echo ===================================================
echo      Playlist Sorter - One-Click Launcher
echo ===================================================
echo.

:: --- Step 1: Check .env ---
if exist "backend\.env" goto env_ok
echo [ERROR] backend\.env file not found!
echo.
echo 1. Open the "backend" folder.
echo 2. Rename ".env.example" to ".env".
echo 3. Open it and paste your Spotify credentials.
echo.
pause
exit /b
:env_ok

:: --- Step 2: Backend Setup ---
echo [1/4] Checking Backend...
cd backend

if exist "venv" goto venv_exists
echo     - Creating Python Virtual Environment...
python -m venv venv
:venv_exists

:: Activate Venv
call venv\Scripts\activate

if exist "venv\Lib\site-packages\fastapi" goto reqs_installed
echo     - Installing Python dependencies...
pip install -r requirements.txt
:reqs_installed

cd ..

:: --- Step 3: Frontend Setup ---
echo [2/4] Checking Frontend...
cd web
if exist "node_modules" goto node_installed
echo     - Installing Node.js dependencies...
call npm install
:node_installed
cd ..


:: --- Step 4: Launch ---
echo [3/4] Launching Backend Server...
start "Playlist Sorter Backend" cmd /k "cd backend && venv\Scripts\activate && uvicorn main:app --reload"

echo [4/4] Launching Frontend...
start "Playlist Sorter Frontend" cmd /k "cd web && npm run dev"

echo.
echo ===================================================
echo      App is starting!
echo      Backend: http://localhost:8000
echo      Frontend: http://localhost:5173
echo ===================================================
echo.
echo Note: The first launch might take 10-20 seconds to load.
echo Press any key to close this launcher window.
pause >nul
