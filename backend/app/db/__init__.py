from pathlib import Path

from app.db.chromadb_ import init_chromadb
from app.db.kuzu_ import init_kuzu
from app.db.sqlite import init_sqlite


async def init_all_databases(data_dir: Path) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    await init_sqlite(data_dir)
    init_chromadb(data_dir)
    init_kuzu(data_dir)
