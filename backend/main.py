import socket

import uvicorn

from app import app


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


if __name__ == "__main__":
    port = find_free_port()
    print(f"PORT={port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
