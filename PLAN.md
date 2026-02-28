# PageNode — Implementation Plan

## Phase Overview

| Phase | Name | Status | Description |
|-------|------|--------|-------------|
| 0 | Scaffolding | Done | Tauri + React + FastAPI wiring |
| 1 | Embedded DB Layer | Done | SQLite, ChromaDB, Kuzu setup |
| 2 | PDF Ingestion Pipeline | Done | Upload, extraction, chunking, embedding, needs_ocr detection |
| 3 | Knowledge Graph Viz | Done | Cytoscape.js graph, CRUD, neighbors endpoint, doc_id filter, search/filter UI |
| 4 | Setup & Library UX | Done | Wizard, model DL, Ollama detection, bookshelf UI, 3-step upload modal, sidebar layout |
| 5 | Local LLM Integration | **Next** | Ollama/llama.cpp inference, concept extraction, flashcard generation |
| 6 | Quiz & Spaced Repetition | — | SM-2 scheduler, flashcard quiz UI, mastery dashboard |
| 7 | Packaging | — | PyInstaller + Tauri bundler, .deb/.AppImage distribution |

---

## Phase 0 — Scaffolding (Done)

**Goal**: Tauri desktop shell launches a React frontend and a Python FastAPI backend as a sidecar process.

**What was built**:
- `scripts/dev.sh` — orchestrates backend + Tauri dev with dynamic port detection
- `backend/main.py` — FastAPI with `find_free_port()`, prints `PORT=XXXX` to stdout
- `src-tauri/src/lib.rs` — Rust sidecar launcher, stores `BackendPort` state
- `vite.config.ts` — Vite dev proxy (`/api` → backend) to bypass WebKitGTK sandbox
- `src/App.tsx` — health check, sidebar layout, backend status in sidebar card

**Key decisions**:
- Vite dev proxy required on Linux because WebKitGTK sandbox blocks direct localhost fetch
- Backend runs with `setsid` for process isolation
- `.env.development.local` written dynamically for port propagation

---

## Phase 1 — Embedded DB Layer (Done)

**Goal**: Set up 3 embedded databases for local-only persistence. No cloud dependency.

**What was built**:
- `app/config.py` — `Settings` with pydantic-settings, data dir at `~/.pagenode/data/`
- `app/db/sqlite.py` — 9 tables (documents, chunks, tags, toc_entries, notes, flashcards, activity_log, schema_version) + async CRUD
- `app/db/chromadb_.py` — `chunk_embeddings` collection with cosine similarity
- `app/db/kuzu_.py` — Graph schema: Concept, DocNode; EXTRACTED_FROM, RELATES_TO, PREREQUISITE_OF
- `app/routers/documents.py` — Full CRUD: POST, GET list, GET by ID, PATCH, DELETE
- `app/routers/health.py` — `/health` endpoint

**Data directory structure**:
```
~/.pagenode/data/
  pagenode.db          # SQLite
  chroma/              # ChromaDB persistent storage
  graph/               # Kuzu graph DB
~/.pagenode/models/    # Downloaded GGUF models
```

---

## Phase 2 — PDF Ingestion Pipeline (Done)

**Goal**: User drops a PDF file. Backend extracts text, chunks, embeds, stores.

**What was built**:
1. **Upload** — `POST /documents/upload` — multipart, SHA-256 dedup, UUID file naming
2. **Text extraction** — PyMuPDF: title, author, page count, TOC, page text
3. **Scanned PDF detection** — `needs_ocr` flag if avg chars/page < 50
4. **Chunking** — ~500-token chunks with overlap, sentence-boundary aware
5. **Embedding** — ChromaDB onnxruntime with all-MiniLM-L6-v2
6. **Pipeline** — Background async task; status: `pending → extracting → chunking → embedding → ready | needs_ocr | error`
7. **Frontend (Phase 4 UX refresh)** — 3-step upload modal: Select → Processing (live status) → Review (metadata + View in Graph)

---

## Phase 3 — Knowledge Graph Visualization (Done)

**Goal**: Render the concept graph interactively.

**What was built**:
1. **Graph API** — `GET /graph/concepts`, `GET /graph/subgraph?doc_id=X`, `GET /graph/concepts/{id}/neighbors`, `POST /graph/concepts`, `POST /graph/relationships`, `DELETE /graph/concepts/{id}`
2. **Cytoscape.js** — Force-directed layout (CoSE), nodes sized by mastery, color-coded by category
3. **Search + category filter** — live filter via `.style("display", ...)` on Cytoscape elements
4. **Side panel** — click node → concept details, mastery bar, description, delete button
5. **Edge types** — RELATES_TO (solid gray) and PREREQUISITE_OF (dashed red)

---

## Phase 4 — Setup & Library UX (Done)

**Goal**: Full-featured first-run experience and polished library UI based on the reference design.

**What was built**:

### Setup Wizard
- 5-step wizard: Welcome → Model Selection → Download → AI Tools (embedding warm-up) → Done
- Model download via `huggingface_hub` with real-time progress polling
- `POST /settings/warm-embeddings` — pre-downloads all-MiniLM-L6-v2 via ChromaDB
- "Use & Continue" when selected model is already installed (GGUF or Ollama)

### Ollama Detection
- `GET /settings/models/available` checks `http://localhost:11434/api/tags` (1.5s timeout)
- Each catalog model has `ollama_name` (e.g. `"qwen2.5:3b"`) — matched by prefix
- `ollama_installed: bool` returned per model; ModelCard shows "Ollama ✓" badge
- Wizard and Settings treat Ollama-installed models as available (no download needed)

### Library — Bookshelf UI
- Documents displayed as vertical book spines on a wooden shelf
- Each spine: color-coded (12 book colors), vertical title text, status dot, hover-lift animation
- Hover reveals: View in Graph (ready docs), Delete buttons
- Processing shimmer animation on in-progress documents

### 3-Step Upload Modal
- **Step 1 (Select)**: Drag-and-drop zone + Browse Files button
- **Step 2 (Processing)**: Indeterminate progress bar + live catalog card (polls `/documents/{id}` every 1.5s)
- **Step 3 (Review)**: Document metadata + "View Knowledge Graph →" button on success

### App Layout
- Left sidebar (220px): Logo, nav items with SVG icons (Library/Graph/Settings), system status card
- Replaces top navbar; sidebar shows health dot + privacy badge

### Settings Page
- Lists all catalog models with disk usage, Ollama status, Download/Use/Active buttons

---

## Phase 5 — Local LLM Integration (Next)

**Goal**: Run inference locally via Ollama (primary) or llama.cpp (fallback) for concept extraction and flashcard generation.

**Planned work**:

### 5a — Inference Backend
- **Ollama integration** (primary path): `POST http://localhost:11434/api/chat` with JSON output mode
  - Use whichever model is configured in settings (`llm_model_id` → Ollama tag lookup)
  - Detect Ollama availability at runtime; fall back to GGUF if unavailable
- **GGUF fallback**: `llama-cpp-python` or `llama-server` subprocess for downloaded GGUF models
- `POST /llm/generate` — internal inference endpoint used by extraction pipeline

### 5b — Concept Extraction
- For each document chunk, prompt LLM to extract:
  - Concepts (name, category, short definition)
  - Relationships between concepts (type, weight)
- Structured JSON output (Ollama JSON mode or constrained generation)
- Upsert concepts and relationships into Kuzu graph
- Link concepts → source chunks via EXTRACTED_FROM edges
- Background task triggered after embedding completes
- Document status gains new stage: `ready → extracting_concepts → concepts_ready`

### 5c — Flashcard Generation
- For each ready chunk, generate Q&A pairs
- Store in SQLite `flashcards` table with source chunk reference
- Allow user to review, edit, and reject cards

### 5d — Auto-refresh after extraction
- When concept extraction completes, graph page auto-refreshes (polling or SSE notification)
- Library shows "View X concepts in Graph" badge on ready documents

### Frontend additions
- `GraphPage`: Visual indicator showing source document for each concept
- `LibraryPage`: "Concepts extracted" count badge on ready book spines
- New `NotebookPage`: Notes and summaries linked to documents

---

## Phase 6 — Quiz & Spaced Repetition

**Goal**: SM-2 spaced repetition scheduler with a quiz UI. Track mastery per concept.

**Planned work**:

### Backend
- `GET /quiz/due` — fetch cards due for review today
- `POST /quiz/review` — submit answer quality (0-5), compute SM-2 next review date
- `GET /quiz/stats` — mastery per concept/document

### Frontend
- Flashcard flip interface (question → reveal answer) styled like reference.html index cards
- Self-grade buttons: Again / Hard / Good / Easy
- Session summary: cards reviewed, accuracy, streak
- Mastery dashboard: per-concept % bars, per-document progress, upcoming review count

---

## Phase 7 — Packaging & Distribution

**Goal**: Ship a single installable desktop app.

**Planned work**:
1. PyInstaller to bundle Python backend into a binary (no Python required)
2. Tauri bundler — `.deb` and `.AppImage` for Linux, `.dmg` for macOS (future)
3. Auto-update via Tauri updater plugin + GitHub Releases
4. End-to-end tests: fresh install → upload PDF → concepts extracted → quiz session
