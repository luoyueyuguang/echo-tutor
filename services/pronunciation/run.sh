#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# httpx2 rejects the common "socks://" alias; keep HTTP(S)_PROXY, drop the bad alias.
case "${ALL_PROXY:-}" in socks://*) unset ALL_PROXY ;; esac
case "${all_proxy:-}" in socks://*) unset all_proxy ;; esac

if [ ! -x .venv/bin/python ]; then
  uv venv --python 3.12 .venv
  uv pip install --python .venv/bin/python torch torchaudio \
    --index-url https://download.pytorch.org/whl/cpu \
    --extra-index-url https://pypi.org/simple
  uv pip install --python .venv/bin/python -r requirements.txt
fi

exec .venv/bin/uvicorn app:app --host 127.0.0.1 --port "${PRONUNCIATION_PORT:-9000}"
