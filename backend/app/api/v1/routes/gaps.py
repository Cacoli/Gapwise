from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.gap_finder import find_gaps, save_gaps, extract_topics_from_chunks
from app.core.supabase import supabase_client

router = APIRouter()

class GapRequest(BaseModel):
    topics: list[str]
    user_id: str

class AnalyzeRequest(BaseModel):
    user_id: str

@router.post("/")
async def detect_gaps(req: GapRequest):
    try:
        results = find_gaps(req.topics, req.user_id)
        save_gaps(results, req.user_id)
        return {"success": True, "topics": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/analyze")
async def analyze_gaps(req: AnalyzeRequest):
    try:
        topics = extract_topics_from_chunks(req.user_id)
        if not topics:
            raise HTTPException(status_code=404, detail="No content found. Upload notes first.")
        results = find_gaps(topics, req.user_id)
        save_gaps(results, req.user_id)
        return {"success": True, "topics": results}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/")
async def get_gaps(user_id: str):
    try:
        result = supabase_client.table("topics") \
            .select("*") \
            .eq("user_id", user_id) \
            .execute()
        gaps = [
            {
                "topic": r["name"],
                "coverage_score": r["coverage_score"],
                "is_gap": r["is_gap"],
            }
            for r in (result.data or [])
        ]
        return gaps
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))