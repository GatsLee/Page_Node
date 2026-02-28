from enum import Enum

from pydantic import BaseModel


class FileType(str, Enum):
    PDF = "pdf"
    MD = "md"
    TXT = "txt"
    DOCX = "docx"


class CoverColor(str, Enum):
    CHARCOAL = "charcoal"
    RED = "red"
    BLUE = "blue"
    GREEN = "green"
    UMBER = "umber"
    NAVY = "navy"


class CoverTexture(str, Enum):
    PLAIN = "plain"
    LEATHER = "leather"
    CLOTH = "cloth"


class DocumentStatus(str, Enum):
    PENDING = "pending"
    EXTRACTING = "extracting"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    EXTRACTING_CONCEPTS = "extracting_concepts"
    CONCEPTS_READY = "concepts_ready"
    READY = "ready"
    NEEDS_OCR = "needs_ocr"
    ERROR = "error"


class DocumentCreate(BaseModel):
    title: str
    author: str = ""
    file_type: FileType
    file_path: str
    file_hash: str
    file_size: int
    page_count: int = 0
    cover_color: CoverColor = CoverColor.CHARCOAL
    cover_texture: CoverTexture = CoverTexture.PLAIN


class DocumentUpdate(BaseModel):
    title: str | None = None
    author: str | None = None
    cover_color: CoverColor | None = None
    cover_texture: CoverTexture | None = None
    status: str | None = None
    concept_count: int | None = None


class Document(BaseModel):
    id: str
    title: str
    author: str
    file_type: FileType
    file_path: str
    file_hash: str
    file_size: int
    page_count: int
    cover_color: CoverColor
    cover_texture: CoverTexture
    ai_confidence: float
    status: str
    concept_count: int = 0
    created_at: str
    updated_at: str


class DocumentList(BaseModel):
    items: list[Document]
    total: int
    offset: int
    limit: int
