@echo off
setlocal EnableExtensions
title LMS Enterprise Video Encryption

REM Use UTF-8 so the script's emoji/status output renders instead of crashing.
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

REM =====================================================================
REM  One-click launcher for ROOT-folder video encryption.
REM   1) finds Python
REM   2) installs the required "cryptography" dependency (once)
REM   3) launches encrypt_root.py: you give ONE root folder + the MASTER
REM      key, and every video in every nested subfolder gets encrypted.
REM  Keep this .bat in the SAME folder as encrypt_root.py and
REM  encrypt_videos.py when sharing (share all three together).
REM =====================================================================

cd /d "%~dp0"

echo ====================================================
echo        LMS ENTERPRISE OFFLINE VIDEO ENCRYPTION
echo             One-Click Setup ^& Launcher
echo ====================================================
echo.

REM --- 1. Locate the encryption scripts -----------------------------
if not exist "%~dp0encrypt_root.py" (
    echo [ERROR] encrypt_root.py was not found next to this .bat file.
    echo         Put Encrypt_Videos.bat, encrypt_root.py and encrypt_videos.py
    echo         all in the same folder.
    echo.
    pause
    exit /b 1
)
if not exist "%~dp0encrypt_videos.py" (
    echo [ERROR] encrypt_videos.py was not found next to this .bat file.
    echo         Put Encrypt_Videos.bat, encrypt_root.py and encrypt_videos.py
    echo         all in the same folder.
    echo.
    pause
    exit /b 1
)

REM --- 2. Find a Python interpreter ---------------------------------
set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY (
    python --version >nul 2>&1 && set "PY=python"
)

if not defined PY (
    echo [ERROR] Python is not installed or not on PATH.
    echo.
    echo   Attempting to install Python via winget...
    winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo.
        echo [ERROR] Automatic install failed.
        echo         Please install Python 3 from https://www.python.org/downloads/
        echo         and tick "Add Python to PATH", then run this file again.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo   Python installed. Please CLOSE this window and double-click
    echo   Encrypt_Videos.bat again so the new PATH takes effect.
    echo.
    pause
    exit /b 0
)

echo [OK] Using Python:
%PY% --version
echo.

REM --- 3. Ensure the "cryptography" dependency is installed ----------
echo Checking required dependency (cryptography)...
%PY% -c "import cryptography" >nul 2>&1
if errorlevel 1 (
    echo   Not found. Installing now, please wait...
    %PY% -m pip install --upgrade pip >nul 2>&1
    %PY% -m pip install cryptography
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install "cryptography".
        echo         Check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
    echo   [OK] cryptography installed.
) else (
    echo   [OK] cryptography already installed.
)
echo.

REM --- 4. Launch the encryptor (it will ask for the MASTER key) ------
echo ====================================================
echo   Starting encryptor...
echo   You will be asked for your MASTER key, then the ROOT folder.
echo   Every video in every nested subfolder will be encrypted.
echo ====================================================
echo.
%PY% "%~dp0encrypt_root.py"

echo.
echo ====================================================
echo   Done. You can close this window.
echo ====================================================
pause
endlocal
