from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import fitz  # PyMuPDF

# Pages with fewer than this many chars on average are likely scanned images
_OCR_THRESHOLD_CHARS_PER_PAGE = 50


@dataclass
class PageText:
    page_number: int  # 1-indexed
    text: str


@dataclass
class TocItem:
    level: int
    title: str
    page_number: int


@dataclass
class PdfExtraction:
    title: str
    author: str
    page_count: int
    pages: list[PageText] = field(default_factory=list)
    toc: list[TocItem] = field(default_factory=list)
    needs_ocr: bool = False


def extract_pdf(file_path: Path) -> PdfExtraction:
    """Extract text, metadata, and TOC from a PDF file.

    This is a synchronous CPU-bound function — call via asyncio.to_thread().
    Sets needs_ocr=True when the average text per page is below threshold,
    indicating a scanned/image-only document.
    """
    doc = fitz.open(str(file_path))
    try:
        meta = doc.metadata or {}
        pages = []
        for i, page in enumerate(doc):
            text = page.get_text("text")
            pages.append(PageText(page_number=i + 1, text=text))

        toc = [
            TocItem(level=entry[0], title=entry[1], page_number=entry[2])
            for entry in doc.get_toc()
        ]

        # Detect scanned PDFs: avg chars/page below threshold = likely image-only
        total_chars = sum(len(p.text.strip()) for p in pages)
        avg_chars = total_chars / max(len(pages), 1)
        needs_ocr = len(pages) > 0 and avg_chars < _OCR_THRESHOLD_CHARS_PER_PAGE

        return PdfExtraction(
            title=meta.get("title", "") or "",
            author=meta.get("author", "") or "",
            page_count=len(doc),
            pages=pages,
            toc=toc,
            needs_ocr=needs_ocr,
        )
    finally:
        doc.close()
