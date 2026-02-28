import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { apiFetch } from "./api";
import Sidebar from "./components/Sidebar";
import SetupWizard from "./components/SetupWizard";
import LibraryPage from "./pages/LibraryPage";
import GraphPage from "./pages/GraphPage";
import QuizPage from "./pages/QuizPage";
import SettingsPage from "./pages/SettingsPage";

type HealthStatus = "loading" | "ok" | "error";

export default function App() {
  const [health, setHealth] = useState<HealthStatus>("loading");
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);

  useEffect(() => {
    apiFetch("/health")
      .then((r) => r.json())
      .then(() => setHealth("ok"))
      .catch(() => setHealth("error"));
  }, []);

  useEffect(() => {
    if (health !== "ok") return;
    apiFetch("/settings/setup-status")
      .then((r) => r.json())
      .then((data: { setup_complete: boolean }) => setSetupComplete(data.setup_complete))
      .catch(() => setSetupComplete(true));
  }, [health]);

  // Loading / backend error splash
  if (health !== "ok" || setupComplete === null) {
    return (
      <div style={s.splash}>
        <div style={s.splashLogoMark}>P</div>
        <span style={s.splashText}>
          {health === "error" ? "Backend unreachable" : "Connecting..."}
        </span>
      </div>
    );
  }

  // First-run wizard (full screen, no sidebar)
  if (!setupComplete) {
    return (
      <div style={s.wizardRoot}>
        <SetupWizard onComplete={() => setSetupComplete(true)} />
      </div>
    );
  }

  // Normal app: sidebar + main
  return (
    <div style={s.root}>
      <Sidebar health={health} />
      <div style={s.main}>
        <Routes>
          <Route path="/" element={<LibraryPage health={health} />} />
          <Route path="/graph" element={<GraphPage health={health} />} />
          <Route path="/quiz" element={<QuizPage health={health} />} />
          <Route path="/settings" element={<SettingsPage health={health} />} />
        </Routes>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
    background: "#fbf8f3",
    fontFamily: "'Inter', sans-serif",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  },
  wizardRoot: {
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#fbf8f3",
    fontFamily: "'Inter', sans-serif",
  },
  splash: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    background: "#fbf8f3",
    fontFamily: "'Inter', sans-serif",
  },
  splashLogoMark: {
    width: "48px",
    height: "48px",
    background: "#2b2b2b",
    color: "#fbf8f3",
    borderRadius: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "24px",
    fontFamily: "'Crimson Pro', serif",
    fontWeight: 700,
  },
  splashText: {
    fontSize: "12px",
    color: "#b0a08b",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.3px",
  },
};
