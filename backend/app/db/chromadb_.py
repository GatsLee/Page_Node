from pathlib import Path

import chromadb

from app.config import settings

_client: chromadb.ClientAPI | None = None
_collection: chromadb.Collection | None = None


def init_chromadb(data_dir: Path) -> None:
    global _client, _collection
    chroma_dir = data_dir / settings.chromadb_dirname
    chroma_dir.mkdir(parents=True, exist_ok=True)

    _client = chromadb.PersistentClient(path=str(chroma_dir))
    _collection = _client.get_or_create_collection(
        name="chunk_embeddings",
        metadata={"hnsw:space": "cosine"},
    )


def get_collection() -> chromadb.Collection:
    assert _collection is not None, "ChromaDB not initialized"
    return _collection
