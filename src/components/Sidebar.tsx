import { Link, useLocation } from "react-router-dom";

interface SidebarProps {
  health: "loading" | "ok" | "error";
}

const LibraryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="4" height="18" rx="1" />
    <rect x="9" y="5" width="4" height="16" rx="1" />
    <rect x="15" y="2" width="6" height="19" rx="1" />
  </svg>
);

const GraphIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="12" r="2" />
    <circle cx="19" cy="5" r="2" />
    <circle cx="19" cy="19" r="2" />
    <circle cx="12" cy="8" r="2" />
    <line x1="7" y1="12" x2="10" y2="9" />
    <line x1="14" y1="7" x2="17" y2="6" />
    <line x1="14" y1="9" x2="17" y2="17" />
    <line x1="7" y1="12" x2="10" y2="10" />
  </svg>
);

const QuizIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="5" x2="8" y2="10" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

export default function Sidebar({ health }: SidebarProps) {
  const location = useLocation();
  const path = location.pathname;

  const navItems = [
    { to: "/", label: "Library", icon: <LibraryIcon /> },
    { to: "/graph", label: "Graph", icon: <GraphIcon /> },
    { to: "/quiz", label: "Quiz", icon: <QuizIcon /> },
    { to: "/settings", label: "Settings", icon: <SettingsIcon /> },
  ];

  const healthColor =
    health === "ok" ? "#3a8f5a" : health === "error" ? "#a63a3a" : "#b0a08b";
  const healthLabel =
    health === "loading" ? "connecting..." : health === "ok" ? "connected" : "unreachable";

  return (
    <aside style={s.sidebar}>
      {/* Logo */}
      <div style={s.logoArea}>
        <div style={s.logoMark}>P</div>
        <div>
          <div style={s.logoName}>pagenode</div>
          <div style={s.logoSub}>knowledge engine</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={s.nav}>
        <div style={s.navSection}>NAVIGATE</div>
        {navItems.map(({ to, label, icon }) => {
          const active = to === "/" ? path === "/" : path.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              style={{
                ...s.navItem,
                ...(active ? s.navItemActive : {}),
              }}
            >
              <span style={{ ...s.navIcon, color: active ? "#2b2b2b" : "#999" }}>
                {icon}
              </span>
              <span style={{ ...s.navLabel, color: active ? "#2b2b2b" : "#5e5e5e" }}>
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Status card */}
      <div style={s.statusCard}>
        <div style={s.statusHeader}>System</div>
        <div style={s.statusRow}>
          <div style={{ ...s.statusDot, background: healthColor }} />
          <span style={s.statusText}>{healthLabel}</span>
        </div>
        <div style={s.statusDivider} />
        <div style={s.statusRow}>
          <span style={s.statusKey}>Storage</span>
          <span style={s.statusVal}>local</span>
        </div>
        <div style={s.statusRow}>
          <span style={s.statusKey}>Privacy</span>
          <span style={s.statusBadge}>✓ offline</span>
        </div>
      </div>
    </aside>
  );
}

const s: Record<string, React.CSSProperties> = {
  sidebar: {
    width: "220px",
    flexShrink: 0,
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#fdfbf7",
    borderRight: "1px solid rgba(0,0,0,0.07)",
    padding: "20px 12px",
    overflowY: "auto",
  },
  logoArea: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "0 8px",
    marginBottom: "28px",
  },
  logoMark: {
    width: "34px",
    height: "34px",
    background: "#2b2b2b",
    color: "#fbf8f3",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "18px",
    fontFamily: "'Crimson Pro', serif",
    fontWeight: 700,
    flexShrink: 0,
  },
  logoName: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#2b2b2b",
    fontFamily: "'Crimson Pro', serif",
    letterSpacing: "-0.2px",
    lineHeight: 1.2,
  },
  logoSub: {
    fontSize: "9px",
    color: "#b0a08b",
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  navSection: {
    fontSize: "9px",
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase",
    letterSpacing: "1px",
    color: "#b0a08b",
    padding: "0 10px",
    marginBottom: "6px",
    marginTop: "4px",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderRadius: "6px",
    textDecoration: "none",
    transition: "background 0.12s",
    cursor: "pointer",
  },
  navItemActive: {
    background: "rgba(0,0,0,0.05)",
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
  },
  navIcon: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
  },
  navLabel: {
    fontSize: "13px",
    fontWeight: 500,
    letterSpacing: "-0.1px",
  },
  statusCard: {
    background: "#f4f0e8",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: "8px",
    padding: "12px 14px",
    marginTop: "8px",
  },
  statusHeader: {
    fontSize: "9px",
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase",
    letterSpacing: "1px",
    color: "#b0a08b",
    marginBottom: "8px",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "4px",
  },
  statusDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    marginRight: "6px",
    flexShrink: 0,
  },
  statusText: {
    fontSize: "11px",
    color: "#5e5e5e",
    fontFamily: "'JetBrains Mono', monospace",
    flex: 1,
  },
  statusDivider: {
    height: "1px",
    background: "rgba(0,0,0,0.07)",
    margin: "6px 0",
  },
  statusKey: {
    fontSize: "10px",
    color: "#999",
    fontFamily: "'JetBrains Mono', monospace",
  },
  statusVal: {
    fontSize: "10px",
    color: "#5e5e5e",
    fontFamily: "'JetBrains Mono', monospace",
  },
  statusBadge: {
    fontSize: "9px",
    fontWeight: 600,
    color: "#3a8f5a",
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase",
    letterSpacing: "0.3px",
  },
};
