import { useCallback, useEffect, useRef, useState } from "react";
import cytoscape, { type Core, type EventObject } from "cytoscape";
import { apiFetch } from "../api";
import ConceptModal from "../components/ConceptModal";
import RelationshipModal from "../components/RelationshipModal";

interface CytoscapeNodeData {
  id: string;
  label: string;
  category: string;
  mastery: number;
  source_doc_id?: string;
}

interface CytoscapeEdgeData {
  id: string;
  source: string;
  target: string;
  label: string;
  type: string;
}

interface SubgraphResponse {
  nodes: { data: CytoscapeNodeData }[];
  edges: { data: CytoscapeEdgeData }[];
}

interface SelectedNode {
  id: string;
  label: string;
  category: string;
  mastery: number;
  description?: string;
  source_doc_id?: string;
}

interface GraphPageProps {
  health: "loading" | "ok" | "error";
}

const CATEGORY_COLORS: Record<string, string> = {
  programming: "#4a90d9",
  mathematics: "#5aab61",
  science: "#b07d4b",
  engineering: "#9b59b6",
  general: "#7f8c8d",
};

export default function GraphPage({ health }: GraphPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const [conceptModal, setConceptModal] = useState(false);
  const [relModal, setRelModal] = useState(false);
  const [concepts, setConcepts] = useState<{ id: string; name: string }[]>([]);
  const [isEmpty, setIsEmpty] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [hasExtracting, setHasExtracting] = useState(false);

  const fetchGraph = useCallback(async () => {
    try {
      const res = await apiFetch("/graph/subgraph");
      if (!res.ok) throw new Error(`Graph load failed (${res.status})`);
      const data: SubgraphResponse = await res.json();
      const cy = cyRef.current;
      if (!cy) return;

      cy.elements().remove();
      setIsEmpty(data.nodes.length === 0);

      for (const n of data.nodes) {
        const size = 30 + n.data.mastery * 40;
        const isExtracted = !!n.data.source_doc_id;
        cy.add({
          group: "nodes",
          data: { ...n.data },
          style: {
            width: size,
            height: size,
            "background-color": CATEGORY_COLORS[n.data.category] || CATEGORY_COLORS.general,
            "border-width": isExtracted ? 3 : 2,
            "border-color": isExtracted ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.1)",
          },
        });
      }

      for (const e of data.edges) {
        cy.add({
          group: "edges",
          data: {
            id: e.data.id,
            source: e.data.source,
            target: e.data.target,
            label: e.data.label,
            type: e.data.type,
          },
        });
      }

      if (data.nodes.length > 0) {
        cy.layout({
          name: "cose",
          animate: true,
          animationDuration: 500,
          nodeRepulsion: () => 8000,
          idealEdgeLength: () => 120,
          gravity: 0.25,
        } as cytoscape.LayoutOptions).run();
      }

      // Check if any documents are still in concept extraction phase
      try {
        const docsRes = await apiFetch("/documents/?limit=100");
        if (docsRes.ok) {
          const docsData = await docsRes.json();
          setHasExtracting(
            docsData.items.some((d: { status: string }) => d.status === "extracting_concepts")
          );
        }
      } catch { /* ignore */ }
    } catch (e) {
      setGraphError(e instanceof Error ? e.message : "Failed to load graph");
    }
  }, []);

  const fetchConceptList = useCallback(async () => {
    try {
      const res = await apiFetch("/graph/concepts");
      if (!res.ok) return;
      const data = await res.json();
      setConcepts(data.items.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
    } catch {
      /* ignore */
    }
  }, []);

  // Apply search + category filter to Cytoscape
  const applyFilter = useCallback((query: string, category: string | null) => {
    const cy = cyRef.current;
    if (!cy) return;
    // Reset all visibility
    cy.elements().style("display", "element");
    if (!query && !category) return;
    cy.nodes().forEach((node) => {
      const labelMatch = !query || node.data("label").toLowerCase().includes(query.toLowerCase());
      const catMatch = !category || node.data("category") === category;
      if (!labelMatch || !catMatch) {
        node.style("display", "none");
        node.connectedEdges().style("display", "none");
      }
    });
  }, []);

  useEffect(() => {
    applyFilter(searchQuery, activeCategory);
  }, [searchQuery, activeCategory, applyFilter]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-valign": "bottom",
            "text-margin-y": 5,
            "font-size": 11,
            "font-family": "'Inter', sans-serif",
            color: "#2b2b2b",
            "text-outline-width": 2,
            "text-outline-color": "#fbf8f3",
            "border-width": 2,
            "border-color": "rgba(0,0,0,0.1)",
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 3,
            "border-color": "#2b2b2b",
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#bbb",
            "target-arrow-color": "#bbb",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(label)",
            "font-size": 9,
            color: "#999",
            "text-rotation": "autorotate",
            "text-margin-y": -8,
          },
        },
        {
          selector: "edge[type = 'PREREQUISITE_OF']",
          style: {
            "line-style": "dashed",
            "line-color": "#c0392b",
            "target-arrow-color": "#c0392b",
          },
        },
      ],
      layout: { name: "preset" },
      minZoom: 0.3,
      maxZoom: 3,
    });

    cy.on("tap", "node", async (evt: EventObject) => {
      const node = evt.target;
      const d = node.data();
      try {
        const res = await apiFetch(`/graph/concepts/${d.id}`);
        const full = await res.json();
        setSelected({
          id: d.id,
          label: d.label,
          category: d.category,
          mastery: d.mastery,
          description: full.description,
          source_doc_id: d.source_doc_id,
        });
      } catch {
        setSelected({
          id: d.id, label: d.label, category: d.category, mastery: d.mastery,
          source_doc_id: d.source_doc_id,
        });
      }
    });

    cy.on("tap", (evt: EventObject) => {
      if (evt.target === cy) setSelected(null);
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Load graph when health is ok
  useEffect(() => {
    if (health === "ok") {
      fetchGraph();
      fetchConceptList();
    }
  }, [health, fetchGraph, fetchConceptList]);

  // Auto-refresh when concept extraction is in progress
  useEffect(() => {
    if (!hasExtracting) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch("/documents/?limit=100");
        if (!res.ok) return;
        const data = await res.json();
        const stillExtracting = data.items.some(
          (d: { status: string }) => d.status === "extracting_concepts"
        );
        if (!stillExtracting) {
          setHasExtracting(false);
          fetchGraph();
          fetchConceptList();
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [hasExtracting, fetchGraph, fetchConceptList]);

  const handleSeed = async () => {
    try {
      const res = await apiFetch("/graph/seed", { method: "POST" });
      if (!res.ok) throw new Error(`Seed failed (${res.status})`);
      setGraphError(null);
      await fetchGraph();
      await fetchConceptList();
    } catch (e) {
      setGraphError(e instanceof Error ? e.message : "Seed failed");
    }
  };

  const handleDeleteConcept = async (id: string) => {
    try {
      const res = await apiFetch(`/graph/concepts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setSelected(null);
      setGraphError(null);
      await fetchGraph();
      await fetchConceptList();
    } catch (e) {
      setGraphError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handleAddConcept = async (data: { name: string; description: string; category: string }) => {
    const res = await apiFetch("/graph/concepts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create concept (${res.status})`);
    setGraphError(null);
    await fetchGraph();
    await fetchConceptList();
  };

  const handleAddRelationship = async (data: {
    from_id: string;
    to_id: string;
    rel_type: string;
    relation_type: string;
    weight: number;
  }) => {
    const res = await apiFetch("/graph/relationships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create relationship (${res.status})`);
    setGraphError(null);
    await fetchGraph();
  };

  return (
    <div style={s.page}>
      {/* Error bar */}
      {graphError && (
        <div style={s.errorBar}>
          <span>{graphError}</span>
          <button style={s.errorDismiss} onClick={() => setGraphError(null)}>✕</button>
        </div>
      )}

      {/* Toolbar */}
      <div style={s.toolbar}>
        <button style={s.toolBtn} onClick={() => setConceptModal(true)}>+ Concept</button>
        <button style={s.toolBtn} onClick={() => { fetchConceptList(); setRelModal(true); }}>+ Relationship</button>
        <button style={s.toolBtnSeed} onClick={handleSeed}>Seed Test Data</button>
        <button style={s.toolBtnSeed} onClick={() => { fetchGraph(); fetchConceptList(); }}>↻ Refresh</button>
        {hasExtracting && (
          <span style={s.extractingBadge}>● extracting concepts…</span>
        )}

        {/* Search */}
        <input
          style={s.searchInput}
          type="text"
          placeholder="Search concepts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {/* Category filter chips */}
        <div style={s.filterChips}>
          <button
            style={{ ...s.chip, ...(activeCategory === null ? s.chipActive : {}) }}
            onClick={() => setActiveCategory(null)}
          >
            All
          </button>
          {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
            <button
              key={cat}
              style={{
                ...s.chip,
                ...(activeCategory === cat ? { ...s.chipActive, background: color, borderColor: color } : {}),
              }}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div style={s.legend}>
          <span style={s.legendItem}>
            <span style={{ ...s.legendLine, borderBottom: "2px solid #bbb" }} />
            relates_to
          </span>
          <span style={s.legendItem}>
            <span style={{ ...s.legendLine, borderBottom: "2px dashed #c0392b" }} />
            prerequisite
          </span>
        </div>
      </div>

      {/* Canvas + Side Panel */}
      <div style={s.body}>
        <div ref={containerRef} style={s.canvas}>
          {isEmpty && (
            <div style={s.emptyState}>
              <p style={s.emptyTitle}>No concepts yet</p>
              <p style={s.emptyBody}>
                Add concepts manually or click <strong>Seed Test Data</strong> to populate an example graph.
              </p>
            </div>
          )}
        </div>

        {selected && (
          <aside style={s.panel}>
            <h3 style={s.panelTitle}>{selected.label}</h3>
            <div style={s.panelField}>
              <span style={s.panelLabel}>Category</span>
              <span
                style={{
                  ...s.panelBadge,
                  background: CATEGORY_COLORS[selected.category] || CATEGORY_COLORS.general,
                }}
              >
                {selected.category}
              </span>
            </div>
            {selected.source_doc_id && (
              <div style={s.panelField}>
                <span style={s.panelLabel}>Origin</span>
                <span style={{ ...s.panelBadge, background: "#7b5ea6" }}>extracted</span>
              </div>
            )}
            {selected.description && (
              <div style={s.panelField}>
                <span style={s.panelLabel}>Description</span>
                <p style={s.panelDesc}>{selected.description}</p>
              </div>
            )}
            <div style={s.panelField}>
              <span style={s.panelLabel}>Mastery</span>
              <div style={s.masteryBar}>
                <div style={{ ...s.masteryFill, width: `${selected.mastery * 100}%` }} />
              </div>
              <span style={s.masteryText}>{(selected.mastery * 100).toFixed(0)}%</span>
            </div>
            <button style={s.deleteConceptBtn} onClick={() => handleDeleteConcept(selected.id)}>
              Delete Concept
            </button>
          </aside>
        )}
      </div>

      <ConceptModal
        isOpen={conceptModal}
        onClose={() => setConceptModal(false)}
        onSubmit={async (data) => {
          try {
            await handleAddConcept(data);
          } catch (e) {
            setGraphError(e instanceof Error ? e.message : "Failed to create concept");
            throw e;
          }
        }}
      />
      <RelationshipModal
        isOpen={relModal}
        onClose={() => setRelModal(false)}
        concepts={concepts}
        onSubmit={async (data) => {
          try {
            await handleAddRelationship(data);
          } catch (e) {
            setGraphError(e instanceof Error ? e.message : "Failed to create relationship");
            throw e;
          }
        }}
      />
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  errorBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 16px",
    background: "#fde8e8",
    borderBottom: "1px solid #f5c6c6",
    fontSize: "12px",
    color: "#a63a3a",
  },
  errorDismiss: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "12px",
    color: "#a63a3a",
    padding: "0 4px",
    lineHeight: 1,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 20px",
    borderBottom: "1px solid rgba(0,0,0,0.07)",
    background: "#fdfbf7",
    flexWrap: "wrap",
    flexShrink: 0,
  },
  toolBtn: {
    padding: "5px 12px",
    fontSize: "12px",
    fontWeight: 600,
    background: "#2b2b2b",
    color: "#fbf8f3",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    boxShadow: "none",
  },
  toolBtnSeed: {
    padding: "5px 12px",
    fontSize: "12px",
    fontWeight: 500,
    background: "none",
    color: "#5e5e5e",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: "4px",
    cursor: "pointer",
    boxShadow: "none",
  },
  searchInput: {
    padding: "4px 10px",
    fontSize: "12px",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: "4px",
    background: "#fff",
    fontFamily: "inherit",
    width: "160px",
    outline: "none",
  },
  filterChips: {
    display: "flex",
    gap: "4px",
    flexWrap: "wrap",
  },
  chip: {
    padding: "3px 10px",
    fontSize: "11px",
    fontWeight: 500,
    background: "none",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: "20px",
    cursor: "pointer",
    color: "#5e5e5e",
    boxShadow: "none",
    transition: "all 0.12s",
  },
  chipActive: {
    background: "#2b2b2b",
    borderColor: "#2b2b2b",
    color: "#fbf8f3",
  },
  extractingBadge: {
    fontSize: "10px",
    fontFamily: "'JetBrains Mono', monospace",
    color: "#7b5ea6",
    letterSpacing: "0.2px",
    animation: "pulse 1.5s ease-in-out infinite",
  },
  legend: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    fontSize: "10px",
    color: "#999",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  legendLine: {
    width: "16px",
    display: "inline-block",
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
    position: "relative",
  },
  canvas: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    background: "#fbf8f3",
  },
  emptyState: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    gap: "8px",
  },
  emptyTitle: {
    margin: 0,
    fontSize: "15px",
    fontWeight: 600,
    color: "#bbb",
  },
  emptyBody: {
    margin: 0,
    fontSize: "13px",
    color: "#bbb",
    textAlign: "center",
    maxWidth: "280px",
    lineHeight: 1.5,
  },
  panel: {
    width: "260px",
    borderLeft: "1px solid rgba(0,0,0,0.08)",
    background: "#fdfbf7",
    padding: "16px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  panelTitle: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 700,
    color: "#2b2b2b",
    fontFamily: "'Crimson Pro', serif",
    letterSpacing: "-0.2px",
  },
  panelField: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  panelLabel: {
    fontSize: "10px",
    fontWeight: 600,
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  panelBadge: {
    display: "inline-block",
    alignSelf: "flex-start",
    padding: "2px 8px",
    borderRadius: "4px",
    color: "#fff",
    fontSize: "11px",
    fontWeight: 600,
  },
  panelDesc: {
    margin: 0,
    fontSize: "13px",
    color: "#5e5e5e",
    lineHeight: 1.5,
  },
  masteryBar: {
    height: "6px",
    background: "rgba(0,0,0,0.08)",
    borderRadius: "3px",
    overflow: "hidden",
  },
  masteryFill: {
    height: "100%",
    background: "#3a8f5a",
    borderRadius: "3px",
    transition: "width 0.3s",
  },
  masteryText: {
    fontSize: "11px",
    color: "#5e5e5e",
    fontFamily: "'JetBrains Mono', monospace",
  },
  deleteConceptBtn: {
    marginTop: "auto",
    padding: "6px 12px",
    fontSize: "12px",
    background: "none",
    color: "#c0392b",
    border: "1px solid #c0392b",
    borderRadius: "4px",
    cursor: "pointer",
    boxShadow: "none",
  },
};
