from sentence_transformers import SentenceTransformer
from typing import List

model = SentenceTransformer("all-MiniLM-L6-v2")

def get_embeddings(texts: List[str]) -> List[List[float]]:
    embeddings = model.encode(texts, show_progress_bar=False)
    return embeddings.tolist()