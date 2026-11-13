@echo off
title SmartBus G4 - Alexa SSDP Discovery Responder
cd /d "%~dp0"
echo Starting Alexa SSDP UPnP Discovery Responder on Windows host...
if exist "C:\ProgramData\anaconda3\python.exe" (
    "C:\ProgramData\anaconda3\python.exe" "scripts\alexa-ssdp-discovery.py"
) else (
    python "scripts\alexa-ssdp-discovery.py"
)
pause

