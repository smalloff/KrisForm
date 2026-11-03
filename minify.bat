@echo off
cd /d "%~dp0"
call npx --yes esbuild forms.js --minify --outfile=forms.min.js
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
if exist "..\SmallStoreCMS\system\admin\static\vendor\" copy /Y "forms.min.js" "..\SmallStoreCMS\system\admin\static\vendor\forms.min.js" >nul
if exist "..\SmallStoreCMS\system\default\static\js\" copy /Y "forms.min.js" "..\SmallStoreCMS\system\default\static\js\forms.min.js" >nul
if exist "..\system\admin\static\vendor\" copy /Y "forms.min.js" "..\system\admin\static\vendor\forms.min.js" >nul
if exist "..\system\default\static\js\" copy /Y "forms.min.js" "..\system\default\static\js\forms.min.js" >nul
echo Done: forms.min.js updated.