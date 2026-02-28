from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    pagenode_data_dir: Path = Path.home() / ".pagenode" / "data"
    pagenode_models_dir: Path = Path.home() / ".pagenode" / "models"
    sqlite_filename: str = "pagenode.db"
    chromadb_dirname: str = "chroma"
    kuzu_dirname: str = "graph"
    files_dirname: str = "files"
    embedding_dim: int = 384  # all-MiniLM-L6-v2 default

    model_config = {"env_prefix": "PAGENODE_"}


settings = Settings()
