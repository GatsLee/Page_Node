from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.pdf_extractor import PageText

TARGET_CHARS = 2000  # ~500 tokens
OVERLAP_CHARS = 200  # ~50 tokens


@dataclass
class ChunkData:
    chunk_index: int
    content: str
    page_number: int | None
    char_start: int
    char_end: int
    token_count: int


def chunk_pages(
    pages: list[PageText],
    target_chars: int = TARGET_CHARS,
    overlap_chars: int = OVERLAP_CHARS,
) -> list[ChunkData]:
    """Split page texts into overlapping chunks respecting paragraph boundaries."""
    if not pages:
        return []

    # Build full text and a page offset map
    full_text = ""
    page_offsets: list[tuple[int, int]] = []  # (char_offset, page_number)
    for p in pages:
        page_offsets.append((len(full_text), p.page_number))
        full_text += p.text + "\n"

    if not full_text.strip():
        return []

    # Split into paragraphs (double newline)
    paragraphs = _split_paragraphs(full_text)

    # Build chunks by accumulating paragraphs
    chunks: list[ChunkData] = []
    buf = ""
    buf_start = 0
    text_cursor = 0

    for para, para_len in paragraphs:
        para_start = text_cursor
        text_cursor += para_len

        if not para.strip():
            buf += para
            continue

        # Would adding this paragraph exceed target?
        if buf and len(buf) + len(para) > target_chars:
            # Emit current buffer as a chunk
            _emit_chunk(chunks, buf, buf_start, page_offsets)
            # Start new buffer with overlap from end of current
            overlap_text = buf[-overlap_chars:] if len(buf) > overlap_chars else buf
            buf_start = buf_start + len(buf) - len(overlap_text)
            buf = overlap_text

        buf += para

    # Emit remaining buffer
    if buf.strip():
        _emit_chunk(chunks, buf, buf_start, page_offsets)

    return chunks


def _split_paragraphs(text: str) -> list[tuple[str, int]]:
    """Split text on double newlines, keeping delimiters.

    Returns (paragraph_text, original_length_including_delimiter) pairs.
    """
    parts = re.split(r"(\n\n+)", text)
    result: list[tuple[str, int]] = []
    i = 0
    while i < len(parts):
        part = parts[i]
        # If next part is a delimiter, merge it
        if i + 1 < len(parts) and re.match(r"\n\n+", parts[i + 1]):
            combined = part + parts[i + 1]
            result.append((combined, len(combined)))
            i += 2
        else:
            result.append((part, len(part)))
            i += 1
    return result


def _emit_chunk(
    chunks: list[ChunkData],
    text: str,
    char_start: int,
    page_offsets: list[tuple[int, int]],
) -> None:
    content = text.strip()
    if not content:
        return

    char_end = char_start + len(text)
    page_number = _lookup_page(char_start, page_offsets)

    chunks.append(
        ChunkData(
            chunk_index=len(chunks),
            content=content,
            page_number=page_number,
            char_start=char_start,
            char_end=char_end,
            token_count=len(content) // 4,  # rough estimate: 1 token ≈ 4 chars
        )
    )


def _lookup_page(
    char_offset: int, page_offsets: list[tuple[int, int]]
) -> int | None:
    """Find which page a character offset belongs to."""
    result = None
    for offset, page_num in page_offsets:
        if offset <= char_offset:
            result = page_num
        else:
            break
    return result
