import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";

interface QuizPageProps {
  health: "loading" | "ok" | "error";
}

interface Flashcard {
  id: string;
  document_id: string;
  chunk_id: string | null;
  question: string;
  answer: string;
  difficulty: number;
  interval: number;
  repetitions: number;
  next_review: string | null;
  created_at: string;
  updated_at: string;
}

interface FlashcardList {
  items: Flashcard[];
  total: number;
}

interface QuizStats {
  total_cards: number;
  due_today: number;
  per_doc: { doc_id: string; title: string; total: number; due: number }[];
}

const GRADE_LABELS = ["Again", "Hard", "Good", "Easy"] as const;
const GRADE_COLORS = ["#c0392b", "#d35400", "#27ae60", "#2980b9"] as const;
const GRADE_BG = [
  "rgba(192,57,43,0.08)",
  "rgba(211,84,0,0.08)",
  "rgba(39,174,96,0.08)",
  "rgba(41,128,185,0.08)",
] as const;

export default function QuizPage({ health }: QuizPageProps) {
  const [tab, setTab] = useState<"quiz" | "dashboard">("quiz");

  // --- Quiz tab state ---
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);

  // --- Dashboard tab state ---
  const [stats, setStats] = useState<QuizStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const loadDueCards = useCallback(async () => {
    setQuizLoading(true);
    setQuizError(null);
    try {
      const res = await apiFetch("/quiz/due?limit=50");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: FlashcardList = await res.json();
      setCards(data.items);
      setCurrent(0);
      setFlipped(false);
      setSessionReviewed(0);
      setSessionCorrect(0);
      setSessionDone(false);
    } catch (e) {
      setQuizError("Failed to load cards.");
    } finally {
      setQuizLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await apiFetch("/quiz/stats");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: QuizStats = await res.json();
      setStats(data);
    } catch {
      // fail silently
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Load due cards when quiz tab is shown
  useEffect(() => {
    if (health !== "ok") return;
    if (tab === "quiz" && cards.length === 0 && !sessionDone && !quizLoading) {
      loadDueCards();
    }
    if (tab === "dashboard") {
      loadStats();
    }
  }, [tab, health]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFlip = () => {
    if (!flipped) setFlipped(true);
  };

  const handleGrade = async (grade: 0 | 1 | 2 | 3) => {
    const card = cards[current];
    if (!card) return;

    try {
      await apiFetch(`/quiz/${card.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade }),
      });
    } catch {
      // best-effort; advance anyway
    }

    const isCorrect = grade >= 2;
    const newReviewed = sessionReviewed + 1;
    const newCorrect = sessionCorrect + (isCorrect ? 1 : 0);
    setSessionReviewed(newReviewed);
    setSessionCorrect(newCorrect);

    if (current + 1 >= cards.length) {
      setSessionDone(true);
    } else {
      setCurrent(current + 1);
      setFlipped(false);
    }
  };

  const handleRestart = () => {
    loadDueCards();
  };

  const card = cards[current] ?? null;

  // ---- Render ----

  const renderTabBar = () => (
    <div style={s.tabBar}>
      {(["quiz", "dashboard"] as const).map((t) => (
        <button
          key={t}
          style={{ ...s.tabBtn, ...(tab === t ? s.tabBtnActive : {}) }}
          onClick={() => setTab(t)}
        >
          {t === "quiz" ? "Quiz" : "Dashboard"}
        </button>
      ))}
    </div>
  );

  const renderQuizTab = () => {
    if (health !== "ok") {
      return <div style={s.emptyMsg}>Backend not connected.</div>;
    }
    if (quizLoading) {
      return <div style={s.emptyMsg}>Loading cards…</div>;
    }
    if (quizError) {
      return (
        <div style={s.emptyMsg}>
          {quizError}{" "}
          <button style={s.linkBtn} onClick={loadDueCards}>
            Retry
          </button>
        </div>
      );
    }
    if (sessionDone) {
      const pct =
        sessionReviewed > 0
          ? Math.round((sessionCorrect / sessionReviewed) * 100)
          : 0;
      return (
        <div style={s.summaryBox}>
          <div style={s.summaryCheck}>✓</div>
          <div style={s.summaryTitle}>Session complete</div>
          <div style={s.summaryStats}>
            <span style={s.summaryPill}>{sessionReviewed} reviewed</span>
            <span style={s.summaryDot}>•</span>
            <span style={s.summaryPill}>{sessionCorrect} correct</span>
            <span style={s.summaryDot}>•</span>
            <span style={s.summaryPill}>{pct}% accuracy</span>
          </div>
          <div style={s.summaryActions}>
            <button style={s.primaryBtn} onClick={handleRestart}>
              Review Again
            </button>
            <button style={s.secondaryBtn} onClick={() => setTab("dashboard")}>
              Go to Dashboard
            </button>
          </div>
        </div>
      );
    }
    if (cards.length === 0) {
      return (
        <div style={s.summaryBox}>
          <div style={s.summaryCheck} role="img" aria-label="all done">
            ◎
          </div>
          <div style={s.summaryTitle}>All caught up!</div>
          <div style={s.emptySubtext}>No cards due for review right now.</div>
          <button
            style={{ ...s.secondaryBtn, marginTop: "16px" }}
            onClick={() => setTab("dashboard")}
          >
            View All Cards
          </button>
        </div>
      );
    }

    return (
      <div style={s.quizArea}>
        {/* Progress bar */}
        <div style={s.progressRow}>
          <span style={s.progressLabel}>
            Card {current + 1} of {cards.length}
          </span>
          <button style={s.quitBtn} onClick={() => setSessionDone(true)}>
            ✕ Quit
          </button>
        </div>
        <div style={s.progressTrack}>
          <div
            style={{
              ...s.progressFill,
              width: `${(current / cards.length) * 100}%`,
            }}
          />
        </div>

        {/* Card */}
        <div style={s.cardWrap}>
          <div
            style={{ ...s.card, cursor: flipped ? "default" : "pointer" }}
            onClick={handleFlip}
          >
            {!flipped ? (
              <div style={s.cardFront}>
                <div style={s.cardQuestion}>{card.question}</div>
                <div style={s.cardHint}>tap to reveal answer</div>
              </div>
            ) : (
              <div style={s.cardBack}>
                <div style={s.cardQSmall}>Q: {card.question}</div>
                <div style={s.cardAnswer}>{card.answer}</div>
              </div>
            )}
          </div>
        </div>

        {/* Show Answer button or grade buttons */}
        {!flipped ? (
          <button style={s.showAnswerBtn} onClick={handleFlip}>
            Show Answer
          </button>
        ) : (
          <div style={s.gradeRow}>
            {([0, 1, 2, 3] as const).map((g) => (
              <button
                key={g}
                style={{
                  ...s.gradeBtn,
                  color: GRADE_COLORS[g],
                  background: GRADE_BG[g],
                  borderColor: `${GRADE_COLORS[g]}44`,
                }}
                onClick={() => handleGrade(g)}
              >
                {GRADE_LABELS[g]}
              </button>
            ))}
          </div>
        )}

        {/* Interval hint */}
        {flipped && (
          <div style={s.intervalHint}>
            Again → tomorrow &nbsp;·&nbsp; Hard → {card.interval}d &nbsp;·&nbsp; Good → {Math.max(1, Math.round(card.interval * (2.5 - card.difficulty * 1.2)))}d &nbsp;·&nbsp; Easy → {Math.max(1, Math.round(card.interval * (2.5 - card.difficulty * 1.2) * 1.3))}d
          </div>
        )}
      </div>
    );
  };

  const renderDashboard = () => {
    if (statsLoading || stats === null) {
      return <div style={s.emptyMsg}>Loading stats…</div>;
    }

    return (
      <div style={s.dashArea}>
        {/* Due today hero */}
        <div style={s.dueHero}>
          <div style={s.dueNum}>{stats.due_today}</div>
          <div style={s.dueLabel}>cards due today</div>
          {stats.due_today > 0 && (
            <button
              style={{ ...s.primaryBtn, marginTop: "14px" }}
              onClick={() => {
                setTab("quiz");
                loadDueCards();
              }}
            >
              Start Quiz
            </button>
          )}
        </div>

        {/* Per-document table */}
        {stats.per_doc.length > 0 ? (
          <div style={s.tableWrap}>
            <div style={s.tableTitle}>By Document</div>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Document</th>
                  <th style={{ ...s.th, textAlign: "right" }}>Total</th>
                  <th style={{ ...s.th, textAlign: "right" }}>Due</th>
                </tr>
              </thead>
              <tbody>
                {stats.per_doc.map((row) => (
                  <tr key={row.doc_id} style={s.tr}>
                    <td style={s.td}>{row.title}</td>
                    <td style={{ ...s.td, textAlign: "right", color: "#5e5e5e" }}>
                      {row.total}
                    </td>
                    <td
                      style={{
                        ...s.td,
                        textAlign: "right",
                        color: row.due > 0 ? "#c0392b" : "#3a8f5a",
                        fontWeight: row.due > 0 ? 600 : 400,
                      }}
                    >
                      {row.due}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={s.emptySubtext}>
            No flashcards yet. Upload a PDF and wait for concept extraction to
            generate cards.
          </div>
        )}

        {stats.total_cards > 0 && (
          <div style={s.totalNote}>
            {stats.total_cards} total cards across {stats.per_doc.length}{" "}
            document{stats.per_doc.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headerTitle}>Quiz</div>
        <div style={s.headerSub}>Spaced repetition review</div>
      </div>
      {renderTabBar()}
      <div style={s.content}>
        {tab === "quiz" ? renderQuizTab() : renderDashboard()}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#fbf8f3",
    overflow: "hidden",
  },
  header: {
    padding: "24px 32px 0",
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: "22px",
    fontWeight: 700,
    color: "#2b2b2b",
    fontFamily: "'Crimson Pro', serif",
    letterSpacing: "-0.3px",
    lineHeight: 1.2,
  },
  headerSub: {
    fontSize: "11px",
    color: "#b0a08b",
    fontFamily: "'JetBrains Mono', monospace",
    marginTop: "3px",
    letterSpacing: "0.2px",
  },
  tabBar: {
    display: "flex",
    gap: "4px",
    padding: "16px 32px 0",
    flexShrink: 0,
    borderBottom: "1px solid rgba(0,0,0,0.07)",
    marginBottom: "0",
  },
  tabBtn: {
    padding: "7px 16px",
    borderRadius: "6px 6px 0 0",
    border: "1px solid transparent",
    borderBottom: "none",
    background: "transparent",
    color: "#5e5e5e",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    transition: "background 0.12s",
    marginBottom: "-1px",
  },
  tabBtnActive: {
    background: "#fbf8f3",
    color: "#2b2b2b",
    border: "1px solid rgba(0,0,0,0.07)",
    borderBottom: "1px solid #fbf8f3",
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: "32px",
  },
  // --- Quiz tab ---
  quizArea: {
    maxWidth: "580px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  progressRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: {
    fontSize: "12px",
    color: "#999",
    fontFamily: "'JetBrains Mono', monospace",
  },
  quitBtn: {
    background: "none",
    border: "none",
    color: "#b0a08b",
    fontSize: "12px",
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    padding: "2px 6px",
  },
  progressTrack: {
    height: "3px",
    background: "rgba(0,0,0,0.08)",
    borderRadius: "2px",
    overflow: "hidden",
    marginBottom: "8px",
  },
  progressFill: {
    height: "100%",
    background: "#2b2b2b",
    borderRadius: "2px",
    transition: "width 0.3s ease",
  },
  cardWrap: {
    perspective: "800px",
  },
  card: {
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.1)",
    borderRadius: "10px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.07)",
    minHeight: "200px",
    padding: "32px 36px",
    display: "flex",
    alignItems: "stretch",
    userSelect: "none" as React.CSSProperties["userSelect"],
    transition: "box-shadow 0.15s",
  },
  cardFront: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    gap: "20px",
    width: "100%",
  },
  cardQuestion: {
    fontSize: "20px",
    fontFamily: "'Crimson Pro', serif",
    color: "#2b2b2b",
    lineHeight: 1.5,
    fontWeight: 600,
  },
  cardHint: {
    fontSize: "11px",
    color: "#b0a08b",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.3px",
  },
  cardBack: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "100%",
  },
  cardQSmall: {
    fontSize: "11px",
    color: "#b0a08b",
    fontFamily: "'JetBrains Mono', monospace",
    borderBottom: "1px solid rgba(0,0,0,0.07)",
    paddingBottom: "10px",
    lineHeight: 1.5,
  },
  cardAnswer: {
    fontSize: "16px",
    color: "#2b2b2b",
    lineHeight: 1.7,
    fontFamily: "'Inter', sans-serif",
  },
  showAnswerBtn: {
    alignSelf: "center",
    padding: "10px 28px",
    background: "#2b2b2b",
    color: "#fbf8f3",
    border: "none",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    letterSpacing: "0.1px",
  },
  gradeRow: {
    display: "flex",
    gap: "10px",
    justifyContent: "center",
    flexWrap: "wrap" as React.CSSProperties["flexWrap"],
  },
  gradeBtn: {
    padding: "9px 22px",
    border: "1px solid",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    transition: "opacity 0.1s",
    minWidth: "72px",
  },
  intervalHint: {
    textAlign: "center" as React.CSSProperties["textAlign"],
    fontSize: "10px",
    color: "#b0a08b",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.2px",
  },
  // --- Summary / empty states ---
  emptyMsg: {
    textAlign: "center" as React.CSSProperties["textAlign"],
    color: "#b0a08b",
    fontSize: "13px",
    fontFamily: "'JetBrains Mono', monospace",
    paddingTop: "60px",
  },
  emptySubtext: {
    textAlign: "center" as React.CSSProperties["textAlign"],
    color: "#b0a08b",
    fontSize: "12px",
    fontFamily: "'JetBrains Mono', monospace",
    marginTop: "8px",
  },
  summaryBox: {
    maxWidth: "420px",
    margin: "40px auto 0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
    textAlign: "center" as React.CSSProperties["textAlign"],
  },
  summaryCheck: {
    fontSize: "36px",
    color: "#3a8f5a",
    lineHeight: 1,
    marginBottom: "4px",
  },
  summaryTitle: {
    fontSize: "20px",
    fontFamily: "'Crimson Pro', serif",
    fontWeight: 600,
    color: "#2b2b2b",
  },
  summaryStats: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap" as React.CSSProperties["flexWrap"],
    justifyContent: "center",
    marginTop: "4px",
  },
  summaryPill: {
    fontSize: "12px",
    color: "#5e5e5e",
    fontFamily: "'JetBrains Mono', monospace",
    background: "rgba(0,0,0,0.04)",
    border: "1px solid rgba(0,0,0,0.07)",
    borderRadius: "4px",
    padding: "3px 8px",
  },
  summaryDot: {
    color: "#b0a08b",
    fontSize: "12px",
  },
  summaryActions: {
    display: "flex",
    gap: "10px",
    marginTop: "16px",
    flexWrap: "wrap" as React.CSSProperties["flexWrap"],
    justifyContent: "center",
  },
  primaryBtn: {
    padding: "10px 24px",
    background: "#2b2b2b",
    color: "#fbf8f3",
    border: "none",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  secondaryBtn: {
    padding: "10px 24px",
    background: "transparent",
    color: "#5e5e5e",
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#2b2b2b",
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "12px",
    textDecoration: "underline",
    padding: 0,
  },
  // --- Dashboard ---
  dashArea: {
    maxWidth: "560px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  dueHero: {
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.09)",
    borderRadius: "10px",
    padding: "28px 32px",
    textAlign: "center" as React.CSSProperties["textAlign"],
    boxShadow: "0 1px 8px rgba(0,0,0,0.05)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  dueNum: {
    fontSize: "56px",
    fontWeight: 700,
    color: "#2b2b2b",
    fontFamily: "'Crimson Pro', serif",
    lineHeight: 1,
  },
  dueLabel: {
    fontSize: "12px",
    color: "#b0a08b",
    fontFamily: "'JetBrains Mono', monospace",
    marginTop: "6px",
    letterSpacing: "0.3px",
  },
  tableWrap: {
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.09)",
    borderRadius: "10px",
    overflow: "hidden",
    boxShadow: "0 1px 8px rgba(0,0,0,0.05)",
  },
  tableTitle: {
    fontSize: "9px",
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase" as React.CSSProperties["textTransform"],
    letterSpacing: "1px",
    color: "#b0a08b",
    padding: "14px 18px 8px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as React.CSSProperties["borderCollapse"],
    fontSize: "13px",
  },
  th: {
    padding: "6px 18px 10px",
    textAlign: "left" as React.CSSProperties["textAlign"],
    fontSize: "10px",
    color: "#999",
    fontWeight: 500,
    fontFamily: "'JetBrains Mono', monospace",
    borderBottom: "1px solid rgba(0,0,0,0.06)",
  },
  tr: {
    borderBottom: "1px solid rgba(0,0,0,0.04)",
  },
  td: {
    padding: "10px 18px",
    color: "#2b2b2b",
    fontSize: "13px",
    verticalAlign: "middle" as React.CSSProperties["verticalAlign"],
  },
  totalNote: {
    fontSize: "11px",
    color: "#b0a08b",
    fontFamily: "'JetBrains Mono', monospace",
    textAlign: "center" as React.CSSProperties["textAlign"],
    marginTop: "-8px",
  },
};
