"""
API endpoints for IAQverse
Architecture simplifiée - endpoints essentiels uniquement
"""
from .ingest import router as ingest_router
from .query import router as query_router
from .config_api import router as config_router

__all__ = [
    "ingest_router",
    "query_router",
    "config_router",
]
