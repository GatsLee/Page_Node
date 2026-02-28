from __future__ import annotations

from pydantic import BaseModel


class Flashcard(BaseModel):
    id: str
    document_id: str
    chunk_id: str | None
    question: str
    answer: str
    difficulty: float       # 0.1–0.9; used as inverse EF in SM-2 interval formula
    interval: int           # days until next review
    repetitions: int        # consecutive correct recalls
    next_review: str | None # ISO date (YYYY-MM-DD) or None = due immediately
    created_at: str
    updated_at: str


class FlashcardList(BaseModel):
    items: list[Flashcard]
    total: int


class FlashcardUpdate(BaseModel):
    question: str | None = None
    answer: str | None = None


class ReviewRequest(BaseModel):
    grade: int  # 0=Again, 1=Hard, 2=Good, 3=Easy


class ReviewResult(BaseModel):
    id: str
    interval: int
    next_review: str
    repetitions: int
    difficulty: float
