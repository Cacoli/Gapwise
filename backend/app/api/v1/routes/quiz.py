from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse as FastAPIStreamingResponse
from pydantic import BaseModel
from app.services.quiz_engine import get_relevant_chunks, get_chunks_by_file, generate_questions, generate_questions_stream, evaluate_answer
from app.core.supabase import supabase_client
from typing import List, Optional
import uuid, json
from datetime import datetime, timezone

router = APIRouter()

class QuizRequest(BaseModel):
    topic: Optional[str] = None
    file_id: Optional[str] = None
    user_id: str
    num_questions: int = 3

class AnswerRequest(BaseModel):
    question: str
    user_answer: str
    correct_answer: str
    user_id: str
    topic_id: str = ""

class BulkAnswerItem(BaseModel):
    question_id: str
    question: str
    selected_answer: str
    correct_answer: str
    topic: str = ""

class BulkEvaluateRequest(BaseModel):
    user_id: str
    file_id: Optional[str] = None
    answers: List[BulkAnswerItem]

class SessionStartRequest(BaseModel):
    user_id: str
    topic: Optional[str] = None
    file_id: Optional[str] = None
    num_questions: int = 3

class SessionAnswerRequest(BaseModel):
    session_id: str
    user_id: str
    question: str
    user_answer: str
    correct_answer: str

class SessionSubmitRequest(BaseModel):
    session_id: str
    user_id: str
    score: int
    total_questions: int
    file_id: Optional[str] = None


def _resolve_chunks_and_label(req_topic, req_file_id, user_id, num_questions):
    """Returns (chunks, source_label, tagged) based on whether file_id or topic was given."""
    if req_file_id:
        file_row = supabase_client.table("uploaded_files") \
            .select("file_name") \
            .eq("id", req_file_id) \
            .eq("user_id", user_id) \
            .single() \
            .execute()
        file_name = file_row.data["file_name"] if file_row.data else "this document"

        chunks = get_chunks_by_file(req_file_id, user_id, limit=max(20, num_questions * 4))
        if not chunks:
            raise HTTPException(status_code=404, detail="No content found for this file")
        return chunks, file_name, True
    elif req_topic:
        chunks = get_relevant_chunks(req_topic, user_id)
        if not chunks:
            raise HTTPException(status_code=404, detail="No relevant content found for this topic")
        return chunks, req_topic, False
    else:
        raise HTTPException(status_code=400, detail="Either file_id or topic must be provided")


@router.post("/generate")
async def generate_quiz(req: QuizRequest):
    try:
        chunks, source_label, tagged = _resolve_chunks_and_label(req.topic, req.file_id, req.user_id, req.num_questions)

        def stream():
            try:
                yield from generate_questions_stream(source_label, chunks, req.num_questions, tagged=tagged)
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return FastAPIStreamingResponse(stream(), media_type="text/event-stream")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/evaluate")
async def evaluate(req: AnswerRequest):
    try:
        result = evaluate_answer(req.question, req.user_answer, req.correct_answer)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/evaluate/bulk")
async def evaluate_bulk(req: BulkEvaluateRequest):
    try:
        results = []
        topic_stats = {}  # topic -> {correct, total}
        for item in req.answers:
            ev = evaluate_answer(item.question, item.selected_answer, item.correct_answer)
            results.append({
                "question_id":    item.question_id,
                "is_correct":     ev["is_correct"],
                "correct_answer": ev["correct_answer"],
            })
            if item.topic:
                stats = topic_stats.setdefault(item.topic, {"correct": 0, "total": 0})
                stats["total"] += 1
                if ev["is_correct"]:
                    stats["correct"] += 1

        score = sum(1 for r in results if r["is_correct"])
        total = len(results)
        try:
            supabase_client.table("quiz_sessions").insert({
                "id":              str(uuid.uuid4()),
                "user_id":         req.user_id,
                "score":           score,
                "total_questions": total,
                "completed_at":    datetime.now(timezone.utc).isoformat(),
                "file_id":         req.file_id,
            }).execute()
        except Exception:
            pass

        return {
            "success": True,
            "results": results,
            "score": score,
            "total_questions": total,
            "topic_breakdown": topic_stats,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/session/start")
async def start_session(req: SessionStartRequest):
    try:
        chunks, source_label, tagged = _resolve_chunks_and_label(req.topic, req.file_id, req.user_id, req.num_questions)
        questions = generate_questions(source_label, chunks, req.num_questions, tagged=tagged)
        session_id = str(uuid.uuid4())
        return {
            "success":         True,
            "session_id":      session_id,
            "topic":           source_label,
            "file_id":         req.file_id,
            "questions":       questions,
            "total_questions": len(questions)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/session/answer")
async def answer_question(req: SessionAnswerRequest):
    try:
        result = evaluate_answer(req.question, req.user_answer, req.correct_answer)
        return {"success": True, "session_id": req.session_id, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/session/submit")
async def submit_session(req: SessionSubmitRequest):
    try:
        supabase_client.table("quiz_sessions").insert({
            "id":              str(uuid.uuid4()),
            "user_id":         req.user_id,
            "score":           req.score,
            "total_questions": req.total_questions,
            "completed_at":    datetime.now(timezone.utc).isoformat(),
            "file_id":         req.file_id,
        }).execute()
        return {
            "success":         True,
            "session_id":      req.session_id,
            "score":           req.score,
            "total_questions": req.total_questions,
            "percentage":      round((req.score / req.total_questions) * 100, 1)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/history/{user_id}")
async def get_history(user_id: str):
    try:
        result = supabase_client.table("quiz_sessions") \
            .select("*") \
            .eq("user_id", user_id) \
            .order("completed_at", desc=True) \
            .execute()
        return {"success": True, "history": result.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))