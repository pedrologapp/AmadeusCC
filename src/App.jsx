import React, { useState, useEffect, useCallback, useRef } from "react";

const CONFIG = {
  SUPABASE_URL: "https://lzqhjutknqeuhscfxald.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6cWhqdXRrbnFldWhzY2Z4YWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4OTY0ODgsImV4cCI6MjA2OTQ3MjQ4OH0.AtiXJ2BpmulSUXo--bz_jKu0esAyS71kF33nWNE1YHk",
  N8N_WEBHOOK_PROCESS_PDF: "https://webhook.escolaamadeus.com/webhook/process-payroll-pdf",
  N8N_WEBHOOK_SEND_EMAILS: "https://webhook.escolaamadeus.com/webhook/send-payroll-emails",
  SCHOOL_NAME: "Escola Amadeus",
};

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
      method: "POST", headers: this.headers, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase insert error: ${res.statusText}`);
    return res.json();
  },
  async update(table, id, data) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH", headers: this.headers, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase update error: ${res.statusText}`);
    return res.json();
  },
  async delete(table, id) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE", headers: this.headers,
    });
    if (!res.ok) throw new Error(`Supabase delete error: ${res.statusText}`);
    return true;
  },
};

const formatCurrency = (value) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

const MONTH_NAMES = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
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

const PdfPageViewer = ({ pdfUrl }) => {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    const loadPdf = async () => {
      setLoading(true); setError(false);
      try {
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            if (document.getElementById("pdfjs-script")) {
              const check = setInterval(() => { if (window.pdfjsLib) { clearInterval(check); resolve(); } }, 100);
              setTimeout(() => { clearInterval(check); reject(new Error("timeout")); }, 10000);
              return;
            }
            const script = document.createElement("script");
            script.id = "pdfjs-script";
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            script.onload = () => {
              window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
              resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }
        const pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (cancelled) return;
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const viewport = page.getViewport({ scale: 1.5 });
          canvas.width = viewport.width; canvas.height = viewport.height;
          canvas.style.width = '100%'; canvas.style.height = 'auto';
          canvas.style.borderRadius = '8px'; canvas.style.border = '1px solid #E5E2DB';
          canvas.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
          if (i > 1) canvas.style.marginTop = '12px';
          await page.render({ canvasContext: ctx, viewport }).promise;
          container.appendChild(canvas);
        }
        setLoading(false);
      } catch (err) {
        console.error("Erro ao renderizar PDF:", err);
        if (!cancelled) { setError(true); setLoading(false); }
      }
    };
    loadPdf();
    return () => { cancelled = true; };
  }, [pdfUrl]);

  if (error) return (
    <div style={{ padding: 20, textAlign: "center", color: "#9CA3AF", background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }}>
      📄 Página do contracheque indisponível
    </div>
  );
  return (
    <div style={{ position: "relative", marginBottom: 16 }}>
      {loading && (
        <div style={{ padding: 20, textAlign: "center", color: "#6B7280", background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB" }}>
          <Spinner /><div style={{ fontSize: 12, marginTop: 8 }}>Carregando contracheque...</div>
        </div>
      )}
      <div ref={containerRef} style={{ display: loading ? "none" : "block" }} />
    </div>
  );
};

// ============================================================
// Main App
// ============================================================
export default function PayrollApp() {
  const [activeTab, setActiveTab] = useState("contracheques");
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
  const [duplicateWarnings, setDuplicateWarnings] = useState([]);

  // Proventos tab state
  const [presets, setPresets] = useState({});
  const [selectedCollabId, setSelectedCollabId] = useState(null);
  const [presetSearch, setPresetSearch] = useState("");
  const [newPreset, setNewPreset] = useState({ type: "addition", description: "", value: "", category: "other" });

  // Preset preview state
  const [showPresetPreview, setShowPresetPreview] = useState(false);
  const [editablePresets, setEditablePresets] = useState([]);
  const [applyingPresets, setApplyingPresets] = useState(false);

  const currentPeriod = periods.find((p) => p.id === currentPeriodId);
  const selectedPaycheck = paychecks.find((p) => p.id === selectedPaycheckId);
  const selectedCollaborator = selectedPaycheck ? collaborators.find((c) => c.id === selectedPaycheck.collaborator_id) : null;
  const selectedAdjustments = selectedPaycheckId ? adjustments[selectedPaycheckId] || [] : [];

  const filteredPaychecks = paychecks.filter((pc) => {
    const collab = collaborators.find((c) => c.id === pc.collaborator_id);
    if (!collab) return false;
    const matchesSearch = collab.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || (collab.role || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === "all" || (filterStatus === "pending_review" && ["extracted", "pending_review"].includes(pc.status)) || pc.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: paychecks.length,
    pending: paychecks.filter((p) => ["extracted", "pending_review"].includes(p.status)).length,
    reviewed: paychecks.filter((p) => ["reviewed", "approved"].includes(p.status)).length,
    sent: paychecks.filter((p) => p.status === "sent").length,
    skipped: paychecks.filter((p) => p.status === "skipped").length,
  };

  // Proventos derived
  const selectedPresetCollab = collaborators.find((c) => c.id === selectedCollabId);
  const selectedPresets = selectedCollabId ? (presets[selectedCollabId] || []).filter(p => p.is_active) : [];
  const filteredCollabs = collaborators.filter((c) =>
    c.full_name.toLowerCase().includes(presetSearch.toLowerCase()) ||
    (c.role || "").toLowerCase().includes(presetSearch.toLowerCase())
  );
  const presetTotalAdd = selectedPresets.filter(p => p.type === 'addition').reduce((s, p) => s + p.value, 0);
  const presetTotalDed = selectedPresets.filter(p => p.type === 'deduction').reduce((s, p) => s + p.value, 0);

  // ============================================================
  // Data Loading
  // ============================================================
  const loadCollaborators = useCallback(async () => {
    try { const data = await supabase.select("collaborators", "is_active=eq.true", "full_name.asc"); setCollaborators(data); } catch (err) { console.error(err); }
  }, []);

  const loadPeriods = useCallback(async () => {
    try { const data = await supabase.select("payroll_periods", "", "reference_year.desc,reference_month.desc"); setPeriods(data); return data; } catch (err) { console.error(err); return []; }
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
    } catch (err) { console.error(err); }
  }, [currentPeriodId]);

  const loadPresets = useCallback(async () => {
    try {
      const data = await supabase.select("collaborator_presets", "", "created_at.asc");
      const map = {};
      for (const p of data) { if (!map[p.collaborator_id]) map[p.collaborator_id] = []; map[p.collaborator_id].push(p); }
      setPresets(map);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadCollaborators();
      const data = await loadPeriods();
      await loadPresets();
      if (data.length > 0) { setCurrentPeriodId(data[0].id); setRefMonth(data[0].reference_month); setRefYear(data[0].reference_year); }
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (currentPeriodId) { loadPaychecks(currentPeriodId); setSelectedPaycheckId(null); }
  }, [currentPeriodId]);

  const handleMonthYearChange = useCallback((month, year) => {
    setRefMonth(month); setRefYear(year);
    const found = periods.find((p) => p.reference_month === month && p.reference_year === year);
    if (found) { setCurrentPeriodId(found.id); } else { setCurrentPeriodId(null); setPaychecks([]); setAdjustments({}); setSelectedPaycheckId(null); }
  }, [periods]);

  // ============================================================
  // Contracheques Actions
  // ============================================================
  const handlePdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { setError("Por favor, selecione um arquivo PDF."); return; }
    setUploading(true); setUploadProgress("Enviando PDF para processamento..."); setError(null); setDuplicateWarnings([]);
    try {
      const formData = new FormData();
      formData.append("file", file); formData.append("reference_month", String(refMonth)); formData.append("reference_year", String(refYear));
      const res = await fetch(CONFIG.N8N_WEBHOOK_PROCESS_PDF, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Erro ao enviar PDF");
      await res.json();
      setUploadProgress("PDF enviado! A IA está processando...");
      const sm = String(refMonth); const sy = String(refYear);
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++; setUploadProgress(`Processando... (verificação ${attempts})`);
        if (attempts > 60) { clearInterval(poll); setUploadProgress("Processamento demorou. Recarregue a página."); setUploading(false); return; }
        try {
          const found = await supabase.select("payroll_periods", `reference_month=eq.${sm}&reference_year=eq.${sy}`, "created_at.desc");
          if (found.length > 0 && found[0].status !== "processing") {
            clearInterval(poll);
            setCurrentPeriodId(found[0].id); setRefMonth(found[0].reference_month); setRefYear(found[0].reference_year);
            await loadPeriods(); await loadPaychecks(found[0].id);
            try {
              const logs = await supabase.select("processing_logs", `payroll_period_id=eq.${found[0].id}&action=eq.duplicate_skipped`, "created_at.desc");
              if (logs.length > 0) { setDuplicateWarnings(logs.map(l => { try { return JSON.parse(l.details); } catch { return { message: "Duplicado" }; } })); }
            } catch (e) {}
            setUploadProgress(""); setUploading(false);
          }
        } catch (err) { console.error(err); }
      }, 5000);
    } catch (err) { setError(`Erro: ${err.message}`); setUploading(false); setUploadProgress(""); }
  };

  const addAdjustment = async () => {
    if (!selectedPaycheckId || !newAdj.value) return;
    const catLabel = ADJUSTMENT_CATEGORIES.find((c) => c.value === newAdj.category)?.label || "";
    const desc = newAdj.description || catLabel || "Ajuste";
    try {
      await supabase.insert("adjustments", { paycheck_id: selectedPaycheckId, type: newAdj.type, description: desc, value: parseFloat(newAdj.value), category: newAdj.category });
      setNewAdj({ type: "addition", description: "", value: "", category: "other" });
      await loadPaychecks();
    } catch (err) { setError(`Erro ao adicionar ajuste: ${err.message}`); }
  };

  const removeAdjustment = async (adjId) => {
    try { await supabase.delete("adjustments", adjId); await loadPaychecks(); } catch (err) { setError(`Erro: ${err.message}`); }
  };

  const validatePaycheck = async () => {
    if (!selectedPaycheckId) return;
    try {
      await supabase.update("paychecks", selectedPaycheckId, { status: "reviewed" });
      await loadPaychecks();
      const idx = filteredPaychecks.findIndex((p) => p.id === selectedPaycheckId);
      const next = filteredPaychecks[idx + 1];
      if (next) setSelectedPaycheckId(next.id);
    } catch (err) { setError(`Erro: ${err.message}`); }
  };

  const skipPaycheck = async () => {
    if (!selectedPaycheckId) return;
    try {
      await supabase.update("paychecks", selectedPaycheckId, { status: "skipped" });
      await loadPaychecks();
      const idx = filteredPaychecks.findIndex((p) => p.id === selectedPaycheckId);
      const next = filteredPaychecks[idx + 1];
      if (next) setSelectedPaycheckId(next.id);
    } catch (err) { setError(`Erro: ${err.message}`); }
  };

  const unvalidatePaycheck = async () => {
    if (!selectedPaycheckId) return;
    try { await supabase.update("paychecks", selectedPaycheckId, { status: "pending_review" }); await loadPaychecks(); } catch (err) { setError(`Erro: ${err.message}`); }
  };

  const sendBatchEmails = async () => {
    if (!currentPeriodId) return;
    setSending(true); setError(null);
    try {
      const res = await fetch(CONFIG.N8N_WEBHOOK_SEND_EMAILS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period_id: currentPeriodId }) });
      if (!res.ok) throw new Error("Erro ao disparar envio");
      const poll = setInterval(async () => { await loadPaychecks(); const remaining = paychecks.filter((p) => p.status === "reviewed").length; if (remaining === 0) { clearInterval(poll); setSending(false); } }, 3000);
      setTimeout(() => { clearInterval(poll); setSending(false); }, 120000);
    } catch (err) { setError(`Erro: ${err.message}`); setSending(false); }
  };

  // Open preset preview for editing before applying
  const openPresetPreview = () => {
    if (!selectedPaycheck) return;
    const collabId = selectedPaycheck.collaborator_id;
    const collabPresets = (presets[collabId] || []).filter(p => p.is_active);
    if (collabPresets.length === 0) { setError("Nenhum preset configurado. Configure na aba Proventos."); return; }
    setEditablePresets(collabPresets.map(p => ({ ...p, _enabled: true })));
    setShowPresetPreview(true);
  };

  // Actually apply the edited presets
  const confirmApplyPresets = async () => {
    if (!selectedPaycheckId) return;
    const toApply = editablePresets.filter(p => p._enabled);
    if (toApply.length === 0) { setShowPresetPreview(false); return; }
    setApplyingPresets(true);
    try {
      for (const preset of toApply) {
        await supabase.insert("adjustments", {
          paycheck_id: selectedPaycheckId,
          type: preset.type,
          description: preset.description,
          value: preset.value,
          category: preset.category,
        });
      }
      await loadPaychecks();
      setShowPresetPreview(false);
      setApplyingPresets(false);
    } catch (err) { setError(`Erro ao aplicar: ${err.message}`); setApplyingPresets(false); }
  };

  const updateEditablePreset = (index, field, value) => {
    setEditablePresets(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: field === 'value' ? parseFloat(value) || 0 : value };
      return updated;
    });
  };

  const toggleEditablePreset = (index) => {
    setEditablePresets(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], _enabled: !updated[index]._enabled };
      return updated;
    });
  };

  const getTotal = (pc) => {
    if (!pc) return 0;
    const base = pc.extracted_net_value || 0;
    const adjs = adjustments[pc.id] || [];
    return adjs.reduce((sum, a) => sum + (a.type === "addition" ? a.value : -a.value), base);
  };

  const getExtractedDetails = (pc) => {
    if (!pc?.ai_extracted_data) return [];
    try { const d = typeof pc.ai_extracted_data === "string" ? JSON.parse(pc.ai_extracted_data) : pc.ai_extracted_data; return Array.isArray(d) ? d : []; } catch { return []; }
  };

  // ============================================================
  // Presets Actions
  // ============================================================
  const addPreset = async () => {
    if (!selectedCollabId || !newPreset.value) return;
    const catLabel = ADJUSTMENT_CATEGORIES.find((c) => c.value === newPreset.category)?.label || "";
    const desc = newPreset.description || catLabel || "Ajuste";
    try {
      await supabase.insert("collaborator_presets", {
        collaborator_id: selectedCollabId, type: newPreset.type, description: desc,
        value: parseFloat(newPreset.value), category: newPreset.category, is_active: true,
      });
      setNewPreset({ type: "addition", description: "", value: "", category: "other" });
      await loadPresets();
    } catch (err) { setError(`Erro: ${err.message}`); }
  };

  const removePreset = async (presetId) => {
    try { await supabase.delete("collaborator_presets", presetId); await loadPresets(); } catch (err) { setError(`Erro: ${err.message}`); }
  };

  const togglePreset = async (preset) => {
    try { await supabase.update("collaborator_presets", preset.id, { is_active: !preset.is_active }); await loadPresets(); } catch (err) { setError(`Erro: ${err.message}`); }
  };

  // ============================================================
  // Render
  // ============================================================
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8F7F4", fontFamily: "'Outfit', 'Segoe UI', sans-serif" }}>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center" }}><Spinner /><p style={{ marginTop: 12, color: "#6B7280", fontSize: 14 }}>Carregando dados...</p></div>
      </div>
    );
  }

  const periodLabel = currentPeriod ? `${MONTH_NAMES[currentPeriod.reference_month - 1]} ${currentPeriod.reference_year}` : `${MONTH_NAMES[refMonth - 1]} ${refYear}`;
  const pdfUrl = selectedPaycheck?.individual_pdf_path ? `https://cc.escolaamadeus.com/api/split-pdf?url=${encodeURIComponent(CONFIG.SUPABASE_URL + '/storage/v1/object/public/' + selectedPaycheck.individual_pdf_path)}&pages=${selectedPaycheck.page_numbers ? selectedPaycheck.page_numbers.join(',') : (selectedPaycheck.pdf_page_number || 1)}` : null;
  const details = selectedPaycheck ? getExtractedDetails(selectedPaycheck) : [];
  const earnings = details.filter((d) => d.earnings > 0);
  const deductions = details.filter((d) => d.deductions > 0);
  const paycheckCollabPresets = selectedPaycheck ? (presets[selectedPaycheck.collaborator_id] || []).filter(p => p.is_active) : [];

  // Preview totals
  const previewEnabled = editablePresets.filter(p => p._enabled);
  const previewTotalAdd = previewEnabled.filter(p => p.type === 'addition').reduce((s, p) => s + (p.value || 0), 0);
  const previewTotalDed = previewEnabled.filter(p => p.type === 'deduction').reduce((s, p) => s + (p.value || 0), 0);

  return (
    <div style={{ minHeight: "100vh", background: "#F8F7F4", fontFamily: "'Outfit', 'Segoe UI', sans-serif", color: "#1a1a1a" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <header style={{
        background: "#1B2A4A", color: "#fff", padding: "0 32px", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(27,42,74,0.15)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #F59E0B, #EF4444)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800 }}>₵</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>ContraCheque</div>
            <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1, textTransform: "uppercase" }}>Sistema de Folha de Pagamento</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: 2 }}>
            {[{ key: "contracheques", label: "📋 Contracheques" }, { key: "proventos", label: "💰 Proventos" }].map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                background: activeTab === tab.key ? "rgba(255,255,255,0.2)" : "transparent",
                color: activeTab === tab.key ? "#fff" : "rgba(255,255,255,0.6)",
              }}>{tab.label}</button>
            ))}
          </div>
          {activeTab === "contracheques" && periods.length > 0 && (
            <select value={currentPeriodId || ""} onChange={(e) => { const p = periods.find((x) => x.id === e.target.value); if (p) { setCurrentPeriodId(p.id); setRefMonth(p.reference_month); setRefYear(p.reference_year); } }}
              style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 500, cursor: "pointer", outline: "none" }}>
              {periods.map((p) => (<option key={p.id} value={p.id} style={{ color: "#1a1a1a" }}>{MONTH_NAMES[p.reference_month - 1]} {p.reference_year}</option>))}
            </select>
          )}
        </div>
      </header>

      {error && (
        <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#991B1B", padding: "10px 24px", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#991B1B", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      {duplicateWarnings.length > 0 && activeTab === "contracheques" && (
        <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", color: "#92400E", padding: "12px 24px", fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontWeight: 700 }}>⚠️ {[...new Set(duplicateWarnings.map((w) => w.collaborator).filter(Boolean))].length} contracheque(s) ignorado(s) (já existiam)</span>
            <button onClick={() => setDuplicateWarnings([])} style={{ background: "none", border: "none", color: "#92400E", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: "#A16207" }}>{[...new Set(duplicateWarnings.map((w) => w.collaborator).filter(Boolean))].join(", ")}</div>
        </div>
      )}

      {/* ============================================================ */}
      {/* PRESET PREVIEW MODAL */}
      {/* ============================================================ */}
      {showPresetPreview && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", zIndex: 200,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowPresetPreview(false)}>
          <div style={{
            background: "#fff", borderRadius: 16, width: 560, maxHeight: "80vh",
            overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }} onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #E5E2DB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#1B2A4A" }}>Revisar Presets antes de Aplicar</div>
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{selectedCollaborator?.full_name} — Edite valores ou desmarque itens</div>
              </div>
              <button onClick={() => setShowPresetPreview(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#9CA3AF" }}>✕</button>
            </div>

            {/* Preset Items */}
            <div style={{ padding: "16px 24px" }}>
              {editablePresets.map((preset, idx) => (
                <div key={idx} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "12px 0",
                  borderBottom: idx < editablePresets.length - 1 ? "1px solid #F3F0EB" : "none",
                  opacity: preset._enabled ? 1 : 0.4,
                }}>
                  {/* Checkbox */}
                  <button onClick={() => toggleEditablePreset(idx)} style={{
                    width: 22, height: 22, borderRadius: 6, border: `2px solid ${preset._enabled ? "#3B82F6" : "#D1D5DB"}`,
                    background: preset._enabled ? "#3B82F6" : "#fff", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", fontSize: 12, fontWeight: 700, flexShrink: 0,
                  }}>{preset._enabled ? "✓" : ""}</button>

                  {/* Type indicator */}
                  <span style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 700,
                    background: preset.type === "addition" ? "#22C55E" : "#EF4444", color: "#fff",
                  }}>{preset.type === "addition" ? "+" : "−"}</span>

                  {/* Description (editable) */}
                  <input type="text" value={preset.description}
                    onChange={(e) => updateEditablePreset(idx, 'description', e.target.value)}
                    disabled={!preset._enabled}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 6,
                      border: "1px solid #E5E2DB", fontSize: 13, outline: "none",
                      background: preset._enabled ? "#fff" : "#F9FAFB",
                      color: "#374151",
                    }}
                  />

                  {/* Category badge */}
                  <span style={{ fontSize: 10, color: "#9CA3AF", background: "#F3F4F6", padding: "3px 6px", borderRadius: 4, flexShrink: 0 }}>
                    {ADJUSTMENT_CATEGORIES.find(c => c.value === preset.category)?.label || preset.category}
                  </span>

                  {/* Value (editable) */}
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#9CA3AF" }}>R$</span>
                    <input type="number" step="0.01" value={preset.value}
                      onChange={(e) => updateEditablePreset(idx, 'value', e.target.value)}
                      disabled={!preset._enabled}
                      style={{
                        width: 100, padding: "6px 10px 6px 30px", borderRadius: 6,
                        border: "1px solid #E5E2DB", fontSize: 13, outline: "none",
                        fontFamily: "'JetBrains Mono', monospace", textAlign: "right",
                        background: preset._enabled ? "#fff" : "#F9FAFB",
                        color: preset.type === "addition" ? "#16A34A" : "#DC2626",
                      }}
                    />
                  </div>
                </div>
              ))}

              {/* Preview Totals */}
              <div style={{ borderTop: "2px solid #1B2A4A", marginTop: 12, paddingTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                  <span style={{ color: "#6B7280" }}>{previewEnabled.length} de {editablePresets.length} selecionados</span>
                </div>
                {previewTotalAdd > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                    <span style={{ color: "#374151", fontWeight: 600 }}>Proventos</span>
                    <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "#16A34A" }}>+{formatCurrency(previewTotalAdd)}</span>
                  </div>
                )}
                {previewTotalDed > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                    <span style={{ color: "#374151", fontWeight: 600 }}>Descontos</span>
                    <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "#DC2626" }}>−{formatCurrency(previewTotalDed)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", fontSize: 15, fontWeight: 700 }}>
                  <span style={{ color: "#1B2A4A" }}>Impacto Total</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: (previewTotalAdd - previewTotalDed) >= 0 ? "#16A34A" : "#DC2626" }}>
                    {(previewTotalAdd - previewTotalDed) >= 0 ? "+" : ""}{formatCurrency(previewTotalAdd - previewTotalDed)}
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid #E5E2DB", display: "flex", gap: 10 }}>
              <button onClick={() => setShowPresetPreview(false)} style={{
                flex: 1, padding: "11px 16px", borderRadius: 8, background: "#fff", color: "#6B7280",
                border: "1px solid #D1D5DB", cursor: "pointer", fontSize: 13, fontWeight: 600,
              }}>Cancelar</button>
              <button onClick={confirmApplyPresets} disabled={applyingPresets || previewEnabled.length === 0} style={{
                flex: 2, padding: "11px 16px", borderRadius: 8, color: "#fff", border: "none",
                cursor: previewEnabled.length === 0 ? "default" : "pointer", fontSize: 13, fontWeight: 700,
                background: previewEnabled.length === 0 ? "#9CA3AF" : "linear-gradient(135deg, #3B82F6, #1D4ED8)",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                boxShadow: previewEnabled.length > 0 ? "0 2px 8px rgba(59,130,246,0.3)" : "none",
              }}>
                {applyingPresets ? <><Spinner /> Aplicando...</> : <>✓ Aplicar {previewEnabled.length} Ajuste{previewEnabled.length !== 1 ? "s" : ""}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* CONTRACHEQUES TAB */}
      {/* ============================================================ */}
      {activeTab === "contracheques" && (
        <div style={{ display: "flex", height: "calc(100vh - 64px)" }}>
          {/* LEFT PANEL */}
          <div style={{ width: 380, borderRight: "1px solid #E5E2DB", display: "flex", flexDirection: "column", background: "#FFFFFF" }}>
            <div style={{ padding: 20, borderBottom: "1px solid #E5E2DB" }}>
              {uploading ? (
                <div style={{ padding: 20, borderRadius: 12, background: "#FFFBEB", border: "1px solid #FCD34D", textAlign: "center" }}>
                  <Spinner /><div style={{ fontSize: 13, fontWeight: 600, color: "#92400E", marginTop: 8 }}>{uploadProgress}</div>
                </div>
              ) : (
                <div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <select value={refMonth} onChange={(e) => handleMonthYearChange(Number(e.target.value), refYear)} style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 13, outline: "none" }}>
                      {MONTH_NAMES.map((m, i) => (<option key={i} value={i + 1}>{m}</option>))}
                    </select>
                    <input type="number" value={refYear} onChange={(e) => handleMonthYearChange(refMonth, Number(e.target.value))} style={{ width: 80, padding: "6px 8px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 13, outline: "none" }} />
                  </div>
                  <label style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 20, borderRadius: 12, border: "2px dashed #CBD5E1", background: "#F8FAFC", cursor: "pointer", gap: 8 }}>
                    <input type="file" accept=".pdf" onChange={handlePdfUpload} style={{ display: "none" }} />
                    <span style={{ fontSize: 28 }}>📄</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A" }}>Upload do PDF de Contracheques</span>
                    <span style={{ fontSize: 11, color: "#94A3B8" }}>Selecione o mês/ano e clique aqui</span>
                  </label>
                </div>
              )}
            </div>

            {paychecks.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, padding: "12px 20px", borderBottom: "1px solid #E5E2DB" }}>
                {[{ label: "Pendentes", value: stats.pending, color: "#F59E0B" }, { label: "Validados", value: stats.reviewed, color: "#22C55E" }, { label: "Pular", value: stats.skipped, color: "#9CA3AF" }, { label: "Enviados", value: stats.sent, color: "#3B82F6" }].map((s) => (
                  <div key={s.label} style={{ textAlign: "center", padding: "6px 2px", borderRadius: 8, background: "#F8F7F4" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
                    <div style={{ fontSize: 9, color: "#6B7280", fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {paychecks.length > 0 && (
              <div style={{ padding: "12px 20px", borderBottom: "1px solid #E5E2DB" }}>
                <input type="text" placeholder="Buscar colaborador..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 13, background: "#F8F7F4", outline: "none", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {[{ key: "all", label: "Todos" }, { key: "pending_review", label: "Pendentes" }, { key: "reviewed", label: "Validados" }, { key: "skipped", label: "Não Enviar" }, { key: "sent", label: "Enviados" }].map((f) => (
                    <button key={f.key} onClick={() => setFilterStatus(f.key)} style={{
                      padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: "1px solid",
                      borderColor: filterStatus === f.key ? "#1B2A4A" : "#E5E2DB", background: filterStatus === f.key ? "#1B2A4A" : "transparent", color: filterStatus === f.key ? "#fff" : "#6B7280", cursor: "pointer",
                    }}>{f.label}</button>
                  ))}
                </div>
              </div>
            )}

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
                const hasPresets = (presets[pc.collaborator_id] || []).filter(p => p.is_active).length > 0;
                return (
                  <div key={pc.id} onClick={() => setSelectedPaycheckId(pc.id)} style={{
                    padding: "14px 20px", borderBottom: "1px solid #F3F0EB", cursor: "pointer",
                    background: selectedPaycheckId === pc.id ? "#FEF9EE" : "transparent",
                    borderLeft: selectedPaycheckId === pc.id ? "3px solid #F59E0B" : "3px solid transparent",
                    opacity: pc.status === "skipped" ? 0.5 : 1,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A", marginBottom: 2 }}>{collab.full_name}</div>
                        <div style={{ fontSize: 11, color: "#6B7280" }}>{collab.role}</div>
                      </div>
                      <StatusBadge status={pc.status} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "#1B2A4A" }}>{formatCurrency(getTotal(pc))}</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        {pcAdjs.length > 0 && <span style={{ fontSize: 10, color: "#F59E0B", fontWeight: 600, background: "#FEF3C7", padding: "2px 6px", borderRadius: 4 }}>{pcAdjs.length} ajuste{pcAdjs.length > 1 ? "s" : ""}</span>}
                        {hasPresets && pcAdjs.length === 0 && ["extracted", "pending_review"].includes(pc.status) && <span style={{ fontSize: 10, color: "#3B82F6", fontWeight: 600, background: "#DBEAFE", padding: "2px 6px", borderRadius: 4 }}>preset</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {stats.reviewed > 0 && (
              <div style={{ padding: 16, borderTop: "1px solid #E5E2DB" }}>
                <button onClick={sendBatchEmails} disabled={sending} style={{
                  width: "100%", padding: "12px 20px", borderRadius: 10,
                  background: sending ? "#9CA3AF" : "linear-gradient(135deg, #1B2A4A, #2D4A7A)",
                  color: "#fff", border: "none", cursor: sending ? "default" : "pointer", fontSize: 14, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 12px rgba(27,42,74,0.3)",
                }}>{sending ? <><Spinner /> Enviando...</> : <>📧 Enviar {stats.reviewed} e-mail{stats.reviewed > 1 ? "s" : ""}</>}</button>
              </div>
            )}
          </div>

          {/* RIGHT PANEL */}
          <div style={{ flex: 1, overflowY: "auto", padding: 32, background: "#EDEAE5" }}>
            {!selectedPaycheck ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#9CA3AF" }}>
                <span style={{ fontSize: 56, marginBottom: 16, opacity: 0.5 }}>📋</span>
                <div style={{ fontSize: 18, fontWeight: 600, color: "#6B7280" }}>Selecione um colaborador</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>Clique em um nome na lista para pré-visualizar o e-mail</div>
              </div>
            ) : (
              <div style={{ maxWidth: 680, margin: "0 auto" }}>
                {/* Envelope */}
                <div style={{ background: "#fff", borderRadius: "12px 12px 0 0", padding: "16px 24px", border: "1px solid #D1D5DB", borderBottom: "none", fontSize: 13, color: "#6B7280" }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 6 }}><span style={{ fontWeight: 600, color: "#374151", minWidth: 50 }}>Para:</span><span>{selectedCollaborator?.full_name} &lt;{selectedCollaborator?.email}&gt;</span></div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 6 }}><span style={{ fontWeight: 600, color: "#374151", minWidth: 50 }}>De:</span><span>{CONFIG.SCHOOL_NAME} &lt;rh@escolaamadeus.com&gt;</span></div>
                  <div style={{ display: "flex", gap: 8 }}><span style={{ fontWeight: 600, color: "#374151", minWidth: 50 }}>Assunto:</span><span>Seu Contracheque — {periodLabel}</span></div>
                </div>

                {/* Email body */}
                <div style={{ background: "#fff", border: "1px solid #D1D5DB", borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
                  <div style={{ background: "#1B2A4A", padding: "24px 32px", color: "#fff", textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{CONFIG.SCHOOL_NAME}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>Contracheque — {periodLabel}</div>
                  </div>
                  <div style={{ padding: "28px 32px" }}>
                    <p style={{ fontSize: 15, color: "#374151", lineHeight: 1.6, margin: "0 0 8px" }}>Olá, <strong>{selectedCollaborator?.full_name?.split(" ")[0]}</strong>!</p>
                    <p style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.6, margin: "0 0 24px" }}>Segue o resumo do seu contracheque referente a <strong>{periodLabel}</strong>. O PDF completo está anexo neste e-mail.</p>

                    {pdfUrl && selectedPaycheck?.pdf_page_number && (
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "#9CA3AF", marginBottom: 10 }}>
                          Contracheque — Página{selectedPaycheck.page_numbers?.length > 1 ? 's' : ''} {selectedPaycheck.page_numbers ? selectedPaycheck.page_numbers.join(', ') : selectedPaycheck.pdf_page_number}
                        </div>
                        <PdfPageViewer pdfUrl={pdfUrl} />
                      </div>
                    )}

                    <div style={{ background: "#F8F7F4", borderRadius: 12, padding: "20px 24px", border: "1px solid #E5E2DB", marginBottom: 24 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "#9CA3AF", marginBottom: 16 }}>Resumo Salarial</div>
                      {earnings.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#16A34A", marginBottom: 8 }}>Proventos</div>
                          {earnings.map((d, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: i < earnings.length - 1 ? "1px solid #E5E2DB" : "none" }}>
                              <span style={{ color: "#374151" }}>{d.description}{d.reference && <span style={{ color: "#9CA3AF", marginLeft: 6, fontSize: 11 }}>({d.reference})</span>}</span>
                              <span style={{ fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: "#16A34A" }}>{formatCurrency(d.earnings)}</span>
                            </div>
                          ))}
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", marginTop: 4, fontWeight: 700, fontSize: 14 }}>
                            <span style={{ color: "#374151" }}>Total Proventos</span><span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#16A34A" }}>{formatCurrency(selectedPaycheck.extracted_gross_value)}</span>
                          </div>
                        </div>
                      )}
                      {deductions.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#DC2626", marginBottom: 8 }}>Descontos</div>
                          {deductions.map((d, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: i < deductions.length - 1 ? "1px solid #E5E2DB" : "none" }}>
                              <span style={{ color: "#374151" }}>{d.description}{d.reference && <span style={{ color: "#9CA3AF", marginLeft: 6, fontSize: 11 }}>({d.reference})</span>}</span>
                              <span style={{ fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: "#DC2626" }}>− {formatCurrency(d.deductions)}</span>
                            </div>
                          ))}
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", marginTop: 4, fontWeight: 700, fontSize: 14 }}>
                            <span style={{ color: "#374151" }}>Total Descontos</span><span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#DC2626" }}>− {formatCurrency(selectedPaycheck.extracted_deductions)}</span>
                          </div>
                        </div>
                      )}
                      {details.length === 0 && (
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #E5E2DB", fontSize: 14 }}><span>Salário Bruto</span><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(selectedPaycheck.extracted_gross_value)}</span></div>
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #E5E2DB", fontSize: 14 }}><span>Descontos</span><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "#DC2626" }}>− {formatCurrency(selectedPaycheck.extracted_deductions)}</span></div>
                        </>
                      )}
                      {selectedAdjustments.length > 0 && (
                        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "2px dashed #E5E2DB" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#F59E0B", marginBottom: 8 }}>Ajustes Adicionais</div>
                          {selectedAdjustments.map((adj) => (
                            <div key={adj.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ width: 20, height: 20, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: adj.type === "addition" ? "#22C55E" : "#EF4444", color: "#fff" }}>{adj.type === "addition" ? "+" : "−"}</span>
                                <span style={{ color: "#374151" }}>{adj.description}</span>
                                {!["sent", "skipped"].includes(selectedPaycheck.status) && (
                                  <button onClick={(e) => { e.stopPropagation(); removeAdjustment(adj.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#D1D5DB", fontSize: 14, padding: "0 4px" }}>✕</button>
                                )}
                              </div>
                              <span style={{ fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: adj.type === "addition" ? "#16A34A" : "#DC2626" }}>{adj.type === "addition" ? "+" : "−"} {formatCurrency(adj.value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0 0", marginTop: 16, borderTop: "2px solid #1B2A4A" }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: "#1B2A4A" }}>Total a Receber</span>
                        <span style={{ fontSize: 26, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: getTotal(selectedPaycheck) >= 0 ? "#16A34A" : "#DC2626" }}>{formatCurrency(getTotal(selectedPaycheck))}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 8, background: "#F0F9FF", border: "1px solid #BAE6FD", marginBottom: 24 }}>
                      <span style={{ fontSize: 24 }}>📎</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#0369A1" }}>contracheque_{selectedCollaborator?.employee_code}_{periodLabel.replace(/ /g, "_")}.pdf</div>
                        <div style={{ fontSize: 11, color: "#7DD3FC" }}>Página individual do contracheque</div>
                      </div>
                    </div>

                    <div style={{ borderTop: "1px solid #E5E2DB", paddingTop: 16, fontSize: 12, color: "#9CA3AF", textAlign: "center", lineHeight: 1.6 }}>
                      <p style={{ margin: 0 }}>Este e-mail foi enviado automaticamente pelo sistema de folha de pagamento.</p>
                      <p style={{ margin: "4px 0 0" }}>Em caso de dúvidas, entre em contato com o RH.</p>
                    </div>
                  </div>
                </div>

                {/* ACTIONS */}
                {!["sent"].includes(selectedPaycheck.status) && (
                  <div style={{ marginTop: 20 }}>
                    {/* Apply Presets Button */}
                    {paycheckCollabPresets.length > 0 && selectedAdjustments.length === 0 && !["skipped", "reviewed"].includes(selectedPaycheck.status) && (
                      <button onClick={openPresetPreview} style={{
                        width: "100%", padding: "10px 16px", borderRadius: 10, marginBottom: 12,
                        background: "linear-gradient(135deg, #3B82F6, #1D4ED8)", color: "#fff",
                        border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        boxShadow: "0 2px 8px rgba(59,130,246,0.3)",
                      }}>💰 Revisar e Aplicar {paycheckCollabPresets.length} Preset{paycheckCollabPresets.length > 1 ? "s" : ""}</button>
                    )}

                    {!["skipped"].includes(selectedPaycheck.status) && (
                      <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", border: "1px solid #D1D5DB", marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "#9CA3AF", marginBottom: 12 }}>Adicionar Ajuste</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ display: "flex" }}>
                            {[{ key: "addition", label: "+ Adicional", color: "#22C55E" }, { key: "deduction", label: "− Desconto", color: "#EF4444" }].map((t, i) => (
                              <button key={t.key} onClick={() => setNewAdj((p) => ({ ...p, type: t.key }))} style={{
                                padding: "7px 12px", borderRadius: i === 0 ? "8px 0 0 8px" : "0 8px 8px 0", fontSize: 12, fontWeight: 600, cursor: "pointer",
                                border: `1px solid ${newAdj.type === t.key ? t.color : "#E5E2DB"}`, background: newAdj.type === t.key ? t.color : "#fff", color: newAdj.type === t.key ? "#fff" : "#6B7280",
                              }}>{t.label}</button>
                            ))}
                          </div>
                          <select value={newAdj.category} onChange={(e) => { const cat = ADJUSTMENT_CATEGORIES.find((c) => c.value === e.target.value); setNewAdj((p) => ({ ...p, category: e.target.value, description: cat ? cat.label : p.description })); }}
                            style={{ padding: "7px 8px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 12, outline: "none" }}>
                            {ADJUSTMENT_CATEGORIES.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
                          </select>
                          <input type="text" placeholder="Descrição (opcional)" value={newAdj.description} onChange={(e) => setNewAdj((p) => ({ ...p, description: e.target.value }))}
                            style={{ flex: 1, minWidth: 120, padding: "7px 10px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 12, outline: "none" }} />
                          <input type="number" placeholder="R$" step="0.01" value={newAdj.value} onChange={(e) => setNewAdj((p) => ({ ...p, value: e.target.value }))}
                            style={{ width: 90, padding: "7px 10px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 12, outline: "none", fontFamily: "'JetBrains Mono', monospace" }} />
                          <button onClick={addAdjustment} style={{ padding: "7px 16px", borderRadius: 8, background: "#F59E0B", color: "#fff", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Adicionar</button>
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 10 }}>
                      {["extracted", "pending_review"].includes(selectedPaycheck.status) && (
                        <>
                          <button onClick={validatePaycheck} style={{ flex: 1, padding: "13px 20px", borderRadius: 10, background: "linear-gradient(135deg, #22C55E, #16A34A)", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 12px rgba(34,197,94,0.3)" }}>✓ Validar E-mail e Próximo</button>
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); skipPaycheck(); }} style={{ padding: "13px 24px", borderRadius: 10, background: "#fff", color: "#6B7280", border: "2px solid #D1D5DB", cursor: "pointer", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 160 }}>🚫 Não Enviar</button>
                        </>
                      )}
                      {selectedPaycheck.status === "reviewed" && (
                        <button onClick={unvalidatePaycheck} style={{ flex: 1, padding: "13px 20px", borderRadius: 10, background: "#fff", color: "#F59E0B", border: "2px solid #F59E0B", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>↩ Reabrir para Edição</button>
                      )}
                      {selectedPaycheck.status === "skipped" && (
                        <button onClick={unvalidatePaycheck} style={{ flex: 1, padding: "13px 20px", borderRadius: 10, background: "#fff", color: "#3B82F6", border: "2px solid #3B82F6", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>↩ Reativar Envio</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* PROVENTOS TAB */}
      {/* ============================================================ */}
      {activeTab === "proventos" && (
        <div style={{ display: "flex", height: "calc(100vh - 64px)" }}>
          <div style={{ width: 380, borderRight: "1px solid #E5E2DB", display: "flex", flexDirection: "column", background: "#FFFFFF" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E5E2DB" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1B2A4A", marginBottom: 10 }}>💰 Presets de Proventos</div>
              <input type="text" placeholder="Buscar colaborador..." value={presetSearch} onChange={(e) => setPresetSearch(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 13, background: "#F8F7F4", outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {filteredCollabs.map((collab) => {
                const collabPresets = (presets[collab.id] || []).filter(p => p.is_active);
                const presetCount = collabPresets.length;
                const totalVal = collabPresets.reduce((s, p) => s + (p.type === 'addition' ? p.value : -p.value), 0);
                return (
                  <div key={collab.id} onClick={() => setSelectedCollabId(collab.id)} style={{
                    padding: "14px 20px", borderBottom: "1px solid #F3F0EB", cursor: "pointer",
                    background: selectedCollabId === collab.id ? "#FEF9EE" : "transparent",
                    borderLeft: selectedCollabId === collab.id ? "3px solid #F59E0B" : "3px solid transparent",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A", marginBottom: 2 }}>{collab.full_name}</div>
                        <div style={{ fontSize: 11, color: "#6B7280" }}>{collab.role}</div>
                      </div>
                      {presetCount > 0 && <span style={{ fontSize: 10, color: "#3B82F6", fontWeight: 600, background: "#DBEAFE", padding: "3px 8px", borderRadius: 10 }}>{presetCount} preset{presetCount > 1 ? "s" : ""}</span>}
                    </div>
                    {presetCount > 0 && (
                      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: totalVal >= 0 ? "#16A34A" : "#DC2626" }}>
                        {totalVal >= 0 ? "+" : ""}{formatCurrency(totalVal)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 32, background: "#EDEAE5" }}>
            {!selectedPresetCollab ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#9CA3AF" }}>
                <span style={{ fontSize: 56, marginBottom: 16, opacity: 0.5 }}>💰</span>
                <div style={{ fontSize: 18, fontWeight: 600, color: "#6B7280" }}>Selecione um colaborador</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>Configure os presets de proventos e descontos fixos mensais</div>
              </div>
            ) : (
              <div style={{ maxWidth: 600, margin: "0 auto" }}>
                <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #D1D5DB", marginBottom: 16 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#1B2A4A", marginBottom: 4 }}>{selectedPresetCollab.full_name}</div>
                  <div style={{ fontSize: 13, color: "#6B7280" }}>{selectedPresetCollab.role} • {selectedPresetCollab.email}</div>
                </div>

                <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", border: "1px solid #D1D5DB", marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "#9CA3AF", marginBottom: 12 }}>Adicionar Preset</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "flex" }}>
                      {[{ key: "addition", label: "+ Provento", color: "#22C55E" }, { key: "deduction", label: "− Desconto", color: "#EF4444" }].map((t, i) => (
                        <button key={t.key} onClick={() => setNewPreset((p) => ({ ...p, type: t.key }))} style={{
                          padding: "7px 12px", borderRadius: i === 0 ? "8px 0 0 8px" : "0 8px 8px 0", fontSize: 12, fontWeight: 600, cursor: "pointer",
                          border: `1px solid ${newPreset.type === t.key ? t.color : "#E5E2DB"}`, background: newPreset.type === t.key ? t.color : "#fff", color: newPreset.type === t.key ? "#fff" : "#6B7280",
                        }}>{t.label}</button>
                      ))}
                    </div>
                    <select value={newPreset.category} onChange={(e) => { const cat = ADJUSTMENT_CATEGORIES.find((c) => c.value === e.target.value); setNewPreset((p) => ({ ...p, category: e.target.value, description: cat ? cat.label : p.description })); }}
                      style={{ padding: "7px 8px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 12, outline: "none" }}>
                      {ADJUSTMENT_CATEGORIES.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
                    </select>
                    <input type="text" placeholder="Descrição" value={newPreset.description} onChange={(e) => setNewPreset((p) => ({ ...p, description: e.target.value }))}
                      style={{ flex: 1, minWidth: 120, padding: "7px 10px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 12, outline: "none" }} />
                    <input type="number" placeholder="R$" step="0.01" value={newPreset.value} onChange={(e) => setNewPreset((p) => ({ ...p, value: e.target.value }))}
                      style={{ width: 100, padding: "7px 10px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 12, outline: "none", fontFamily: "'JetBrains Mono', monospace" }} />
                    <button onClick={addPreset} style={{ padding: "7px 16px", borderRadius: 8, background: "#3B82F6", color: "#fff", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Salvar</button>
                  </div>
                </div>

                <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #D1D5DB" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "#9CA3AF", marginBottom: 16 }}>Presets Salvos ({selectedPresets.length})</div>

                  {(presets[selectedCollabId] || []).length === 0 ? (
                    <div style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Nenhum preset configurado. Adicione proventos ou descontos fixos mensais.</div>
                  ) : (
                    <>
                      {(presets[selectedCollabId] || []).filter(p => p.type === 'addition').length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#16A34A", marginBottom: 8 }}>Proventos Fixos</div>
                          {(presets[selectedCollabId] || []).filter(p => p.type === 'addition').map((preset) => (
                            <div key={preset.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F3F0EB", opacity: preset.is_active ? 1 : 0.4 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ width: 20, height: 20, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: "#22C55E", color: "#fff" }}>+</span>
                                <span style={{ fontSize: 13, color: "#374151", textDecoration: preset.is_active ? "none" : "line-through" }}>{preset.description}</span>
                                <span style={{ fontSize: 10, color: "#9CA3AF", background: "#F3F4F6", padding: "2px 6px", borderRadius: 4 }}>{ADJUSTMENT_CATEGORIES.find(c => c.value === preset.category)?.label || preset.category}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: "#16A34A", fontSize: 13 }}>+{formatCurrency(preset.value)}</span>
                                <button onClick={() => togglePreset(preset)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: preset.is_active ? "#9CA3AF" : "#3B82F6", padding: "0 2px" }}>{preset.is_active ? "⏸" : "▶"}</button>
                                <button onClick={() => removePreset(preset.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#D1D5DB", fontSize: 14, padding: "0 2px" }}>✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {(presets[selectedCollabId] || []).filter(p => p.type === 'deduction').length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#DC2626", marginBottom: 8 }}>Descontos Fixos</div>
                          {(presets[selectedCollabId] || []).filter(p => p.type === 'deduction').map((preset) => (
                            <div key={preset.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F3F0EB", opacity: preset.is_active ? 1 : 0.4 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ width: 20, height: 20, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: "#EF4444", color: "#fff" }}>−</span>
                                <span style={{ fontSize: 13, color: "#374151", textDecoration: preset.is_active ? "none" : "line-through" }}>{preset.description}</span>
                                <span style={{ fontSize: 10, color: "#9CA3AF", background: "#F3F4F6", padding: "2px 6px", borderRadius: 4 }}>{ADJUSTMENT_CATEGORIES.find(c => c.value === preset.category)?.label || preset.category}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: "#DC2626", fontSize: 13 }}>−{formatCurrency(preset.value)}</span>
                                <button onClick={() => togglePreset(preset)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: preset.is_active ? "#9CA3AF" : "#3B82F6", padding: "0 2px" }}>{preset.is_active ? "⏸" : "▶"}</button>
                                <button onClick={() => removePreset(preset.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#D1D5DB", fontSize: 14, padding: "0 2px" }}>✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ borderTop: "2px solid #1B2A4A", paddingTop: 12, marginTop: 8 }}>
                        {presetTotalAdd > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                            <span style={{ color: "#374151", fontWeight: 600 }}>Total Proventos Fixos</span>
                            <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "#16A34A" }}>+{formatCurrency(presetTotalAdd)}</span>
                          </div>
                        )}
                        {presetTotalDed > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                            <span style={{ color: "#374151", fontWeight: 600 }}>Total Descontos Fixos</span>
                            <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "#DC2626" }}>−{formatCurrency(presetTotalDed)}</span>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", fontSize: 15, fontWeight: 700, marginTop: 4 }}>
                          <span style={{ color: "#1B2A4A" }}>Impacto Mensal</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: (presetTotalAdd - presetTotalDed) >= 0 ? "#16A34A" : "#DC2626" }}>
                            {(presetTotalAdd - presetTotalDed) >= 0 ? "+" : ""}{formatCurrency(presetTotalAdd - presetTotalDed)}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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






