@echo off
REM Double-click to run Violet without building an exe
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing packages...
  call npm install
)
call npm start
