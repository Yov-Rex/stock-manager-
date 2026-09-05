@echo off
REM install-tunnel.bat
REM
REM Installs `cloudflared` (the Cloudflare Tunnel connector) on this
REM Windows host and verifies the install.
REM
REM What this does:
REM   1. Detects whether cloudflared is already installed.
REM   2. If not, downloads the official Windows amd64 build straight
REM      from Cloudflare's CDN to %LOCALAPPDATA%\Temp, then moves it
REM      to a stable location and adds that location to the user PATH
REM      (so `cloudflared` works from any shell going forward).
REM   3. Prints the version so you can see it's working.
REM   4. Prints the next manual steps you need to run on the
REM      Cloudflare dashboard to create the tunnel.
REM
REM Re-runnable: safe to run twice. Detects an existing install and
REM skips the download step.
REM
REM Usage:
REM   install-tunnel.bat
REM
REM No admin required for the install itself. The `cloudflared
REM service install` step that comes later DOES need an elevated
REM shell — see the printed next-steps for that.

setlocal ENABLEDELAYEDEXPANSION

echo === Stockroom: cloudflared installer ===

REM ---- 1. Is it already on PATH? ----
where cloudflared >nul 2>nul
if %ERRORLEVEL%==0 (
    echo [ok] cloudflared already installed.
    cloudflared --version
    goto :next_steps
)

REM ---- 2. Download ----
set "CFDIR=%USERPROFILE%\bin"
set "CFBIN=%CFDIR%\cloudflared.exe"
set "TMPZIP=%LOCALAPPDATA%\Temp\cloudflared-amd64.exe"

if not exist "%CFDIR%" mkdir "%CFDIR%"

echo [..] Downloading cloudflared (Windows amd64) ...
REM Use curl.exe (built into Windows 10 1803+). curl handles HTTPS,
REM follows GitHub's release redirect, and exits with a meaningful
REM error code on failure. connect-timeout caps how long we wait for
REM the TCP handshake so a wedged network fails fast (visible to the
REM user) instead of looking like a hang.
curl.exe --fail --location --silent --show-error ^
    --connect-timeout 15 --max-time 120 ^
    --output "%TMPZIP%" ^
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
if errorlevel 1 (
    echo [err] curl download failed ^(rc=%ERRORLEVEL%^).
    echo Check your internet connection and that GitHub is reachable.
    if exist "%TMPZIP%" del "%TMPZIP%" >nul 2>nul
    exit /b 1
)

if not exist "%TMPZIP%" (
    echo [err] download did not produce %TMPZIP%
    exit /b 1
)

REM GitHub's asset is named .exe already, just move it into place.
move /Y "%TMPZIP%" "%CFBIN%" >nul
if errorlevel 1 (
    echo [err] could not move cloudflared to %CFBIN%
    exit /b 1
)

REM ---- 3. Put it on the user PATH (no admin needed) ----
echo [..] Adding %CFDIR% to user PATH ...
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "USERPATH=%%B"
echo %USERPATH% | find /I "%CFDIR%" >nul
if errorlevel 1 (
    if defined USERPATH (
        set "NEWPATH=%USERPATH%;%CFDIR%"
    ) else (
        set "NEWPATH=%CFDIR%"
    )
    reg add "HKCU\Environment" /v PATH /t REG_EXPAND_SZ /f /d "!NEWPATH!" >nul
    echo [ok] PATH updated. Open a NEW shell for cloudflared to be on PATH.
) else (
    echo [ok] %CFDIR% already on PATH.
)

REM Make THIS shell see it without re-opening.
set "PATH=%CFDIR%;%PATH%"

echo.
echo [ok] cloudflared installed at %CFBIN%
"%CFBIN%" --version

:next_steps
echo.
echo ==========================================================
echo  Next manual steps (need your Cloudflare account + browser):
echo ==========================================================
echo.
echo 1. Open https://one.dash.cloudflare.com/  ^>  Networks  ^>  Tunnels
echo    Click "Create a tunnel"  ^>  pick "Cloudflared".
echo    Name it: stockroom
echo.
echo 2. COPY THE TUNNEL TOKEN (long base64 string shown on the
echo    "Install and run a connector" page).
echo.
echo 3. In a NEW PowerShell (Run as Administrator), run:
echo.
echo      cloudflared service install ^<paste token here^>
echo      Start-Service cloudflared
echo.
echo    OR for a quick foreground test (no service install):
echo.
echo      cloudflared tunnel --no-autoupdate run stockroom
echo.
echo 4. Back in the dashboard, add a Public Hostname:
echo      Subdomain: stock   (or whatever you want)
echo      Domain:     ^<your-domain^>
echo      Service:    http://localhost:3000
echo.
echo 5. Add Cloudflare Access in front (see CLOUDFLARE.md, section 6).
echo.
echo ==========================================================
echo  Tip: setup-cloudflare.bat does steps 1-4 of the SERVER side
echo       (JWT_SECRET, .env, starts the app) in one go.
echo ==========================================================
endlocal
