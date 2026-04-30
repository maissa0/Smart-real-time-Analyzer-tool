@echo off
echo Killing process on port 8082...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8082"') do taskkill /F /PID %%a 2>nul
echo Done. Port 8082 is free.
pause
