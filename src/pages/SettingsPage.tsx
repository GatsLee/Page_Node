import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import ModelCard from "../components/ModelCard";
import ProgressBar from "../components/ProgressBar";

interface AvailableModel {
  id: string;
  name: string;
  param_count: string;
  file_size_mb: number;
  ram_required_gb: number;
  description: string;
  recommended: boolean;
  installed_size_bytes: number | null;
  ollama_installed: boolean;
}

interface DownloadProgress {
  status: string;
  model_name: string;
  downloaded_bytes: number;
  total_bytes: number;
  percent: number;
  speed_mbps: number;
  error: string | null;
}

interface SetupStatus {
  setup_complete: boolean;
  llm_model_id: string;
  llm_model_path: string;
}

interface SettingsPageProps {
  health: "loading" | "ok" | "error";
}

export default function SettingsPage({ health }: SettingsPageProps) {
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [modRes, statRes] = await Promise.all([
        apiFetch("/settings/models/available"),
        apiFetch("/settings/setup-status"),
      ]);
      if (modRes.ok) setModels(await modRes.json());
      if (statRes.ok) setStatus(await statRes.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (health === "ok") fetchData();
  }, [health, fetchData]);

  // Poll download progress while downloading
  useEffect(() => {
    if (!downloading) return;
    const poll = async () => {
      try {
        const res = await apiFetch("/settings/models/download/status");
        const data: DownloadProgress = await res.json();
        setProgress(data);
        if (data.status === "complete") {
          setDownloading(false);
          fetchData(); // refresh installed sizes
          return;
        }
        if (data.status === "error" || data.status === "cancelled") {
          setDownloading(false);
          return;
        }
      } catch { /* ignore */ }
      timerId = window.setTimeout(poll, 500);
    };
    let timerId: number;
    poll();
    return () => clearTimeout(timerId);
  }, [downloading, fetchData]);

  const handleDownload = async (modelId: string) => {
    setError(null);
    try {
      const res = await apiFetch("/settings/models/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || `Download start failed (${res.status})`);
      }
      setDownloading(true);
      setProgress(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  };

  const handleCancelDownload = async () => {
    await apiFetch("/settings/models/download/cancel", { method: "POST" });
  };

  const handleUseModel = async (modelId: string) => {
    setError(null);
    try {
      const res = await apiFetch("/settings/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "llm_model_id", value: modelId }),
      });
      if (!res.ok) throw new Error("Failed to switch model");
      // Also update llm_model_path
      const model = models.find((m) => m.id === modelId);
      if (model?.installed_size_bytes) {
        // Derive path from model catalog — backend will resolve on next setup-complete call
        // For now, just re-fetch status
      }
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch model");
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const activeModelId = status?.llm_model_id || "";

  return (
    <main style={s.main}>
      <h1 style={s.pageTitle}>Settings</h1>

      {error && (
        <div style={s.errorBar}>
          <span>{error}</span>
          <button style={s.errorDismiss} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Language Model section */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>Language Model</h2>
        <p style={s.sectionDesc}>
          The local LLM used for concept extraction and flashcard generation.
          Models are stored in <code style={s.code}>~/.pagenode/models/</code>.
        </p>

        {/* Download progress */}
        {downloading && progress && progress.status === "downloading" && (
          <div style={s.progressCard}>
            <p style={s.progressTitle}>Downloading {progress.model_name}…</p>
            <ProgressBar
              percent={progress.percent}
              label={`${formatBytes(progress.downloaded_bytes)} / ${formatBytes(progress.total_bytes)} — ${progress.speed_mbps.toFixed(1)} MB/s`}
            />
            <p style={s.percentText}>{progress.percent.toFixed(1)}%</p>
            <button style={s.ghostBtn} onClick={handleCancelDownload}>Cancel</button>
          </div>
        )}
        {progress?.status === "complete" && !downloading && (
          <div style={{ ...s.progressCard, background: "#f0faf4" }}>
            <span style={s.successText}>&#10003; Download complete</span>
          </div>
        )}
        {progress?.status === "error" && (
          <div style={{ ...s.progressCard, background: "#fdf0f0" }}>
            <span style={s.errorText}>Download failed: {progress.error}</span>
          </div>
        )}

        <div style={s.modelList}>
          {models.map((m) => (
            <div key={m.id} style={s.modelRow}>
              <ModelCard
                id={m.id}
                name={m.name}
                paramCount={m.param_count}
                sizeMb={m.file_size_mb}
                ramGb={m.ram_required_gb}
                description={m.description}
                recommended={m.recommended}
                selected={activeModelId === m.id}
                installedSizeBytes={m.installed_size_bytes}
                ollamaInstalled={m.ollama_installed}
                onClick={() => {
                  const available = m.installed_size_bytes !== null || m.ollama_installed;
                  if (available && m.id !== activeModelId) {
                    handleUseModel(m.id);
                  }
                }}
              />
              <div style={s.modelBtns}>
                {(m.installed_size_bytes !== null || m.ollama_installed) ? (
                  activeModelId === m.id ? (
                    <span style={s.activeLabel}>Active</span>
                  ) : (
                    <button style={s.primaryBtn} onClick={() => handleUseModel(m.id)}>
                      Use this model
                    </button>
                  )
                ) : (
                  <button
                    style={s.primaryBtn}
                    onClick={() => handleDownload(m.id)}
                    disabled={downloading}
                  >
                    Download
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  main: {
    flex: 1,
    padding: "32px 24px",
    maxWidth: "680px",
    width: "100%",
    margin: "0 auto",
  },
  pageTitle: {
    fontSize: "22px",
    fontWeight: 600,
    color: "#2b2b2b",
    margin: "0 0 32px",
  },
  errorBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    background: "#fde8e8",
    border: "1px solid #f5c6c6",
    borderRadius: "6px",
    fontSize: "12px",
    color: "#a63a3a",
    marginBottom: "16px",
  },
  errorDismiss: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "12px",
    color: "#a63a3a",
    padding: "0 4px",
  },
  section: {
    marginBottom: "40px",
  },
  sectionTitle: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#2b2b2b",
    margin: "0 0 6px",
  },
  sectionDesc: {
    fontSize: "13px",
    color: "#5e5e5e",
    margin: "0 0 20px",
    lineHeight: 1.5,
  },
  code: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "12px",
    background: "rgba(0,0,0,0.06)",
    padding: "1px 5px",
    borderRadius: "3px",
  },
  progressCard: {
    background: "#f8f8f6",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: "6px",
    padding: "16px",
    marginBottom: "16px",
  },
  progressTitle: {
    margin: "0 0 10px",
    fontSize: "13px",
    fontWeight: 600,
    color: "#2b2b2b",
  },
  percentText: {
    margin: "8px 0 12px",
    fontSize: "20px",
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', monospace",
    color: "#2b2b2b",
  },
  successText: {
    fontSize: "13px",
    color: "#155724",
    fontWeight: 600,
  },
  errorText: {
    fontSize: "13px",
    color: "#721c24",
  },
  modelList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  modelRow: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  modelBtns: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
  },
  activeLabel: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#3a8f5a",
    padding: "5px 0",
  },
  primaryBtn: {
    padding: "6px 16px",
    fontSize: "12px",
    fontWeight: 600,
    background: "#2b2b2b",
    color: "#fbf8f3",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    boxShadow: "none",
  },
  ghostBtn: {
    padding: "6px 16px",
    fontSize: "12px",
    background: "none",
    color: "#5e5e5e",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: "4px",
    cursor: "pointer",
    boxShadow: "none",
  },
};
