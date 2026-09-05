@echo off
REM trycloudflare.bat
REM
REM Exposes the local Stockroom server at http://localhost:3000 to
REM the internet via Cloudflare's free quick-tunnel
REM (something.trycloudflare.com). No account, no DNS, no signup.
REM The URL is printed in the terminal once the tunnel is up.
REM
REM IMPORTANT: the URL is ephemeral. Every restart of cloudflared
REM generates a NEW random hostname. For a stable URL, use
REM install-tunnel.bat + CLOUDFLARE.md (named tunnel with your
REM own domain + Cloudflare Access).
REM
REM Usage:
REM   trycloudflare.bat           (assumes server already on :3000)
REM   trycloudflare.bat 8080      (exposes a different local port)
REM
REM Requires: the Stockroom server running. Easiest way to start
REM it is: setup-cloudflare.bat in another shell.
REM
REM Security: a trycloudflare URL is PUBLIC. Anyone who knows the
REM URL can reach your Stockroom login. Don't share it broadly.
REM For an office team, use CLOUDFLARE.md (named tunnel + Access).

setlocal ENABLEDELAYEDEXPANSION

set "PORT=%~1"
if "%PORT%"=="" set "PORT=3000"

REM ---- Find cloudflared ----
where cloudflared >nul 2>nul
if errorlevel 1 (
    echo [err] cloudflared not found on PATH.
    echo       Run install-tunnel.bat first, then re-run this script.
    exit /b 1
)

REM ---- Sanity-check the server is actually listening on PORT ----
powershell -NoProfile -Command ^
  "Test-NetConnection -ComputerName 127.0.0.1 -Port %PORT% -InformationLevel Quiet" ^
  >nul 2>nul
if errorlevel 1 (
    echo [warn] Nothing is listening on 127.0.0.1:%PORT%.
    echo        Start the Stockroom server first (setup-cloudflare.bat).
    echo        Continuing anyway - cloudflared will retry on each request.
)

echo === Stockroom trycloudflare quick-tunnel ===
echo Local server: http://localhost:%PORT%
echo.
echo [..] Starting tunnel. The public URL will appear below
echo      AND be appended to stockroom-tunnel.log in this folder.
echo      Press Ctrl-C to stop.
echo.

REM --url flags: ephemeral random trycloudflare.com subdomain.
REM --no-autoupdate: keeps cloudflared from restarting mid-session.
REM | tee captures cloudflared's stdout BOTH to the console window AND
REM to the log file, so the URL survives after the window closes.
REM findstr extracts just the line containing trycloudflare.com.
cloudflared tunnel --no-autoupdate --url http://localhost:%PORT% ^
  2>&1 | tee "%~dp0stockroom-tunnel.log" | findstr /C:"trycloudflare.com"

endlocal
