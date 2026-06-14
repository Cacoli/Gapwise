from fastapi import APIRouter, Header, HTTPException
from app.core.supabase import supabase_client
router = APIRouter()

@router.get("/history")
async def get_history(authorization: str = Header(...)):
    token = authorization.replace("Bearer ", "")
    
    user = supabase_client.auth.get_user(token)
    if not user or not user.user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    user_id = user.user.id

    # Fetch quiz sessions joined with topics
    sessions = supabase_client.table("quiz_sessions") \
        .select("id, score, total_questions, completed_at, topics(name)") \
        .eq("user_id", user_id) \
        .order("completed_at", desc=True) \
        .execute()

    # Fetch gap history
    gaps = supabase_client.table("topics") \
        .select("id, name, coverage_score, is_gap, created_at") \
        .eq("user_id", user_id) \
        .order("created_at", desc=True) \
        .execute()

    return {
        "quiz_sessions": sessions.data,
        "gap_history": gaps.data
    }