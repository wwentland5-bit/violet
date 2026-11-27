@echo off
REM ============================================================
REM  VIOLET SETUP - double-click me. Does everything for you:
REM   Node.js, Claude Code + login, packages, voice downloads,
REM   desktop shortcut, optional .exe build, then starts Violet.
REM  Safe to run again anytime (it skips what is already done).
REM ============================================================
title Violet Setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup.ps1"
if errorlevel 1 (
  echo.
  echo Setup stopped early. Details are in setup-log.txt
)
