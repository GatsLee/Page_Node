import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

interface DocumentItem {
  id: string;
  title: string;
  author: string;
  file_type: string;
  file_size: number;
  page_count: number;
  status: string;
  concept_count: number;
  created_at: string;
}

interface DocumentList {
  items: DocumentItem[];
  total: number;
}

interface LibraryPageProps {
  health: "loading" | "ok" | "error";
}

type UploadStep = 0 | 1 | 2 | 3; // 0=closed, 1=select, 2=processing, 3=review

const BOOK_COLORS = [
  "#333333", "#a63a3a", "#3a5fa6", "#3a8f5a",
  "#634e3b", "#1e2b42", "#7b5e3a", "#4a3a6a",
  "#5a3a3a", "#2a4a3a", "#4a4a2a", "#3a4a5a",
];

const STATUS_PROCESSING = new Set([
  "pending", "extracting", "chunking", "embedding", "extracting_concepts",
]);

const STATUS_LABELS: Record<string, string> = {
  pending: "queued",
  extracting: "reading",
  chunking: "chunking",
  embedding: "indexing",
  extracting_concepts: "thinking",
  concepts_ready: "ready",
  ready: "ready",
  needs_ocr: "scan",
  error: "error",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#b0a08b",
  extracting: "#d4a843",
  chunking: "#d4a843",
  embedding: "#d4a843",
  extracting_concepts: "#7b5ea6",
  concepts_ready: "#3a8f5a",
  ready: "#3a8f5a",
  needs_ocr: "#c97b30",
  error: "#a63a3a",
};

const STAGE_LABELS: Record<string, string> = {
  pending: "Queued for processing…",
  extracting: "Extracting text from PDF…",
  chunking: "Splitting into chunks…",
  embedding: "Building semantic index…",
  extracting_concepts: "Extracting concepts with AI…",
  concepts_ready: "Complete",
  ready: "Complete",
  needs_ocr: "Scanned document detected",
  error: "Processing error",
};

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LibraryPage({ health }: LibraryPageProps) {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [uploadStep, setUploadStep] = useState<UploadStep>(0);
  const [dragOver, setDragOver] = useState(false);
  const [processingDocId, setProcessingDocId] = useState<string | null>(null);
  const [processingDoc, setProcessingDoc] = useState<DocumentItem | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocs = useCallback(async () => {
    try {
      const res = await apiFetch("/documents/?limit=100");
      const data: DocumentList = await res.json();
      setDocuments(data.items);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (health === "ok") fetchDocs();
  }, [health, fetchDocs]);

  // Poll all docs while any are processing
  useEffect(() => {
    const hasProcessing = documents.some((d) => STATUS_PROCESSING.has(d.status));
    if (!hasProcessing) return;
    const interval = setInterval(fetchDocs, 2000);
    return () => clearInterval(interval);
  }, [documents, fetchDocs]);

  // Poll specific doc while upload modal is at step 2
  useEffect(() => {
    if (uploadStep !== 2 || !processingDocId) return;
    let timerId: number;
    const poll = async () => {
      try {
        const res = await apiFetch(`/documents/${processingDocId}`);
        if (!res.ok) return;
        const doc: DocumentItem = await res.json();
        setProcessingDoc(doc);
        if (doc.status === "ready" || doc.status === "concepts_ready" || doc.status === "needs_ocr" || doc.status === "error") {
          setUploadStep(3);
          fetchDocs();
          return;
        }
      } catch { /* ignore */ }
      timerId = window.setTimeout(poll, 1500);
    };
    poll();
    return () => clearTimeout(timerId);
  }, [uploadStep, processingDocId, fetchDocs]);

  const handleFileDrop = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Only PDF files are supported.");
      return;
    }
    setUploadError(null);
    setProcessingDoc(null);
    setProcessingDocId(null);

    const form = new FormData();
    form.append("file", file);
    try {
      const res = await apiFetch("/documents/upload", { method: "POST", body: form });
      if (res.status === 409) {
        setUploadError("This file has already been uploaded.");
        return;
      }
      if (!res.ok) {
        const err = await res.json();
        setUploadError(err.detail || "Upload failed.");
        return;
      }
      const doc: DocumentItem = await res.json();
      setProcessingDocId(doc.id);
      setProcessingDoc(doc);
      setUploadStep(2);
    } catch {
      setUploadError("Upload failed — is the backend running?");
    }
  };

  const handleDelete = async (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await apiFetch(`/documents/${docId}`, { method: "DELETE" });
    await fetchDocs();
  };

  const openUploadModal = () => {
    setUploadStep(1);
    setUploadError(null);
    setProcessingDoc(null);
    setProcessingDocId(null);
  };

  const closeModal = () => {
    setUploadStep(0);
    setUploadError(null);
  };

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <h1 style={s.pageTitle}>My Library</h1>
          <p style={s.pageSubtitle}>
            {documents.length} document{documents.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button style={s.addBtn} onClick={openUploadModal}>
          <span style={{ fontSize: "16px", lineHeight: 1, marginRight: "6px" }}>+</span>
          Add Book
        </button>
      </div>

      {/* Shelf area */}
      <div style={s.shelfArea}>
        {documents.length === 0 && health === "ok" ? (
          <div style={s.emptyShelf}>
            <p style={s.emptyTitle}>Your library is empty</p>
            <p style={s.emptyBody}>Upload a PDF to get started with your knowledge library.</p>
            <button style={s.emptyBtn} onClick={openUploadModal}>Add your first book</button>
          </div>
        ) : (
          <div style={s.shelf}>
            <div style={s.bookRow}>
              {documents.map((doc, i) => (
                <BookSpine
                  key={doc.id}
                  doc={doc}
                  color={BOOK_COLORS[i % BOOK_COLORS.length]}
                  onDelete={(e) => handleDelete(doc.id, e)}
                  onViewGraph={() => navigate("/graph")}
                />
              ))}
              <div style={s.addSpine} onClick={openUploadModal} title="Add a book">
                <span style={s.addSpineIcon}>+</span>
                <span style={s.addSpineLabel}>ADD</span>
              </div>
            </div>
            <div style={s.shelfPlank} />
          </div>
        )}
      </div>

      {/* Upload modal */}
      {uploadStep > 0 && (
        <UploadModal
          step={uploadStep}
          dragOver={dragOver}
          setDragOver={setDragOver}
          processingDoc={processingDoc}
          uploadError={uploadError}
          fileInputRef={fileInputRef}
          onFileDrop={handleFileDrop}
          onClose={closeModal}
          onViewGraph={() => { closeModal(); navigate("/graph"); }}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileDrop(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ─── BookSpine ───────────────────────────────────────────────────────────────

interface BookSpineProps {
  doc: DocumentItem;
  color: string;
  onDelete: (e: React.MouseEvent) => void;
  onViewGraph: () => void;
}

function BookSpine({ doc, color, onDelete, onViewGraph }: BookSpineProps) {
  const [hovered, setHovered] = useState(false);
  const isProcessing = STATUS_PROCESSING.has(doc.status);
  const statusColor = STATUS_COLORS[doc.status] || "#999";

  return (
    <div
      style={{
        ...bs.spine,
        background: `linear-gradient(105deg, ${color}cc 0%, ${color} 40%, ${color}ee 100%)`,
        transform: hovered ? "translateY(-14px)" : "translateY(0)",
        boxShadow: hovered
          ? "4px 0 16px rgba(0,0,0,0.4), inset 2px 0 0 rgba(255,255,255,0.18)"
          : "2px 0 6px rgba(0,0,0,0.22), inset 2px 0 0 rgba(255,255,255,0.1)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={doc.title}
    >
      <span style={bs.title}>{doc.title}</span>

      {doc.concept_count > 0 && (
        <span style={bs.conceptPill}>{doc.concept_count}</span>
      )}

      <div style={bs.bottom}>
        <div style={{ ...bs.statusDot, background: statusColor }} />
        {hovered && (
          <div style={bs.actions} onClick={(e) => e.stopPropagation()}>
            {(doc.status === "ready" || doc.status === "concepts_ready") && (
              <button style={bs.spineBtn} onClick={onViewGraph} title="View in graph">⬡</button>
            )}
            <button
              style={{ ...bs.spineBtn, color: "rgba(255,200,200,0.9)" }}
              onClick={onDelete}
              title="Delete"
            >×</button>
          </div>
        )}
      </div>

      {isProcessing && <div style={bs.shimmer} />}
    </div>
  );
}

const bs: Record<string, React.CSSProperties> = {
  spine: {
    width: "38px",
    height: "200px",
    borderRadius: "2px 4px 0 0",
    cursor: "pointer",
    transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: "14px",
    paddingBottom: "8px",
    overflow: "hidden",
    flexShrink: 0,
  },
  title: {
    writingMode: "vertical-rl" as React.CSSProperties["writingMode"],
    transform: "rotate(180deg)",
    fontSize: "11px",
    fontFamily: "'Crimson Pro', serif",
    fontWeight: 600,
    color: "rgba(255,255,255,0.9)",
    overflow: "hidden",
    whiteSpace: "nowrap",
    maxHeight: "140px",
    letterSpacing: "0.3px",
    textShadow: "0 1px 3px rgba(0,0,0,0.4)",
    flex: 1,
  },
  bottom: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
    width: "100%",
  },
  statusDot: {
    width: "5px",
    height: "5px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    alignItems: "center",
  },
  spineBtn: {
    background: "rgba(0,0,0,0.3)",
    border: "none",
    color: "rgba(255,255,255,0.85)",
    fontSize: "12px",
    width: "22px",
    height: "22px",
    borderRadius: "3px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
  },
  shimmer: {
    position: "absolute",
    top: 0,
    left: "-100%",
    width: "60%",
    height: "100%",
    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)",
    animation: "shimmer 1.8s ease-in-out infinite",
    pointerEvents: "none",
  },
  conceptPill: {
    fontSize: "8px",
    fontFamily: "'JetBrains Mono', monospace",
    color: "rgba(255,255,255,0.75)",
    background: "rgba(0,0,0,0.3)",
    borderRadius: "3px",
    padding: "1px 4px",
    letterSpacing: "0.3px",
    flexShrink: 0,
    lineHeight: 1.4,
  },
};

// ─── UploadModal ──────────────────────────────────────────────────────────────

interface UploadModalProps {
  step: UploadStep;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  processingDoc: DocumentItem | null;
  uploadError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileDrop: (file: File) => void;
  onClose: () => void;
  onViewGraph: () => void;
}

function UploadModal({
  step, dragOver, setDragOver, processingDoc, uploadError,
  fileInputRef, onFileDrop, onClose, onViewGraph,
}: UploadModalProps) {
  return (
    <div style={m.backdrop} onClick={onClose}>
      <div style={m.modal} onClick={(e) => e.stopPropagation()}>

        {/* Step indicator */}
        <div style={m.stepBar}>
          {(["Select", "Processing", "Review"] as const).map((label, i) => {
            const stepNum = (i + 1) as UploadStep;
            const active = step === stepNum;
            const done = step > stepNum;
            return (
              <div key={label} style={m.stepItem}>
                <div style={{
                  ...m.stepDot,
                  background: done ? "#3a8f5a" : active ? "#2b2b2b" : "rgba(0,0,0,0.1)",
                }} />
                <span style={{
                  ...m.stepLabel,
                  color: active ? "#2b2b2b" : done ? "#3a8f5a" : "#ccc",
                }}>{label}</span>
              </div>
            );
          })}
        </div>

        {/* Step 1 — Select */}
        {step === 1 && (
          <div style={m.body}>
            <h2 style={m.title}>Add New Resource</h2>
            <p style={m.desc}>Drop a PDF into your knowledge library</p>

            {uploadError && <div style={m.errorBox}>{uploadError}</div>}

            <div
              style={{
                ...m.dropZone,
                borderColor: dragOver ? "#2b2b2b" : "rgba(0,0,0,0.15)",
                background: dragOver ? "rgba(43,43,43,0.03)" : "transparent",
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) onFileDrop(file);
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
            >
              <div style={m.pdfIconWrap}>
                <svg width="28" height="36" viewBox="0 0 28 36" fill="none">
                  <rect width="28" height="36" rx="3" fill="#a63a3a" fillOpacity="0.1" />
                  <rect x="1" y="1" width="26" height="34" rx="2" stroke="#a63a3a" strokeWidth="1.5" strokeOpacity="0.4" fill="none" />
                  <text x="14" y="23" textAnchor="middle" fontSize="9" fill="#a63a3a" fontFamily="JetBrains Mono, monospace" fontWeight="700">PDF</text>
                </svg>
              </div>
              <p style={m.dropMain}>Drag & drop your PDF here</p>
              <p style={m.dropOr}>— or —</p>
              <button style={m.browseBtn} onClick={() => fileInputRef.current?.click()}>
                Choose from files
              </button>
            </div>

            <div style={m.footer}>
              <button style={m.cancelBtn} onClick={onClose}>Cancel</button>
              <span style={m.privacyNote}>
                <span style={{ color: "#3a8f5a", marginRight: "4px" }}>✓</span>
                local processing only
              </span>
            </div>
          </div>
        )}

        {/* Step 2 — Processing */}
        {step === 2 && (
          <div style={m.body}>
            <h2 style={m.title}>Processing Document</h2>
            <p style={m.desc}>
              {processingDoc ? (STAGE_LABELS[processingDoc.status] || "Working…") : "Starting upload…"}
            </p>

            <div style={m.progressTrack}>
              <div style={m.progressBar} />
            </div>

            {processingDoc && (
              <div style={m.catalogCard}>
                <Row k="TITLE" v={processingDoc.title || "—"} />
                {processingDoc.author && <Row k="AUTHOR" v={processingDoc.author} />}
                <Row k="SIZE" v={formatSize(processingDoc.file_size)} />
                <div style={m.rowWrap}>
                  <span style={m.rowKey}>STATUS</span>
                  <span style={{
                    ...m.rowVal,
                    color: STATUS_COLORS[processingDoc.status] || "#999",
                    fontWeight: 600,
                  }}>
                    ◼ {STATUS_LABELS[processingDoc.status] || processingDoc.status}
                  </span>
                </div>
              </div>
            )}

            <div style={m.footer}>
              <button style={m.cancelBtn} onClick={onClose}>Close</button>
              <span style={m.etaNote}>processing in background…</span>
            </div>
          </div>
        )}

        {/* Step 3 — Review */}
        {step === 3 && processingDoc && (() => {
          const isSuccess = processingDoc.status === "ready" || processingDoc.status === "concepts_ready";
          return (
            <div style={m.body}>
              <div style={m.reviewIcon}>
                {isSuccess
                  ? <span style={{ color: "#3a8f5a" }}>✓</span>
                  : processingDoc.status === "needs_ocr"
                  ? <span style={{ color: "#c97b30" }}>⚠</span>
                  : <span style={{ color: "#a63a3a" }}>✕</span>}
              </div>
              <h2 style={m.title}>
                {isSuccess ? "Document Ready"
                  : processingDoc.status === "needs_ocr" ? "Scanned PDF Detected"
                  : "Processing Error"}
              </h2>
              <p style={m.desc}>
                {isSuccess
                  ? processingDoc.concept_count > 0
                    ? `Indexed and ${processingDoc.concept_count} concepts extracted.`
                    : "Your document has been indexed and is ready for use."
                  : processingDoc.status === "needs_ocr"
                  ? "This PDF appears image-based. OCR support is coming soon."
                  : "Something went wrong while processing this document."}
              </p>

              <div style={m.catalogCard}>
                <Row k="TITLE" v={processingDoc.title} />
                {processingDoc.author && <Row k="AUTHOR" v={processingDoc.author} />}
                {processingDoc.page_count > 0 && <Row k="PAGES" v={String(processingDoc.page_count)} />}
                <Row k="SIZE" v={formatSize(processingDoc.file_size)} />
                {processingDoc.concept_count > 0 && <Row k="CONCEPTS" v={String(processingDoc.concept_count)} />}
              </div>

              <div style={m.footer}>
                <button style={m.cancelBtn} onClick={onClose}>Done</button>
                {isSuccess && (
                  <button style={m.primaryBtn} onClick={onViewGraph}>
                    View Knowledge Graph →
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={m.rowWrap}>
      <span style={m.rowKey}>{k}</span>
      <span style={m.rowVal}>{v}</span>
    </div>
  );
}

// ─── Page styles ─────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "#fbf8f3",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "28px 32px 20px",
    borderBottom: "1px solid rgba(0,0,0,0.06)",
    flexShrink: 0,
  },
  pageTitle: {
    margin: 0,
    fontSize: "24px",
    fontWeight: 700,
    color: "#2b2b2b",
    fontFamily: "'Crimson Pro', serif",
    letterSpacing: "-0.3px",
  },
  pageSubtitle: {
    margin: "3px 0 0",
    fontSize: "11px",
    color: "#b0a08b",
    fontFamily: "'JetBrains Mono', monospace",
  },
  addBtn: {
    display: "flex",
    alignItems: "center",
    padding: "8px 16px",
    fontSize: "12px",
    fontWeight: 600,
    background: "#2b2b2b",
    color: "#fbf8f3",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
    letterSpacing: "0.2px",
    flexShrink: 0,
  },
  shelfArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    padding: "40px 32px 0",
    overflow: "hidden",
  },
  shelf: {
    display: "flex",
    flexDirection: "column",
  },
  bookRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: "4px",
    paddingLeft: "16px",
    flexWrap: "wrap",
  },
  shelfPlank: {
    height: "18px",
    background: "linear-gradient(to bottom, #d4c5b0 0%, #b8a48e 100%)",
    borderRadius: "2px",
    boxShadow: "0 4px 14px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.3)",
    marginTop: "0",
    flexShrink: 0,
  },
  addSpine: {
    width: "38px",
    height: "200px",
    border: "2px dashed rgba(0,0,0,0.13)",
    borderRadius: "2px 4px 0 0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    gap: "4px",
    flexShrink: 0,
    transition: "border-color 0.15s",
  },
  addSpineIcon: {
    fontSize: "16px",
    color: "rgba(0,0,0,0.18)",
    lineHeight: 1,
  },
  addSpineLabel: {
    fontSize: "7px",
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase",
    letterSpacing: "1.5px",
    color: "rgba(0,0,0,0.18)",
    writingMode: "vertical-rl" as React.CSSProperties["writingMode"],
  },
  emptyShelf: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: "8px",
    paddingBottom: "60px",
  },
  emptyTitle: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 600,
    color: "#c4b49f",
    fontFamily: "'Crimson Pro', serif",
  },
  emptyBody: {
    margin: 0,
    fontSize: "13px",
    color: "#c4b49f",
    textAlign: "center",
    maxWidth: "260px",
    lineHeight: 1.5,
  },
  emptyBtn: {
    marginTop: "8px",
    padding: "8px 20px",
    fontSize: "12px",
    fontWeight: 600,
    background: "#2b2b2b",
    color: "#fbf8f3",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
  },
};

// ─── Modal styles ─────────────────────────────────────────────────────────────

const m: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(43,43,43,0.55)",
    backdropFilter: "blur(2px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  modal: {
    background: "#fdfbf7",
    borderRadius: "10px",
    width: "480px",
    maxWidth: "calc(100vw - 48px)",
    boxShadow: "0 25px 50px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.07)",
    overflow: "hidden",
  },
  stepBar: {
    display: "flex",
    justifyContent: "center",
    gap: "28px",
    padding: "14px 24px",
    borderBottom: "1px solid rgba(0,0,0,0.06)",
    background: "#f7f4ee",
  },
  stepItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
  },
  stepDot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    transition: "background 0.2s",
  },
  stepLabel: {
    fontSize: "9px",
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    transition: "color 0.2s",
  },
  body: {
    padding: "24px 28px",
  },
  title: {
    margin: "0 0 4px",
    fontSize: "20px",
    fontWeight: 700,
    color: "#2b2b2b",
    fontFamily: "'Crimson Pro', serif",
  },
  desc: {
    margin: "0 0 20px",
    fontSize: "13px",
    color: "#5e5e5e",
    lineHeight: 1.5,
  },
  errorBox: {
    padding: "8px 12px",
    background: "#fde8e8",
    border: "1px solid #f5c6c6",
    borderRadius: "6px",
    fontSize: "12px",
    color: "#a63a3a",
    marginBottom: "14px",
  },
  dropZone: {
    border: "2px dashed rgba(0,0,0,0.18)",
    borderRadius: "8px",
    padding: "32px 24px",
    textAlign: "center",
    cursor: "pointer",
    transition: "all 0.15s",
    marginBottom: "16px",
  },
  pdfIconWrap: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "12px",
  },
  dropMain: {
    margin: "0 0 4px",
    fontSize: "14px",
    fontFamily: "'Crimson Pro', serif",
    fontStyle: "italic",
    color: "#5e5e5e",
  },
  dropOr: {
    margin: "0 0 12px",
    fontSize: "10px",
    color: "#b0a08b",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "1px",
  },
  browseBtn: {
    padding: "7px 18px",
    fontSize: "12px",
    fontWeight: 600,
    background: "#2b2b2b",
    color: "#fbf8f3",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "8px",
  },
  cancelBtn: {
    background: "none",
    border: "none",
    fontSize: "12px",
    color: "#999",
    cursor: "pointer",
    padding: "4px 0",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "3px",
  },
  privacyNote: {
    fontSize: "10px",
    color: "#5e5e5e",
    fontFamily: "'JetBrains Mono', monospace",
    border: "1px solid rgba(58,143,90,0.25)",
    borderRadius: "4px",
    padding: "3px 8px",
  },
  progressTrack: {
    height: "3px",
    background: "rgba(0,0,0,0.07)",
    borderRadius: "2px",
    overflow: "hidden",
    marginBottom: "20px",
    position: "relative",
  },
  progressBar: {
    position: "absolute",
    top: 0,
    height: "100%",
    width: "40%",
    background: "#2b2b2b",
    borderRadius: "2px",
    animation: "progress-slide 1.4s ease-in-out infinite",
  },
  catalogCard: {
    background: "#f4f0e8",
    border: "1px solid rgba(0,0,0,0.07)",
    borderRadius: "6px",
    padding: "14px 16px",
    marginBottom: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  rowWrap: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  rowKey: {
    fontSize: "9px",
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase",
    letterSpacing: "1px",
    color: "#b0a08b",
  },
  rowVal: {
    fontSize: "13px",
    color: "#2b2b2b",
    fontFamily: "'Crimson Pro', serif",
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  etaNote: {
    fontSize: "10px",
    color: "#b0a08b",
    fontFamily: "'JetBrains Mono', monospace",
  },
  reviewIcon: {
    textAlign: "center",
    fontSize: "44px",
    lineHeight: 1,
    marginBottom: "8px",
  },
  primaryBtn: {
    padding: "7px 16px",
    fontSize: "12px",
    fontWeight: 600,
    background: "#2b2b2b",
    color: "#fbf8f3",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
  },
};
