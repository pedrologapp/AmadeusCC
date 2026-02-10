import { useState, useEffect, useCallback } from "react";

// ============================================================
// CONFIGURAÇÃO - Altere estas URLs para as suas
// ============================================================
const CONFIG = {
  SUPABASE_URL: "https://lzqhjutknqeuhscfxald.supabase.co",
  SUPABASE_ANON_KEY: "sb_secret_vHp1qqxG_A-i7npeDiECZQ_-16SCNtE",
  N8N_WEBHOOK_PROCESS_PDF: "https://webhook.escolaamadeus.com/webhook/process-payroll-pdf",
  N8N_WEBHOOK_SEND_EMAILS: "https://seu-n8n.com/webhook/send-payroll-emails",
};

// ============================================================
// Cliente Supabase simplificado (sem SDK)
// ============================================================
const supabase = {
  headers: {
    apikey: CONFIG.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  },

  async select(table, filters = "", order = "") {
    const params = [filters, order && `order=${order}`].filter(Boolean).join("&");
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}${params ? `?${params}` : ""}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) throw new Error(`Supabase select error: ${res.statusText}`);
    return res.json();
  },

  async insert(table, data) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase insert error: ${res.statusText}`);
    return res.json();
  },

  async update(table, id, data) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase update error: ${res.statusText}`);
    return res.json();
  },

  async delete(table, id) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE",
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Supabase delete error: ${res.statusText}`);
    return true;
  },

  async rpc(functionName, params) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`Supabase RPC error: ${res.statusText}`);
    return res.json();
  },
};

// ============================================================
// Helpers
// ============================================================
const formatCurrency = (value) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const ADJUSTMENT_CATEGORIES = [
  { value: "extra_class", label: "Aula Extra" },
  { value: "replacement", label: "Substituição" },
  { value: "bonus", label: "Bônus" },
  { value: "transport", label: "Vale Transporte" },
  { value: "meal", label: "Vale Refeição" },
  { value: "health", label: "Plano de Saúde" },
  { value: "absence", label: "Falta" },
  { value: "late", label: "Atraso" },
  { value: "advance", label: "Adiantamento" },
  { value: "loan", label: "Empréstimo" },
  { value: "material", label: "Material Didático" },
  { value: "other", label: "Outros" },
];

// ============================================================
// Components
// ============================================================
const StatusBadge = ({ status }) => {
  const config = {
    extracted: { label: "Extraído", bg: "#FEF9C3", color: "#854D0E", border: "#FDE047" },
    pending_review: { label: "Pendente", bg: "#FEF3C7", color: "#92400E", border: "#FCD34D" },
    reviewed: { label: "Validado", bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" },
    approved: { label: "Aprovado", bg: "#DBEAFE", color: "#1E40AF", border: "#93C5FD" },
    sent: { label: "Enviado", bg: "#E0E7FF", color: "#3730A3", border: "#A5B4FC" },
    error: { label: "Erro", bg: "#FEE2E2", color: "#991B1B", border: "#FCA5A5" },
    draft: { label: "Rascunho", bg: "#F3F4F6", color: "#374151", border: "#D1D5DB" },
    processing: { label: "Processando", bg: "#FEF3C7", color: "#92400E", border: "#FCD34D" },
    reviewing: { label: "Em Revisão", bg: "#DBEAFE", color: "#1E40AF", border: "#93C5FD" },
  };
  const c = config[status] || config.draft;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      letterSpacing: 0.3, textTransform: "uppercase",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color }} />
      {c.label}
    </span>
  );
};

const Spinner = () => (
  <span style={{
    display: "inline-block", width: 16, height: 16,
    border: "2px solid #E5E7EB", borderTopColor: "#F59E0B",
    borderRadius: "50%", animation: "spin 0.6s linear infinite",
  }} />
);

// ============================================================
// Main App
// ============================================================
export default function PayrollApp() {
  const [collaborators, setCollaborators] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [currentPeriodId, setCurrentPeriodId] = useState(null);
  const [paychecks, setPaychecks] = useState([]);
  const [adjustments, setAdjustments] = useState({});
  const [selectedPaycheckId, setSelectedPaycheckId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [newAdj, setNewAdj] = useState({ type: "addition", description: "", value: "", category: "other" });

  const [refMonth, setRefMonth] = useState(new Date().getMonth() + 1);
  const [refYear, setRefYear] = useState(new Date().getFullYear());

  // Derived
  const currentPeriod = periods.find((p) => p.id === currentPeriodId);
  const selectedPaycheck = paychecks.find((p) => p.id === selectedPaycheckId);
  const selectedCollaborator = selectedPaycheck
    ? collaborators.find((c) => c.id === selectedPaycheck.collaborator_id)
    : null;
  const selectedAdjustments = selectedPaycheckId ? adjustments[selectedPaycheckId] || [] : [];

  const filteredPaychecks = paychecks.filter((pc) => {
    const collab = collaborators.find((c) => c.id === pc.collaborator_id);
    if (!collab) return false;
    const matchesSearch =
      collab.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (collab.role || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === "all" || pc.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: paychecks.length,
    pending: paychecks.filter((p) => ["extracted", "pending_review"].includes(p.status)).length,
    reviewed: paychecks.filter((p) => ["reviewed", "approved"].includes(p.status)).length,
    sent: paychecks.filter((p) => p.status === "sent").length,
  };

  // ============================================================
  // Data Loading
  // ============================================================
  const loadCollaborators = useCallback(async () => {
    try {
      const data = await supabase.select("collaborators", "is_active=eq.true", "full_name.asc");
      setCollaborators(data);
    } catch (err) {
      console.error("Erro ao carregar colaboradores:", err);
    }
  }, []);

  const loadPeriods = useCallback(async () => {
    try {
      const data = await supabase.select("payroll_periods", "", "reference_year.desc,reference_month.desc");
      setPeriods(data);
      if (data.length > 0 && !currentPeriodId) {
        setCurrentPeriodId(data[0].id);
      }
    } catch (err) {
      console.error("Erro ao carregar períodos:", err);
    }
  }, [currentPeriodId]);

  const loadPaychecks = useCallback(async () => {
    if (!currentPeriodId) return;
    try {
      const data = await supabase.select("paychecks", `payroll_period_id=eq.${currentPeriodId}`, "created_at.asc");
      setPaychecks(data);
      const adjMap = {};
      for (const pc of data) {
        const adjs = await supabase.select("adjustments", `paycheck_id=eq.${pc.id}`, "created_at.asc");
        adjMap[pc.id] = adjs;
      }
      setAdjustments(adjMap);
    } catch (err) {
      console.error("Erro ao carregar contracheques:", err);
    }
  }, [currentPeriodId]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadCollaborators();
      await loadPeriods();
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (currentPeriodId) loadPaychecks();
  }, [currentPeriodId, loadPaychecks]);

  // ============================================================
  // Actions
  // ============================================================
  const handlePdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("Por favor, selecione um arquivo PDF.");
      return;
    }

    setUploading(true);
    setUploadProgress("Enviando PDF para processamento...");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("reference_month", String(refMonth));
      formData.append("reference_year", String(refYear));

      const res = await fetch(CONFIG.N8N_WEBHOOK_PROCESS_PDF, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Erro ao enviar PDF para o n8n");
      const result = await res.json();
      setUploadProgress("PDF enviado! A IA está processando as páginas...");

      if (result.period_id) setCurrentPeriodId(result.period_id);

      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        await loadPeriods();
        await loadPaychecks();
        setUploadProgress(`Processando... (verificação ${attempts})`);

        if (attempts > 60) {
          clearInterval(poll);
          setUploadProgress("Processamento demorou mais que o esperado. Recarregue a página.");
          setUploading(false);
        }

        const updated = await supabase.select("payroll_periods", `id=eq.${result.period_id || currentPeriodId}`);
        if (updated[0] && updated[0].status !== "processing") {
          clearInterval(poll);
          await loadPaychecks();
          setUploadProgress("");
          setUploading(false);
        }
      }, 5000);
    } catch (err) {
      setError(`Erro: ${err.message}`);
      setUploading(false);
      setUploadProgress("");
    }
  };

  const addAdjustment = async () => {
    if (!selectedPaycheckId || !newAdj.description || !newAdj.value) return;
    try {
      const result = await supabase.insert("adjustments", {
        paycheck_id: selectedPaycheckId,
        type: newAdj.type,
        description: newAdj.description,
        value: parseFloat(newAdj.value),
        category: newAdj.category,
      });
      setAdjustments((prev) => ({
        ...prev,
        [selectedPaycheckId]: [...(prev[selectedPaycheckId] || []), ...result],
      }));
      setNewAdj({ type: "addition", description: "", value: "", category: "other" });
      await loadPaychecks();
    } catch (err) {
      setError(`Erro ao adicionar ajuste: ${err.message}`);
    }
  };

  const removeAdjustment = async (adjId) => {
    try {
      await supabase.delete("adjustments", adjId);
      setAdjustments((prev) => ({
        ...prev,
        [selectedPaycheckId]: (prev[selectedPaycheckId] || []).filter((a) => a.id !== adjId),
      }));
      await loadPaychecks();
    } catch (err) {
      setError(`Erro ao remover ajuste: ${err.message}`);
    }
  };

  const validatePaycheck = async () => {
    if (!selectedPaycheckId) return;
    try {
      await supabase.update("paychecks", selectedPaycheckId, { status: "reviewed" });
      await loadPaychecks();
      const currentIndex = filteredPaychecks.findIndex((p) => p.id === selectedPaycheckId);
      const next = filteredPaychecks[currentIndex + 1];
      if (next) setSelectedPaycheckId(next.id);
    } catch (err) {
      setError(`Erro ao validar: ${err.message}`);
    }
  };

  const unvalidatePaycheck = async () => {
    if (!selectedPaycheckId) return;
    try {
      await supabase.update("paychecks", selectedPaycheckId, { status: "pending_review" });
      await loadPaychecks();
    } catch (err) {
      setError(`Erro: ${err.message}`);
    }
  };

  const sendBatchEmails = async () => {
    if (!currentPeriodId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(CONFIG.N8N_WEBHOOK_SEND_EMAILS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_id: currentPeriodId }),
      });
      if (!res.ok) throw new Error("Erro ao disparar envio de e-mails");

      const poll = setInterval(async () => {
        await loadPaychecks();
        const stillReviewed = paychecks.filter((p) => p.status === "reviewed").length;
        if (stillReviewed === 0) {
          clearInterval(poll);
          setSending(false);
        }
      }, 3000);

      setTimeout(() => { clearInterval(poll); setSending(false); }, 120000);
    } catch (err) {
      setError(`Erro: ${err.message}`);
      setSending(false);
    }
  };

  const getTotal = (pc) => {
    if (!pc) return 0;
    return pc.final_value || pc.extracted_net_value || pc.extracted_gross_value || 0;
  };

  // ============================================================
  // Render
  // ============================================================
  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#F8F7F4", fontFamily: "'Outfit', 'Segoe UI', sans-serif",
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center" }}>
          <Spinner />
          <p style={{ marginTop: 12, color: "#6B7280", fontSize: 14 }}>Carregando dados...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#F8F7F4",
      fontFamily: "'Outfit', 'Segoe UI', sans-serif", color: "#1a1a1a",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <header style={{
        background: "#1B2A4A", color: "#fff", padding: "0 32px", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(27,42,74,0.15)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #F59E0B, #EF4444)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800,
          }}>₵</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>ContraCheque</div>
            <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1, textTransform: "uppercase" }}>
              Sistema de Folha de Pagamento
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {periods.length > 0 && (
            <select
              value={currentPeriodId || ""}
              onChange={(e) => { setCurrentPeriodId(e.target.value); setSelectedPaycheckId(null); }}
              style={{
                background: "rgba(255,255,255,0.12)", color: "#fff",
                border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8,
                padding: "6px 12px", fontSize: 13, fontWeight: 500, cursor: "pointer", outline: "none",
              }}
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id} style={{ color: "#1a1a1a" }}>
                  {MONTH_NAMES[p.reference_month - 1]} {p.reference_year}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {error && (
        <div style={{
          background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#991B1B",
          padding: "10px 24px", fontSize: 13,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{
            background: "none", border: "none", color: "#991B1B", cursor: "pointer", fontSize: 16,
          }}>✕</button>
        </div>
      )}

      <div style={{ display: "flex", height: "calc(100vh - 64px)" }}>
        {/* LEFT PANEL */}
        <div style={{
          width: 380, borderRight: "1px solid #E5E2DB",
          display: "flex", flexDirection: "column", background: "#FFFFFF",
        }}>
          {/* PDF Upload */}
          <div style={{ padding: 20, borderBottom: "1px solid #E5E2DB" }}>
            {uploading ? (
              <div style={{
                padding: 20, borderRadius: 12, background: "#FFFBEB",
                border: "1px solid #FCD34D", textAlign: "center",
              }}>
                <Spinner />
                <div style={{ fontSize: 13, fontWeight: 600, color: "#92400E", marginTop: 8 }}>
                  {uploadProgress}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <select value={refMonth} onChange={(e) => setRefMonth(Number(e.target.value))}
                    style={{
                      flex: 1, padding: "6px 8px", borderRadius: 8,
                      border: "1px solid #E5E2DB", fontSize: 13, outline: "none",
                    }}>
                    {MONTH_NAMES.map((m, i) => (
                      <option key={i} value={i + 1}>{m}</option>
                    ))}
                  </select>
                  <input type="number" value={refYear}
                    onChange={(e) => setRefYear(Number(e.target.value))}
                    style={{
                      width: 80, padding: "6px 8px", borderRadius: 8,
                      border: "1px solid #E5E2DB", fontSize: 13, outline: "none",
                    }}
                  />
                </div>
                <label style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  padding: 20, borderRadius: 12, border: "2px dashed #CBD5E1",
                  background: "#F8FAFC", cursor: "pointer", gap: 8,
                }}>
                  <input type="file" accept=".pdf" onChange={handlePdfUpload} style={{ display: "none" }} />
                  <span style={{ fontSize: 28 }}>📄</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A" }}>
                    Upload do PDF de Contracheques
                  </span>
                  <span style={{ fontSize: 11, color: "#94A3B8" }}>
                    Selecione o mês/ano e clique aqui
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Stats */}
          {paychecks.length > 0 && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8, padding: "12px 20px", borderBottom: "1px solid #E5E2DB",
            }}>
              {[
                { label: "Pendentes", value: stats.pending, color: "#F59E0B" },
                { label: "Validados", value: stats.reviewed, color: "#22C55E" },
                { label: "Enviados", value: stats.sent, color: "#3B82F6" },
              ].map((s) => (
                <div key={s.label} style={{
                  textAlign: "center", padding: "8px 4px", borderRadius: 8, background: "#F8F7F4",
                }}>
                  <div style={{
                    fontSize: 22, fontWeight: 800, color: s.color,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>{s.value}</div>
                  <div style={{
                    fontSize: 10, color: "#6B7280", fontWeight: 500,
                    textTransform: "uppercase", letterSpacing: 0.5,
                  }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Search & Filter */}
          {paychecks.length > 0 && (
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #E5E2DB" }}>
              <input type="text" placeholder="Buscar colaborador..."
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid #E5E2DB", fontSize: 13,
                  background: "#F8F7F4", outline: "none", boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {[
                  { key: "all", label: "Todos" },
                  { key: "pending_review", label: "Pendentes" },
                  { key: "reviewed", label: "Validados" },
                  { key: "sent", label: "Enviados" },
                ].map((f) => (
                  <button key={f.key} onClick={() => setFilterStatus(f.key)} style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500,
                    border: "1px solid",
                    borderColor: filterStatus === f.key ? "#1B2A4A" : "#E5E2DB",
                    background: filterStatus === f.key ? "#1B2A4A" : "transparent",
                    color: filterStatus === f.key ? "#fff" : "#6B7280",
                    cursor: "pointer",
                  }}>{f.label}</button>
                ))}
              </div>
            </div>
          )}

          {/* Employee List */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filteredPaychecks.length === 0 && !uploading && (
              <div style={{ padding: 32, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>
                {paychecks.length === 0
                  ? "Nenhum contracheque ainda. Faça upload de um PDF."
                  : "Nenhum resultado encontrado."}
              </div>
            )}
            {filteredPaychecks.map((pc) => {
              const collab = collaborators.find((c) => c.id === pc.collaborator_id);
              if (!collab) return null;
              const pcAdjs = adjustments[pc.id] || [];
              return (
                <div key={pc.id} onClick={() => setSelectedPaycheckId(pc.id)}
                  style={{
                    padding: "14px 20px", borderBottom: "1px solid #F3F0EB", cursor: "pointer",
                    background: selectedPaycheckId === pc.id ? "#FEF9EE" : "transparent",
                    borderLeft: selectedPaycheckId === pc.id ? "3px solid #F59E0B" : "3px solid transparent",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A", marginBottom: 2 }}>
                        {collab.full_name}
                      </div>
                      <div style={{ fontSize: 11, color: "#6B7280" }}>{collab.role}</div>
                    </div>
                    <StatusBadge status={pc.status} />
                  </div>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8,
                  }}>
                    <span style={{
                      fontSize: 13, fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace", color: "#1B2A4A",
                    }}>{formatCurrency(getTotal(pc))}</span>
                    {pcAdjs.length > 0 && (
                      <span style={{
                        fontSize: 10, color: "#F59E0B", fontWeight: 600,
                        background: "#FEF3C7", padding: "2px 6px", borderRadius: 4,
                      }}>{pcAdjs.length} ajuste{pcAdjs.length > 1 ? "s" : ""}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Send Button */}
          {stats.reviewed > 0 && (
            <div style={{ padding: 16, borderTop: "1px solid #E5E2DB" }}>
              <button onClick={sendBatchEmails} disabled={sending} style={{
                width: "100%", padding: "12px 20px", borderRadius: 10,
                background: sending ? "#9CA3AF" : "linear-gradient(135deg, #1B2A4A, #2D4A7A)",
                color: "#fff", border: "none", cursor: sending ? "default" : "pointer",
                fontSize: 14, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                boxShadow: "0 4px 12px rgba(27,42,74,0.3)",
              }}>
                {sending ? <><Spinner /> Enviando...</> : <>📧 Enviar Lote ({stats.reviewed})</>}
              </button>
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div style={{ flex: 1, overflowY: "auto", padding: 32 }}>
          {!selectedPaycheck ? (
            <div style={{
              height: "100%", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", color: "#9CA3AF",
            }}>
              <span style={{ fontSize: 56, marginBottom: 16, opacity: 0.5 }}>📋</span>
              <div style={{ fontSize: 18, fontWeight: 600, color: "#6B7280" }}>Selecione um colaborador</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Clique em um nome na lista para revisar</div>
            </div>
          ) : (
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
              {/* Header */}
              <div style={{ marginBottom: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <h2 style={{ fontSize: 24, fontWeight: 800, color: "#1B2A4A", margin: 0 }}>
                    {selectedCollaborator?.full_name}
                  </h2>
                  <StatusBadge status={selectedPaycheck.status} />
                </div>
                <div style={{ fontSize: 14, color: "#6B7280" }}>{selectedCollaborator?.role}</div>
                <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>
                  ✉️ {selectedCollaborator?.email}
                </div>
                {selectedPaycheck.ai_confidence_score != null && (
                  <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
                    Confiança IA: {(selectedPaycheck.ai_confidence_score * 100).toFixed(0)}%
                    {selectedPaycheck.ai_confidence_score < 0.6 && (
                      <span style={{ color: "#EF4444", fontWeight: 600 }}> ⚠️ Baixa</span>
                    )}
                  </div>
                )}
              </div>

              {/* Paycheck Card */}
              <div style={{
                background: "#fff", borderRadius: 16, padding: 24,
                border: "1px solid #E5E2DB", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                marginBottom: 20,
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: 1, color: "#9CA3AF", marginBottom: 16,
                }}>Valores Extraídos do PDF</div>

                {[
                  { label: "Salário Bruto", value: selectedPaycheck.extracted_gross_value },
                  { label: "Descontos", value: selectedPaycheck.extracted_deductions, negative: true },
                  { label: "Salário Líquido", value: selectedPaycheck.extracted_net_value },
                ].map((item) => (
                  <div key={item.label} style={{
                    display: "flex", justifyContent: "space-between", padding: "10px 0",
                    borderBottom: "1px solid #F3F0EB",
                  }}>
                    <span style={{ fontSize: 14, color: "#374151" }}>{item.label}</span>
                    <span style={{
                      fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                      color: item.negative ? "#DC2626" : "#1B2A4A",
                    }}>
                      {item.negative && item.value ? "− " : ""}{formatCurrency(item.value)}
                    </span>
                  </div>
                ))}

                {selectedAdjustments.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                      letterSpacing: 1, color: "#9CA3AF", marginBottom: 10,
                    }}>Ajustes</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {selectedAdjustments.map((adj) => (
                        <div key={adj.id} style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 12px", borderRadius: 8,
                          background: adj.type === "addition" ? "#F0FDF4" : "#FEF2F2",
                          border: `1px solid ${adj.type === "addition" ? "#BBF7D0" : "#FECACA"}`,
                          fontSize: 13,
                        }}>
                          <span style={{
                            width: 22, height: 22, borderRadius: "50%",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 14, fontWeight: 700,
                            background: adj.type === "addition" ? "#22C55E" : "#EF4444", color: "#fff",
                          }}>{adj.type === "addition" ? "+" : "−"}</span>
                          <span style={{ flex: 1, color: "#374151" }}>{adj.description}</span>
                          <span style={{
                            fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                            color: adj.type === "addition" ? "#16A34A" : "#DC2626",
                          }}>
                            {adj.type === "addition" ? "+" : "−"} {formatCurrency(adj.value)}
                          </span>
                          {selectedPaycheck.status !== "sent" && (
                            <button onClick={() => removeAdjustment(adj.id)} style={{
                              background: "none", border: "none", cursor: "pointer",
                              color: "#9CA3AF", fontSize: 16,
                            }}>✕</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "16px 0 0", marginTop: 16, borderTop: "2px solid #1B2A4A",
                }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#1B2A4A" }}>Total a Receber</span>
                  <span style={{
                    fontSize: 26, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
                    color: getTotal(selectedPaycheck) >= 0 ? "#16A34A" : "#DC2626",
                  }}>{formatCurrency(getTotal(selectedPaycheck))}</span>
                </div>
              </div>

              {/* Add Adjustment */}
              {selectedPaycheck.status !== "sent" && (
                <div style={{
                  background: "#fff", borderRadius: 16, padding: 24,
                  border: "1px solid #E5E2DB", marginBottom: 20,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: 1, color: "#9CA3AF", marginBottom: 16,
                  }}>Adicionar Ajuste</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex" }}>
                      {[
                        { key: "addition", label: "+ Adicional", color: "#22C55E" },
                        { key: "deduction", label: "− Desconto", color: "#EF4444" },
                      ].map((t, i) => (
                        <button key={t.key}
                          onClick={() => setNewAdj((p) => ({ ...p, type: t.key }))}
                          style={{
                            padding: "8px 14px",
                            borderRadius: i === 0 ? "8px 0 0 8px" : "0 8px 8px 0",
                            fontSize: 13, fontWeight: 600, cursor: "pointer",
                            border: `1px solid ${newAdj.type === t.key ? t.color : "#E5E2DB"}`,
                            background: newAdj.type === t.key ? t.color : "#fff",
                            color: newAdj.type === t.key ? "#fff" : "#6B7280",
                          }}>{t.label}</button>
                      ))}
                    </div>
                    <select value={newAdj.category}
                      onChange={(e) => setNewAdj((p) => ({ ...p, category: e.target.value }))}
                      style={{
                        padding: "8px 10px", borderRadius: 8,
                        border: "1px solid #E5E2DB", fontSize: 13, outline: "none",
                      }}>
                      {ADJUSTMENT_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                    <input type="text" placeholder="Descrição"
                      value={newAdj.description}
                      onChange={(e) => setNewAdj((p) => ({ ...p, description: e.target.value }))}
                      style={{
                        flex: 1, minWidth: 150, padding: "8px 12px", borderRadius: 8,
                        border: "1px solid #E5E2DB", fontSize: 13, outline: "none",
                      }}
                    />
                    <input type="number" placeholder="R$" step="0.01"
                      value={newAdj.value}
                      onChange={(e) => setNewAdj((p) => ({ ...p, value: e.target.value }))}
                      style={{
                        width: 100, padding: "8px 12px", borderRadius: 8,
                        border: "1px solid #E5E2DB", fontSize: 13, outline: "none",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    />
                    <button onClick={addAdjustment} style={{
                      padding: "8px 20px", borderRadius: 8,
                      background: "#F59E0B", color: "#fff",
                      border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
                    }}>Adicionar</button>
                  </div>
                </div>
              )}

              {/* Actions */}
              {selectedPaycheck.status !== "sent" && (
                <div style={{ display: "flex", gap: 12 }}>
                  {["extracted", "pending_review"].includes(selectedPaycheck.status) ? (
                    <button onClick={validatePaycheck} style={{
                      flex: 1, padding: "14px 24px", borderRadius: 12,
                      background: "linear-gradient(135deg, #22C55E, #16A34A)",
                      color: "#fff", border: "none", cursor: "pointer",
                      fontSize: 15, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      boxShadow: "0 4px 12px rgba(34,197,94,0.3)",
                    }}>✓ Validar e Próximo</button>
                  ) : selectedPaycheck.status === "reviewed" ? (
                    <button onClick={unvalidatePaycheck} style={{
                      flex: 1, padding: "14px 24px", borderRadius: 12,
                      background: "#fff", color: "#F59E0B",
                      border: "2px solid #F59E0B", cursor: "pointer",
                      fontSize: 15, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    }}>↩ Reabrir para Edição</button>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 3px; }
      `}</style>
    </div>
  );
}






































