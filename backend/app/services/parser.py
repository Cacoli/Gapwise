import fitz  # PyMuPDF
import re

def parse_pdf(file_bytes: bytes) -> str:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    return text.strip()

def parse_text(file_bytes: bytes) -> str:
    return file_bytes.decode("utf-8", errors="ignore").strip()

def parse_markdown(file_bytes: bytes) -> str:
    text = file_bytes.decode("utf-8", errors="ignore")
    # Remove markdown syntax
    text = re.sub(r'#{1,6}\s', '', text)
    text = re.sub(r'\*\*|__|\*|_', '', text)
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    return text.strip()

def parse_file(file_bytes: bytes, file_type: str) -> str:
    if file_type == "pdf":
        return parse_pdf(file_bytes)
    elif file_type == "md":
        return parse_markdown(file_bytes)
    elif file_type == "txt":
        return parse_text(file_bytes)
    else:
        raise ValueError(f"Unsupported file type: {file_type}")