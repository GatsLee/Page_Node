# PageNode

## Problem

Reading technical books and papers is slow, lonely, and forgettable.

- **No structure**: You finish a chapter but can't explain how concepts connect.
- **No retention**: Highlights fade. Notes sit in a graveyard. Within a week, 80% is gone.
- **Cloud lock-in**: Every "smart reading" tool wants your data on their servers, a monthly fee, and an internet connection.
- **Tool fragmentation**: PDF viewer + note app + flashcard app + mind map tool — four apps that don't talk to each other.

PageNode solves this by combining document reading, AI-powered concept extraction, knowledge graph visualization, and spaced-repetition quizzes into a single offline desktop app. Everything runs locally. No cloud, no subscription, no data leaves your machine.

## Target Audience

**Primary**: Self-learners studying technical subjects (CS, math, engineering, science) who read PDFs and want to actually retain what they read.

- University students preparing for exams
- Career changers learning new technical domains
- Researchers managing large paper collections
- Developers reading documentation and textbooks

**Secondary**: Anyone who reads non-fiction and wants structured note-taking with automatic knowledge linking.

**Key trait**: Values privacy and offline-first tools. Willing to run a desktop app over a web service.

## Main Features

### 1. Document Library
Import PDFs, Markdown, DOCX, and plain text files. Each document gets a visual book cover (color + texture). Browse, search, tag, and organize your collection.

### 2. AI Concept Extraction
A local LLM reads your documents chunk-by-chunk and extracts key concepts, definitions, and relationships — automatically. No manual tagging required. AI confidence scores let you verify quality.

### 3. Knowledge Graph
Concepts extracted from different documents form a connected graph. See how ideas from Chapter 3 of one book link to Chapter 7 of another. Navigate visually. Discover prerequisite chains you didn't know existed.

### 4. Spaced Repetition Quiz
AI generates flashcards from your documents. SM-2 algorithm schedules reviews at optimal intervals. Mastery tracking shows which concepts you've locked in and which need more work.

### 5. Fully Offline
- Local LLM via llama.cpp (no API keys)
- Embedded databases (SQLite + ChromaDB + Kuzu)
- Tauri desktop app (small binary, native performance)
- Your data stays in `~/.pagenode/data/` — always yours

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri 2 (Rust) |
| Frontend | React 19 + TypeScript + Vite 7 |
| Backend | Python 3.12 + FastAPI (sidecar) |
| Relational DB | SQLite (aiosqlite) |
| Vector DB | ChromaDB (embedded) |
| Graph DB | Kuzu (embedded) |
| Local LLM | llama.cpp (Phase 5) |
| Packaging | PyInstaller + Tauri bundler |
