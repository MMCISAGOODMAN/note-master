@echo off
REM Ops Notepad 启动脚本 (Windows)
cd /d "%~dp0\.."
if not exist .venv (
  python -m venv .venv
)
call .venv\Scripts\activate.bat
python -c "import flask" 2>nul || pip install -r requirements.txt
python init_db.py
echo 启动 Ops Notepad → http://localhost:18765
python app.py
pause
