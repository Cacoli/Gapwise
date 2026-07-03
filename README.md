# Gapwise

An AI-powered study tool that analyzes your uploaded notes and documents, identifies knowledge gaps, and generates targeted quizzes to help you study smarter — not just harder.

**Live app:** [gapwise-npic.vercel.app](https://gapwise-npic.vercel.app)
**Backend API:** [cacoli07/gapwise-backend on Hugging Face Spaces](https://huggingface.co/spaces/cacoli07/gapwise-backend)

---

## What it does

Upload your study material (PDFs, notes) and Gapwise:
- Chunks and embeds the content using a 384-dimension sentence-transformer model
- Indexes it in a vector database for semantic search
- Identifies topics you haven't covered well ("gaps") using an LLM-driven analysis pipeline
- Generates quizzes on demand, streamed token-by-token for instant feedback
- Tracks your quiz history and topic coverage over time

## Features

- **Dashboard** — overview of uploaded files and topic coverage
- **Gap Visualizer** — see which topics need more attention
- **Quiz** — real-time, streaming quiz generation with instant color-coded feedback and a dot navigator
- **Notes** — upload and re-process documents
- **History** — past quiz sessions and gap analysis over time

## Architecture

**Frontend:** Next.js, deployed on Vercel
**Backend:** FastAPI, containerized with Docker, deployed on Hugging Face Spaces
**Auth & Database:** Supabase (Postgres + Auth + Storage)
**Vector Search:** Qdrant Cloud
**LLM:** Groq (`llama-3.3-70b-versatile`) for gap analysis and quiz generation, streamed via Server-Sent Events
**Embeddings:** HuggingFace `sentence-transformers` (`all-MiniLM-L6-v2`, 384-dim)
