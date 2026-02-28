from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import init_all_databases


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_all_databases(settings.pagenode_data_dir)
    settings.pagenode_models_dir.mkdir(parents=True, exist_ok=True)
    from app.services.task_registry import recover_stuck_documents

    await recover_stuck_documents()
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title="PageNode Backend", version="0.1.0", lifespan=lifespan
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.routers import documents, graph, health, quiz, setup, upload

    application.include_router(health.router)
    application.include_router(
        documents.router, prefix="/documents", tags=["documents"]
    )
    application.include_router(
        upload.router, prefix="/documents", tags=["documents"]
    )
    application.include_router(
        graph.router, prefix="/graph", tags=["graph"]
    )
    application.include_router(
        setup.router, prefix="/settings", tags=["settings"]
    )
    application.include_router(
        quiz.router, prefix="/quiz", tags=["quiz"]
    )

    return application


app = create_app()
