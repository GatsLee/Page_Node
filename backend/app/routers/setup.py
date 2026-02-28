import asyncio
import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.config import settings as app_settings
from app.db.sqlite import get_db, get_all_settings, get_setting, set_setting
from app.models.setup import (
    AvailableModel,
    DownloadProgress,
    ModelDownloadRequest,
    SettingUpdate,
    SetupStatus,
)
from app.services.model_downloader import (
    cancel_download,
    get_download_progress,
    is_downloading,
    start_download,
)
from app.services.model_registry import MODEL_CATALOG

router = APIRouter()


# --- Setup Status ---


@router.get("/setup-status", response_model=SetupStatus)
async def get_setup_status(db=Depends(get_db)):
    return SetupStatus(
        setup_complete=(await get_setting(db, "setup_complete")) == "true",
        llm_model_id=await get_setting(db, "llm_model_id") or "",
        llm_model_path=await get_setting(db, "llm_model_path") or "",
    )


@router.post("/setup-complete")
async def mark_setup_complete(db=Depends(get_db)):
    await set_setting(db, "setup_complete", "true")
    # Derive and persist the model file path from the stored model ID
    model_id = await get_setting(db, "llm_model_id")
    if model_id and model_id in MODEL_CATALOG:
        model_path = app_settings.pagenode_models_dir / MODEL_CATALOG[model_id].filename
        if model_path.exists():
            await set_setting(db, "llm_model_path", str(model_path))
    return {"status": "ok"}


# --- Settings CRUD ---


@router.get("/")
async def list_settings(db=Depends(get_db)):
    return await get_all_settings(db)


@router.put("/")
async def update_setting(body: SettingUpdate, db=Depends(get_db)):
    await set_setting(db, body.key, body.value)
    return {"key": body.key, "value": body.value}


# --- Model Catalog ---


async def _get_ollama_model_names() -> set[str]:
    """Return set of model name prefixes found in local Ollama (e.g. {'llama3.2', 'qwen2.5'})."""
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get("http://localhost:11434/api/tags", timeout=1.5)
            if res.status_code == 200:
                models = res.json().get("models", [])
                return {m["name"].split(":")[0] for m in models}
    except Exception:
        pass
    return set()


@router.get("/models/available", response_model=list[AvailableModel])
async def list_available_models():
    ollama_prefixes = await _get_ollama_model_names()
    result = []
    for model in MODEL_CATALOG.values():
        model_path = app_settings.pagenode_models_dir / model.filename
        installed_size = model_path.stat().st_size if model_path.exists() else None
        ollama_installed = bool(
            model.ollama_name and model.ollama_name.split(":")[0] in ollama_prefixes
        )
        result.append(model.model_copy(update={
            "installed_size_bytes": installed_size,
            "ollama_installed": ollama_installed,
        }))
    return result


@router.post("/warm-embeddings")
async def warm_embeddings():
    """Pre-download the ChromaDB onnxruntime embedding model by running a test query."""
    from app.db.chromadb_ import get_collection

    collection = get_collection()
    try:
        # A query against an empty collection still triggers model download
        await asyncio.to_thread(
            collection.query,
            query_texts=["warmup"],
            n_results=1,
        )
    except Exception:
        pass  # Empty collection raises; that's expected
    return {"status": "ok"}


# --- Model Download ---


@router.post("/models/download")
async def download_model(body: ModelDownloadRequest, db=Depends(get_db)):
    if body.model_id not in MODEL_CATALOG:
        raise HTTPException(400, f"Unknown model: {body.model_id}")
    if is_downloading():
        raise HTTPException(409, "Download already in progress")

    await set_setting(db, "llm_model_id", body.model_id)
    await start_download(body.model_id)
    return {"status": "started", "model_id": body.model_id}


@router.get("/models/download/progress")
async def download_progress_sse():
    """SSE stream for download progress updates."""

    async def event_generator():
        while True:
            progress = get_download_progress()
            data = json.dumps(progress.model_dump())
            yield f"data: {data}\n\n"

            if progress.status in ("complete", "error", "cancelled"):
                break
            await asyncio.sleep(0.3)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/models/download/cancel")
async def cancel_model_download():
    if not is_downloading():
        raise HTTPException(400, "No download in progress")
    cancel_download()
    return {"status": "cancelling"}


@router.get("/models/download/status", response_model=DownloadProgress)
async def get_download_status():
    """Single poll endpoint (fallback if SSE is problematic)."""
    return get_download_progress()
