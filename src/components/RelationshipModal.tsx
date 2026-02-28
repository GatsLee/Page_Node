import { useState } from "react";

interface ConceptOption {
  id: string;
  name: string;
}

interface RelationshipModalProps {
  isOpen: boolean;
  onClose: () => void;
  concepts: ConceptOption[];
  onSubmit: (data: {
    from_id: string;
    to_id: string;
    rel_type: string;
    relation_type: string;
    weight: number;
  }) => Promise<void>;
}

export default function RelationshipModal({
  isOpen,
  onClose,
  concepts,
  onSubmit,
}: RelationshipModalProps) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [relType, setRelType] = useState("RELATES_TO");
  const [relationLabel, setRelationLabel] = useState("");
  const [weight, setWeight] = useState(1.0);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!fromId || !toId || fromId === toId) return;
    setLoading(true);
    try {
      await onSubmit({
        from_id: fromId,
        to_id: toId,
        rel_type: relType,
        relation_type: relationLabel.trim(),
        weight,
      });
      setFromId("");
      setToId("");
      setRelationLabel("");
      setWeight(1.0);
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
        <h3 style={s.title}>Add Relationship</h3>

        <label style={s.label}>From</label>
        <select style={s.input} value={fromId} onChange={(e) => setFromId(e.target.value)}>
          <option value="">Select concept...</option>
          {concepts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <label style={s.label}>To</label>
        <select style={s.input} value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="">Select concept...</option>
          {concepts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <label style={s.label}>Type</label>
        <div style={s.radioGroup}>
          {[
            { value: "RELATES_TO", label: "Relates To" },
            { value: "PREREQUISITE_OF", label: "Prerequisite Of" },
          ].map(({ value, label }) => (
            <label key={value} style={s.radioLabel}>
              <input
                type="radio"
                name="relType"
                value={value}
                checked={relType === value}
                onChange={() => setRelType(value)}
              />
              {label}
            </label>
          ))}
        </div>

        {relType === "RELATES_TO" && (
          <>
            <label style={s.label}>Label</label>
            <input
              style={s.input}
              value={relationLabel}
              onChange={(e) => setRelationLabel(e.target.value)}
              placeholder="e.g. uses, implements"
            />
            <label style={s.label}>Weight (0-1)</label>
            <input
              style={s.input}
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(parseFloat(e.target.value) || 0)}
            />
          </>
        )}

        <div style={s.actions}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={s.submitBtn}
            onClick={handleSubmit}
            disabled={!fromId || !toId || fromId === toId || loading}
          >
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
  radioGroup: {
    display: "flex",
    gap: "16px",
    marginTop: "4px",
  },
  radioLabel: {
    fontSize: "13px",
    color: "#2b2b2b",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    cursor: "pointer",
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
