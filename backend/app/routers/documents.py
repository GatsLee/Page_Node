import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from app.db.sqlite import (
    create_document,
    delete_document,
    get_db,
    get_document,
    list_documents,
    update_document,
)
from app.models.document import Document, DocumentCreate, DocumentList, DocumentUpdate

router = APIRouter()


@router.post("/", response_model=Document, status_code=201)
async def create_doc(
    body: DocumentCreate, db: aiosqlite.Connection = Depends(get_db)
):
    return await create_document(db, body)


@router.get("/", response_model=DocumentList)
async def list_docs(
    offset: int = 0, limit: int = 50, db: aiosqlite.Connection = Depends(get_db)
):
    items, total = await list_documents(db, offset, limit)
    return DocumentList(items=items, total=total, offset=offset, limit=limit)


@router.get("/{doc_id}", response_model=Document)
async def get_doc(doc_id: str, db: aiosqlite.Connection = Depends(get_db)):
    doc = await get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.patch("/{doc_id}", response_model=Document)
async def update_doc(
    doc_id: str, body: DocumentUpdate, db: aiosqlite.Connection = Depends(get_db)
):
    doc = await update_document(db, doc_id, body)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.delete("/{doc_id}", status_code=204)
async def delete_doc(doc_id: str, db: aiosqlite.Connection = Depends(get_db)):
    deleted = await delete_document(db, doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
