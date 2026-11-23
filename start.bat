@echo off
title OddsPulse Pro
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo Building OddsPulse Pro...
  call npm.cmd run build
)
call npx.cmd electron .
