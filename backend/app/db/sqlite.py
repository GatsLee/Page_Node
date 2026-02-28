import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

import aiosqlite

from app.config import settings
from app.models.chunk import Chunk
from app.models.document import Document, DocumentCreate, DocumentUpdate
from app.models.flashcard import Flashcard, FlashcardUpdate
from app.services.chunker import ChunkData
from app.services.pdf_extractor import TocItem

_db_path: Path | None = None

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    author      TEXT DEFAULT '',
    file_type   TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    file_hash   TEXT NOT NULL,
    file_size   INTEGER NOT NULL,
    page_count  INTEGER DEFAULT 0,
    cover_color TEXT DEFAULT 'charcoal',
    cover_texture TEXT DEFAULT 'plain',
    ai_confidence REAL DEFAULT 0.0,
    status      TEXT DEFAULT 'pending',
    concept_count INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chunks (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content     TEXT NOT NULL,
    page_number INTEGER,
    char_start  INTEGER,
    char_end    INTEGER,
    token_count INTEGER DEFAULT 0,
    has_embedding INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_order ON chunks(document_id, chunk_index);

CREATE TABLE IF NOT EXISTS tags (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#5e5e5e'
);

CREATE TABLE IF NOT EXISTS document_tags (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
);

CREATE TABLE IF NOT EXISTS toc_entries (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    parent_id   TEXT REFERENCES toc_entries(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    level       INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    page_number INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_toc_document ON toc_entries(document_id);

CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    chunk_id    TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    content     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flashcards (
    id          TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id    TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    difficulty  REAL DEFAULT 0.3,
    interval    INTEGER DEFAULT 1,
    repetitions INTEGER DEFAULT 0,
    next_review TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_flashcards_review ON flashcards(next_review);

CREATE TABLE IF NOT EXISTS activity_log (
    id          TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    detail      TEXT DEFAULT '',
    mastery_pct REAL DEFAULT 0.0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_document ON activity_log(document_id);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(created_at);

CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_version(version) VALUES (1);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO settings(key, value) VALUES ('setup_complete', 'false');
INSERT OR IGNORE INTO settings(key, value) VALUES ('llm_model_id', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('llm_model_path', '');
"""


async def init_sqlite(data_dir: Path) -> None:
    global _db_path
    _db_path = data_dir / settings.sqlite_filename
    async with aiosqlite.connect(_db_path) as db:
        await db.executescript(SCHEMA_SQL)
        # Migration v1 → v2: add settings table for existing databases
        cursor = await db.execute("SELECT MAX(version) FROM schema_version")
        current_version = (await cursor.fetchone())[0]
        if current_version < 2:
            await db.executescript("""
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT OR IGNORE INTO settings(key, value) VALUES ('setup_complete', 'false');
                INSERT OR IGNORE INTO settings(key, value) VALUES ('llm_model_id', '');
                INSERT OR IGNORE INTO settings(key, value) VALUES ('llm_model_path', '');
                INSERT OR IGNORE INTO schema_version(version) VALUES (2);
            """)
        if current_version < 3:
            await db.executescript("""
                ALTER TABLE documents ADD COLUMN concept_count INTEGER DEFAULT 0;
                INSERT OR IGNORE INTO schema_version(version) VALUES (3);
            """)
        await db.commit()


async def get_db() -> AsyncIterator[aiosqlite.Connection]:
    assert _db_path is not None, "SQLite not initialized"
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")
        yield db


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _row_to_document(row: aiosqlite.Row) -> Document:
    return Document(**dict(row))


async def create_document(db: aiosqlite.Connection, doc: DocumentCreate) -> Document:
    doc_id = str(uuid.uuid4())
    now = _now()
    await db.execute(
        """INSERT INTO documents
           (id, title, author, file_type, file_path, file_hash, file_size,
            page_count, cover_color, cover_texture, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            doc_id,
            doc.title,
            doc.author,
            doc.file_type.value,
            doc.file_path,
            doc.file_hash,
            doc.file_size,
            doc.page_count,
            doc.cover_color.value,
            doc.cover_texture.value,
            now,
            now,
        ),
    )
    await db.commit()
    return await get_document(db, doc_id)  # type: ignore[return-value]


async def get_document(db: aiosqlite.Connection, doc_id: str) -> Document | None:
    cursor = await db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,))
    row = await cursor.fetchone()
    if row is None:
        return None
    return _row_to_document(row)


async def list_documents(
    db: aiosqlite.Connection, offset: int = 0, limit: int = 50
) -> tuple[list[Document], int]:
    cursor = await db.execute("SELECT COUNT(*) FROM documents")
    total = (await cursor.fetchone())[0]

    cursor = await db.execute(
        "SELECT * FROM documents ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (limit, offset),
    )
    rows = await cursor.fetchall()
    return [_row_to_document(r) for r in rows], total


async def update_document(
    db: aiosqlite.Connection, doc_id: str, updates: DocumentUpdate
) -> Document | None:
    fields = updates.model_dump(exclude_none=True)
    if not fields:
        return await get_document(db, doc_id)

    # Convert enums to values
    for key, val in fields.items():
        if hasattr(val, "value"):
            fields[key] = val.value

    fields["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [doc_id]

    await db.execute(
        f"UPDATE documents SET {set_clause} WHERE id = ?",  # noqa: S608
        values,
    )
    await db.commit()
    return await get_document(db, doc_id)


async def delete_document(db: aiosqlite.Connection, doc_id: str) -> bool:
    cursor = await db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    await db.commit()
    return cursor.rowcount > 0


# --- Phase 2: Chunk, TOC, duplicate detection, recovery ---


async def find_document_by_hash(
    db: aiosqlite.Connection, file_hash: str
) -> Document | None:
    cursor = await db.execute(
        "SELECT * FROM documents WHERE file_hash = ?", (file_hash,)
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    return _row_to_document(row)


async def insert_chunks(
    db: aiosqlite.Connection, doc_id: str, chunks: list[ChunkData]
) -> list[str]:
    """Insert chunks into SQLite. Returns list of generated chunk IDs."""
    now = _now()
    chunk_ids: list[str] = []
    for c in chunks:
        chunk_id = str(uuid.uuid4())
        chunk_ids.append(chunk_id)
        await db.execute(
            """INSERT INTO chunks
               (id, document_id, chunk_index, content, page_number,
                char_start, char_end, token_count, has_embedding, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
            (
                chunk_id,
                doc_id,
                c.chunk_index,
                c.content,
                c.page_number,
                c.char_start,
                c.char_end,
                c.token_count,
                now,
            ),
        )
    await db.commit()
    return chunk_ids


async def update_chunks_embedding(
    db: aiosqlite.Connection, doc_id: str
) -> None:
    await db.execute(
        "UPDATE chunks SET has_embedding = 1 WHERE document_id = ?", (doc_id,)
    )
    await db.commit()


def _row_to_chunk(row: aiosqlite.Row) -> Chunk:
    d = dict(row)
    d["has_embedding"] = bool(d["has_embedding"])
    return Chunk(**d)


async def list_chunks_for_document(
    db: aiosqlite.Connection, doc_id: str, offset: int = 0, limit: int = 50
) -> tuple[list[Chunk], int]:
    cursor = await db.execute(
        "SELECT COUNT(*) FROM chunks WHERE document_id = ?", (doc_id,)
    )
    total = (await cursor.fetchone())[0]

    cursor = await db.execute(
        "SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index LIMIT ? OFFSET ?",
        (doc_id, limit, offset),
    )
    rows = await cursor.fetchall()
    return [_row_to_chunk(r) for r in rows], total


async def insert_toc_entries(
    db: aiosqlite.Connection, doc_id: str, toc_items: list[TocItem]
) -> None:
    now = _now()
    for i, item in enumerate(toc_items):
        await db.execute(
            """INSERT INTO toc_entries
               (id, document_id, title, level, sort_order, page_number, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()),
                doc_id,
                item.title,
                item.level,
                i,
                item.page_number,
                now,
            ),
        )
    await db.commit()


async def find_documents_by_status(
    db: aiosqlite.Connection, statuses: list[str]
) -> list[Document]:
    placeholders = ", ".join("?" for _ in statuses)
    cursor = await db.execute(
        f"SELECT * FROM documents WHERE status IN ({placeholders})",  # noqa: S608
        statuses,
    )
    rows = await cursor.fetchall()
    return [_row_to_document(r) for r in rows]


# --- Settings key-value store ---


async def get_setting(db: aiosqlite.Connection, key: str) -> str | None:
    cursor = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = await cursor.fetchone()
    return row[0] if row else None


async def set_setting(db: aiosqlite.Connection, key: str, value: str) -> None:
    now = _now()
    await db.execute(
        "INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, value, now),
    )
    await db.commit()


async def get_all_settings(db: aiosqlite.Connection) -> dict[str, str]:
    cursor = await db.execute("SELECT key, value FROM settings")
    rows = await cursor.fetchall()
    return {row[0]: row[1] for row in rows}


# --- Flashcard / Quiz ---


def _row_to_flashcard(row: aiosqlite.Row) -> Flashcard:
    return Flashcard(**dict(row))


async def get_due_flashcards(
    db: aiosqlite.Connection,
    limit: int = 20,
    doc_id: str | None = None,
) -> list[Flashcard]:
    """Return cards due for review today (next_review <= today or NULL), ordered oldest-first."""
    if doc_id:
        cursor = await db.execute(
            """SELECT * FROM flashcards
               WHERE (next_review <= date('now') OR next_review IS NULL)
               AND document_id = ?
               ORDER BY COALESCE(next_review, '0000') ASC
               LIMIT ?""",
            (doc_id, limit),
        )
    else:
        cursor = await db.execute(
            """SELECT * FROM flashcards
               WHERE (next_review <= date('now') OR next_review IS NULL)
               ORDER BY COALESCE(next_review, '0000') ASC
               LIMIT ?""",
            (limit,),
        )
    rows = await cursor.fetchall()
    return [_row_to_flashcard(r) for r in rows]


async def get_flashcard(db: aiosqlite.Connection, card_id: str) -> Flashcard | None:
    cursor = await db.execute("SELECT * FROM flashcards WHERE id = ?", (card_id,))
    row = await cursor.fetchone()
    return _row_to_flashcard(row) if row else None


async def list_flashcards(
    db: aiosqlite.Connection,
    doc_id: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Flashcard], int]:
    if doc_id:
        cursor = await db.execute(
            "SELECT * FROM flashcards WHERE document_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?",
            (doc_id, limit, offset),
        )
        count_cursor = await db.execute(
            "SELECT COUNT(*) FROM flashcards WHERE document_id = ?", (doc_id,)
        )
    else:
        cursor = await db.execute(
            "SELECT * FROM flashcards ORDER BY created_at ASC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        count_cursor = await db.execute("SELECT COUNT(*) FROM flashcards")
    rows = await cursor.fetchall()
    count_row = await count_cursor.fetchone()
    total = count_row[0] if count_row else 0
    return [_row_to_flashcard(r) for r in rows], total


async def update_flashcard_sm2(
    db: aiosqlite.Connection,
    card_id: str,
    repetitions: int,
    interval: int,
    difficulty: float,
    next_review: str,
) -> Flashcard | None:
    now = _now()
    await db.execute(
        """UPDATE flashcards
           SET repetitions = ?, interval = ?, difficulty = ?, next_review = ?, updated_at = ?
           WHERE id = ?""",
        (repetitions, interval, difficulty, next_review, now, card_id),
    )
    await db.commit()
    return await get_flashcard(db, card_id)


async def update_flashcard_content(
    db: aiosqlite.Connection,
    card_id: str,
    update: FlashcardUpdate,
) -> Flashcard | None:
    card = await get_flashcard(db, card_id)
    if not card:
        return None
    new_q = update.question if update.question is not None else card.question
    new_a = update.answer if update.answer is not None else card.answer
    now = _now()
    await db.execute(
        "UPDATE flashcards SET question = ?, answer = ?, updated_at = ? WHERE id = ?",
        (new_q, new_a, now, card_id),
    )
    await db.commit()
    return await get_flashcard(db, card_id)


async def delete_flashcard(db: aiosqlite.Connection, card_id: str) -> bool:
    cursor = await db.execute("DELETE FROM flashcards WHERE id = ?", (card_id,))
    await db.commit()
    return (cursor.rowcount or 0) > 0


async def get_quiz_stats(db: aiosqlite.Connection) -> dict:
    """Return total cards, due today count, and per-document breakdown."""
    total_cursor = await db.execute("SELECT COUNT(*) FROM flashcards")
    total_row = await total_cursor.fetchone()
    total_cards: int = total_row[0] if total_row else 0

    due_cursor = await db.execute(
        "SELECT COUNT(*) FROM flashcards WHERE (next_review <= date('now') OR next_review IS NULL)"
    )
    due_row = await due_cursor.fetchone()
    due_today: int = due_row[0] if due_row else 0

    per_doc_cursor = await db.execute(
        """SELECT f.document_id, d.title,
                  COUNT(*) as total,
                  SUM(CASE WHEN (f.next_review <= date('now') OR f.next_review IS NULL) THEN 1 ELSE 0 END) as due
           FROM flashcards f
           LEFT JOIN documents d ON d.id = f.document_id
           GROUP BY f.document_id
           ORDER BY d.title ASC"""
    )
    per_doc_rows = await per_doc_cursor.fetchall()
    per_doc = [
        {
            "doc_id": row[0],
            "title": row[1] or row[0],
            "total": row[2],
            "due": row[3] or 0,
        }
        for row in per_doc_rows
    ]

    return {"total_cards": total_cards, "due_today": due_today, "per_doc": per_doc}
