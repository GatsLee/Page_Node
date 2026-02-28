from pydantic import BaseModel


class Chunk(BaseModel):
    id: str
    document_id: str
    chunk_index: int
    content: str
    page_number: int | None
    char_start: int | None
    char_end: int | None
    token_count: int
    has_embedding: bool
    created_at: str


class ChunkList(BaseModel):
    items: list[Chunk]
    total: int
    offset: int
    limit: int
