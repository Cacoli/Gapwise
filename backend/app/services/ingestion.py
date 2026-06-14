from app.services.parser import parse_file
from app.services.chunker import chunk_text
from app.services.embedder import get_embeddings
from app.services.vector_store import store_chunks

def run_ingestion(file_bytes: bytes, file_type: str, metadata: dict) -> dict:
    # Step 1: Parse
    text = parse_file(file_bytes, file_type)
    if not text:
        raise ValueError("No text extracted from file")

    # Step 2: Chunk
    chunks = chunk_text(text)
    if not chunks:
        raise ValueError("No chunks generated")

    # Step 3: Embed
    embeddings = get_embeddings(chunks)

    # Step 4: Store in Qdrant
    stored = store_chunks(chunks, embeddings, metadata)

    return {
        "chunks": len(chunks),
        "stored": stored,
        "text_length": len(text)
    }