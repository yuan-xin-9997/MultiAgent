#!/usr/bin/env bash
set -euo pipefail

app_dir="$HOME/apps/multiagent"
config_dir="$HOME/.config/multiagent"
data_dir="$HOME/.local/share/multiagent"
unit_dir="$HOME/.config/systemd/user"
codex_bin="$HOME/.local/share/multiagent-cli/node_modules/.bin"
tailnet_ip="$(tailscale ip -4 | head -1)"

if [[ -z "$tailnet_ip" ]]; then
  echo "Tailscale IPv4 is required for private Web access" >&2
  exit 1
fi
if [[ ! -x "$codex_bin/codex" ]]; then
  echo "Codex CLI is not installed at $codex_bin" >&2
  exit 1
fi

mkdir -p "$config_dir" "$data_dir" "$unit_dir"
chmod 700 "$config_dir" "$data_dir"

if [[ ! -e "$config_dir/env" ]]; then
  MA_CONFIG_DIR="$config_dir" MA_DATA_PATH="$data_dir" MA_TAILNET_IP="$tailnet_ip" MA_CODEX_BIN="$codex_bin" python3 - <<'PY'
import os
import secrets
from pathlib import Path

config = Path(os.environ["MA_CONFIG_DIR"])
password = secrets.token_urlsafe(18)
secret = secrets.token_urlsafe(48)
values = {
    "MA_HOST": os.environ["MA_TAILNET_IP"],
    "MA_PORT": "33080",
    "MA_DATA_DIR": os.environ["MA_DATA_PATH"],
    "MA_MODELS_FILE": str(config / "models.json"),
    "MA_PASSWORD": password,
    "MA_SESSION_SECRET": secret,
    "MA_GIT_TRANSPORT": "ssh",
    "MA_TEST_IMAGE": "python:3.12-slim",
    "MA_AIDER_IMAGE": "multiagent-aider:local",
    "PATH": os.environ["MA_CODEX_BIN"] + ":/usr/local/bin:/usr/bin:/bin",
}
path = config / "env"
path.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
path.chmod(0o600)
PY
fi

if [[ ! -e "$config_dir/models.json" ]]; then
  cat > "$config_dir/models.json" <<'JSON'
{
  "codex": {
    "label": "Codex · ChatGPT 登录",
    "adapter": "codex",
    "roles": ["planning", "implementation", "testing", "review"]
  }
}
JSON
  chmod 600 "$config_dir/models.json"
fi

cat > "$unit_dir/multiagent.service" <<UNIT
[Unit]
Description=MultiAgent Coding Web and worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$app_dir
EnvironmentFile=$config_dir/env
ExecStart=/usr/bin/python3 $app_dir/app.py
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=true
MemoryMax=4G

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now multiagent.service
echo "MultiAgent Web configured at http://$tailnet_ip:33080"
echo "Web password: retrieve MA_PASSWORD from $config_dir/env on the server"
