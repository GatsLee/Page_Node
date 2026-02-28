import { Link, useLocation } from "react-router-dom";

interface NavHeaderProps {
  health: "loading" | "ok" | "error";
}

export default function NavHeader({ health }: NavHeaderProps) {
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <header style={s.header}>
      <div style={s.left}>
        <div style={s.logoMark}>P</div>
        <span style={s.logoText}>PageNode</span>
      </div>

      <nav style={s.nav}>
        {[
          { to: "/", label: "Library" },
          { to: "/graph", label: "Graph" },
          { to: "/settings", label: "Settings" },
        ].map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            style={{
              ...s.navLink,
              color: currentPath === to ? "#2b2b2b" : "#999",
              borderBottom:
                currentPath === to ? "2px solid #2b2b2b" : "2px solid transparent",
            }}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div style={s.right}>
        <div
          style={{
            ...s.dot,
            background:
              health === "ok"
                ? "#3a8f5a"
                : health === "error"
                  ? "#a63a3a"
                  : "#b0a08b",
          }}
        />
        <span style={s.status}>
          {health === "loading" && "Connecting..."}
          {health === "ok" && "Connected"}
          {health === "error" && "Unreachable"}
        </span>
      </div>
    </header>
  );
}

const s: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 24px",
    borderBottom: "1px solid rgba(0,0,0,0.08)",
    background: "#fdfbf7",
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  logoMark: {
    width: "32px",
    height: "32px",
    background: "#2b2b2b",
    color: "#fbf8f3",
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
    fontFamily: "'Crimson Pro', serif",
    fontWeight: 700,
  },
  logoText: {
    fontSize: "18px",
    fontWeight: 600,
    color: "#2b2b2b",
    letterSpacing: "-0.3px",
  },
  nav: {
    display: "flex",
    gap: "24px",
  },
  navLink: {
    fontSize: "13px",
    fontWeight: 500,
    textDecoration: "none",
    padding: "4px 0",
    transition: "color 0.15s",
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  dot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
  },
  status: {
    fontSize: "11px",
    color: "#5e5e5e",
    fontFamily: "'JetBrains Mono', monospace",
  },
};
