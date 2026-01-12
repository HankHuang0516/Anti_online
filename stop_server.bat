@echo off
echo Stopping Anti Online services...

:: Kill node processes (Server & LocalTunnel)
taskkill /F /IM node.exe
taskkill /F /IM node_bg.exe

echo.
echo All background services stopped.
pause
