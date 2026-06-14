from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.ingestion import run_ingestion
from app.core.supabase import supabase_client
from app.services.vector_store import client, COLLECTION_NAME
from qdrant_client.models import Filter, FieldCondition, MatchValue

router = APIRouter()


class IngestRequest(BaseModel):
    file_id: str
    user_id: str
    file_name: str
    file_type: str
    storage_path: str


@router.post("/")
async def ingest_file(req: IngestRequest):
    try:
        # 1. Download file from Supabase Storage
        file_bytes = supabase_client.storage.from_("user-upload").download(req.storage_path)

        # 2. Run ingestion pipeline (parse → chunk → embed → store in Qdrant)
        result = run_ingestion(
            file_bytes=file_bytes,
            file_type=req.file_type,
            metadata={
                "file_id": req.file_id,
                "user_id": req.user_id,
                "file_name": req.file_name,
            }
        )

        # 3. Mark file as done in Supabase
        supabase_client.table("uploaded_files").update(
            {"status": "done", "chunks_count": result["chunks"]}
        ).eq("id", req.file_id).execute()

        return {"success": True, **result}

    except Exception as e:
        supabase_client.table("uploaded_files").update(
            {"status": "failed"}
        ).eq("id", req.file_id).execute()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{file_id}")
async def delete_file(file_id: str, user_id: str):
    try:
        client.delete(
            collection_name=COLLECTION_NAME,
            points_selector=Filter(
                must=[
                    FieldCondition(key="file_id", match=MatchValue(value=file_id)),
                    FieldCondition(key="user_id", match=MatchValue(value=user_id)),
                ]
            ),
        )

        supabase_client.table("topics").delete().eq("user_id", user_id).execute()
        supabase_client.table("uploaded_files").delete().eq("id", file_id).execute()

        return {"success": True}

    except Exception as e:
        print(f"DELETE ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))