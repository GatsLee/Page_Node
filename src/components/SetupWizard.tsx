import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import ModelCard from "./ModelCard";
import ProgressBar from "./ProgressBar";

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

interface SetupWizardProps {
  onComplete: () => void;
}

// Steps: 0=Welcome, 1=Model, 2=Download, 3=Embeddings, 4=Done
const STEP_LABELS = ["Welcome", "Model", "Download", "AI Tools", "Done"];

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [embeddingReady, setEmbeddingReady] = useState(false);

  const fetchModels = useCallback(async () => {
    try {
      const res = await apiFetch("/settings/models/available");
      const data: AvailableModel[] = await res.json();
      setModels(data);
      const recommended = data.find((m) => m.recommended);
      if (recommended) setSelectedModel(recommended.id);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Poll download progress when on step 2
  useEffect(() => {
    if (step !== 2) return;
    const poll = async () => {
      try {
        const res = await apiFetch("/settings/models/download/status");
        const data: DownloadProgress = await res.json();
        setProgress(data);
        if (data.status === "complete" || data.status === "error" || data.status === "cancelled") {
          return; // stop polling
        }
      } catch { /* ignore */ }
      timerId = window.setTimeout(poll, 500);
    };
    let timerId: number;
    poll();
    return () => clearTimeout(timerId);
  }, [step]);

  // Trigger embedding warm-up when entering step 3
  useEffect(() => {
    if (step !== 3) return;
    setEmbeddingReady(false);
    apiFetch("/settings/warm-embeddings", { method: "POST" })
      .then(() => setEmbeddingReady(true))
      .catch(() => setEmbeddingReady(true)); // proceed even on error
  }, [step]);

  const startDownload = async () => {
    setStep(2);
    setProgress(null);
    await apiFetch("/settings/models/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_id: selectedModel }),
    });
  };

  const handleSkip = () => {
    setStep(3); // skip download, still warm up embeddings
  };

  const handleFinish = async () => {
    // setup-complete endpoint derives and persists the model path server-side
    await apiFetch("/settings/setup-complete", { method: "POST" });
    onComplete();
  };

  const handleCancel = async () => {
    await apiFetch("/settings/models/download/cancel", { method: "POST" });
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div style={s.container}>
      <div style={s.wizard}>
        {/* Step indicator */}
        <div style={s.steps}>
          {STEP_LABELS.map((label, i) => (
            <div key={label} style={s.stepItem}>
              <div
                style={{
                  ...s.stepDot,
                  background: i <= step ? "#2b2b2b" : "rgba(0,0,0,0.12)",
                }}
              />
              <span
                style={{
                  ...s.stepLabel,
                  color: i <= step ? "#2b2b2b" : "#999",
                }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div style={s.content}>
            <div style={s.logoRow}>
              <div style={s.logoMark}>P</div>
              <span style={s.logoText}>PageNode</span>
            </div>
            <h2 style={s.heading}>Welcome to PageNode</h2>
            <p style={s.body}>
              PageNode is a local-first learning tool. Your documents, notes, and
              knowledge graph stay on your machine — no cloud, no accounts, no internet
              required after setup.
            </p>
            <p style={s.body}>
              To power AI features like concept extraction and flashcard generation,
              we'll download a small language model to run locally on your computer.
            </p>
            <button style={s.primaryBtn} onClick={() => setStep(1)}>
              Get Started
            </button>
          </div>
        )}

        {/* Step 1: Model Selection */}
        {step === 1 && (
          <div style={s.content}>
            <h2 style={s.heading}>Choose a Model</h2>
            <p style={s.body}>
              Select a language model based on your machine's capabilities.
              Larger models produce better results but need more RAM.
            </p>
            <div style={s.modelList}>
              {models.map((m) => (
                <ModelCard
                  key={m.id}
                  id={m.id}
                  name={m.name}
                  paramCount={m.param_count}
                  sizeMb={m.file_size_mb}
                  ramGb={m.ram_required_gb}
                  description={m.description}
                  recommended={m.recommended}
                  selected={selectedModel === m.id}
                  installedSizeBytes={m.installed_size_bytes}
                  ollamaInstalled={m.ollama_installed}
                  onClick={() => setSelectedModel(m.id)}
                />
              ))}
            </div>
            <div style={s.actions}>
              <button style={s.ghostBtn} onClick={handleSkip}>
                Skip for now
              </button>
              {(() => {
                const sel = models.find((m) => m.id === selectedModel);
                const alreadyAvailable =
                  sel && (sel.installed_size_bytes !== null || sel.ollama_installed);
                return (
                  <button
                    style={s.primaryBtn}
                    onClick={alreadyAvailable ? handleSkip : startDownload}
                    disabled={!selectedModel}
                  >
                    {alreadyAvailable ? "Use & Continue" : "Download & Continue"}
                  </button>
                );
              })()}
            </div>
          </div>
        )}

        {/* Step 2: Download Progress */}
        {step === 2 && (
          <div style={s.content}>
            <h2 style={s.heading}>Downloading Model</h2>
            {progress && progress.status === "downloading" && (
              <>
                <p style={s.modelName}>{progress.model_name}</p>
                <ProgressBar
                  percent={progress.percent}
                  label={`${formatBytes(progress.downloaded_bytes)} / ${formatBytes(progress.total_bytes)} — ${progress.speed_mbps.toFixed(1)} MB/s`}
                />
                <p style={s.percentText}>{progress.percent.toFixed(1)}%</p>
                <button style={s.ghostBtn} onClick={handleCancel}>
                  Cancel
                </button>
              </>
            )}
            {progress && progress.status === "complete" && (
              <>
                <p style={s.successIcon}>&#10003;</p>
                <p style={s.body}>
                  <strong>{progress.model_name}</strong> downloaded successfully.
                </p>
                <button style={s.primaryBtn} onClick={() => setStep(3)}>
                  Continue
                </button>
              </>
            )}
            {progress && progress.status === "error" && (
              <>
                <p style={s.errorText}>Download failed: {progress.error}</p>
                <div style={s.actions}>
                  <button style={s.ghostBtn} onClick={() => setStep(1)}>
                    Choose Another
                  </button>
                  <button style={s.primaryBtn} onClick={startDownload}>
                    Retry
                  </button>
                </div>
              </>
            )}
            {progress && progress.status === "cancelled" && (
              <>
                <p style={s.body}>Download cancelled.</p>
                <div style={s.actions}>
                  <button style={s.ghostBtn} onClick={handleSkip}>
                    Skip for now
                  </button>
                  <button style={s.primaryBtn} onClick={() => setStep(1)}>
                    Choose Another
                  </button>
                </div>
              </>
            )}
            {(!progress || progress.status === "idle") && (
              <p style={s.body}>Starting download...</p>
            )}
          </div>
        )}

        {/* Step 3: Embedding model warm-up */}
        {step === 3 && (
          <div style={s.content}>
            <h2 style={s.heading}>Preparing AI Tools</h2>
            {!embeddingReady ? (
              <>
                <p style={s.body}>
                  Downloading the embedding model used to search your documents…
                </p>
                <ProgressBar percent={0} label="all-MiniLM-L6-v2 (~90 MB)" />
              </>
            ) : (
              <>
                <p style={s.successIcon}>&#10003;</p>
                <p style={s.body}>Embedding model ready.</p>
                <button style={s.primaryBtn} onClick={() => setStep(4)}>
                  Continue
                </button>
              </>
            )}
          </div>
        )}

        {/* Step 4: Done */}
        {step === 4 && (
          <div style={s.content}>
            <p style={s.successIcon}>&#10003;</p>
            <h2 style={s.heading}>You're All Set</h2>
            <p style={s.body}>
              PageNode is ready to use. Upload a PDF to get started with your
              personal knowledge library.
            </p>
            <button style={s.primaryBtn} onClick={handleFinish}>
              Start Using PageNode
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
  wizard: {
    width: "100%",
    maxWidth: "520px",
  },
  steps: {
    display: "flex",
    justifyContent: "center",
    gap: "18px",
    marginBottom: "32px",
  },
  stepItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
  },
  stepDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    transition: "background 0.2s",
  },
  stepLabel: {
    fontSize: "10px",
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    transition: "color 0.2s",
  },
  content: {
    textAlign: "center",
  },
  logoRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    marginBottom: "16px",
  },
  logoMark: {
    width: "40px",
    height: "40px",
    background: "#2b2b2b",
    color: "#fbf8f3",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "20px",
    fontFamily: "'Crimson Pro', serif",
    fontWeight: 700,
  },
  logoText: {
    fontSize: "22px",
    fontWeight: 600,
    color: "#2b2b2b",
    letterSpacing: "-0.3px",
  },
  heading: {
    fontSize: "20px",
    fontWeight: 600,
    color: "#2b2b2b",
    margin: "0 0 12px",
  },
  body: {
    fontSize: "14px",
    color: "#5e5e5e",
    lineHeight: 1.6,
    margin: "0 0 16px",
  },
  modelList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    textAlign: "left",
    margin: "16px 0",
  },
  modelName: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#2b2b2b",
    margin: "0 0 12px",
  },
  percentText: {
    fontSize: "24px",
    fontWeight: 600,
    color: "#2b2b2b",
    margin: "12px 0 16px",
    fontFamily: "'JetBrains Mono', monospace",
  },
  successIcon: {
    fontSize: "48px",
    color: "#3a8f5a",
    margin: "0 0 8px",
  },
  errorText: {
    fontSize: "13px",
    color: "#c0392b",
    margin: "0 0 16px",
  },
  actions: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    marginTop: "8px",
  },
  primaryBtn: {
    padding: "10px 24px",
    fontSize: "13px",
    fontWeight: 600,
    background: "#2b2b2b",
    color: "#fbf8f3",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    boxShadow: "none",
  },
  ghostBtn: {
    padding: "10px 24px",
    fontSize: "13px",
    fontWeight: 500,
    background: "none",
    color: "#5e5e5e",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: "6px",
    cursor: "pointer",
    boxShadow: "none",
  },
};
