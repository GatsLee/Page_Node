"""
Flashcard generation service.

For each chunk of a document (up to MAX_CHUNKS, minimum MIN_CHUNK_CHARS):
  1. Calls the LLM via llm_service.chat_json()
  2. Parses {"cards": [{"question", "answer", "difficulty"}]}
  3. Inserts into the SQLite flashcards table

Soft failures: LLMUnavailableError stops the loop; per-chunk exceptions are logged and skipped.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

import aiosqlite

from app.services.llm_service import LLMUnavailableError, chat_json

logger = logging.getLogger(__name__)

MAX_CHUNKS = 10
MIN_CHUNK_CHARS = 100

SYSTEM_PROMPT = (
    "You are a flashcard generator for active recall learning. "
    "Given a text passage, generate 2-3 question-answer pairs to test understanding. "
    "Respond ONLY with valid JSON in exactly this structure:\n"
    '{"cards": [{"question": "string", "answer": "string", "difficulty": 0.3}]}\n'
    "Rules:\n"
    "- difficulty is a float from 0.1 (easy) to 0.9 (hard).\n"
    "- Questions must be specific and directly answerable from the passage.\n"
    "- Answers must be concise (1-3 sentences).\n"
    "- Generate at most 3 cards per passage.\n"
    "- If the passage has no meaningful content to test, return an empty cards array."
)


def _user_prompt(chunk_text: str) -> str:
    return f"Generate flashcards from this passage:\n\n{chunk_text[:3000]}"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


async def generate_flashcards_for_document(
    db: aiosqlite.Connection,
    doc_id: str,
) -> int:
    """
    Generate flashcards for up to MAX_CHUNKS chunks.
    Returns the total number of flashcards inserted.
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
        return 0

    now = _now()
    total_cards = 0

    for row in rows:
        chunk_id, content = str(row[0]), str(row[1])
        if len(content) < MIN_CHUNK_CHARS:
            continue

        try:
            result = await chat_json(SYSTEM_PROMPT, _user_prompt(content), max_tokens=512)
        except LLMUnavailableError:
            logger.warning("LLM unavailable — stopping flashcard generation for doc %s", doc_id)
            break
        except Exception as e:
            logger.warning("LLM call failed for flashcard chunk %s: %s", chunk_id, e)
            continue

        for card in result.get("cards") or []:
            question = (card.get("question") or "").strip()
            answer = (card.get("answer") or "").strip()
            if not question or not answer:
                continue
            difficulty = float(card.get("difficulty") or 0.3)
            difficulty = max(0.1, min(0.9, difficulty))

            try:
                await db.execute(
                    """INSERT INTO flashcards
                       (id, document_id, chunk_id, question, answer,
                        difficulty, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        str(uuid.uuid4()),
                        doc_id,
                        chunk_id,
                        question,
                        answer,
                        difficulty,
                        now,
                        now,
                    ),
                )
                total_cards += 1
            except Exception as e:
                logger.warning("Flashcard insert failed: %s", e)

        await db.commit()

    return total_cards
