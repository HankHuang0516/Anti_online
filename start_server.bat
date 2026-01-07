@echo off
:: Switch to the script's directory (project root)
cd /d "%~dp0"

echo Starting Anti Online services...

:: Start LocalTunnel (Minimized)
:: Using npx localtunnel to avoid global install dependence
:: Try to request subdomain 'anti-online-user', if taken it might assign random
echo Starting LocalTunnel on port 3001...
start /min "Anti Online - Public URL" cmd /k "npx localtunnel --port 3001 --subdomain anti-online-user"

:: Start Server (Minimized)
echo Starting Server...
cd server
start /min "Anti Online - Server" npm start

echo ====================================================
echo Services are running in the background (minimized).
echo Check the "Anti Online - Public URL" window for your link.
echo ====================================================
pause
