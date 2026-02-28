interface ProgressBarProps {
  percent: number;
  label?: string;
}

export default function ProgressBar({ percent, label }: ProgressBarProps) {
  return (
    <div>
      <div style={s.track}>
        <div style={{ ...s.fill, width: `${Math.min(percent, 100)}%` }} />
      </div>
      {label && <span style={s.label}>{label}</span>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  track: {
    height: "8px",
    background: "rgba(0,0,0,0.08)",
    borderRadius: "4px",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    background: "#2b2b2b",
    borderRadius: "4px",
    transition: "width 0.3s ease",
  },
  label: {
    display: "block",
    fontSize: "11px",
    color: "#5e5e5e",
    fontFamily: "'JetBrains Mono', monospace",
    marginTop: "6px",
  },
};
