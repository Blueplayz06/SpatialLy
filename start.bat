@echo off
setlocal EnableDelayedExpansion

:: -------------------------------------------------------------
:: Spatially Development Environment Launcher
:: -------------------------------------------------------------
title Spatially Launcher
cd /d "%~dp0"
set "ROOT=%~dp0"
set "IS_CLI=0"

:: Handle CLI arguments if provided
if /i "%~1"=="web" ( set "IS_CLI=1" & goto start_web )
if /i "%~1"=="all" ( set "IS_CLI=1" & goto start_web )
if /i "%~1"=="server" ( set "IS_CLI=1" & goto start_server )
if /i "%~1"=="backend" ( set "IS_CLI=1" & goto start_server )
if /i "%~1"=="api" ( set "IS_CLI=1" & goto start_server )
if /i "%~1"=="client" ( set "IS_CLI=1" & goto start_client )
if /i "%~1"=="frontend" ( set "IS_CLI=1" & goto start_client )
if /i "%~1"=="stop" (
    call :do_stop_servers
    echo [OK] All Spatially servers stopped.
    goto exit_script
)
if /i "%~1"=="sim" ( set "IS_CLI=1" & goto run_simulation )
if /i "%~1"=="simulate" ( set "IS_CLI=1" & goto run_simulation )
if /i "%~1"=="vsim" ( set "IS_CLI=1" & goto run_volunteer_simulation )
if /i "%~1"=="volunteers" ( set "IS_CLI=1" & goto run_volunteer_simulation )
if /i "%~1"=="volunteer-sim" ( set "IS_CLI=1" & goto run_volunteer_simulation )
if /i "%~1"=="attendee" ( set "IS_CLI=1" & goto start_attendee )
if /i "%~1"=="volunteer" ( set "IS_CLI=1" & goto start_volunteer )

:menu
cls
echo =============================================================
echo               SPATIALLY DEVELOPMENT LAUNCHER
echo =============================================================
echo.
echo   Select an option to launch:
echo.
echo   [1] Start Organizer Web (Frontend + Backend)  [RECOMMENDED]
echo   [2] Start Frontend only  (React / Vite on :5173)
echo   [3] Start Backend only   (FastAPI / Uvicorn on :8000)
echo   [4] Run Crowd Simulation Harness (simulate_crowd.py)
echo   [5] Stop running Spatially servers (Kill :8000 and :5173)
echo   [6] Run Attendee Mobile App (Flutter)
echo   [7] Run Volunteer Mobile App (Flutter)
echo   [8] Run Volunteer & Telemetry Demo Simulator (simulate_volunteers.bat)  [DEMO]
echo   [0] Exit
echo.
echo =============================================================
set "choice="
set /p choice="Enter choice [0-8] (default 1): "

if "%choice%"=="" set choice=1
if "%choice%"=="1" goto start_web
if "%choice%"=="2" goto start_client
if "%choice%"=="3" goto start_server
if "%choice%"=="4" goto run_simulation
if "%choice%"=="5" goto menu_stop_servers
if "%choice%"=="6" goto start_attendee
if "%choice%"=="7" goto start_volunteer
if "%choice%"=="8" goto run_volunteer_simulation
if "%choice%"=="0" goto exit_script

echo.
echo [!] Invalid option '%choice%'. Please select between 0 and 8.
ping 127.0.0.1 -n 3 >nul
goto menu

:: -------------------------------------------------------------
:: Dependency & Environment Verifications
:: -------------------------------------------------------------
:verify_env
echo [*] Checking environment prerequisites...

:: 1. Check Python & venv
set "PYTHON_ACTIVATE="
if exist "%ROOT%server\.venv\Scripts\activate.bat" (
    set "PYTHON_ACTIVATE=%ROOT%server\.venv\Scripts\activate.bat"
) else if exist "%ROOT%server\venv\Scripts\activate.bat" (
    set "PYTHON_ACTIVATE=%ROOT%server\venv\Scripts\activate.bat"
) else if exist "%ROOT%.venv\Scripts\activate.bat" (
    set "PYTHON_ACTIVATE=%ROOT%.venv\Scripts\activate.bat"
)

if "%PYTHON_ACTIVATE%"=="" (
    echo [!] Warning: No Python virtual environment found in server\.venv or server\venv.
    where python >nul 2>&1
    if !errorlevel! neq 0 (
        echo [ERROR] Python is not installed or not in your PATH.
        echo Please install Python 3.10+ or set up a virtual environment in server\.venv
        if "%IS_CLI%"=="0" pause
        goto menu
    )
    echo [*] Falling back to system Python.
) else (
    echo [OK] Python virtual environment detected: %PYTHON_ACTIVATE%
)

:: 2. Check server .env file
if not exist "%ROOT%server\.env" (
    if exist "%ROOT%server\.env.example" (
        echo [*] server\.env not found. Creating server\.env from .env.example...
        copy "%ROOT%server\.env.example" "%ROOT%server\.env" >nul
        echo [OK] Created server\.env. Please verify your Supabase keys if needed.
    ) else (
        echo [!] Warning: server\.env file is missing.
    )
)

:: 3. Check Node.js / npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js / npm is not installed or not found in your PATH.
    echo Please install Node.js from https://nodejs.org/ to run the frontend.
    if "%IS_CLI%"=="0" pause
    goto menu
)
echo [OK] Node.js / npm detected.

:: 4. Check client node_modules
if not exist "%ROOT%client\node_modules" (
    echo [*] client\node_modules not found. Running 'npm install' in client...
    cd /d "%ROOT%client"
    call npm install
    if !errorlevel! neq 0 (
        echo [ERROR] 'npm install' failed in client directory.
        if "%IS_CLI%"=="0" pause
        goto menu
    )
    cd /d "%ROOT%"
)

echo [OK] Environment check completed.
echo.
exit /b 0

:: -------------------------------------------------------------
:: Action: Start Web (Frontend + Backend)
:: -------------------------------------------------------------
:start_web
call :verify_env

echo [*] Launching Spatially Backend API (Port 8000)...
if not "%PYTHON_ACTIVATE%"=="" (
    start "Spatially - Backend API (Port 8000)" cmd /k "title Spatially Backend API && cd /d "%ROOT%server" && call "%PYTHON_ACTIVATE%" && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"
) else (
    start "Spatially - Backend API (Port 8000)" cmd /k "title Spatially Backend API && cd /d "%ROOT%server" && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"
)

:: Brief pause so backend starts first
ping 127.0.0.1 -n 3 >nul

echo [*] Launching Spatially Frontend Dashboard (Port 5173)...
start "Spatially - Frontend (Port 5173)" cmd /k "title Spatially Frontend && cd /d "%ROOT%client" && npm run dev"

cls
echo =============================================================
echo               SPATIALLY SERVICES RUNNING
echo =============================================================
echo.
echo   [+] Frontend Dashboard:  http://localhost:5173
echo   [+] Backend API:         http://localhost:8000
echo   [+] Swagger API Docs:    http://localhost:8000/docs
echo   [+] OpenAPI Spec:        http://localhost:8000/openapi.json
echo.
echo   Each service is running in its own terminal window.
echo   You can monitor logs or trigger restarts there.
echo.
echo =============================================================
echo.
echo   Controls:
echo     [S] Stop all running servers
echo     [R] Restart all servers
echo     [M] Return to main menu
echo     [Q] Close this launcher window (servers stay running)
echo.

:web_running_loop
set "ctrl_choice="
set /p ctrl_choice="Selection [S/R/M/Q]: "
if /i "%ctrl_choice%"=="S" (
    call :do_stop_servers
    echo [OK] Servers stopped.
    if "%IS_CLI%"=="0" pause
    goto menu
)
if /i "%ctrl_choice%"=="R" (
    call :do_stop_servers
    ping 127.0.0.1 -n 2 >nul
    goto start_web
)
if /i "%ctrl_choice%"=="M" goto menu
if /i "%ctrl_choice%"=="Q" goto exit_script
goto web_running_loop

:: -------------------------------------------------------------
:: Action: Start Frontend Only
:: -------------------------------------------------------------
:start_client
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm is not found in PATH.
    if "%IS_CLI%"=="0" pause
    goto menu
)
if not exist "%ROOT%client\node_modules" (
    echo [*] Running 'npm install' in client...
    cd /d "%ROOT%client"
    call npm install
    cd /d "%ROOT%"
)
echo [*] Starting Frontend on http://localhost:5173...
start "Spatially - Frontend (Port 5173)" cmd /k "title Spatially Frontend && cd /d "%ROOT%client" && npm run dev"
echo [OK] Frontend started in a new terminal window.
if "%IS_CLI%"=="1" goto exit_script
pause
goto menu

:: -------------------------------------------------------------
:: Action: Start Backend Only
:: -------------------------------------------------------------
:start_server
set "PYTHON_ACTIVATE="
if exist "%ROOT%server\.venv\Scripts\activate.bat" (
    set "PYTHON_ACTIVATE=%ROOT%server\.venv\Scripts\activate.bat"
) else if exist "%ROOT%server\venv\Scripts\activate.bat" (
    set "PYTHON_ACTIVATE=%ROOT%server\venv\Scripts\activate.bat"
) else if exist "%ROOT%.venv\Scripts\activate.bat" (
    set "PYTHON_ACTIVATE=%ROOT%.venv\Scripts\activate.bat"
)

echo [*] Starting FastAPI Backend on http://localhost:8000...
if not "%PYTHON_ACTIVATE%"=="" (
    start "Spatially - Backend API (Port 8000)" cmd /k "title Spatially Backend API && cd /d "%ROOT%server" && call "%PYTHON_ACTIVATE%" && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"
) else (
    start "Spatially - Backend API (Port 8000)" cmd /k "title Spatially Backend API && cd /d "%ROOT%server" && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"
)
echo [OK] Backend started in a new terminal window.
if "%IS_CLI%"=="1" goto exit_script
pause
goto menu

:: -------------------------------------------------------------
:: Action: Run Crowd Simulation
:: -------------------------------------------------------------
:run_simulation
set "PYTHON_ACTIVATE="
if exist "%ROOT%server\.venv\Scripts\activate.bat" (
    set "PYTHON_ACTIVATE=%ROOT%server\.venv\Scripts\activate.bat"
) else if exist "%ROOT%server\venv\Scripts\activate.bat" (
    set "PYTHON_ACTIVATE=%ROOT%server\venv\Scripts\activate.bat"
)

echo.
echo =============================================================
echo               CROWD SIMULATION HARNESS
echo =============================================================
echo   Choose pattern:
echo   [1] Ramp (gradual accumulation to capacity)
echo   [2] Surge (sharp spike exceeding capacity)
echo   [3] Plateau (steady high occupancy)
echo   [4] Dispersal (steady clearing out)
echo.
set "sim_pat="
set /p sim_pat="Select pattern [1-4] (default 1): "
if "%sim_pat%"=="" set sim_pat=1
set "PATTERN=ramp"
if "%sim_pat%"=="2" set "PATTERN=surge"
if "%sim_pat%"=="3" set "PATTERN=plateau"
if "%sim_pat%"=="4" set "PATTERN=dispersal"

echo [*] Launching simulation harness with pattern '%PATTERN%'...
if not "%PYTHON_ACTIVATE%"=="" (
    start "Spatially - Crowd Simulation" cmd /k "title Spatially Crowd Simulation && cd /d "%ROOT%server" && call "%PYTHON_ACTIVATE%" && python data\simulate_crowd.py --pattern %PATTERN%"
) else (
    start "Spatially - Crowd Simulation" cmd /k "title Spatially Crowd Simulation && cd /d "%ROOT%server" && python data\simulate_crowd.py --pattern %PATTERN%"
)
echo [OK] Simulation started in a new terminal window.
if "%IS_CLI%"=="1" goto exit_script
pause
goto menu

:: -------------------------------------------------------------
:: Action: Run Volunteer & Telemetry Simulation
:: -------------------------------------------------------------
:run_volunteer_simulation
call "%ROOT%simulate_volunteers.bat" %2 %3 %4 %5 %6 %7 %8 %9
if "%IS_CLI%"=="1" goto exit_script
goto menu

:: -------------------------------------------------------------
:: Action: Stop Servers
:: -------------------------------------------------------------
:menu_stop_servers
call :do_stop_servers
echo [OK] Server cleanup complete.
pause
goto menu

:do_stop_servers
echo [*] Stopping processes on ports 8000 (FastAPI) and 5173 (Vite)...
powershell -NoProfile -Command "$ports = 8000, 5173; foreach ($p in $ports) { $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue; if ($conns) { foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host ('[OK] Terminated PID ' + $c.OwningProcess + ' on port ' + $p) } } }" >nul 2>&1
exit /b 0

:: -------------------------------------------------------------
:: Action: Mobile Apps (Flutter)
:: -------------------------------------------------------------
:start_attendee
where flutter >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Flutter is not recognized in PATH.
    echo Please ensure Flutter SDK is installed and added to your system environment PATH.
    if "%IS_CLI%"=="0" pause
    goto menu
)
echo [*] Starting Attendee Mobile App...
start "Spatially - Attendee Mobile" cmd /k "title Spatially Attendee Mobile && cd /d "%ROOT%apps\attendee_mobile" && flutter pub get && flutter run"
if "%IS_CLI%"=="1" goto exit_script
pause
goto menu

:start_volunteer
where flutter >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Flutter is not recognized in PATH.
    echo Please ensure Flutter SDK is installed and added to your system environment PATH.
    if "%IS_CLI%"=="0" pause
    goto menu
)
echo [*] Starting Volunteer Mobile App...
start "Spatially - Volunteer Mobile" cmd /k "title Spatially Volunteer Mobile && cd /d "%ROOT%apps\volunteer_mobile" && flutter pub get && flutter run"
if "%IS_CLI%"=="1" goto exit_script
pause
goto menu

:exit_script
echo [*] Exiting Spatially launcher. Goodbye!
exit /b 0
