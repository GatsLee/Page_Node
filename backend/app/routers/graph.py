import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from app.db.kuzu_ import get_kuzu_conn
from app.models.graph import (
    Concept,
    ConceptCreate,
    ConceptList,
    CytoscapeEdge,
    CytoscapeEdgeData,
    CytoscapeNode,
    CytoscapeNodeData,
    Relationship,
    RelationshipCreate,
    SubgraphResponse,
)

router = APIRouter()

VALID_REL_TYPES = {"RELATES_TO", "PREREQUISITE_OF"}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _esc(value: str) -> str:
    """Escape a string for Kuzu Cypher literals."""
    return value.replace("\\", "\\\\").replace("'", "\\'")


async def _run(query: str, params: dict | None = None):
    conn = get_kuzu_conn()
    if params:
        return await asyncio.to_thread(conn.execute, query, parameters=params)
    return await asyncio.to_thread(conn.execute, query)


def _rows(result) -> list[list]:
    """Collect all rows from a Kuzu QueryResult."""
    rows = []
    while result.has_next():
        rows.append(result.get_next())
    return rows


# --- Concept CRUD ---


@router.post("/concepts", response_model=Concept, status_code=201)
async def create_concept(body: ConceptCreate):
    concept_id = str(uuid.uuid4())
    now = _now()
    # Kuzu 0.11.3: $params don't work in CREATE property maps, use inline values
    await _run(
        f"CREATE (c:Concept {{"
        f"id: '{_esc(concept_id)}', name: '{_esc(body.name)}', "
        f"description: '{_esc(body.description)}', category: '{_esc(body.category)}', "
        f"mastery: 0.0, review_count: 0, created_at: '{_esc(now)}'"
        f"}})"
    )
    return Concept(
        id=concept_id, name=body.name, description=body.description,
        category=body.category, mastery=0.0, review_count=0, created_at=now,
    )


@router.get("/concepts", response_model=ConceptList)
async def list_concepts(category: str | None = Query(None)):
    if category:
        result = await _run(
            "MATCH (c:Concept) WHERE c.category = $cat "
            "RETURN c.id, c.name, c.description, c.category, c.mastery, c.review_count, c.created_at",
            {"cat": category},
        )
    else:
        result = await _run(
            "MATCH (c:Concept) "
            "RETURN c.id, c.name, c.description, c.category, c.mastery, c.review_count, c.created_at"
        )
    rows = _rows(result)
    items = [
        Concept(id=r[0], name=r[1], description=r[2], category=r[3],
                mastery=r[4], review_count=r[5], created_at=r[6])
        for r in rows
    ]
    return ConceptList(items=items, total=len(items))


@router.get("/concepts/{concept_id}", response_model=Concept)
async def get_concept(concept_id: str):
    result = await _run(
        "MATCH (c:Concept) WHERE c.id = $id "
        "RETURN c.id, c.name, c.description, c.category, c.mastery, c.review_count, c.created_at",
        {"id": concept_id},
    )
    rows = _rows(result)
    if not rows:
        raise HTTPException(404, "Concept not found")
    r = rows[0]
    return Concept(id=r[0], name=r[1], description=r[2], category=r[3],
                   mastery=r[4], review_count=r[5], created_at=r[6])


@router.get("/concepts/{concept_id}/neighbors", response_model=SubgraphResponse)
async def get_concept_neighbors(concept_id: str):
    """Return the concept and all directly connected concepts as a Cytoscape subgraph."""
    # Verify the concept exists and get its data
    result = await _run(
        "MATCH (c:Concept) WHERE c.id = $id RETURN c.id, c.name, c.category, c.mastery",
        {"id": concept_id},
    )
    center_rows = _rows(result)
    if not center_rows:
        raise HTTPException(404, "Concept not found")

    # Outbound/inbound neighbors via RELATES_TO (undirected)
    result = await _run(
        "MATCH (c:Concept)-[:RELATES_TO]-(n:Concept) WHERE c.id = $id "
        "RETURN DISTINCT n.id, n.name, n.category, n.mastery",
        {"id": concept_id},
    )
    rt_rows = _rows(result)

    # Outbound/inbound neighbors via PREREQUISITE_OF (undirected)
    result = await _run(
        "MATCH (c:Concept)-[:PREREQUISITE_OF]-(n:Concept) WHERE c.id = $id "
        "RETURN DISTINCT n.id, n.name, n.category, n.mastery",
        {"id": concept_id},
    )
    po_rows = _rows(result)

    # Deduplicate nodes (center + all neighbors)
    seen: dict[str, list] = {}
    for r in center_rows + rt_rows + po_rows:
        if r[0] not in seen:
            seen[r[0]] = r
    nodes = [
        CytoscapeNode(data=CytoscapeNodeData(id=r[0], label=r[1], category=r[2], mastery=r[3]))
        for r in seen.values()
    ]
    allowed_ids = set(seen.keys())

    # Edges between nodes in this subgraph touching the center concept
    edges: list[CytoscapeEdge] = []

    result = await _run(
        "MATCH (a:Concept)-[r:RELATES_TO]->(b:Concept) "
        "WHERE a.id = $id OR b.id = $id "
        "RETURN a.id, b.id, r.relation_type",
        {"id": concept_id},
    )
    for r in _rows(result):
        if r[0] in allowed_ids and r[1] in allowed_ids:
            edges.append(CytoscapeEdge(data=CytoscapeEdgeData(
                id=str(uuid.uuid4()), source=r[0], target=r[1],
                label=r[2] or "", type="RELATES_TO",
            )))

    result = await _run(
        "MATCH (a:Concept)-[r:PREREQUISITE_OF]->(b:Concept) "
        "WHERE a.id = $id OR b.id = $id "
        "RETURN a.id, b.id",
        {"id": concept_id},
    )
    for r in _rows(result):
        if r[0] in allowed_ids and r[1] in allowed_ids:
            edges.append(CytoscapeEdge(data=CytoscapeEdgeData(
                id=str(uuid.uuid4()), source=r[0], target=r[1],
                label="prerequisite", type="PREREQUISITE_OF",
            )))

    return SubgraphResponse(nodes=nodes, edges=edges)


@router.delete("/concepts/{concept_id}", status_code=204)
async def delete_concept(concept_id: str):
    # Delete all relationships first (Kuzu requires specific rel types)
    for rel in ("RELATES_TO", "PREREQUISITE_OF"):
        await _run(
            f"MATCH (a:Concept)-[r:{rel}]->(b:Concept) WHERE a.id = $id OR b.id = $id DELETE r",
            {"id": concept_id},
        )
    await _run(
        "MATCH (a:Concept)-[r:EXTRACTED_FROM]->(b:DocNode) WHERE a.id = $id DELETE r",
        {"id": concept_id},
    )
    await _run(
        "MATCH (c:Concept) WHERE c.id = $id DELETE c",
        {"id": concept_id},
    )


# --- Relationship CRUD ---


@router.post("/relationships", response_model=Relationship, status_code=201)
async def create_relationship(body: RelationshipCreate):
    if body.rel_type not in VALID_REL_TYPES:
        raise HTTPException(400, f"rel_type must be one of {VALID_REL_TYPES}")

    # Verify both concepts exist
    for cid, label in [(body.from_id, "source"), (body.to_id, "target")]:
        result = await _run(
            "MATCH (c:Concept) WHERE c.id = $id RETURN c.id",
            {"id": cid},
        )
        if not _rows(result):
            raise HTTPException(404, f"{label} concept {cid} not found")

    if body.rel_type == "RELATES_TO":
        await _run(
            f"MATCH (a:Concept), (b:Concept) WHERE a.id = $from AND b.id = $to "
            f"CREATE (a)-[:RELATES_TO {{relation_type: '{_esc(body.relation_type)}', weight: {body.weight}}}]->(b)",
            {"from": body.from_id, "to": body.to_id},
        )
    else:
        await _run(
            "MATCH (a:Concept), (b:Concept) WHERE a.id = $from AND b.id = $to "
            "CREATE (a)-[:PREREQUISITE_OF]->(b)",
            {"from": body.from_id, "to": body.to_id},
        )

    return Relationship(
        from_id=body.from_id, to_id=body.to_id, rel_type=body.rel_type,
        relation_type=body.relation_type, weight=body.weight,
    )


@router.delete("/relationships/{rel_type}/{from_id}/{to_id}", status_code=204)
async def delete_relationship(rel_type: str, from_id: str, to_id: str):
    if rel_type not in VALID_REL_TYPES:
        raise HTTPException(400, f"rel_type must be one of {VALID_REL_TYPES}")

    await _run(
        f"MATCH (a:Concept)-[r:{rel_type}]->(b:Concept) "  # noqa: S608
        "WHERE a.id = $from AND b.id = $to DELETE r",
        {"from": from_id, "to": to_id},
    )


# --- Subgraph ---


@router.get("/subgraph", response_model=SubgraphResponse)
async def get_subgraph(doc_id: str | None = Query(None)):
    """Return the full concept graph, or only concepts from a specific document."""
    if doc_id:
        # Only concepts that have an EXTRACTED_FROM edge to this DocNode
        result = await _run(
            "MATCH (c:Concept)-[:EXTRACTED_FROM]->(d:DocNode) WHERE d.id = $doc_id "
            "RETURN c.id, c.name, c.category, c.mastery",
            {"doc_id": doc_id},
        )
        rows = _rows(result)
        # All these concepts came from this doc — set source_doc_id directly
        nodes = [
            CytoscapeNode(data=CytoscapeNodeData(
                id=r[0], label=r[1], category=r[2], mastery=r[3], source_doc_id=doc_id,
            ))
            for r in rows
        ]
    else:
        result = await _run(
            "MATCH (c:Concept) RETURN c.id, c.name, c.category, c.mastery"
        )
        rows = _rows(result)

        # Fetch source doc mapping: concept_id → first doc that extracted it
        source_result = await _run(
            "MATCH (c:Concept)-[:EXTRACTED_FROM]->(d:DocNode) RETURN c.id, d.id"
        )
        source_map: dict[str, str] = {}
        for sr in _rows(source_result):
            if sr[0] not in source_map:
                source_map[sr[0]] = sr[1]

        nodes = [
            CytoscapeNode(data=CytoscapeNodeData(
                id=r[0], label=r[1], category=r[2], mastery=r[3],
                source_doc_id=source_map.get(r[0]),
            ))
            for r in rows
        ]

    allowed_ids = {n.data.id for n in nodes}

    # Edges: RELATES_TO — only include edges where both endpoints are in the subgraph
    edges: list[CytoscapeEdge] = []
    result = await _run(
        "MATCH (a:Concept)-[r:RELATES_TO]->(b:Concept) "
        "RETURN a.id, b.id, r.relation_type"
    )
    for r in _rows(result):
        if r[0] in allowed_ids and r[1] in allowed_ids:
            edges.append(CytoscapeEdge(data=CytoscapeEdgeData(
                id=str(uuid.uuid4()),
                source=r[0], target=r[1], label=r[2] or "", type="RELATES_TO",
            )))

    # Edges: PREREQUISITE_OF
    result = await _run(
        "MATCH (a:Concept)-[r:PREREQUISITE_OF]->(b:Concept) "
        "RETURN a.id, b.id"
    )
    for r in _rows(result):
        if r[0] in allowed_ids and r[1] in allowed_ids:
            edges.append(CytoscapeEdge(data=CytoscapeEdgeData(
                id=str(uuid.uuid4()),
                source=r[0], target=r[1], label="prerequisite", type="PREREQUISITE_OF",
            )))

    return SubgraphResponse(nodes=nodes, edges=edges)


# --- Seed ---


@router.post("/seed", response_model=SubgraphResponse, status_code=201)
async def seed_graph():
    """Populate test concepts and relationships for development."""
    now = _now()
    concepts = [
        ("Python", "General-purpose programming language", "programming"),
        ("Machine Learning", "Field of AI using statistical methods", "science"),
        ("Linear Algebra", "Branch of math dealing with vectors and matrices", "mathematics"),
        ("Neural Networks", "Computing systems inspired by biological neurons", "science"),
        ("Gradient Descent", "Optimization algorithm for minimizing loss", "mathematics"),
        ("Data Structures", "Ways to organize and store data", "programming"),
        ("Calculus", "Study of continuous change", "mathematics"),
        ("TensorFlow", "Open-source ML framework", "programming"),
    ]

    ids: dict[str, str] = {}
    for name, desc, cat in concepts:
        cid = str(uuid.uuid4())
        ids[name] = cid
        await _run(
            f"CREATE (c:Concept {{"
            f"id: '{_esc(cid)}', name: '{_esc(name)}', "
            f"description: '{_esc(desc)}', category: '{_esc(cat)}', "
            f"mastery: 0.0, review_count: 0, created_at: '{_esc(now)}'"
            f"}})"
        )

    relationships = [
        (ids["Linear Algebra"], ids["Machine Learning"], "PREREQUISITE_OF", "", 1.0),
        (ids["Calculus"], ids["Gradient Descent"], "PREREQUISITE_OF", "", 1.0),
        (ids["Gradient Descent"], ids["Neural Networks"], "PREREQUISITE_OF", "", 1.0),
        (ids["Data Structures"], ids["Python"], "PREREQUISITE_OF", "", 1.0),
        (ids["Machine Learning"], ids["Neural Networks"], "RELATES_TO", "uses", 0.9),
        (ids["Neural Networks"], ids["TensorFlow"], "RELATES_TO", "implemented_in", 0.8),
        (ids["Python"], ids["TensorFlow"], "RELATES_TO", "implements", 0.8),
        (ids["Machine Learning"], ids["Linear Algebra"], "RELATES_TO", "applies", 0.7),
    ]

    for from_id, to_id, rel_type, rt, w in relationships:
        if rel_type == "RELATES_TO":
            await _run(
                f"MATCH (a:Concept), (b:Concept) WHERE a.id = $from AND b.id = $to "
                f"CREATE (a)-[:RELATES_TO {{relation_type: '{_esc(rt)}', weight: {w}}}]->(b)",
                {"from": from_id, "to": to_id},
            )
        else:
            await _run(
                "MATCH (a:Concept), (b:Concept) WHERE a.id = $from AND b.id = $to "
                "CREATE (a)-[:PREREQUISITE_OF]->(b)",
                {"from": from_id, "to": to_id},
            )

    return await get_subgraph()
