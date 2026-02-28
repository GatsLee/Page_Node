from __future__ import annotations

import asyncio
import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from app.config import settings
from app.models.setup import DownloadProgress
from app.services.model_registry import MODEL_CATALOG

logger = logging.getLogger(__name__)


@dataclass
class _DownloadState:
    status: str = "idle"
    model_name: str = ""
    downloaded_bytes: int = 0
    total_bytes: int = 0
    speed_mbps: float = 0.0
    error: str | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    _last_time: float = 0.0
    _last_bytes: int = 0

    def to_progress(self) -> DownloadProgress:
        pct = (self.downloaded_bytes / self.total_bytes * 100) if self.total_bytes > 0 else 0.0
        return DownloadProgress(
            status=self.status,
            model_name=self.model_name,
            downloaded_bytes=self.downloaded_bytes,
            total_bytes=self.total_bytes,
            percent=round(pct, 1),
            speed_mbps=round(self.speed_mbps, 2),
            error=self.error,
        )


_state = _DownloadState()


def get_download_progress() -> DownloadProgress:
    return _state.to_progress()


def _make_tqdm_class(state: _DownloadState):
    """Create a custom tqdm subclass that captures progress into shared state."""
    from tqdm import tqdm

    class ProgressCapture(tqdm):
        def __init__(self, *args, **kwargs):
            # Force disable=False — huggingface_hub passes disable=None
            # which disables tqdm in non-TTY environments, breaking self.n tracking
            kwargs["disable"] = False
            kwargs.pop("name", None)  # HF-specific kwarg, not in standard tqdm
            super().__init__(*args, **kwargs)
            if self.total:
                state.total_bytes = int(self.total)
            state._last_time = time.monotonic()
            state._last_bytes = 0

        def update(self, n=1):
            super().update(n)
            state.downloaded_bytes = int(self.n)
            now = time.monotonic()
            elapsed = now - state._last_time
            if elapsed > 0.5:
                delta_bytes = state.downloaded_bytes - state._last_bytes
                state.speed_mbps = (delta_bytes / elapsed) / (1024 * 1024)
                state._last_time = now
                state._last_bytes = state.downloaded_bytes

            if state.cancel_event.is_set():
                raise KeyboardInterrupt("Download cancelled by user")

        def display(self, *args, **kwargs):
            pass  # suppress terminal output

    return ProgressCapture


def _download_sync(model_id: str) -> Path:
    """Blocking download — runs in a thread via asyncio.to_thread."""
    from huggingface_hub import hf_hub_download

    model = MODEL_CATALOG[model_id]
    models_dir = settings.pagenode_models_dir
    models_dir.mkdir(parents=True, exist_ok=True)

    # Check if already downloaded
    target = models_dir / model.filename
    if target.exists() and target.stat().st_size > 0:
        _state.status = "complete"
        _state.model_name = model.name
        _state.downloaded_bytes = target.stat().st_size
        _state.total_bytes = target.stat().st_size
        _state.speed_mbps = 0.0
        _state.error = None
        return target

    _state.status = "downloading"
    _state.model_name = model.name
    _state.downloaded_bytes = 0
    _state.total_bytes = 0
    _state.speed_mbps = 0.0
    _state.error = None
    _state.cancel_event.clear()

    path = hf_hub_download(
        repo_id=model.repo_id,
        filename=model.filename,
        local_dir=str(models_dir),
        tqdm_class=_make_tqdm_class(_state),
    )
    return Path(path)


async def start_download(model_id: str) -> None:
    if _state.status == "downloading":
        raise RuntimeError("Download already in progress")

    if model_id not in MODEL_CATALOG:
        raise ValueError(f"Unknown model_id: {model_id}")

    async def _run():
        try:
            path = await asyncio.to_thread(_download_sync, model_id)
            if _state.status == "downloading":
                _state.status = "complete"
            return str(path)
        except KeyboardInterrupt:
            _state.status = "cancelled"
            _state.error = "Download cancelled"
            logger.info("Model download cancelled by user")
        except Exception as e:
            _state.status = "error"
            _state.error = str(e)
            logger.error("Model download failed: %s", e)

    asyncio.create_task(_run())


def cancel_download() -> None:
    _state.cancel_event.set()


def is_downloading() -> bool:
    return _state.status == "downloading"
