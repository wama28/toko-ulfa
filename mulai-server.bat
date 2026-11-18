@echo off
cd /d "%~dp0"
title UD. ULFA - Backend Server

echo ============================================
echo   BACKEND UD. ULFA - Memulai Server...
echo ============================================
echo.

:: Jalankan Node.js server di jendela terpisah
start "Backend UD ULFA - Node.js" cmd /k "cd /d "%~dp0" && node server.js"

:: Tunggu server siap
echo [1/2] Menunggu server Node.js siap...
timeout /t 3 >nul

:: Jalankan ngrok dengan domain statis
echo [2/2] Menjalankan ngrok tunnel...
start "Ngrok Tunnel" cmd /k "ngrok http --url=sliver-impeach-tree.ngrok-free.dev 5000"

echo.
echo ============================================
echo   SERVER SIAP!
echo ============================================
echo.
echo   URL Publik : https://sliver-impeach-tree.ngrok-free.dev
echo   API Docs   : https://sliver-impeach-tree.ngrok-free.dev/api/docs
echo   Lokal      : http://localhost:5000
echo.
echo   Bagikan URL publik di atas ke client / frontend.
echo ============================================
echo.
pause
