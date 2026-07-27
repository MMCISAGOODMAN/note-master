#!/usr/bin/env bash
# Ops Notepad 启动脚本 (macOS / Linux)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  echo "创建虚拟环境…"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

if ! python -c "import flask" 2>/dev/null; then
  echo "安装依赖…"
  pip install -r requirements.txt
fi

python init_db.py
echo "启动 Ops Notepad → http://localhost:${PORT:-18765}"
exec python app.py
