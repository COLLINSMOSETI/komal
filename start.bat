@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing Komal for the first time...
  call npm install --omit=dev
)
node --env-file-if-exists=.env server.js
pause
