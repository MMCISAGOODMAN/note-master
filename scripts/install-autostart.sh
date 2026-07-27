#!/usr/bin/env bash
# 安装开机自启（macOS LaunchAgent / Linux systemd user）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-18765}"

OS="$(uname -s)"
if [[ "$OS" == "Darwin" ]]; then
  PLIST="$HOME/Library/LaunchAgents/com.opsnotepad.app.plist"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.opsnotepad.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ROOT}/.venv/bin/python</string>
    <string>${ROOT}/app.py</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PORT</key><string>${PORT}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${HOME}/.ops-notepad/launch.log</string>
  <key>StandardErrorPath</key><string>${HOME}/.ops-notepad/launch.err</string>
</dict>
</plist>
EOF
  mkdir -p "$HOME/.ops-notepad"
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "已安装 macOS LaunchAgent: $PLIST"
  echo "卸载: launchctl unload $PLIST && rm $PLIST"

elif [[ "$OS" == "Linux" ]]; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR" "$HOME/.ops-notepad"
  UNIT="$UNIT_DIR/ops-notepad.service"
  cat > "$UNIT" <<EOF
[Unit]
Description=Ops Notepad
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
Environment=PORT=${PORT}
ExecStart=${ROOT}/.venv/bin/python ${ROOT}/app.py
Restart=on-failure

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now ops-notepad.service
  echo "已安装 systemd user 服务: ops-notepad"
  echo "卸载: systemctl --user disable --now ops-notepad.service"
else
  echo "未识别的系统。Windows 请将 scripts/start.bat 快捷方式放入 shell:startup"
fi
