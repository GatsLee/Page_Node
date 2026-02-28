import hashlib
import uuid
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.config import settings
from app.db.sqlite import (
    create_document,
    find_document_by_hash,
    get_db,
    get_document,
    list_chunks_for_document,
)
from app.models.chunk import ChunkList
from app.models.document import Document, DocumentCreate, FileType

router = APIRouter()


@router.post("/upload", response_model=Document, status_code=201)
async def upload_document(
    file: UploadFile,
    db: aiosqlite.Connection = Depends(get_db),
):
    # Validate file type
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported")

    # Read file content and compute hash
    content = await file.read()
    file_hash = hashlib.sha256(content).hexdigest()

    # Check for duplicate
    existing = await find_document_by_hash(db, file_hash)
    if existing:
        raise HTTPException(409, f"Duplicate file. Existing document: {existing.id}")

    # Save file to disk
    files_dir = settings.pagenode_data_dir / settings.files_dirname
    files_dir.mkdir(parents=True, exist_ok=True)
    doc_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix.lower()
    dest = files_dir / f"{doc_id}{ext}"
    dest.write_bytes(content)

    # Create document record
    doc_create = DocumentCreate(
        title=Path(file.filename).stem,
        file_type=FileType.PDF,
        file_path=str(dest),
        file_hash=file_hash,
        file_size=len(content),
    )
    doc = await create_document(db, doc_create)

    # Fire background processing
    from app.services.ingestion import process_document
    from app.services.task_registry import start_task

    start_task(doc.id, process_document(doc.id))

    return doc


@router.get("/{doc_id}/chunks", response_model=ChunkList)
async def list_chunks(
    doc_id: str,
    offset: int = 0,
    limit: int = 50,
    db: aiosqlite.Connection = Depends(get_db),
):
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    chunks, total = await list_chunks_for_document(db, doc_id, offset, limit)
    return ChunkList(items=chunks, total=total, offset=offset, limit=limit)
