@echo off
title Spatially - Stop Servers
cd /d "%~dp0"

echo =============================================================
echo               STOPPING SPATIALLY SERVICES
echo =============================================================
echo.
echo [*] Terminating processes on Port 8000 (Backend API) and Port 5173 (Frontend)...
powershell -NoProfile -Command "$ports = 8000, 5173; $stopped = 0; foreach ($p in $ports) { $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue; if ($conns) { foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host ('[OK] Terminated PID ' + $c.OwningProcess + ' on port ' + $p); $stopped++ } } }; if ($stopped -eq 0) { Write-Host '[i] No active processes found on ports 8000 or 5173.' }"

echo.
echo [OK] Done.
ping 127.0.0.1 -n 3 >nul
