from groq import Groq
from app.services.embedder import get_embeddings
from app.services.vector_store import client, COLLECTION_NAME
from app.core.config import settings
from qdrant_client.models import Filter, FieldCondition, MatchValue
from typing import Generator
import json, uuid

def get_groq_client():
    return Groq(api_key=settings.GROQ_API_KEY)

def get_relevant_chunks(topic: str, user_id: str, limit: int = 5) -> list[str]:
    embedding = get_embeddings([topic])[0]
    hits = client.query_points(
        collection_name=COLLECTION_NAME,
        query=embedding,
        query_filter=Filter(
            must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))]
        ),
        limit=limit,
        with_payload=True,
    ).points
    return [hit.payload["text"] for hit in hits if hit.payload.get("text")]

def get_chunks_by_file(file_id: str, user_id: str, limit: int = 20) -> list[str]:
    """Fetch chunks belonging to a specific file (no embedding search needed -
    we want broad coverage of the whole document, not similarity to a query)."""
    hits = client.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=Filter(
            must=[
                FieldCondition(key="user_id", match=MatchValue(value=user_id)),
                FieldCondition(key="file_id", match=MatchValue(value=file_id)),
            ]
        ),
        limit=limit,
        with_payload=True,
    )[0]
    return [point.payload["text"] for point in hits if point.payload.get("text")]

def _build_prompt(source_label: str, context: str, num_questions: int, tagged: bool) -> str:
    topic_field = '\n    "topic": "short topic label (2-4 words) this question covers",' if tagged else ""
    return f"""You are a study assistant. Based on the following notes from "{source_label}", generate {num_questions} multiple choice questions covering DIFFERENT topics/sections from across these notes (not just one part).

Notes:
{context}

Return ONLY a JSON array with this exact format, no other text:
[
  {{
    "question": "question text here",
    "options": ["A) option1", "B) option2", "C) option3", "D) option4"],
    "correct": "A) option1",
    "explanation": "brief explanation",{topic_field}
  }}
]

Rules:
- options must be exactly 4 items
- correct must be the FULL text of the correct option, exactly matching one entry in options
- each question should target a different topic/section of the notes where possible
- no markdown, no extra keys"""

def generate_questions(source_label: str, chunks: list[str], num_questions: int = 3, tagged: bool = False) -> list[dict]:
    context = "\n\n".join(chunks)
    prompt = _build_prompt(source_label, context, num_questions, tagged)

    response = get_groq_client().chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=2000,
    )
    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    questions = json.loads(raw)
    for q in questions:
        q["question_id"] = str(uuid.uuid4())
    return questions

def generate_questions_stream(source_label: str, chunks: list[str], num_questions: int = 3, tagged: bool = False) -> Generator[str, None, None]:
    context = "\n\n".join(chunks)
    prompt = _build_prompt(source_label, context, num_questions, tagged)

    stream = get_groq_client().chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=2000,
        stream=True,
    )

    full = ""
    for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            full += delta
            yield f"data: {json.dumps({'delta': delta})}\n\n"

    yield f"data: {json.dumps({'full': full})}\n\n"
    yield "data: [DONE]\n\n"

def evaluate_answer(question: str, user_answer: str, correct_answer: str) -> dict:
    def extract_letter(s: str) -> str:
        s = s.strip()
        if s and s[0].upper() in "ABCD":
            return s[0].upper()
        return s.lower()

    is_correct = extract_letter(user_answer) == extract_letter(correct_answer)
    return {"is_correct": is_correct, "correct_answer": correct_answer}