import { useState } from "react";

interface ConceptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; description: string; category: string }) => Promise<void>;
}

const CATEGORIES = ["programming", "mathematics", "science", "engineering", "general"];

export default function ConceptModal({ isOpen, onClose, onSubmit }: ConceptModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onSubmit({ name: name.trim(), description: description.trim(), category });
      setName("");
      setDescription("");
      setCategory("general");
      onClose();
    } catch {
      // error displayed by parent; keep modal open
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={s.title}>Add Concept</h3>

        <label style={s.label}>Name</label>
        <input
          style={s.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Neural Networks"
          autoFocus
        />

        <label style={s.label}>Description</label>
        <textarea
          style={{ ...s.input, minHeight: "60px", resize: "vertical" }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description..."
        />

        <label style={s.label}>Category</label>
        <select style={s.input} value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <div style={s.actions}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={s.submitBtn} onClick={handleSubmit} disabled={!name.trim() || loading}>
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "#fdfbf7",
    borderRadius: "8px",
    padding: "24px",
    width: "360px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
  },
  title: {
    margin: "0 0 16px",
    fontSize: "16px",
    fontWeight: 600,
    color: "#2b2b2b",
  },
  label: {
    display: "block",
    fontSize: "11px",
    fontWeight: 600,
    color: "#5e5e5e",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: "4px",
    marginTop: "12px",
  },
  input: {
    width: "100%",
    padding: "8px 10px",
    fontSize: "13px",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: "4px",
    background: "#fff",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "20px",
  },
  cancelBtn: {
    padding: "6px 14px",
    fontSize: "12px",
    background: "none",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: "4px",
    cursor: "pointer",
    color: "#5e5e5e",
    boxShadow: "none",
  },
  submitBtn: {
    padding: "6px 14px",
    fontSize: "12px",
    background: "#2b2b2b",
    color: "#fbf8f3",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: 600,
    boxShadow: "none",
  },
};
