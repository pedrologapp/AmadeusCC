import { useState, useEffect, useCallback } from "react";

// ============================================================
// CONFIGURAÇÃO - Altere estas URLs para as suas
// ============================================================
const CONFIG = {
  SUPABASE_URL: "https://lzqhjutknqeuhscfxald.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6cWhqdXRrbnFldWhzY2Z4YWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4OTY0ODgsImV4cCI6MjA2OTQ3MjQ4OH0.AtiXJ2BpmulSUXo--bz_jKu0esAyS71kF33nWNE1YHk",
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
    extracted: { label: "Pendente", bg: "#FEF9C3", color: "#854D0E", border: "#FDE047" },
    pending_review: { label: "Pendente", bg: "#FEF3C7", color: "#92400E", border: "#FCD34D" },
    reviewed: { label: "Validado", bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" },
    approved: { label: "Aprovado", bg: "#DBEAFE", color: "#1E40AF", border: "#93C5FD" },
    sent: { label: "Enviado", bg: "#E0E7FF", color: "#3730A3", border: "#A5B4FC" },
    error: { label: "Erro", bg: "#FEE2E2", color: "#991B1B", border: "#FCA5A5" },
    draft: { label: "Rascunho", bg: "#F3F4F6", color: "#374151", border: "#D1D5DB" },
    processing: { label: "Processando", bg: "#FEF3C7", color: "#92400E", border: "#FCD34D" },
    reviewing: { label: "Em Revisão", bg: "#DBEAFE", color: "#1E40AF", border: "#93C5FD" },
    skipped: { label: "Não Enviar", bg: "#F3F4F6", color: "#6B7280", border: "#D1D5DB" },
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

// PDF Page Viewer - renders a single page from a PDF
const PdfPageViewer = ({ pdfUrl, pageNumber }) => {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!pdfUrl || !pageNumber) return;
    let cancelled = false;

    const loadPdf = async () => {
      setLoading(true);
      setError(false);
      try {
        // Load pdf.js dynamically
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            if (document.getElementById("pdfjs-script")) {
              const check = setInterval(() => {
                if (window.pdfjsLib) { clearInterval(check); resolve(); }
              }, 100);
              setTimeout(() => { clearInterval(check); reject(new Error("timeout")); }, 10000);
              return;
            }
            const script = document.createElement("script");
            script.id = "pdfjs-script";
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            script.onload = () => {
              window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
              resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }

        const pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        setLoading(false);
      } catch (err) {
        console.error("Erro ao renderizar PDF:", err);
        if (!cancelled) { setError(true); setLoading(false); }
      }
    };

    loadPdf();
    return () => { cancelled = true; };
  }, [pdfUrl, pageNumber]);

  if (error) {
    return (
      <div style={{
        padding: 20, textAlign: "center", color: "#9CA3AF",
        background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB",
        fontSize: 13,
      }}>
        📄 Página do contracheque indisponível
      </div>
    );
  }

  return (
    <div style={{ position: "relative", marginBottom: 16 }}>
      {loading && (
        <div style={{
          padding: 20, textAlign: "center", color: "#6B7280",
          background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB",
        }}>
          <Spinner />
          <div style={{ fontSize: 12, marginTop: 8 }}>Carregando contracheque...</div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{
          width: "100%", height: "auto", borderRadius: 8,
          border: "1px solid #E5E2DB",
          display: loading ? "none" : "block",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      />
    </div>
  );
};

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
    const matchesFilter =
      filterStatus === "all" ||
      (filterStatus === "pending_review" && ["extracted", "pending_review"].includes(pc.status)) ||
      pc.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: paychecks.length,
    pending: paychecks.filter((p) => ["extracted", "pending_review"].includes(p.status)).length,
    reviewed: paychecks.filter((p) => ["reviewed", "approved"].includes(p.status)).length,
    sent: paychecks.filter((p) => p.status === "sent").length,
    skipped: paychecks.filter((p) => p.status === "skipped").length,
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
      return data;
    } catch (err) {
      console.error("Erro ao carregar períodos:", err);
      return [];
    }
  }, []);

  const loadPaychecks = useCallback(async (periodId) => {
    const pid = periodId || currentPeriodId;
    if (!pid) return;
    try {
      const data = await supabase.select("paychecks", `payroll_period_id=eq.${pid}`, "created_at.asc");
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

  // Init
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadCollaborators();
      const data = await loadPeriods();
      if (data.length > 0) {
        setCurrentPeriodId(data[0].id);
        setRefMonth(data[0].reference_month);
        setRefYear(data[0].reference_year);
      }
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (currentPeriodId) {
      loadPaychecks(currentPeriodId);
      setSelectedPaycheckId(null);
    }
  }, [currentPeriodId]);

  // Mudar mês/ano => buscar período correspondente
  const handleMonthYearChange = useCallback((month, year) => {
    setRefMonth(month);
    setRefYear(year);
    const found = periods.find(
      (p) => p.reference_month === month && p.reference_year === year
    );
    if (found) {
      setCurrentPeriodId(found.id);
    } else {
      setCurrentPeriodId(null);
      setPaychecks([]);
      setAdjustments({});
      setSelectedPaycheckId(null);
    }
  }, [periods]);

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
      const res = await fetch(CONFIG.N8N_WEBHOOK_PROCESS_PDF, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Erro ao enviar PDF para o n8n");
      await res.json();
      setUploadProgress("PDF enviado! A IA está processando...");
      const sm = String(refMonth);
      const sy = String(refYear);
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        setUploadProgress(`Processando... (verificação ${attempts})`);
        if (attempts > 60) {
          clearInterval(poll);
          setUploadProgress("Processamento demorou mais que o esperado. Recarregue a página.");
          setUploading(false);
          return;
        }
        try {
          const found = await supabase.select(
            "payroll_periods",
            `reference_month=eq.${sm}&reference_year=eq.${sy}`,
            "created_at.desc"
          );
          if (found.length > 0 && found[0].status !== "processing") {
            clearInterval(poll);
            setCurrentPeriodId(found[0].id);
            setRefMonth(found[0].reference_month);
            setRefYear(found[0].reference_year);
            await loadPeriods();
            await loadPaychecks(found[0].id);
            setUploadProgress("");
            setUploading(false);
          }
        } catch (err) {
          console.error("Erro no polling:", err);
        }
      }, 5000);
    } catch (err) {
      setError(`Erro: ${err.message}`);
      setUploading(false);
      setUploadProgress("");
    }
  };

  const addAdjustment = async () => {
    if (!selectedPaycheckId || !newAdj.value) return;
    const catLabel = ADJUSTMENT_CATEGORIES.find((c) => c.value === newAdj.category)?.label || "";
    const desc = newAdj.description || catLabel || "Ajuste";
    try {
      await supabase.insert("adjustments", {
        paycheck_id: selectedPaycheckId,
        type: newAdj.type,
        description: desc,
        value: parseFloat(newAdj.value),
        category: newAdj.category,
      });
      setNewAdj({ type: "addition", description: "", value: "", category: "other" });
      await loadPaychecks();
    } catch (err) {
      setError(`Erro ao adicionar ajuste: ${err.message}`);
    }
  };

  const removeAdjustment = async (adjId) => {
    try {
      await supabase.delete("adjustments", adjId);
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
      const idx = filteredPaychecks.findIndex((p) => p.id === selectedPaycheckId);
      const next = filteredPaychecks[idx + 1];
      if (next) setSelectedPaycheckId(next.id);
    } catch (err) {
      setError(`Erro ao validar: ${err.message}`);
    }
  };

  const skipPaycheck = async () => {
    if (!selectedPaycheckId) return;
    try {
      await supabase.update("paychecks", selectedPaycheckId, { status: "skipped" });
      await loadPaychecks();
      const idx = filteredPaychecks.findIndex((p) => p.id === selectedPaycheckId);
      const next = filteredPaychecks[idx + 1];
      if (next) setSelectedPaycheckId(next.id);
    } catch (err) {
      setError(`Erro: ${err.message}`);
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
        const remaining = paychecks.filter((p) => p.status === "reviewed").length;
        if (remaining === 0) { clearInterval(poll); setSending(false); }
      }, 3000);
      setTimeout(() => { clearInterval(poll); setSending(false); }, 120000);
    } catch (err) {
      setError(`Erro: ${err.message}`);
      setSending(false);
    }
  };

  const getTotal = (pc) => {
    if (!pc) return 0;
    const base = pc.extracted_net_value || 0;
    const adjs = adjustments[pc.id] || [];
    return adjs.reduce((sum, a) => sum + (a.type === "addition" ? a.value : -a.value), base);
  };

  const getExtractedDetails = (pc) => {
    if (!pc?.ai_extracted_data) return [];
    try {
      const d = typeof pc.ai_extracted_data === "string" ? JSON.parse(pc.ai_extracted_data) : pc.ai_extracted_data;
      return Array.isArray(d) ? d : [];
    } catch { return []; }
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

  const periodLabel = currentPeriod
    ? `${MONTH_NAMES[currentPeriod.reference_month - 1]} ${currentPeriod.reference_year}`
    : `${MONTH_NAMES[refMonth - 1]} ${refYear}`;

  const pdfUrl = currentPeriod
    ? `${CONFIG.SUPABASE_URL}/storage/v1/object/public/paychecks/${currentPeriod.reference_year}/${String(currentPeriod.reference_month).padStart(2, "0")}.pdf`
    : null;

  const details = selectedPaycheck ? getExtractedDetails(selectedPaycheck) : [];
  const earnings = details.filter((d) => d.earnings > 0);
  const deductions = details.filter((d) => d.deductions > 0);

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
        {periods.length > 0 && (
          <select
            value={currentPeriodId || ""}
            onChange={(e) => {
              const p = periods.find((x) => x.id === e.target.value);
              if (p) { setCurrentPeriodId(p.id); setRefMonth(p.reference_month); setRefYear(p.reference_year); }
            }}
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
        {/* ===== LEFT PANEL ===== */}
        <div style={{
          width: 380, borderRight: "1px solid #E5E2DB",
          display: "flex", flexDirection: "column", background: "#FFFFFF",
        }}>
          {/* Upload */}
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
                  <select value={refMonth}
                    onChange={(e) => handleMonthYearChange(Number(e.target.value), refYear)}
                    style={{
                      flex: 1, padding: "6px 8px", borderRadius: 8,
                      border: "1px solid #E5E2DB", fontSize: 13, outline: "none",
                    }}>
                    {MONTH_NAMES.map((m, i) => (
                      <option key={i} value={i + 1}>{m}</option>
                    ))}
                  </select>
                  <input type="number" value={refYear}
                    onChange={(e) => handleMonthYearChange(refMonth, Number(e.target.value))}
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
                  <span style={{ fontSize: 11, color: "#94A3B8" }}>Selecione o mês/ano e clique aqui</span>
                </label>
              </div>
            )}
          </div>

          {/* Stats */}
          {paychecks.length > 0 && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
              gap: 6, padding: "12px 20px", borderBottom: "1px solid #E5E2DB",
            }}>
              {[
                { label: "Pendentes", value: stats.pending, color: "#F59E0B" },
                { label: "Validados", value: stats.reviewed, color: "#22C55E" },
                { label: "Pular", value: stats.skipped, color: "#9CA3AF" },
                { label: "Enviados", value: stats.sent, color: "#3B82F6" },
              ].map((s) => (
                <div key={s.label} style={{
                  textAlign: "center", padding: "6px 2px", borderRadius: 8, background: "#F8F7F4",
                }}>
                  <div style={{
                    fontSize: 20, fontWeight: 800, color: s.color,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>{s.value}</div>
                  <div style={{
                    fontSize: 9, color: "#6B7280", fontWeight: 500,
                    textTransform: "uppercase", letterSpacing: 0.5,
                  }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Search + Filter */}
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
                  { key: "skipped", label: "Não Enviar" },
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

          {/* List */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filteredPaychecks.length === 0 && !uploading && (
              <div style={{ padding: 32, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>
                {paychecks.length === 0 ? "Nenhum contracheque ainda. Faça upload de um PDF." : "Nenhum resultado encontrado."}
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
                    opacity: pc.status === "skipped" ? 0.5 : 1,
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

          {/* Send batch */}
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
                {sending ? <><Spinner /> Enviando...</> : <>📧 Enviar {stats.reviewed} e-mail{stats.reviewed > 1 ? "s" : ""}</>}
              </button>
            </div>
          )}
        </div>

        {/* ===== RIGHT PANEL - EMAIL PREVIEW ===== */}
        <div style={{ flex: 1, overflowY: "auto", padding: 32, background: "#EDEAE5" }}>
          {!selectedPaycheck ? (
            <div style={{
              height: "100%", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", color: "#9CA3AF",
            }}>
              <span style={{ fontSize: 56, marginBottom: 16, opacity: 0.5 }}>📋</span>
              <div style={{ fontSize: 18, fontWeight: 600, color: "#6B7280" }}>Selecione um colaborador</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Clique em um nome na lista para pré-visualizar o e-mail</div>
            </div>
          ) : (
            <div style={{ maxWidth: 680, margin: "0 auto" }}>

              {/* Envelope */}
              <div style={{
                background: "#fff", borderRadius: "12px 12px 0 0", padding: "16px 24px",
                border: "1px solid #D1D5DB", borderBottom: "none", fontSize: 13, color: "#6B7280",
              }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, color: "#374151", minWidth: 50 }}>Para:</span>
                  <span>{selectedCollaborator?.full_name} &lt;{selectedCollaborator?.email}&gt;</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, color: "#374151", minWidth: 50 }}>De:</span>
                  <span>{CONFIG.SCHOOL_NAME} &lt;rh@escolaamadeus.com&gt;</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "#374151", minWidth: 50 }}>Assunto:</span>
                  <span>Seu Contracheque — {periodLabel}</span>
                </div>
              </div>

              {/* Email body */}
              <div style={{
                background: "#fff", border: "1px solid #D1D5DB",
                borderRadius: "0 0 12px 12px", overflow: "hidden",
              }}>
                {/* Header bar */}
                <div style={{
                  background: "#1B2A4A", padding: "24px 32px",
                  color: "#fff", textAlign: "center",
                }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{CONFIG.SCHOOL_NAME}</div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>
                    Contracheque — {periodLabel}
                  </div>
                </div>

                <div style={{ padding: "28px 32px" }}>
                  {/* Greeting */}
                  <p style={{ fontSize: 15, color: "#374151", lineHeight: 1.6, margin: "0 0 8px" }}>
                    Olá, <strong>{selectedCollaborator?.full_name?.split(" ")[0]}</strong>!
                  </p>
                  <p style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.6, margin: "0 0 24px" }}>
                    Segue o resumo do seu contracheque referente a <strong>{periodLabel}</strong>.
                    O PDF completo está anexo neste e-mail.
                  </p>

                  {/* PDF Page Preview */}
                  {pdfUrl && selectedPaycheck?.pdf_page_number && (
                    <div style={{ marginBottom: 24 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                        letterSpacing: 1, color: "#9CA3AF", marginBottom: 10,
                      }}>Contracheque — Página {selectedPaycheck.pdf_page_number}</div>
                      <PdfPageViewer pdfUrl={pdfUrl} pageNumber={selectedPaycheck.pdf_page_number} />
                    </div>
                  )}

                  {/* Summary card */}
                  <div style={{
                    background: "#F8F7F4", borderRadius: 12, padding: "20px 24px",
                    border: "1px solid #E5E2DB", marginBottom: 24,
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                      letterSpacing: 1, color: "#9CA3AF", marginBottom: 16,
                    }}>Resumo Salarial</div>

                    {/* Proventos */}
                    {earnings.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#16A34A", marginBottom: 8 }}>
                          Proventos
                        </div>
                        {earnings.map((d, i) => (
                          <div key={i} style={{
                            display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13,
                            borderBottom: i < earnings.length - 1 ? "1px solid #E5E2DB" : "none",
                          }}>
                            <span style={{ color: "#374151" }}>
                              {d.description}
                              {d.reference && <span style={{ color: "#9CA3AF", marginLeft: 6, fontSize: 11 }}>({d.reference})</span>}
                            </span>
                            <span style={{ fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: "#16A34A" }}>
                              {formatCurrency(d.earnings)}
                            </span>
                          </div>
                        ))}
                        <div style={{
                          display: "flex", justifyContent: "space-between",
                          padding: "8px 0 0", marginTop: 4, fontWeight: 700, fontSize: 14,
                        }}>
                          <span style={{ color: "#374151" }}>Total Proventos</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#16A34A" }}>
                            {formatCurrency(selectedPaycheck.extracted_gross_value)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Descontos */}
                    {deductions.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#DC2626", marginBottom: 8 }}>
                          Descontos
                        </div>
                        {deductions.map((d, i) => (
                          <div key={i} style={{
                            display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13,
                            borderBottom: i < deductions.length - 1 ? "1px solid #E5E2DB" : "none",
                          }}>
                            <span style={{ color: "#374151" }}>
                              {d.description}
                              {d.reference && <span style={{ color: "#9CA3AF", marginLeft: 6, fontSize: 11 }}>({d.reference})</span>}
                            </span>
                            <span style={{ fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: "#DC2626" }}>
                              − {formatCurrency(d.deductions)}
                            </span>
                          </div>
                        ))}
                        <div style={{
                          display: "flex", justifyContent: "space-between",
                          padding: "8px 0 0", marginTop: 4, fontWeight: 700, fontSize: 14,
                        }}>
                          <span style={{ color: "#374151" }}>Total Descontos</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#DC2626" }}>
                            − {formatCurrency(selectedPaycheck.extracted_deductions)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Fallback simples se não tem details */}
                    {details.length === 0 && (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #E5E2DB", fontSize: 14 }}>
                          <span>Salário Bruto</span>
                          <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                            {formatCurrency(selectedPaycheck.extracted_gross_value)}
                          </span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #E5E2DB", fontSize: 14 }}>
                          <span>Descontos</span>
                          <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "#DC2626" }}>
                            − {formatCurrency(selectedPaycheck.extracted_deductions)}
                          </span>
                        </div>
                      </>
                    )}

                    {/* Ajustes escola */}
                    {selectedAdjustments.length > 0 && (
                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "2px dashed #E5E2DB" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#F59E0B", marginBottom: 8 }}>
                          Ajustes Adicionais
                        </div>
                        {selectedAdjustments.map((adj) => (
                          <div key={adj.id} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "6px 0", fontSize: 13,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{
                                width: 20, height: 20, borderRadius: "50%",
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                fontSize: 12, fontWeight: 700,
                                background: adj.type === "addition" ? "#22C55E" : "#EF4444", color: "#fff",
                              }}>{adj.type === "addition" ? "+" : "−"}</span>
                              <span style={{ color: "#374151" }}>{adj.description}</span>
                              {!["sent", "skipped"].includes(selectedPaycheck.status) && (
                                <button onClick={(e) => { e.stopPropagation(); removeAdjustment(adj.id); }} style={{
                                  background: "none", border: "none", cursor: "pointer",
                                  color: "#D1D5DB", fontSize: 14, padding: "0 4px",
                                }}>✕</button>
                              )}
                            </div>
                            <span style={{
                              fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
                              color: adj.type === "addition" ? "#16A34A" : "#DC2626",
                            }}>
                              {adj.type === "addition" ? "+" : "−"} {formatCurrency(adj.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Total */}
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

                  {/* Attachment */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 16px", borderRadius: 8,
                    background: "#F0F9FF", border: "1px solid #BAE6FD", marginBottom: 24,
                  }}>
                    <span style={{ fontSize: 24 }}>📎</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#0369A1" }}>
                        contracheque_{selectedCollaborator?.employee_code}_{periodLabel.replace(/ /g, "_")}.pdf
                      </div>
                      <div style={{ fontSize: 11, color: "#7DD3FC" }}>Página individual do contracheque</div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div style={{
                    borderTop: "1px solid #E5E2DB", paddingTop: 16,
                    fontSize: 12, color: "#9CA3AF", textAlign: "center", lineHeight: 1.6,
                  }}>
                    <p style={{ margin: 0 }}>Este e-mail foi enviado automaticamente pelo sistema de folha de pagamento.</p>
                    <p style={{ margin: "4px 0 0" }}>Em caso de dúvidas, entre em contato com o RH.</p>
                  </div>
                </div>
              </div>

              {/* ===== ACTIONS (fora do email) ===== */}
              {!["sent"].includes(selectedPaycheck.status) && (
                <div style={{ marginTop: 20 }}>
                  {/* Add adjustment */}
                  {!["skipped"].includes(selectedPaycheck.status) && (
                    <div style={{
                      background: "#fff", borderRadius: 12, padding: "16px 20px",
                      border: "1px solid #D1D5DB", marginBottom: 12,
                    }}>
                      <div style={{
                        fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                        letterSpacing: 1, color: "#9CA3AF", marginBottom: 12,
                      }}>Adicionar Ajuste</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ display: "flex" }}>
                          {[
                            { key: "addition", label: "+ Adicional", color: "#22C55E" },
                            { key: "deduction", label: "− Desconto", color: "#EF4444" },
                          ].map((t, i) => (
                            <button key={t.key}
                              onClick={() => setNewAdj((p) => ({ ...p, type: t.key }))}
                              style={{
                                padding: "7px 12px",
                                borderRadius: i === 0 ? "8px 0 0 8px" : "0 8px 8px 0",
                                fontSize: 12, fontWeight: 600, cursor: "pointer",
                                border: `1px solid ${newAdj.type === t.key ? t.color : "#E5E2DB"}`,
                                background: newAdj.type === t.key ? t.color : "#fff",
                                color: newAdj.type === t.key ? "#fff" : "#6B7280",
                              }}>{t.label}</button>
                          ))}
                        </div>
                        <select value={newAdj.category}
                          onChange={(e) => {
                            const cat = ADJUSTMENT_CATEGORIES.find((c) => c.value === e.target.value);
                            setNewAdj((p) => ({
                              ...p,
                              category: e.target.value,
                              description: cat ? cat.label : p.description,
                            }));
                          }}
                          style={{
                            padding: "7px 8px", borderRadius: 8,
                            border: "1px solid #E5E2DB", fontSize: 12, outline: "none",
                          }}>
                          {ADJUSTMENT_CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                        <input type="text" placeholder="Descrição (opcional)"
                          value={newAdj.description}
                          onChange={(e) => setNewAdj((p) => ({ ...p, description: e.target.value }))}
                          style={{
                            flex: 1, minWidth: 120, padding: "7px 10px", borderRadius: 8,
                            border: "1px solid #E5E2DB", fontSize: 12, outline: "none",
                          }}
                        />
                        <input type="number" placeholder="R$" step="0.01"
                          value={newAdj.value}
                          onChange={(e) => setNewAdj((p) => ({ ...p, value: e.target.value }))}
                          style={{
                            width: 90, padding: "7px 10px", borderRadius: 8,
                            border: "1px solid #E5E2DB", fontSize: 12, outline: "none",
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        />
                        <button onClick={addAdjustment} style={{
                          padding: "7px 16px", borderRadius: 8,
                          background: "#F59E0B", color: "#fff",
                          border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700,
                        }}>Adicionar</button>
                      </div>
                    </div>
                  )}

                  {/* Buttons */}
                  <div style={{ display: "flex", gap: 10 }}>
                    {["extracted", "pending_review"].includes(selectedPaycheck.status) && (
                      <>
                        <button onClick={validatePaycheck} style={{
                          flex: 1, padding: "13px 20px", borderRadius: 10,
                          background: "linear-gradient(135deg, #22C55E, #16A34A)",
                          color: "#fff", border: "none", cursor: "pointer",
                          fontSize: 14, fontWeight: 700,
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          boxShadow: "0 4px 12px rgba(34,197,94,0.3)",
                        }}>✓ Validar E-mail e Próximo</button>
                        <button onClick={skipPaycheck} style={{
                          padding: "13px 20px", borderRadius: 10,
                          background: "#fff", color: "#6B7280",
                          border: "2px solid #D1D5DB", cursor: "pointer",
                          fontSize: 14, fontWeight: 600,
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        }}>🚫 Não Enviar</button>
                      </>
                    )}
                    {selectedPaycheck.status === "reviewed" && (
                      <button onClick={unvalidatePaycheck} style={{
                        flex: 1, padding: "13px 20px", borderRadius: 10,
                        background: "#fff", color: "#F59E0B",
                        border: "2px solid #F59E0B", cursor: "pointer",
                        fontSize: 14, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      }}>↩ Reabrir para Edição</button>
                    )}
                    {selectedPaycheck.status === "skipped" && (
                      <button onClick={unvalidatePaycheck} style={{
                        flex: 1, padding: "13px 20px", borderRadius: 10,
                        background: "#fff", color: "#3B82F6",
                        border: "2px solid #3B82F6", cursor: "pointer",
                        fontSize: 14, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      }}>↩ Reativar Envio</button>
                    )}
                  </div>
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






































