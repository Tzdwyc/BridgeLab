@echo off
cd /d "%~dp0"
node "%~dp0scripts\start-desktop.mjs"
if errorlevel 1 pause
