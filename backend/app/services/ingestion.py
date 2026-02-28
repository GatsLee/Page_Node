from __future__ import annotations

import asyncio
import logging
import traceback

from app.db.chromadb_ import get_collection
from app.db.sqlite import (
    get_db,
    get_document,
    get_setting,
    insert_chunks,
    insert_toc_entries,
    update_chunks_embedding,
    update_document,
)
from app.models.document import DocumentUpdate
from app.services.chunker import chunk_pages
from app.services.pdf_extractor import extract_pdf

logger = logging.getLogger(__name__)

CHROMA_BATCH_SIZE = 100


async def process_document(doc_id: str) -> None:
    """Full ingestion pipeline: extract → chunk → embed → (LLM concepts + flashcards).

    Runs as a background asyncio task. Updates document status at each stage.
    """
    try:
        async for db in get_db():
            # --- Step 1: Extract ---
            await _set_status(db, doc_id, "extracting")

            doc = await get_document(db, doc_id)
            if doc is None:
                logger.error("Document %s not found, aborting ingestion", doc_id)
                return

            from pathlib import Path

            extraction = await asyncio.to_thread(extract_pdf, Path(doc.file_path))

            # Update document with extracted metadata
            update_fields: dict = {"page_count": extraction.page_count}
            if extraction.title and doc.title == Path(doc.file_path).stem:
                update_fields["title"] = extraction.title
            if extraction.author and not doc.author:
                update_fields["author"] = extraction.author

            if update_fields:
                await db.execute(
                    "UPDATE documents SET {} WHERE id = ?".format(  # noqa: S608
                        ", ".join(f"{k} = ?" for k in update_fields)
                    ),
                    list(update_fields.values()) + [doc_id],
                )
                await db.commit()

            # Store TOC
            if extraction.toc:
                await insert_toc_entries(db, doc_id, extraction.toc)

            # Scanned PDF — flag and stop (no text to chunk/embed)
            if extraction.needs_ocr:
                await _set_status(db, doc_id, "needs_ocr")
                logger.warning(
                    "Document %s flagged needs_ocr (avg %.1f chars/page)",
                    doc_id,
                    sum(len(p.text.strip()) for p in extraction.pages) / max(len(extraction.pages), 1),
                )
                return

            # --- Step 2: Chunk ---
            await _set_status(db, doc_id, "chunking")

            chunks = chunk_pages(extraction.pages)
            if not chunks:
                logger.warning("No chunks produced for document %s", doc_id)
                await _set_status(db, doc_id, "ready")
                return

            chunk_ids = await insert_chunks(db, doc_id, chunks)

            # --- Step 3: Embed ---
            await _set_status(db, doc_id, "embedding")

            collection = get_collection()

            # Delete any existing embeddings for this doc (crash recovery)
            try:
                collection.delete(where={"document_id": doc_id})
            except Exception:
                pass  # Collection may be empty, that's fine

            # Add chunks to ChromaDB in batches (auto-embeds via onnxruntime)
            for i in range(0, len(chunks), CHROMA_BATCH_SIZE):
                batch_chunks = chunks[i : i + CHROMA_BATCH_SIZE]
                batch_ids = chunk_ids[i : i + CHROMA_BATCH_SIZE]

                await asyncio.to_thread(
                    collection.add,
                    ids=batch_ids,
                    documents=[c.content for c in batch_chunks],
                    metadatas=[
                        {
                            "document_id": doc_id,
                            "chunk_index": c.chunk_index,
                            "page_number": c.page_number or 0,
                        }
                        for c in batch_chunks
                    ],
                )

            await update_chunks_embedding(db, doc_id)

            # --- Step 4: LLM Concept Extraction + Flashcard Generation ---
            llm_model_id = (await get_setting(db, "llm_model_id")) or ""
            llm_model_path = (await get_setting(db, "llm_model_path")) or ""

            # Re-fetch doc to get updated title/author after extraction
            doc = await get_document(db, doc_id) or doc

            if llm_model_id or llm_model_path:
                await _run_llm_stage(db, doc_id, doc.title, doc.author or "")
            else:
                await _set_status(db, doc_id, "ready")
                logger.info(
                    "Document %s processed: %d pages, %d chunks (no LLM configured)",
                    doc_id,
                    extraction.page_count,
                    len(chunks),
                )

    except Exception:
        logger.error("Ingestion failed for %s:\n%s", doc_id, traceback.format_exc())
        try:
            async for db in get_db():
                await _set_status(db, doc_id, "error")
        except Exception:
            logger.error("Failed to set error status for %s", doc_id)


async def run_llm_stage_for_doc(doc_id: str) -> None:
    """
    Standalone LLM stage — used by crash recovery for extracting_concepts docs.
    Re-runs only concept extraction and flashcard generation (skips extract/chunk/embed).
    Falls back to 'ready' if the LLM fails entirely.
    """
    try:
        async for db in get_db():
            doc = await get_document(db, doc_id)
            if doc is None:
                logger.error("Document %s not found for LLM stage recovery", doc_id)
                return
            await _run_llm_stage(db, doc_id, doc.title, doc.author or "")
    except Exception:
        logger.error(
            "LLM stage recovery failed for %s:\n%s", doc_id, traceback.format_exc()
        )
        try:
            async for db in get_db():
                await _set_status(db, doc_id, "ready")
        except Exception:
            pass


async def _run_llm_stage(
    db,
    doc_id: str,
    doc_title: str,
    doc_author: str,
) -> None:
    """
    Run concept extraction + flashcard generation.
    Each phase is wrapped independently for soft failure.
    Status always advances to 'concepts_ready' at the end.
    """
    from app.services.concept_extractor import extract_concepts_for_document
    from app.services.flashcard_generator import generate_flashcards_for_document

    await _set_status(db, doc_id, "extracting_concepts")

    try:
        n_concepts = await extract_concepts_for_document(db, doc_id, doc_title, doc_author)
        logger.info("Document %s: extracted %d concepts", doc_id, n_concepts)
    except Exception:
        logger.error(
            "Concept extraction failed for %s:\n%s", doc_id, traceback.format_exc()
        )

    try:
        n_cards = await generate_flashcards_for_document(db, doc_id)
        logger.info("Document %s: generated %d flashcards", doc_id, n_cards)
    except Exception:
        logger.error(
            "Flashcard generation failed for %s:\n%s", doc_id, traceback.format_exc()
        )

    await _set_status(db, doc_id, "concepts_ready")


async def _set_status(db, doc_id: str, status: str) -> None:
    await update_document(db, doc_id, DocumentUpdate(status=status))
