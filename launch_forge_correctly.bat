@echo off
chcp 65001
title Tbilisi 2077 - Forge Launcher

set USERNAME=Steve_Gamer
set MINECRAFT_DIR=%APPDATA%\.minecraft
set FORGE_DIR=%MINECRAFT_DIR%\versions\1.20.1-forge-47.4.10
set FORGE_JAR=%FORGE_DIR%\1.20.1-forge-47.4.10.jar

echo ========================================
echo    TBILISI 2077 - FORGE LAUNCHER
echo ========================================

echo Checking Java...
java -version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Java not found!
    pause
    exit /b 1
)

echo Checking Forge JAR...
if not exist "%FORGE_JAR%" (
    echo ERROR: Forge JAR not found!
    echo Please install Forge 1.20.1-47.4.10
    echo Download from: https://files.minecraftforge.net
    pause
    exit /b 1
)

echo Setting up game directory...
set GAMEDIR=%APPDATA%\.cybercraft
if not exist "%GAMEDIR%" mkdir "%GAMEDIR%"
if not exist "%GAMEDIR%\mods" mkdir "%GAMEDIR%\mods"

echo Copying mods...
if exist "modpack_files\mods\*" (
    xcopy /E /I "modpack_files\mods" "%GAMEDIR%\mods" >nul
    echo Mods copied successfully
)

echo.
echo ========================================
echo LAUNCHING MINECRAFT FORGE 1.20.1-47.4.10
echo ========================================

java -Xmx6G -Xms4G ^
     -Dminecraft.client.jar="%FORGE_JAR%" ^
     -cp "%FORGE_JAR%;%MINECRAFT_DIR%\libraries\*" ^
     net.minecraft.client.main.Main ^
     --username "%USERNAME%" ^
     --version "1.20.1-forge-47.4.10" ^
     --gameDir "%GAMEDIR%" ^
     --assetsDir "%GAMEDIR%\assets" ^
     --assetIndex "4" ^
     --uuid "00000000-0000-0000-0000-000000000000" ^
     --accessToken "null" ^
     --userType "mojang" ^
     --versionType "release"

echo.
echo Game closed.
pause