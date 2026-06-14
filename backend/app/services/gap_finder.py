from app.services.embedder import get_embeddings
from app.services.vector_store import client, COLLECTION_NAME
from app.core.supabase import supabase_client
from qdrant_client.models import Filter, FieldCondition, MatchValue
from groq import Groq
from app.core.config import settings
import json

COVERAGE_THRESHOLD = 0.45

def find_gaps(topics: list[str], user_id: str) -> list[dict]:
    results = []
    for topic in topics:
        embedding = get_embeddings([topic])[0]
        hits = client.query_points(
            collection_name=COLLECTION_NAME,
            query=embedding,
            query_filter=Filter(
                must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))]
            ),
            limit=5,
            with_payload=True,
        ).points
        top_score = hits[0].score if hits else 0.0
        is_gap = top_score < COVERAGE_THRESHOLD
        results.append({
            "topic": topic,
            "coverage_score": round(top_score, 3),
            "is_gap": is_gap,
        })
    return results

def save_gaps(topics: list[dict], user_id: str):
    supabase_client.table("topics").delete().eq("user_id", user_id).execute()
    rows = [
        {
            "user_id": user_id,
            "name": t["topic"],
            "coverage_score": t["coverage_score"],
            "is_gap": t["is_gap"],
        }
        for t in topics
    ]
    supabase_client.table("topics").insert(rows).execute()

def extract_topics_from_chunks(user_id: str) -> list[str]:
    hits = client.query_points(
        collection_name=COLLECTION_NAME,
        query=get_embeddings(["study notes"])[0],
        query_filter=Filter(
            must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))]
        ),
        limit=20,
        with_payload=True,
    ).points

    if not hits:
        return []

    context = "\n\n".join([h.payload["text"] for h in hits if h.payload.get("text")])

    prompt = f"""Extract a list of study topics from the following notes. Return ONLY a JSON array of topic strings, no other text.

Notes:
{context[:4000]}

Example output: ["Arrays", "Dynamic Programming", "Binary Trees"]"""

    groq = Groq(api_key=settings.GROQ_API_KEY)
    response = groq.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=500,
    )
    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    return json.loads(raw)