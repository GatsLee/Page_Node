from pydantic import BaseModel


class ConceptCreate(BaseModel):
    name: str
    description: str = ""
    category: str = ""


class Concept(BaseModel):
    id: str
    name: str
    description: str
    category: str
    mastery: float = 0.0
    review_count: int = 0
    created_at: str


class ConceptList(BaseModel):
    items: list[Concept]
    total: int


class RelationshipCreate(BaseModel):
    from_id: str
    to_id: str
    rel_type: str  # "RELATES_TO" or "PREREQUISITE_OF"
    relation_type: str = ""  # label for RELATES_TO
    weight: float = 1.0


class Relationship(BaseModel):
    from_id: str
    to_id: str
    rel_type: str
    relation_type: str = ""
    weight: float = 1.0


class CytoscapeNodeData(BaseModel):
    id: str
    label: str
    category: str
    mastery: float
    source_doc_id: str | None = None


class CytoscapeEdgeData(BaseModel):
    id: str
    source: str
    target: str
    label: str
    type: str  # "RELATES_TO" or "PREREQUISITE_OF"


class CytoscapeNode(BaseModel):
    data: CytoscapeNodeData


class CytoscapeEdge(BaseModel):
    data: CytoscapeEdgeData


class SubgraphResponse(BaseModel):
    nodes: list[CytoscapeNode]
    edges: list[CytoscapeEdge]
