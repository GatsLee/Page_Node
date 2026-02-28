from pydantic import BaseModel


class AvailableModel(BaseModel):
    id: str
    name: str
    repo_id: str
    filename: str
    param_count: str
    file_size_mb: int
    ram_required_gb: float
    description: str
    recommended: bool = False
    installed_size_bytes: int | None = None  # None = not installed (GGUF)
    ollama_name: str | None = None  # e.g. "llama3.2:1b"
    ollama_installed: bool = False  # True if found in local Ollama


class ModelDownloadRequest(BaseModel):
    model_id: str


class DownloadProgress(BaseModel):
    status: str  # idle | downloading | complete | error | cancelled
    model_name: str
    downloaded_bytes: int
    total_bytes: int
    percent: float
    speed_mbps: float
    error: str | None = None


class SetupStatus(BaseModel):
    setup_complete: bool
    llm_model_id: str
    llm_model_path: str


class SettingUpdate(BaseModel):
    key: str
    value: str
