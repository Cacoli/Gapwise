from fastapi import APIRouter
from app.api.v1.routes import health, ingest, gaps, quiz, history

router = APIRouter()
router.include_router(health.router, prefix="/health", tags=["health"])
router.include_router(ingest.router, prefix="/ingest", tags=["ingest"])
router.include_router(gaps.router, prefix="/gaps", tags=["gaps"])
router.include_router(quiz.router, prefix="/quiz", tags=["quiz"])
router.include_router(history.router, prefix="/history", tags=["history"])