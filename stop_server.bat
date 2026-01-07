@echo off
echo Stopping Anti Online services...

:: Kill node processes (Server & LocalTunnel)
taskkill /F /IM node.exe

echo.
echo All background services stopped.
pause
