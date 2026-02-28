from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

logger = logging.getLogger(__name__)

_running_tasks: dict[str, asyncio.Task[Any]] = {}


def start_task(doc_id: str, coro: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
    """Create an asyncio task and register it by document ID."""
    task = asyncio.create_task(coro, name=f"ingest-{doc_id}")
    _running_tasks[doc_id] = task
    task.add_done_callback(lambda _: _running_tasks.pop(doc_id, None))
    return task


def get_task(doc_id: str) -> asyncio.Task[Any] | None:
    return _running_tasks.get(doc_id)


def is_processing(doc_id: str) -> bool:
    task = _running_tasks.get(doc_id)
    return task is not None and not task.done()


async def recover_stuck_documents() -> None:
    """Re-queue documents stuck in processing state from a previous crash."""
    from app.db.sqlite import find_documents_by_status, get_db
    from app.services.ingestion import process_document, run_llm_stage_for_doc

    async for db in get_db():
        # Restart full pipeline for docs stuck before the LLM stage
        stuck_pipeline = await find_documents_by_status(
            db, ["extracting", "chunking", "embedding"]
        )
        for doc in stuck_pipeline:
            logger.info("Recovering stuck document: %s (%s)", doc.id, doc.status)
            start_task(doc.id, process_document(doc.id))

        # Restart only the LLM stage for docs stuck during concept extraction
        # (avoids re-chunking which would create duplicate chunks)
        stuck_llm = await find_documents_by_status(db, ["extracting_concepts"])
        for doc in stuck_llm:
            logger.info("Recovering LLM stage for document: %s", doc.id)
            start_task(doc.id, run_llm_stage_for_doc(doc.id))
