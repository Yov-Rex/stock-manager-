@echo off
echo --- syntax check: install-tunnel.bat ---
call install-tunnel.bat >nul 2>&1
echo exit=%ERRORLEVEL%
echo.
echo --- syntax check: setup-cloudflare.bat (no .env yet, will generate) ---
cd /d "%~dp0"
if exist .env.test del .env.test
echo --- node secret generator check ---
node -e "const s=require('crypto').randomBytes(32).toString('hex'); console.log('len=' + s.length + ' hex=' + s)"
echo --- end ---
