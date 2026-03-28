from __future__ import annotations

import socket
import threading
import time
import urllib.error
import urllib.request
import webbrowser

import uvicorn

from app.main import app


def _find_available_port(preferred: int = 8000) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            pass

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _open_when_ready(port: int) -> None:
    base_url = f"http://127.0.0.1:{port}"
    health_url = f"{base_url}/api/health"

    for _ in range(120):
        try:
            with urllib.request.urlopen(health_url, timeout=1) as response:
                if response.status == 200:
                    webbrowser.open(base_url)
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(0.25)

    webbrowser.open(base_url)


def main() -> None:
    port = _find_available_port(8000)

    opener = threading.Thread(target=_open_when_ready, args=(port,), daemon=True)
    opener.start()

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
