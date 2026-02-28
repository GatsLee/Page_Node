"""
Concept extraction service.

For each chunk of a document (up to MAX_CHUNKS, minimum MIN_CHUNK_CHARS):
  1. Calls the LLM via llm_service.chat_json()
  2. Parses {"concepts": [...], "relationships": [...]}
  3. Upserts concepts into Kuzu (find-by-name or create)
  4. Adds EXTRACTED_FROM edges
  5. Adds RELATES_TO / PREREQUISITE_OF edges between extracted concepts
  6. Updates documents.concept_count in SQLite

Soft failures: LLMUnavailableError stops the loop; per-chunk exceptions are logged and skipped.
"""
from __future__ import annotations

import logging

import aiosqlite

from app.db.kuzu_ import (
    add_concept_edge,
    add_extracted_from,
    ensure_doc_node,
    upsert_concept,
)
from app.services.llm_service import LLMUnavailableError, chat_json

logger = logging.getLogger(__name__)

MAX_CHUNKS = 20
MIN_CHUNK_CHARS = 100

SYSTEM_PROMPT = (
    "You are a knowledge extraction engine. "
    "Given a text passage from a document, identify key concepts and their relationships. "
    "Respond ONLY with valid JSON in exactly this structure:\n"
    '{"concepts": [{"name": "string", "category": "string", "description": "string"}], '
    '"relationships": [{"from": "concept name", "to": "concept name", "type": "relates_to"}]}\n'
    "Rules:\n"
    "- Extract at most 5 concepts per passage.\n"
    "- Keep concept names concise (2-5 words).\n"
    "- Categories must be one of: programming, mathematics, science, engineering, general.\n"
    "- Relationship types must be: relates_to or prerequisite_of.\n"
    "- 'from' and 'to' in relationships must exactly match names in the concepts list.\n"
    "- If no clear concepts are found, return empty arrays."
)


def _user_prompt(chunk_text: str, doc_title: str) -> str:
    return (
        f'Extract concepts from this passage from "{doc_title}":\n\n'
        f"{chunk_text[:3000]}"
    )


async def extract_concepts_for_document(
    db: aiosqlite.Connection,
    doc_id: str,
    doc_title: str,
    doc_author: str,
) -> int:
    """
    Run concept extraction for up to MAX_CHUNKS chunks.
    Returns the total number of new/existing concepts linked to this document.
    Does not raise — logs errors and continues.
    """
    cursor = await db.execute(
        "SELECT id, content FROM chunks "
        "WHERE document_id = ? AND has_embedding = 1 "
        "ORDER BY chunk_index LIMIT ?",
        (doc_id, MAX_CHUNKS),
    )
    rows = await cursor.fetchall()

    if not rows:
        logger.info("No embedded chunks found for document %s", doc_id)
        return 0

    # Ensure the DocNode exists in Kuzu before writing EXTRACTED_FROM edges
    await ensure_doc_node(doc_id, doc_title, doc_author)

    total_concepts = 0

    for row in rows:
        chunk_id, content = str(row[0]), str(row[1])
        if len(content) < MIN_CHUNK_CHARS:
            continue

        try:
            result = await chat_json(
                SYSTEM_PROMPT,
                _user_prompt(content, doc_title),
                max_tokens=512,
            )
        except LLMUnavailableError:
            logger.warning("LLM unavailable — stopping concept extraction for doc %s", doc_id)
            break
        except Exception as e:
            logger.warning("LLM call failed for chunk %s: %s", chunk_id, e)
            continue

        concepts_data = result.get("concepts") or []
        relationships_data = result.get("relationships") or []

        # name → kuzu concept_id for this chunk's relationship pass
        name_to_id: dict[str, str] = {}

        for cdata in concepts_data:
            name = (cdata.get("name") or "").strip()
            category = (cdata.get("category") or "general").strip().lower()
            description = (cdata.get("description") or "").strip()
            if not name:
                continue

            valid_categories = {"programming", "mathematics", "science", "engineering", "general"}
            if category not in valid_categories:
                category = "general"

            try:
                concept_id = await upsert_concept(name, category, description)
                name_to_id[name] = concept_id
                await add_extracted_from(concept_id, doc_id, chunk_id, confidence=0.8)
                total_concepts += 1
            except Exception as e:
                logger.warning("Kuzu write failed for concept '%s': %s", name, e)

        for rel in relationships_data:
            from_name = (rel.get("from") or "").strip()
            to_name = (rel.get("to") or "").strip()
            rel_type = (rel.get("type") or "relates_to").strip()
            if not from_name or not to_name:
                continue
            if from_name not in name_to_id or to_name not in name_to_id:
                continue
            try:
                await add_concept_edge(name_to_id[from_name], name_to_id[to_name], rel_type)
            except Exception as e:
                logger.warning("Kuzu edge write failed (%s→%s): %s", from_name, to_name, e)

    # Persist concept count to SQLite
    if total_concepts > 0:
        await db.execute(
            "UPDATE documents SET concept_count = ? WHERE id = ?",
            (total_concepts, doc_id),
        )
        await db.commit()

    return total_concepts
