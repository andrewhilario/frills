@echo off
rem Double-click to start the Frills helper. It builds the site, starts the helper and opens the editor in your browser.
rem Leave this window open while you test or stream. Close it (or press Ctrl+C) to stop.
cd /d "%~dp0"
call npm run tiktok
echo.
echo The helper has stopped. If that was not on purpose, the message above says why.
pause
