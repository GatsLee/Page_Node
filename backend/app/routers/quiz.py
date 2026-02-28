"""
Quiz & Spaced Repetition router.

Endpoints:
  GET  /quiz/due             — cards due for review today
  POST /quiz/{id}/review     — submit grade, run SM-2, update concept mastery
  GET  /quiz/cards           — list all cards (optionally filtered by doc_id)
  GET  /quiz/stats           — summary stats (total, due, per-doc)
  GET  /quiz/{id}            — single card
  PATCH/quiz/{id}            — edit question / answer
  DELETE /quiz/{id}          — delete card
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query

from app.db.kuzu_ import update_concept_mastery_from_chunk
from app.db.sqlite import (
    delete_flashcard,
    get_due_flashcards,
    get_flashcard,
    get_quiz_stats,
    list_flashcards,
    update_flashcard_content,
    update_flashcard_sm2,
    get_db,
)
from app.models.flashcard import (
    Flashcard,
    FlashcardList,
    FlashcardUpdate,
    ReviewRequest,
    ReviewResult,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# --- SM-2 grade mapping ---
# grade: 0=Again, 1=Hard, 2=Good, 3=Easy
_GRADE_QUALITY = [0, 2, 4, 5]       # maps to SM-2 quality scores (0–5)
_MASTERY_DELTA = {0: -0.05, 1: 0.0, 2: 0.05, 3: 0.10}


def _compute_sm2(
    grade: int,
    repetitions: int,
    interval: int,
    difficulty: float,
) -> tuple[int, int, float, str]:
    """
    Compute SM-2 scheduling values for a reviewed card.

    Returns (new_repetitions, new_interval, new_difficulty, next_review_date_iso).
    """
    q = _GRADE_QUALITY[grade]

    if q < 3:
        # Incorrect recall: reset streak and retry tomorrow
        new_reps = 0
        new_interval = 1
    else:
        if repetitions == 0:
            new_interval = 1
        elif repetitions == 1:
            new_interval = 6
        else:
            # Interval grows faster for easy cards (low difficulty)
            new_interval = max(1, round(interval * (2.5 - difficulty * 1.2)))
        new_reps = repetitions + 1

    # EF-inspired difficulty update (standard SM-2 EF formula, rescaled to 0.1–0.9)
    ef_delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
    new_difficulty = max(0.1, min(0.9, difficulty - ef_delta * 0.2))

    next_review = (date.today() + timedelta(days=new_interval)).isoformat()
    return new_reps, new_interval, new_difficulty, next_review


# --- Endpoints ---

@router.get("/due", response_model=FlashcardList)
async def get_due(
    limit: int = Query(default=20, ge=1, le=100),
    doc_id: str | None = Query(default=None),
    db: aiosqlite.Connection = Depends(get_db),
) -> FlashcardList:
    """Return cards due for review today, oldest first."""
    items = await get_due_flashcards(db, limit=limit, doc_id=doc_id)
    return FlashcardList(items=items, total=len(items))


@router.post("/{card_id}/review", response_model=ReviewResult)
async def review_card(
    card_id: str,
    body: ReviewRequest,
    db: aiosqlite.Connection = Depends(get_db),
) -> ReviewResult:
    """Submit a review grade for a flashcard. Runs SM-2 and updates concept mastery."""
    if body.grade not in (0, 1, 2, 3):
        raise HTTPException(status_code=422, detail="grade must be 0, 1, 2, or 3")

    card = await get_flashcard(db, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Flashcard not found")

    new_reps, new_interval, new_diff, next_review = _compute_sm2(
        body.grade, card.repetitions, card.interval, card.difficulty
    )

    updated = await update_flashcard_sm2(
        db, card_id, new_reps, new_interval, new_diff, next_review
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update flashcard")

    # Update concept mastery in Kuzu graph (best-effort; never fails the request)
    if card.chunk_id:
        delta = _MASTERY_DELTA[body.grade]
        try:
            await update_concept_mastery_from_chunk(card.chunk_id, delta)
        except Exception:
            logger.warning(
                "Mastery update failed for chunk %s (card %s)", card.chunk_id, card_id
            )

    return ReviewResult(
        id=card_id,
        interval=new_interval,
        next_review=next_review,
        repetitions=new_reps,
        difficulty=new_diff,
    )


@router.get("/cards", response_model=FlashcardList)
async def list_cards(
    doc_id: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: aiosqlite.Connection = Depends(get_db),
) -> FlashcardList:
    """List all flashcards, optionally filtered by document."""
    items, total = await list_flashcards(db, doc_id=doc_id, offset=offset, limit=limit)
    return FlashcardList(items=items, total=total)


@router.get("/stats")
async def quiz_stats(db: aiosqlite.Connection = Depends(get_db)) -> dict:
    """Return summary statistics: total cards, due today, per-document breakdown."""
    return await get_quiz_stats(db)


@router.get("/{card_id}", response_model=Flashcard)
async def get_card(
    card_id: str,
    db: aiosqlite.Connection = Depends(get_db),
) -> Flashcard:
    card = await get_flashcard(db, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Flashcard not found")
    return card


@router.patch("/{card_id}", response_model=Flashcard)
async def edit_card(
    card_id: str,
    body: FlashcardUpdate,
    db: aiosqlite.Connection = Depends(get_db),
) -> Flashcard:
    updated = await update_flashcard_content(db, card_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Flashcard not found")
    return updated


@router.delete("/{card_id}", status_code=204)
async def remove_card(
    card_id: str,
    db: aiosqlite.Connection = Depends(get_db),
) -> None:
    deleted = await delete_flashcard(db, card_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Flashcard not found")
