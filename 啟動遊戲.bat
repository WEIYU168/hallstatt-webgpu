@echo off
chcp 65001 >nul
title 哈修塔特遊戲伺服器
cd /d "%~dp0"
rem 直接雙擊 index.html 會被瀏覽器的安全限制擋下（一直停在載入中），所以用本機伺服器開啟
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY (where py >nul 2>nul && set "PY=py -3")
if not defined PY (
  echo.
  echo   找不到 Python。請先安裝 Python 3： https://www.python.org/downloads/
  echo   安裝時記得勾選 "Add python.exe to PATH"，裝好後再雙擊這個檔案。
  echo.
  pause
  exit /b 1
)
%PY% serve.py %*
if errorlevel 1 pause
