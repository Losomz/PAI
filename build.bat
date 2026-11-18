@echo off
cd /d "%~dp0"
call npm.cmd run pack
exit /b %errorlevel%
