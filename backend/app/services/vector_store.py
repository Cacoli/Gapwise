from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from app.core.config import settings
import uuid

COLLECTION_NAME = "gapwise_chunks"
VECTOR_SIZE = 384  # all-MiniLM-L6-v2 output size

client = QdrantClient(
    url=settings.QDRANT_URL,
    api_key=settings.QDRANT_API_KEY,
)

def ensure_collection():
    existing = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME not in existing:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )

def store_chunks(chunks: list[str], embeddings: list[list[float]], metadata: dict):
    ensure_collection()
    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=embeddings[i],
            payload={
                "text": chunks[i],
                "file_id": metadata.get("file_id"),
                "user_id": metadata.get("user_id"),
                "file_name": metadata.get("file_name"),
                "chunk_index": i,
            }
        )
        for i in range(len(chunks))
    ]
    client.upsert(collection_name=COLLECTION_NAME, points=points)
    return len(points)