interface ModelCardProps {
  id: string;
  name: string;
  paramCount: string;
  sizeMb: number;
  ramGb: number;
  description: string;
  recommended: boolean;
  selected: boolean;
  installedSizeBytes: number | null;
  ollamaInstalled?: boolean;
  onClick: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function ModelCard({
  name,
  paramCount,
  sizeMb,
  ramGb,
  description,
  recommended,
  selected,
  installedSizeBytes,
  ollamaInstalled = false,
  onClick,
}: ModelCardProps) {
  const sizeLabel = sizeMb >= 1024
    ? `${(sizeMb / 1024).toFixed(1)} GB`
    : `${sizeMb} MB`;

  const isInstalled = installedSizeBytes !== null;

  return (
    <div
      style={{
        ...s.card,
        borderColor: selected ? "#2b2b2b" : "rgba(0,0,0,0.08)",
        background: selected ? "#2b2b2b" : "#fdfbf7",
      }}
      onClick={onClick}
    >
      <div style={s.header}>
        <span style={{ ...s.name, color: selected ? "#fbf8f3" : "#2b2b2b" }}>
          {name}
        </span>
        {recommended && (
          <span style={s.badge}>Recommended</span>
        )}
        {isInstalled && (
          <span style={{ ...s.badge, background: selected ? "#3a6e4a" : "#3a8f5a" }}>
            Installed · {formatBytes(installedSizeBytes!)}
          </span>
        )}
        {!isInstalled && ollamaInstalled && (
          <span style={{ ...s.badge, background: selected ? "#2a5e6e" : "#3a7a8f" }}>
            Ollama ✓
          </span>
        )}
      </div>
      <p style={{ ...s.desc, color: selected ? "rgba(251,248,243,0.7)" : "#5e5e5e" }}>
        {description}
      </p>
      <div style={s.stats}>
        <span style={{ ...s.stat, color: selected ? "rgba(251,248,243,0.5)" : "#999" }}>
          {paramCount} params
        </span>
        <span style={{ ...s.stat, color: selected ? "rgba(251,248,243,0.5)" : "#999" }}>
          {sizeLabel} download
        </span>
        <span style={{ ...s.stat, color: selected ? "rgba(251,248,243,0.5)" : "#999" }}>
          {ramGb} GB RAM
        </span>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    border: "2px solid rgba(0,0,0,0.08)",
    borderRadius: "8px",
    padding: "16px",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "6px",
    flexWrap: "wrap",
  },
  name: {
    fontSize: "15px",
    fontWeight: 600,
  },
  badge: {
    fontSize: "10px",
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: "3px",
    background: "#3a8f5a",
    color: "#fff",
    textTransform: "uppercase",
    letterSpacing: "0.3px",
  },
  desc: {
    margin: "0 0 10px",
    fontSize: "13px",
    lineHeight: 1.4,
  },
  stats: {
    display: "flex",
    gap: "16px",
  },
  stat: {
    fontSize: "11px",
    fontFamily: "'JetBrains Mono', monospace",
  },
};
