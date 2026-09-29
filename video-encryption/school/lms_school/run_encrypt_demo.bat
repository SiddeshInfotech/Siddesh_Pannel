@echo off
REM Portable launcher — runs the encryptor from wherever this .bat lives.
REM Prompts for SRC, DEST and the master key (hidden). Works on any machine
REM with Python 3 + the 'cryptography' (or 'pycryptodome') package.
chcp 65001 >nul
cd /d "%~dp0"
python encrypt_demo.py %*
echo.
pause
