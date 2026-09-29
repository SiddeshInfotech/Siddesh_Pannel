@echo off
setlocal enabledelayedexpansion
title LMS-Lab Video Encryption

echo =======================================================
echo     LMS-Lab Enterprise Video Encryption Bootstrapper
echo =======================================================
echo.
echo This tool will:
echo   1. Check/install everything it needs (Python + required library)
echo   2. Ask you for THREE things only:
echo        - the Master Key
echo        - the folder with the original videos (source)
echo        - the folder to save encrypted videos (destination)
echo   3. Encrypt the videos automatically.
echo.
echo Safe to re-run any time: files already installed are skipped,
echo and videos already encrypted are skipped automatically.
echo =======================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "PY_SCRIPT=%SCRIPT_DIR%encrypt_lab_videos.py"
set "PYTHON_CMD="

:: ------------------------------------------------------------------
:: Step 1: Find a working Python. Try "python" first, then the "py"
:: launcher (both are common depending on how Python was installed).
:: If neither exists, offer to install Python automatically.
:: ------------------------------------------------------------------
python --version >nul 2>&1
IF !ERRORLEVEL! EQU 0 (
    set "PYTHON_CMD=python"
) ELSE (
    py -3 --version >nul 2>&1
    IF !ERRORLEVEL! EQU 0 (
        set "PYTHON_CMD=py -3"
    )
)

IF "!PYTHON_CMD!"=="" (
    echo [!] Python was not found on this computer.
    echo [i] Attempting to install it automatically via Windows Package Manager...
    echo.

    winget --version >nul 2>&1
    IF !ERRORLEVEL! NEQ 0 (
        echo [X] Automatic install is not available on this computer ^(winget missing^).
        echo.
        echo Please ask someone to install Python manually from:
        echo     https://www.python.org/downloads/
        echo IMPORTANT: on the first install screen, tick "Add Python to PATH".
        echo Then double-click this file again.
        echo.
        pause
        exit /b 1
    )

    winget install -e --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements
    IF !ERRORLEVEL! NEQ 0 (
        echo.
        echo [X] Python installation did not complete successfully.
        echo Please check your internet connection and try again,
        echo or ask someone to install Python manually from:
        echo     https://www.python.org/downloads/
        echo.
        pause
        exit /b 1
    )

    echo.
    echo [OK] Python has been installed.
    echo [i] Windows needs a fresh window to see the new install.
    echo     Please close this window and double-click this file again to continue.
    echo.
    pause
    exit /b 0
)

echo [OK] Python found ^(using: !PYTHON_CMD!^)
echo.

:: ------------------------------------------------------------------
:: Step 2: Make sure the encryption script itself is present.
:: ------------------------------------------------------------------
IF NOT EXIST "!PY_SCRIPT!" (
    echo [X] Could not find the encryption script next to this file:
    echo     !PY_SCRIPT!
    echo Please make sure Run-LabEncryption.bat and encrypt_lab_videos.py
    echo are in the same folder, then try again.
    echo.
    pause
    exit /b 1
)

:: ------------------------------------------------------------------
:: Step 3: Prepare the demo content folder at LMS_Content1\videos - same
:: exact folder/file names as the real curriculum (derived from
:: class_lab.json, not hand-typed), so there is always a ready-made
:: folder to point this tool at. Safe to re-run: generate_lab_content_
:: structure.py only fills in whatever is missing and never overwrites
:: or touches a file that already has real content in it.
:: ------------------------------------------------------------------
set "DEMO_GEN_SCRIPT=%SCRIPT_DIR%generate_lab_content_structure.py"
set "DEMO_DEST=%SCRIPT_DIR%LMS_Content1\videos"
set "DEMO_SOURCE=%SCRIPT_DIR%lms-multiplatform\shared\data\src\commonMain\resources\curriculum\class_lab.json"

IF EXIST "!DEMO_GEN_SCRIPT!" (
    IF EXIST "!DEMO_SOURCE!" (
        echo [i] Preparing demo content folder at LMS_Content1\videos ...
        !PYTHON_CMD! "!DEMO_GEN_SCRIPT!" --source "!DEMO_SOURCE!" --dest "!DEMO_DEST!"
        echo.
    ) ELSE (
        echo [!] Skipping demo folder setup - curriculum file not found:
        echo     !DEMO_SOURCE!
        echo.
    )
) ELSE (
    echo [!] Skipping demo folder setup - generate_lab_content_structure.py not found.
    echo.
)

:: ------------------------------------------------------------------
:: Step 4: Make sure pip itself works, then install the ONE required
:: library only if it isn't already installed - no repeated downloads
:: on machines that already have everything set up.
:: ------------------------------------------------------------------
!PYTHON_CMD! -m pip --version >nul 2>&1
IF !ERRORLEVEL! NEQ 0 (
    echo [!] Python's package installer ^(pip^) is not available.
    echo [i] Attempting to repair it automatically...
    !PYTHON_CMD! -m ensurepip --upgrade >nul 2>&1
    !PYTHON_CMD! -m pip --version >nul 2>&1
    IF !ERRORLEVEL! NEQ 0 (
        echo [X] Could not set up pip automatically.
        echo Please reinstall Python from https://www.python.org/downloads/
        echo and make sure "pip" is included ^(it is, by default^).
        echo.
        pause
        exit /b 1
    )
)

!PYTHON_CMD! -c "import cryptography" >nul 2>&1
IF !ERRORLEVEL! EQU 0 (
    echo [OK] Required library already installed - skipping download.
) ELSE (
    echo [i] Installing the required library ^(one-time, needs internet^)...
    !PYTHON_CMD! -m pip install --quiet cryptography
    IF !ERRORLEVEL! NEQ 0 (
        echo [i] First attempt failed - retrying after updating pip...
        !PYTHON_CMD! -m pip install --quiet --upgrade pip >nul 2>&1
        !PYTHON_CMD! -m pip install --quiet cryptography
    )
    !PYTHON_CMD! -c "import cryptography" >nul 2>&1
    IF !ERRORLEVEL! NEQ 0 (
        echo.
        echo [X] Could not install the required library.
        echo Please check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
    echo [OK] Required library installed successfully.
)

echo.
echo =======================================================
echo   All set. Starting the encryption tool...
echo   You will be asked for the Master Key, the source
echo   folder, and the destination folder - nothing else.
echo   ^(a ready demo source folder is at LMS_Content1\videos^)
echo =======================================================
echo.

:: LMS_LAB_QUICKSTART tells the script to skip its menu (always use
:: Per-Course Encrypt mode) and skip the "parallel workers" question
:: (auto-picked) - so only Master Key / source / destination are asked.
set "LMS_LAB_QUICKSTART=1"
!PYTHON_CMD! "!PY_SCRIPT!"
set "RUN_RESULT=!ERRORLEVEL!"
set "LMS_LAB_QUICKSTART="

echo.
IF !RUN_RESULT! EQU 0 (
    echo =======================================================
    echo   Finished. Check the messages above for a summary.
    echo =======================================================
) ELSE (
    echo =======================================================
    echo   Stopped because of an error - see the message above
    echo   for details on what to fix, then run this file again.
    echo =======================================================
)
echo.
pause
