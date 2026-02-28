from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from pathlib import Path

import kuzu

from app.config import settings

_db: kuzu.Database | None = None
_conn: kuzu.Connection | None = None


def init_kuzu(data_dir: Path) -> None:
    global _db, _conn
    kuzu_dir = data_dir / settings.kuzu_dirname
    # Don't pre-create directory — Kuzu needs to create it itself
    _db = kuzu.Database(str(kuzu_dir))
    _conn = kuzu.Connection(_db)
    _create_schema(_conn)


def _create_schema(conn: kuzu.Connection) -> None:
    conn.execute("""
        CREATE NODE TABLE IF NOT EXISTS Concept(
            id STRING PRIMARY KEY,
            name STRING,
            description STRING,
            category STRING,
            mastery DOUBLE DEFAULT 0.0,
            review_count INT64 DEFAULT 0,
            created_at STRING
        )
    """)

    conn.execute("""
        CREATE NODE TABLE IF NOT EXISTS DocNode(
            id STRING PRIMARY KEY,
            title STRING,
            author STRING
        )
    """)

    conn.execute("""
        CREATE REL TABLE IF NOT EXISTS EXTRACTED_FROM(
            FROM Concept TO DocNode,
            chunk_id STRING,
            confidence DOUBLE DEFAULT 0.0
        )
    """)

    conn.execute("""
        CREATE REL TABLE IF NOT EXISTS RELATES_TO(
            FROM Concept TO Concept,
            relation_type STRING,
            weight DOUBLE DEFAULT 1.0
        )
    """)

    conn.execute("""
        CREATE REL TABLE IF NOT EXISTS PREREQUISITE_OF(
            FROM Concept TO Concept
        )
    """)


def get_kuzu_conn() -> kuzu.Connection:
    assert _conn is not None, "Kuzu not initialized"
    return _conn


# --- Phase 5: LLM extraction helpers ---


def _esc(value: str) -> str:
    """Escape a string for inline Kuzu Cypher string literals."""
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


async def _krun(query: str) -> None:
    """Run a Kuzu query (no return value needed) in a thread."""
    conn = get_kuzu_conn()
    await asyncio.to_thread(conn.execute, query)


async def _kquery(query: str):
    """Run a Kuzu query and return the QueryResult."""
    conn = get_kuzu_conn()
    return await asyncio.to_thread(conn.execute, query)


async def ensure_doc_node(doc_id: str, title: str, author: str) -> None:
    """Create a DocNode if it does not already exist. Idempotent."""
    conn = get_kuzu_conn()

    def _sync() -> None:
        result = conn.execute(
            f"MATCH (d:DocNode) WHERE d.id = '{_esc(doc_id)}' RETURN d.id"
        )
        if not result.has_next():
            conn.execute(
                f"CREATE (d:DocNode {{"
                f"id: '{_esc(doc_id)}', "
                f"title: '{_esc(title)}', "
                f"author: '{_esc(author)}'"
                f"}})"
            )

    await asyncio.to_thread(_sync)


async def upsert_concept(name: str, category: str, description: str) -> str:
    """
    Find an existing Concept by name (exact match) or create a new one.
    Returns the concept's id string.

    Upsert-by-name is intentional: multiple documents extracting the same
    concept (e.g. 'Linear Algebra') converge to the same node.
    """
    conn = get_kuzu_conn()

    def _sync() -> str:
        # Try to find existing concept by name
        result = conn.execute(
            f"MATCH (c:Concept) WHERE c.name = '{_esc(name)}' RETURN c.id"
        )
        if result.has_next():
            return result.get_next()[0]

        # Create new concept
        concept_id = str(uuid.uuid4())
        conn.execute(
            f"CREATE (c:Concept {{"
            f"id: '{_esc(concept_id)}', "
            f"name: '{_esc(name)}', "
            f"description: '{_esc(description)}', "
            f"category: '{_esc(category)}', "
            f"mastery: 0.0, "
            f"review_count: 0, "
            f"created_at: '{_esc(_now_str())}'"
            f"}})"
        )
        return concept_id

    return await asyncio.to_thread(_sync)


async def add_extracted_from(
    concept_id: str,
    doc_id: str,
    chunk_id: str,
    confidence: float,
) -> None:
    """
    Create an EXTRACTED_FROM edge from Concept to DocNode.
    Skips if an identical (concept, doc, chunk) triple already exists.
    """
    conn = get_kuzu_conn()

    def _sync() -> None:
        check = conn.execute(
            f"MATCH (c:Concept)-[r:EXTRACTED_FROM]->(d:DocNode) "
            f"WHERE c.id = '{_esc(concept_id)}' "
            f"AND d.id = '{_esc(doc_id)}' "
            f"AND r.chunk_id = '{_esc(chunk_id)}' "
            f"RETURN r"
        )
        if check.has_next():
            return
        conn.execute(
            f"MATCH (c:Concept), (d:DocNode) "
            f"WHERE c.id = '{_esc(concept_id)}' AND d.id = '{_esc(doc_id)}' "
            f"CREATE (c)-[:EXTRACTED_FROM {{"
            f"chunk_id: '{_esc(chunk_id)}', "
            f"confidence: {confidence}"
            f"}}]->(d)"
        )

    await asyncio.to_thread(_sync)


async def update_concept_mastery_from_chunk(chunk_id: str, delta: float) -> None:
    """
    Find all concepts linked to a chunk via EXTRACTED_FROM edge.
    Apply mastery delta (clamped 0.0–1.0) and increment review_count.
    No-op if the chunk has no associated concepts.
    """
    conn = get_kuzu_conn()

    def _sync() -> None:
        result = conn.execute(
            f"MATCH (c:Concept)-[r:EXTRACTED_FROM]->() "
            f"WHERE r.chunk_id = '{_esc(chunk_id)}' "
            f"RETURN c.id, c.mastery, c.review_count"
        )
        updates: list[tuple[str, float, int]] = []
        while result.has_next():
            row = result.get_next()
            cid, mastery, review_count = row[0], float(row[1]), int(row[2])
            new_mastery = max(0.0, min(1.0, mastery + delta))
            updates.append((cid, new_mastery, review_count + 1))

        for cid, new_mastery, new_rc in updates:
            conn.execute(
                f"MATCH (c:Concept) WHERE c.id = '{_esc(cid)}' "
                f"SET c.mastery = {new_mastery}, c.review_count = {new_rc}"
            )

    await asyncio.to_thread(_sync)


async def add_concept_edge(from_id: str, to_id: str, rel_type: str) -> None:
    """
    Add a RELATES_TO or PREREQUISITE_OF edge between two concepts.
    rel_type: 'relates_to' or 'prerequisite_of' (case-insensitive).
    Skips silently if the edge already exists.
    """
    conn = get_kuzu_conn()
    use_prereq = "prerequisite" in rel_type.lower()
    kuzu_rel = "PREREQUISITE_OF" if use_prereq else "RELATES_TO"

    def _sync() -> None:
        check = conn.execute(
            f"MATCH (a:Concept)-[r:{kuzu_rel}]->(b:Concept) "
            f"WHERE a.id = '{_esc(from_id)}' AND b.id = '{_esc(to_id)}' RETURN r"
        )
        if check.has_next():
            return
        if kuzu_rel == "RELATES_TO":
            conn.execute(
                f"MATCH (a:Concept), (b:Concept) "
                f"WHERE a.id = '{_esc(from_id)}' AND b.id = '{_esc(to_id)}' "
                f"CREATE (a)-[:RELATES_TO {{relation_type: '', weight: 1.0}}]->(b)"
            )
        else:
            conn.execute(
                f"MATCH (a:Concept), (b:Concept) "
                f"WHERE a.id = '{_esc(from_id)}' AND b.id = '{_esc(to_id)}' "
                f"CREATE (a)-[:PREREQUISITE_OF]->(b)"
            )

    await asyncio.to_thread(_sync)
