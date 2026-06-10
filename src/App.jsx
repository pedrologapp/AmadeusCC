import React, { useState, useEffect, useCallback, useRef } from "react";
import { parsePayrollWorkbook, suggestCollaborator } from "./lib/excelImport";

const CONFIG = {
  SUPABASE_URL: "https://lzqhjutknqeuhscfxald.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6cWhqdXRrbnFldWhzY2Z4YWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4OTY0ODgsImV4cCI6MjA2OTQ3MjQ4OH0.AtiXJ2BpmulSUXo--bz_jKu0esAyS71kF33nWNE1YHk",
  N8N_WEBHOOK_PROCESS_PDF: "https://webhook.escolaamadeus.com/webhook/process-payroll-pdf",
  N8N_WEBHOOK_SEND_EMAILS: "https://webhook.escolaamadeus.com/webhook/send-payroll-emails",
  API_BASE: "https://cc.escolaamadeus.com", // nossas funções no Vercel
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
  async deleteWhere(table, filters) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}?${filters}`, {
      method: "DELETE", headers: this.headers,
    });
    if (!res.ok) throw new Error(`Supabase delete error: ${res.statusText}`);
    return true;
  },
};

const formatCurrency = (value) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

// De-para "aba do Excel -> colaborador", guardado no navegador (localStorage).
// Na Fase 3 isso migra para o Supabase junto com o login.
const MAPPING_KEY = "excel_collab_mappings_v1";
const loadMappings = () => { try { return JSON.parse(localStorage.getItem(MAPPING_KEY) || "{}"); } catch { return {}; } };
const saveMappings = (m) => { try { localStorage.setItem(MAPPING_KEY, JSON.stringify(m)); } catch (e) {} };

// Carrega o pdf.js (CDN) para contar as páginas no navegador
const ensurePdfJs = () => new Promise((resolve, reject) => {
  if (window.pdfjsLib) return resolve(window.pdfjsLib);
  const existing = document.getElementById("pdfjs-script");
  if (existing) {
    const check = setInterval(() => { if (window.pdfjsLib) { clearInterval(check); resolve(window.pdfjsLib); } }, 100);
    setTimeout(() => { clearInterval(check); reject(new Error("pdf.js timeout")); }, 10000);
    return;
  }
  const s = document.createElement("script");
  s.id = "pdfjs-script";
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; resolve(window.pdfjsLib); };
  s.onerror = reject;
  document.head.appendChild(s);
});

const getPdfPageCount = async (arrayBuffer) => {
  const lib = await ensurePdfJs();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
};

// Casa um colaborador extraído pela IA com o cadastro (código -> CPF -> nome)
const matchCollaborator = (emp, collaborators) => {
  let m = collaborators.find((c) => c.employee_code && emp.employee_code && c.employee_code === emp.employee_code);
  if (!m && emp.cpf) m = collaborators.find((c) => c.cpf && c.cpf === emp.cpf);
  if (!m && emp.employee_name) {
    const name = emp.employee_name.toUpperCase().trim();
    m = collaborators.find((c) => {
      const cn = (c.full_name || "").toUpperCase().trim();
      return cn === name || cn.includes(name) || name.includes(cn);
    });
  }
  return m || null;
};

const MONTH_NAMES = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

// Etapas do assistente guiado (Fase 2b)
const WIZARD_STEPS = [
  { n: 1, label: "Mês" },
  { n: 2, label: "PDF" },
  { n: 3, label: "Conferir" },
  { n: 4, label: "Excel" },
  { n: 5, label: "Revisar" },
  { n: 6, label: "Enviar" },
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

  // Importação de Excel (planilha mensal da folha)
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState("");

  // Conferência de colaboradores (novos no PDF / ausentes no mês)
  const [reconcile, setReconcile] = useState(null); // { periodId, storagePath, novos:[], ausentes:[] }
  const [lastNovos, setLastNovos] = useState([]);
  const [lastStoragePath, setLastStoragePath] = useState("");

  // Navegação (Fase 2): painel de meses x assistente
  const [view, setView] = useState("dashboard"); // "dashboard" | "process"
  const [periodStats, setPeriodStats] = useState({});
  const [wizardStep, setWizardStep] = useState(1); // 1..6

  // Configurações (Fase 2c): colaboradores + proventos
  const [settingsTab, setSettingsTab] = useState("colaboradores"); // "colaboradores" | "proventos"
  const [allCollaborators, setAllCollaborators] = useState([]);
  const [collabSearch, setCollabSearch] = useState("");
  const [editCollab, setEditCollab] = useState(null);
  const [savingCollab, setSavingCollab] = useState(false);

  const currentPeriod = periods.find((p) => p.id === currentPeriodId);
  const selectedPaycheck = paychecks.find((p) => p.id === selectedPaycheckId);
  const selectedCollaborator = selectedPaycheck
    ? (collaborators.find((c) => c.id === selectedPaycheck.collaborator_id) ||
       allCollaborators.find((c) => c.id === selectedPaycheck.collaborator_id) || null)
    : null;
  const selectedAdjustments = selectedPaycheckId ? adjustments[selectedPaycheckId] || [] : [];

  // Acha o colaborador do contracheque (ativos primeiro, depois inativos).
  // NUNCA esconde um contracheque do PDF — sem cadastro vira sinalização visual.
  const findCollab = (pc) =>
    collaborators.find((c) => c.id === pc.collaborator_id) ||
    allCollaborators.find((c) => c.id === pc.collaborator_id) || null;

  const filteredPaychecks = paychecks
    .filter((pc) => {
      const collab = findCollab(pc);
      const name = collab?.full_name || "(sem cadastro)";
      const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase()) || (collab?.role || "").toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFilter = filterStatus === "all" || (filterStatus === "pending_review" && ["extracted", "pending_review"].includes(pc.status)) || pc.status === filterStatus;
      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => (findCollab(a)?.full_name || "").localeCompare(findCollab(b)?.full_name || "", "pt-BR"));

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

  // Carrega TODOS os colaboradores (incl. inativos) para a tela de Configurações
  const loadAllCollaborators = useCallback(async () => {
    try { const data = await supabase.select("collaborators", "", "full_name.asc"); setAllCollaborators(data); } catch (err) { console.error(err); }
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

  // Carrega contagem de status por período (para o painel de meses)
  const loadPeriodStats = useCallback(async () => {
    try {
      const rows = await supabase.select("paychecks", "select=payroll_period_id,status");
      const m = {};
      for (const r of rows) {
        const k = r.payroll_period_id;
        if (!m[k]) m[k] = { total: 0, sent: 0, reviewed: 0, pending: 0, skipped: 0 };
        m[k].total++;
        if (r.status === "sent") m[k].sent++;
        else if (["reviewed", "approved"].includes(r.status)) m[k].reviewed++;
        else if (["extracted", "pending_review"].includes(r.status)) m[k].pending++;
        else if (r.status === "skipped") m[k].skipped++;
      }
      setPeriodStats(m);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadCollaborators();
      const data = await loadPeriods();
      await loadPresets();
      await loadPeriodStats();
      await loadAllCollaborators();
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

  // Navegação entre painel de meses e o assistente
  const openMonth = (period) => {
    setCurrentPeriodId(period.id);
    setRefMonth(period.reference_month); setRefYear(period.reference_year);
    setActiveTab("contracheques"); setSelectedPaycheckId(null);
    const s = periodStats[period.id];
    let step = 5;
    if (!s || s.total === 0) step = 2;
    else if (s.pending === 0 && (s.reviewed > 0 || s.sent > 0)) step = 6;
    setWizardStep(step);
    setError(null); setImportNote(""); setDuplicateWarnings([]); setView("process");
  };
  const startNewMonth = () => {
    const now = new Date();
    setCurrentPeriodId(null); setPaychecks([]); setAdjustments({});
    setRefMonth(now.getMonth() + 1); setRefYear(now.getFullYear());
    setActiveTab("contracheques"); setSelectedPaycheckId(null); setWizardStep(1);
    setError(null); setImportNote(""); setDuplicateWarnings([]); setView("process");
  };
  const backToDashboard = async () => {
    setView("dashboard"); setSelectedPaycheckId(null); setError(null);
    await loadPeriods(); await loadPeriodStats();
  };
  const openSettings = () => {
    setSettingsTab("colaboradores"); setEditCollab(null); setError(null);
    loadAllCollaborators(); setView("settings");
  };

  // Colaboradores (Configurações)
  const newCollab = () => setEditCollab({ full_name: "", email: "", role: "", employee_code: "", cpf: "", is_active: true });
  const editExistingCollab = (c) => setEditCollab({ ...c });
  const updateEditCollabField = (field, value) => setEditCollab((prev) => ({ ...prev, [field]: value }));
  const saveCollab = async () => {
    if (!editCollab) return;
    if (!editCollab.full_name?.trim()) { setError("O nome completo é obrigatório."); return; }
    setSavingCollab(true); setError(null);
    try {
      const payload = {
        full_name: editCollab.full_name.trim(),
        email: editCollab.email?.trim() || null,
        role: editCollab.role?.trim() || null,
        employee_code: editCollab.employee_code?.trim() || null,
        cpf: editCollab.cpf?.trim() || null,
        is_active: editCollab.is_active !== false,
      };
      let res;
      if (editCollab.id) res = await supabase.update("collaborators", editCollab.id, payload);
      else res = await supabase.insert("collaborators", payload);
      if (res?.[0]) setEditCollab({ ...res[0] });
      await loadAllCollaborators(); await loadCollaborators();
      setSavingCollab(false);
    } catch (err) { setError(`Erro ao salvar colaborador: ${err.message}`); setSavingCollab(false); }
  };
  const toggleCollabActive = async () => {
    if (!editCollab?.id) return;
    try {
      const res = await supabase.update("collaborators", editCollab.id, { is_active: !editCollab.is_active });
      if (res?.[0]) setEditCollab({ ...res[0] });
      await loadAllCollaborators(); await loadCollaborators();
    } catch (err) { setError(`Erro: ${err.message}`); }
  };

  // ============================================================
  // Contracheques Actions
  // ============================================================
  const handlePdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") { setError("Por favor, selecione um arquivo PDF."); return; }
    setUploading(true); setError(null); setDuplicateWarnings([]); setImportNote("");
    const mes = refMonth, ano = refYear;
    try {
      // 1) Conta as páginas do PDF (no navegador)
      setUploadProgress("Lendo o arquivo...");
      const numPages = await getPdfPageCount(await file.arrayBuffer());

      // 2) Envia o PDF para o armazenamento (Supabase Storage)
      setUploadProgress("Enviando o PDF...");
      const storagePath = `paychecks/${ano}/${String(mes).padStart(2, "0")}_${Date.now()}.pdf`;
      const up = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/${storagePath}`, {
        method: "PUT",
        headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`, "Content-Type": "application/pdf", "x-upsert": "true" },
        body: file,
      });
      if (!up.ok) throw new Error("Falha ao enviar o PDF para o armazenamento");
      const pdfUrl = `${CONFIG.SUPABASE_URL}/storage/v1/object/public/${storagePath}`;

      // 3) Cria (ou reaproveita) o período do mês
      let period = (await supabase.select("payroll_periods", `reference_month=eq.${mes}&reference_year=eq.${ano}`, "created_at.desc"))[0];
      if (period) { await supabase.update("payroll_periods", period.id, { status: "processing" }); }
      else { period = (await supabase.insert("payroll_periods", { reference_month: mes, reference_year: ano, status: "processing" }))[0]; }
      const periodId = period.id;

      // 4) Lê o PDF em lotes de páginas, chamando nossa função no Vercel
      const BATCH = 6;
      const all = [];
      for (let start = 1; start <= numPages; start += BATCH) {
        const batchPages = [];
        for (let p = start; p < start + BATCH && p <= numPages; p++) batchPages.push(p);
        setUploadProgress(`A IA está lendo as páginas ${start}–${batchPages[batchPages.length - 1]} de ${numPages}...`);
        const r = await fetch(`${CONFIG.API_BASE}/api/extract-payroll`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdf_url: pdfUrl, pages: batchPages, origin: CONFIG.API_BASE }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Erro ao ler as páginas");
        if (Array.isArray(data.employees)) all.push(...data.employees);
      }

      // 5) Junta quem aparece em mais de um lote (por código/CPF/nome)
      setUploadProgress("Organizando os contracheques...");
      const byKey = {};
      for (const emp of all) {
        const key = (emp.employee_code || emp.cpf || emp.employee_name || "").toString().trim();
        if (!key) { byKey[`x${Object.keys(byKey).length}`] = { ...emp, pages: [...(emp.pages || [])] }; continue; }
        if (!byKey[key]) { byKey[key] = { ...emp, pages: [...(emp.pages || [])] }; }
        else {
          const ex = byKey[key];
          const pages = [...new Set([...(ex.pages || []), ...(emp.pages || [])])].sort((a, b) => a - b);
          if ((emp.net_salary || 0) > (ex.net_salary || 0) || ((emp.details || []).length > (ex.details || []).length)) byKey[key] = { ...emp, pages };
          else ex.pages = pages;
        }
      }
      const merged = Object.values(byKey);

      // 6) Casa com o cadastro e cria os contracheques.
      // Quem está no PDF mas NÃO tem cadastro: cria o cadastro na hora (sem e-mail)
      // para o contracheque subir junto — nada do PDF fica de fora. O e-mail é
      // completado depois na conferência de colaboradores.
      let created = 0; const dups = []; const novos = []; const matchedIds = new Set();
      for (const emp of merged) {
        let collab = matchCollaborator(emp, collaborators);
        if (!collab) {
          const createdC = await supabase.insert("collaborators", {
            full_name: emp.employee_name || "Sem nome",
            email: null,
            cpf: emp.cpf || null,
            employee_code: emp.employee_code || null,
            role: emp.role || null,
            is_active: true,
          });
          collab = createdC?.[0];
          if (!collab) { novos.push({ ...emp, _email: "" }); continue; }
          novos.push({ ...emp, _email: "", _collabId: collab.id });
        }
        matchedIds.add(collab.id);
        const existing = await supabase.select("paychecks", `payroll_period_id=eq.${periodId}&collaborator_id=eq.${collab.id}`);
        if (existing.length > 0) { dups.push(collab.full_name); continue; }
        const pageNums = (emp.pages && emp.pages.length) ? emp.pages : [1];
        await supabase.insert("paychecks", {
          payroll_period_id: periodId,
          collaborator_id: collab.id,
          extracted_gross_value: emp.gross_salary,
          extracted_deductions: emp.total_deductions,
          extracted_net_value: emp.net_salary,
          final_value: emp.net_salary,
          ai_confidence_score: 0.95,
          individual_pdf_path: storagePath,
          pdf_page_number: pageNums[0],
          page_numbers: pageNums,
          status: "extracted",
          ai_extracted_data: JSON.stringify(emp.details || []),
        });
        created++;
      }
      // quem está no cadastro (ativo) mas não apareceu neste PDF
      const ausentes = collaborators.filter((c) => !matchedIds.has(c.id));

      // 7) Fecha o período e atualiza a tela
      await supabase.update("payroll_periods", periodId, { status: "reviewing", pdf_total_pages: numPages });
      setCurrentPeriodId(periodId); setRefMonth(mes); setRefYear(ano);
      await loadPeriods(); await loadPaychecks(periodId); await loadPeriodStats();
      if (novos.length) { await loadCollaborators(); await loadAllCollaborators(); }
      if (dups.length) setDuplicateWarnings(dups.map((d) => ({ collaborator: d })));
      setUploadProgress(""); setUploading(false); setWizardStep(3);
      let note = `${created} contracheque(s) criado(s) de ${numPages} páginas.`;
      if (novos.length) note += ` ${novos.length} colaborador(es) novo(s) cadastrado(s) automaticamente — complete o e-mail na conferência.`;
      setImportNote(note);
      setLastNovos(novos); setLastStoragePath(storagePath);
      if (novos.length || ausentes.length) setReconcile({ periodId, storagePath, novos, ausentes });
    } catch (err) {
      setError(`Erro: ${err.message}`); setUploading(false); setUploadProgress("");
    }
  };

  // ============================================================
  // Importar Excel da folha (lê no navegador, sem n8n)
  // ============================================================
  const handleExcelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    if (!currentPeriodId) { setError("Suba/selecione o mês (com o PDF) antes de importar o Excel."); return; }
    setError(null); setImportNote("");
    try {
      const buffer = await file.arrayBuffer();
      const sheets = parsePayrollWorkbook(buffer);
      const mappings = loadMappings();
      const rows = sheets.map((s) => {
        const saved = mappings[s.sheetName];
        if (saved === "IGNORE") return { ...s, collabId: "", ignored: true };
        if (saved && collaborators.some((c) => c.id === saved)) return { ...s, collabId: saved, ignored: false };
        const sug = suggestCollaborator(s.sheetName, collaborators, s.cpf);
        return { ...s, collabId: sug ? sug.id : "", ignored: false };
      });
      setImportRows(rows);
      setShowImportModal(true);
    } catch (err) {
      setError(`Erro ao ler o Excel: ${err.message}`);
    }
  };

  const setImportRowCollab = (sheetName, value) => {
    setImportRows((prev) => prev.map((r) => {
      if (r.sheetName !== sheetName) return r;
      if (value === "IGNORE") return { ...r, ignored: true, collabId: "" };
      return { ...r, ignored: false, collabId: value };
    }));
  };

  const confirmImport = async () => {
    setImporting(true); setError(null);
    try {
      // 1) salvar o de-para (aba -> colaborador) para os próximos meses
      const mappings = loadMappings();
      for (const r of importRows) {
        if (r.ignored) mappings[r.sheetName] = "IGNORE";
        else if (r.collabId) mappings[r.sheetName] = r.collabId;
      }
      saveMappings(mappings);

      // 2) aplicar os ajustes nos contracheques do mês atual (substitui os existentes)
      let applied = 0, noPaycheck = 0;
      for (const r of importRows) {
        if (r.ignored || !r.collabId || !r.items?.length) continue;
        const pc = paychecks.find((p) => p.collaborator_id === r.collabId);
        if (!pc) { noPaycheck++; continue; }
        const existing = adjustments[pc.id] || [];
        for (const a of existing) { await supabase.delete("adjustments", a.id); }
        for (const it of r.items) {
          await supabase.insert("adjustments", {
            paycheck_id: pc.id, type: it.type, description: it.description,
            value: it.value, category: it.category,
          });
        }
        applied++;
      }
      await loadPaychecks();
      setShowImportModal(false); setImportRows([]); setImporting(false);
      let msg = `Importação concluída — ${applied} contracheque(s) atualizado(s).`;
      if (noPaycheck > 0) msg += ` ${noPaycheck} colaborador(es) sem contracheque neste mês (suba o PDF primeiro).`;
      setImportNote(msg); setWizardStep(5);
    } catch (err) {
      setError(`Erro ao importar: ${err.message}`); setImporting(false);
    }
  };

  // Apaga os contracheques e ajustes do mês para subir o PDF de novo.
  // O cadastro de colaboradores NÃO é alterado.
  const redoMonth = async () => {
    if (!currentPeriodId) return;
    const enviados = paychecks.filter((p) => p.status === "sent").length;
    let aviso = `Refazer ${periodLabel}? Todos os ${paychecks.length} contracheques e seus ajustes deste mês serão apagados para você subir o PDF novamente.\n\nO cadastro de colaboradores não muda.`;
    if (enviados > 0) aviso += `\n\nATENÇÃO: ${enviados} contracheque(s) já foram ENVIADOS por e-mail — refazer apaga esse registro.`;
    if (!window.confirm(aviso)) return;
    try {
      setUploading(true); setUploadProgress("Limpando o mês...");
      const pcs = await supabase.select("paychecks", `payroll_period_id=eq.${currentPeriodId}`);
      if (pcs.length > 0) {
        const ids = pcs.map((p) => p.id).join(",");
        await supabase.deleteWhere("adjustments", `paycheck_id=in.(${ids})`);
        await supabase.deleteWhere("email_logs", `paycheck_id=in.(${ids})`).catch(() => {});
        await supabase.deleteWhere("paychecks", `payroll_period_id=eq.${currentPeriodId}`);
      }
      await supabase.update("payroll_periods", currentPeriodId, { status: "processing" });
      setPaychecks([]); setAdjustments({}); setSelectedPaycheckId(null);
      await loadPeriodStats();
      setUploading(false); setUploadProgress("");
      setWizardStep(2); setImportNote("Mês limpo — suba o PDF novamente.");
    } catch (err) {
      setUploading(false); setUploadProgress("");
      setError(`Erro ao refazer o mês: ${err.message}`);
    }
  };

  // ============================================================
  // Conferência de colaboradores (novos / ausentes)
  // ============================================================
  const openReconcile = () => {
    const matchedIds = new Set(paychecks.map((p) => p.collaborator_id));
    const ausentes = collaborators.filter((c) => !matchedIds.has(c.id));
    const storagePath = lastStoragePath || paychecks[0]?.individual_pdf_path || "";
    // "Novos" vem do banco (tem contracheque no mês mas está sem e-mail), então a
    // lista sobrevive a fechar o modal ou recarregar a página. lastNovos cobre só
    // o caso raro de alguém do PDF cujo cadastro não pôde ser criado no upload.
    const semEmail = collaborators
      .filter((c) => matchedIds.has(c.id) && !(c.email || "").trim())
      .map((c) => {
        const pc = paychecks.find((p) => p.collaborator_id === c.id);
        return {
          employee_name: c.full_name, cpf: c.cpf, employee_code: c.employee_code,
          role: c.role, net_salary: pc?.extracted_net_value, _email: "", _collabId: c.id,
        };
      });
    const soDoUpload = (lastNovos || []).filter((n) => !n._collabId);
    setReconcile({ periodId: currentPeriodId, storagePath, novos: [...semEmail, ...soDoUpload], ausentes });
  };
  const updateNovoEmail = (idx, val) => setReconcile((prev) => {
    const n = [...prev.novos]; n[idx] = { ...n[idx], _email: val }; return { ...prev, novos: n };
  });
  const addNovoFromPdf = async (idx) => {
    const emp = reconcile.novos[idx];
    try {
      // Cadastro já foi criado no upload do PDF — aqui só completa o e-mail.
      if (emp._collabId) {
        await supabase.update("collaborators", emp._collabId, { email: emp._email?.trim() || null });
        await loadCollaborators(); await loadAllCollaborators();
        setReconcile((prev) => ({ ...prev, novos: prev.novos.filter((_, i) => i !== idx) }));
        return;
      }
      const created = await supabase.insert("collaborators", {
        full_name: emp.employee_name || "Sem nome",
        email: emp._email?.trim() || null,
        cpf: emp.cpf || null,
        employee_code: emp.employee_code || null,
        role: emp.role || null,
        is_active: true,
      });
      const collab = created?.[0];
      if (collab && reconcile.periodId) {
        const pageNums = (emp.pages && emp.pages.length) ? emp.pages : [1];
        await supabase.insert("paychecks", {
          payroll_period_id: reconcile.periodId,
          collaborator_id: collab.id,
          extracted_gross_value: emp.gross_salary,
          extracted_deductions: emp.total_deductions,
          extracted_net_value: emp.net_salary,
          final_value: emp.net_salary,
          ai_confidence_score: 0.95,
          individual_pdf_path: reconcile.storagePath,
          pdf_page_number: pageNums[0],
          page_numbers: pageNums,
          status: "extracted",
          ai_extracted_data: JSON.stringify(emp.details || []),
        });
      }
      await loadCollaborators(); await loadAllCollaborators(); await loadPaychecks(); await loadPeriodStats();
      setReconcile((prev) => ({ ...prev, novos: prev.novos.filter((_, i) => i !== idx) }));
    } catch (err) { setError(`Erro ao adicionar: ${err.message}`); }
  };
  const deactivateAusente = async (idx) => {
    const c = reconcile.ausentes[idx];
    try {
      await supabase.update("collaborators", c.id, { is_active: false });
      await loadCollaborators(); await loadAllCollaborators();
      setReconcile((prev) => ({ ...prev, ausentes: prev.ausentes.filter((_, i) => i !== idx) }));
    } catch (err) { setError(`Erro: ${err.message}`); }
  };
  const dismissAusente = (idx) => setReconcile((prev) => ({ ...prev, ausentes: prev.ausentes.filter((_, i) => i !== idx) }));

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
          {view !== "dashboard" && (
            <button onClick={backToDashboard} style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>← Meses</button>
          )}
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #F59E0B, #EF4444)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800 }}>₵</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>ContraCheque{view === "process" ? ` — ${periodLabel}` : view === "settings" ? " — Configurações" : ""}</div>
            <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1, textTransform: "uppercase" }}>{view === "process" ? "Escola Amadeus" : view === "settings" ? "Colaboradores e Proventos" : "Sistema de Folha de Pagamento"}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {view === "dashboard" && (
            <button onClick={openSettings} style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>⚙️ Configurações</button>
          )}
        </div>
      </header>

      {error && (
        <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#991B1B", padding: "10px 24px", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#991B1B", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      {importNote && view === "process" && (
        <div style={{ background: "#D1FAE5", border: "1px solid #6EE7B7", color: "#065F46", padding: "10px 24px", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>✓ {importNote}</span>
          <button onClick={() => setImportNote("")} style={{ background: "none", border: "none", color: "#065F46", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      {duplicateWarnings.length > 0 && view === "process" && (
        <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", color: "#92400E", padding: "12px 24px", fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontWeight: 700 }}>⚠️ {[...new Set(duplicateWarnings.map((w) => w.collaborator).filter(Boolean))].length} contracheque(s) ignorado(s) (já existiam)</span>
            <button onClick={() => setDuplicateWarnings([])} style={{ background: "none", border: "none", color: "#92400E", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: "#A16207" }}>{[...new Set(duplicateWarnings.map((w) => w.collaborator).filter(Boolean))].join(", ")}</div>
        </div>
      )}

      {/* ============================================================ */}
      {/* PAINEL DE MESES (DASHBOARD) */}
      {/* ============================================================ */}
      {view === "dashboard" && (
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#1B2A4A" }}>Meses</div>
              <div style={{ fontSize: 13, color: "#6B7280" }}>Escolha um mês para processar ou ver o que já foi enviado</div>
            </div>
            <button onClick={startNewMonth} style={{ padding: "11px 18px", borderRadius: 10, background: "linear-gradient(135deg, #F59E0B, #EF4444)", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, boxShadow: "0 4px 12px rgba(245,158,11,0.3)" }}>+ Novo mês</button>
          </div>

          {periods.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: "#9CA3AF", background: "#fff", borderRadius: 16, border: "1px solid #E5E2DB" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#6B7280" }}>Nenhum mês ainda</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Clique em "Novo mês" para começar</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {periods.map((p) => {
                const s = periodStats[p.id] || { total: 0, sent: 0, reviewed: 0, pending: 0, skipped: 0 };
                let st;
                if (s.total === 0) st = { label: "Aguardando PDF", color: "#6B7280", bg: "#F3F4F6", icon: "⚪" };
                else if (s.pending > 0) st = { label: "Precisa revisar", color: "#92400E", bg: "#FEF3C7", icon: "🟡" };
                else if (s.reviewed > 0) st = { label: "Pronto para enviar", color: "#1E40AF", bg: "#DBEAFE", icon: "🔵" };
                else if (s.sent > 0) st = { label: "Enviado", color: "#065F46", bg: "#D1FAE5", icon: "✅" };
                else st = { label: "Em aberto", color: "#6B7280", bg: "#F3F4F6", icon: "⚪" };
                return (
                  <div key={p.id} onClick={() => openMonth(p)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", background: "#fff", borderRadius: 14, border: "1px solid #E5E2DB", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#1B2A4A" }}>{MONTH_NAMES[p.reference_month - 1]} {p.reference_year}</div>
                      <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>
                        {s.total > 0 ? `${s.total} contracheques${s.sent > 0 ? ` · ${s.sent} enviados` : ""}${s.pending > 0 ? ` · ${s.pending} pendentes` : ""}` : "Suba o PDF do contador"}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 20, color: st.color, background: st.bg, whiteSpace: "nowrap" }}>{st.icon} {st.label}</span>
                      <span style={{ fontSize: 20, color: "#CBD5E1" }}>›</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
      {/* IMPORT EXCEL MODAL */}
      {/* ============================================================ */}
      {showImportModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !importing && setShowImportModal(false)}>
          <div style={{ background: "#fff", borderRadius: 16, width: 780, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #E5E2DB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#1B2A4A" }}>Importar Excel — {periodLabel}</div>
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Confira o colaborador de cada aba. Confirmar substitui os ajustes deste mês.</div>
              </div>
              <button onClick={() => !importing && setShowImportModal(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#9CA3AF" }}>✕</button>
            </div>

            {(() => {
              const ident = importRows.filter((r) => !r.ignored && r.collabId).length;
              const ign = importRows.filter((r) => r.ignored).length;
              const none = importRows.filter((r) => !r.ignored && !r.collabId).length;
              return (
                <div style={{ display: "flex", gap: 16, padding: "10px 24px", borderBottom: "1px solid #F3F0EB", fontSize: 12 }}>
                  <span style={{ color: "#16A34A", fontWeight: 600 }}>✓ {ident} identificados</span>
                  <span style={{ color: "#6B7280", fontWeight: 600 }}>⊘ {ign} ignorados</span>
                  {none > 0 && <span style={{ color: "#DC2626", fontWeight: 600 }}>⚠ {none} não identificados</span>}
                </div>
              );
            })()}

            <div style={{ overflowY: "auto", padding: "4px 24px", flex: 1 }}>
              {importRows.map((r) => {
                const pc = r.collabId ? paychecks.find((p) => p.collaborator_id === r.collabId) : null;
                const excelTotal = r.grandTotal != null ? r.grandTotal : r.computedTotal;
                const sysTotal = pc ? (pc.extracted_net_value || 0) + (r.sumSigned || 0) : null;
                let badge;
                if (r.ignored) badge = { t: "Ignorado", c: "#6B7280", bg: "#F3F4F6" };
                else if (!r.collabId) badge = { t: "Selecione", c: "#991B1B", bg: "#FEE2E2" };
                else if (!pc) badge = { t: "Sem contracheque", c: "#92400E", bg: "#FEF3C7" };
                else if (sysTotal != null && Math.abs(sysTotal - (excelTotal || 0)) < 0.5 && r.reconciles !== false) badge = { t: "Confere ✓", c: "#065F46", bg: "#D1FAE5" };
                else badge = { t: "Divergência", c: "#92400E", bg: "#FEF3C7" };
                const diverge = pc && sysTotal != null && Math.abs(sysTotal - (excelTotal || 0)) >= 0.5;
                return (
                  <div key={r.sheetName} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #F3F0EB", opacity: r.ignored ? 0.55 : 1 }}>
                    <div style={{ width: 110, flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1B2A4A" }}>{r.sheetName}</div>
                      {r.innerName && <div style={{ fontSize: 10, color: "#9CA3AF" }} title="Nome de dentro da planilha (apenas dica)">{r.innerName}</div>}
                    </div>
                    <select value={r.ignored ? "IGNORE" : r.collabId} onChange={(e) => setImportRowCollab(r.sheetName, e.target.value)}
                      style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 8, border: `1px solid ${!r.ignored && !r.collabId ? "#FCA5A5" : "#E5E2DB"}`, fontSize: 12, outline: "none", background: "#fff" }}>
                      <option value="">— selecionar —</option>
                      {collaborators.map((c) => (<option key={c.id} value={c.id}>{c.full_name}</option>))}
                      <option value="IGNORE">⊘ Ignorar (não é funcionário)</option>
                    </select>
                    <div style={{ width: 56, textAlign: "center", fontSize: 12, color: "#6B7280", flexShrink: 0 }}>{r.error ? "erro" : `${r.items.length} aj.`}</div>
                    <div style={{ width: 150, textAlign: "right", flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 12, color: badge.c, background: badge.bg, whiteSpace: "nowrap" }}>{badge.t}</span>
                      {pc && <div style={{ fontSize: 10, color: diverge ? "#DC2626" : "#9CA3AF", marginTop: 3, fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(sysTotal)}{diverge ? ` ≠ ${formatCurrency(excelTotal)}` : ""}</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: "16px 24px", borderTop: "1px solid #E5E2DB", display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ fontSize: 11, color: "#9CA3AF", flex: 1 }}>Ajustes existentes deste mês serão substituídos pelos do Excel.</div>
              <button onClick={() => setShowImportModal(false)} disabled={importing} style={{ padding: "11px 16px", borderRadius: 8, background: "#fff", color: "#6B7280", border: "1px solid #D1D5DB", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Cancelar</button>
              <button onClick={confirmImport} disabled={importing} style={{ padding: "11px 20px", borderRadius: 8, color: "#fff", border: "none", cursor: importing ? "default" : "pointer", fontSize: 13, fontWeight: 700, background: importing ? "#9CA3AF" : "linear-gradient(135deg, #16A34A, #15803D)", display: "flex", alignItems: "center", gap: 6, boxShadow: "0 2px 8px rgba(22,163,74,0.3)" }}>
                {importing ? <><Spinner /> Importando...</> : <>✓ Aplicar ajustes</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* CONFERÊNCIA DE COLABORADORES */}
      {/* ============================================================ */}
      {reconcile && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setReconcile(null)}>
          <div style={{ background: "#fff", borderRadius: 16, width: 640, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #E5E2DB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#1B2A4A" }}>Conferência de colaboradores — {periodLabel}</div>
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Compare quem apareceu no PDF com o cadastro</div>
              </div>
              <button onClick={() => setReconcile(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#9CA3AF" }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", padding: "16px 24px", flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#16A34A", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>➕ Novos no PDF — {reconcile.novos.length}</div>
              {reconcile.novos.length === 0 ? (
                <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 16 }}>Nenhum novo — todos do PDF já estão cadastrados.</div>
              ) : reconcile.novos.map((n, idx) => (
                <div key={idx} style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A" }}>{n.employee_name || "Sem nome"}</div>
                  <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 8 }}>{n.cpf ? `CPF ${n.cpf}` : "sem CPF"}{n.employee_code ? ` · cód ${n.employee_code}` : ""}{n.role ? ` · ${n.role}` : ""} · líquido {formatCurrency(n.net_salary)}{n._collabId ? " · cadastro e contracheque já criados" : ""}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="email" placeholder="e-mail (para enviar o contracheque)" value={n._email || ""} onChange={(e) => updateNovoEmail(idx, e.target.value)}
                      style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 12, outline: "none" }} />
                    <button onClick={() => addNovoFromPdf(idx)} style={{ padding: "7px 14px", borderRadius: 8, background: "#16A34A", color: "#fff", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{n._collabId ? "✓ Salvar e-mail" : "✓ Adicionar"}</button>
                  </div>
                </div>
              ))}

              <div style={{ fontSize: 12, fontWeight: 700, color: "#DC2626", textTransform: "uppercase", letterSpacing: 0.5, margin: "18px 0 8px" }}>➖ Ausentes neste mês (cadastrados ativos) — {reconcile.ausentes.length}</div>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10 }}>Não apareceram no PDF deste mês. Pode ser que saíram — ou só estão de férias/afastados. Você decide.</div>
              {reconcile.ausentes.length === 0 ? (
                <div style={{ fontSize: 13, color: "#9CA3AF" }}>Ninguém ausente — todos os ativos apareceram no PDF.</div>
              ) : reconcile.ausentes.map((c, idx) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A" }}>{c.full_name}</div>
                    <div style={{ fontSize: 11, color: "#6B7280" }}>{c.role || ""}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => dismissAusente(idx)} style={{ padding: "6px 10px", borderRadius: 8, background: "#fff", color: "#6B7280", border: "1px solid #D1D5DB", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Manter</button>
                    <button onClick={() => deactivateAusente(idx)} style={{ padding: "6px 10px", borderRadius: 8, background: "#fff", color: "#DC2626", border: "1px solid #FCA5A5", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Desativar</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: "14px 24px", borderTop: "1px solid #E5E2DB", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => { setReconcile(null); if (wizardStep === 3) setWizardStep(4); }} style={{ padding: "10px 18px", borderRadius: 8, background: "#1B2A4A", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Concluir</button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* CONTRACHEQUES TAB */}
      {/* ============================================================ */}
      {view === "process" && activeTab === "contracheques" && (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)" }}>
          {/* STEPPER */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 24px", background: "#fff", borderBottom: "1px solid #E5E2DB", flexShrink: 0 }}>
            {WIZARD_STEPS.map((s, i) => {
              const active = wizardStep === s.n;
              const done = wizardStep > s.n;
              return (
                <React.Fragment key={s.n}>
                  <button onClick={() => setWizardStep(s.n)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "0 6px" }}>
                    <span style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: (active || done) ? "#fff" : "#9CA3AF", background: active ? "#F59E0B" : done ? "#22C55E" : "#E5E7EB" }}>{done ? "✓" : s.n}</span>
                    <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "#1B2A4A" : "#9CA3AF" }}>{s.label}</span>
                  </button>
                  {i < WIZARD_STEPS.length - 1 && <span style={{ width: 28, height: 2, background: done ? "#22C55E" : "#E5E7EB", margin: "0 4px" }} />}
                </React.Fragment>
              );
            })}
          </div>
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* LEFT PANEL */}
          <div style={{ width: 380, borderRight: "1px solid #E5E2DB", display: "flex", flexDirection: "column", background: "#FFFFFF" }}>
            {wizardStep <= 4 && (
            <div style={{ padding: 20, borderBottom: "1px solid #E5E2DB" }}>
              {uploading ? (
                <div style={{ padding: 20, borderRadius: 12, background: "#FFFBEB", border: "1px solid #FCD34D", textAlign: "center" }}>
                  <Spinner /><div style={{ fontSize: 13, fontWeight: 600, color: "#92400E", marginTop: 8 }}>{uploadProgress}</div>
                </div>
              ) : (
                <div>
                  {wizardStep <= 2 && (<>
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
                  <div style={{ textAlign: "center", fontSize: 12, color: "#6B7280", marginTop: 10, padding: "8px", borderRadius: 8, background: "#F8F7F4" }}>
                    👥 <b>{collaborators.length}</b> colaborador{collaborators.length === 1 ? "" : "es"} ativo{collaborators.length === 1 ? "" : "s"} no cadastro
                  </div>
                  </>)}
                  {paychecks.length > 0 && wizardStep === 3 && (
                    <div style={{ borderRadius: 12, border: "2px solid #BFDBFE", background: "#EFF6FF", padding: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1B2A4A", marginBottom: 4 }}>👥 Conferir colaboradores</div>
                      <div style={{ fontSize: 12, color: "#1B2A4A", marginBottom: 6 }}><b>{paychecks.length}</b> contracheque{paychecks.length === 1 ? "" : "s"} neste mês · <b>{collaborators.length}</b> ativo{collaborators.length === 1 ? "" : "s"} no cadastro</div>
                      <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 12 }}>Veja quem é novo no PDF (complete o e-mail) e quem está cadastrado mas não veio neste mês (desativar ou manter).</div>
                      <button onClick={openReconcile} style={{ width: "100%", padding: "10px", borderRadius: 8, background: "#1B2A4A", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Abrir conferência</button>
                      <button onClick={() => setWizardStep(4)} style={{ width: "100%", padding: "8px", borderRadius: 8, background: "#fff", color: "#1B2A4A", border: "1px solid #CBD5E1", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Tudo certo, continuar → Excel</button>
                    </div>
                  )}
                  {paychecks.length > 0 && wizardStep === 4 && (
                    <label style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 16, borderRadius: 12, border: "2px dashed #86EFAC", background: "#F0FDF4", cursor: "pointer", gap: 6 }}>
                      <input type="file" accept=".xls,.xlsx" onChange={handleExcelUpload} style={{ display: "none" }} />
                      <span style={{ fontSize: 24 }}>📊</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#166534" }}>Importar Excel de Proventos</span>
                      <span style={{ fontSize: 11, color: "#22C55E" }}>Aplica os ajustes do mês automaticamente</span>
                    </label>
                  )}
                </div>
              )}
            </div>
            )}

            {paychecks.length > 0 && wizardStep >= 3 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, padding: "12px 20px", borderBottom: "1px solid #E5E2DB" }}>
                {[{ label: "Pendentes", value: stats.pending, color: "#F59E0B" }, { label: "Validados", value: stats.reviewed, color: "#22C55E" }, { label: "Pular", value: stats.skipped, color: "#9CA3AF" }, { label: "Enviados", value: stats.sent, color: "#3B82F6" }].map((s) => (
                  <div key={s.label} style={{ textAlign: "center", padding: "6px 2px", borderRadius: 8, background: "#F8F7F4" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
                    <div style={{ fontSize: 9, color: "#6B7280", fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {paychecks.length > 0 && wizardStep >= 3 && (
              <div style={{ padding: "10px 20px", borderBottom: "1px solid #E5E2DB" }}>
                <button onClick={redoMonth} style={{ width: "100%", padding: "7px", borderRadius: 8, background: "#fff", color: "#B91C1C", border: "1px solid #FCA5A5", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>🔄 Refazer mês (apagar contracheques e subir o PDF de novo)</button>
              </div>
            )}

            {paychecks.length > 0 && wizardStep === 5 && (
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
                const collab = findCollab(pc);
                const pcAdjs = adjustments[pc.id] || [];
                const hasPresets = (presets[pc.collaborator_id] || []).filter(p => p.is_active).length > 0;
                const semEmail = collab && !(collab.email || "").trim();
                return (
                  <div key={pc.id} onClick={() => setSelectedPaycheckId(pc.id)} style={{
                    padding: "14px 20px", borderBottom: "1px solid #F3F0EB", cursor: "pointer",
                    background: selectedPaycheckId === pc.id ? "#FEF9EE" : "transparent",
                    borderLeft: selectedPaycheckId === pc.id ? "3px solid #F59E0B" : "3px solid transparent",
                    opacity: pc.status === "skipped" ? 0.5 : 1,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A", marginBottom: 2 }}>{collab?.full_name || "(sem cadastro)"}</div>
                        <div style={{ fontSize: 11, color: "#6B7280" }}>{collab?.role}</div>
                        {!collab && <div style={{ fontSize: 10, fontWeight: 700, color: "#B91C1C", background: "#FEE2E2", display: "inline-block", padding: "2px 6px", borderRadius: 4, marginTop: 3 }}>⚠ sem cadastro</div>}
                        {semEmail && <div style={{ fontSize: 10, fontWeight: 700, color: "#92400E", background: "#FEF3C7", display: "inline-block", padding: "2px 6px", borderRadius: 4, marginTop: 3 }}>⚠ falta e-mail</div>}
                        {collab && collab.is_active === false && <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", background: "#F3F4F6", display: "inline-block", padding: "2px 6px", borderRadius: 4, marginTop: 3, marginLeft: semEmail ? 4 : 0 }}>inativo</div>}
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

            {stats.reviewed > 0 && wizardStep === 6 && (
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
                <div style={{ fontSize: 18, fontWeight: 600, color: "#6B7280" }}>{wizardStep <= 2 ? "Suba o PDF do contador" : wizardStep === 3 ? "Confira os colaboradores" : wizardStep === 4 ? "Importe o Excel da folha" : "Selecione um colaborador"}</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{wizardStep <= 2 ? "Escolha o mês e envie o PDF na coluna ao lado" : wizardStep === 3 ? "Veja os novos do PDF e os ausentes do mês na coluna ao lado" : wizardStep === 4 ? "Use o botão verde, ou clique em \"Revisar\" para pular esta etapa" : "Clique em um nome na lista para pré-visualizar o e-mail"}</div>
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
        </div>
      )}

      {/* ============================================================ */}
      {/* CONFIGURAÇÕES: SUB-ABAS */}
      {/* ============================================================ */}
      {view === "settings" && (
        <div style={{ display: "flex", gap: 8, padding: "10px 24px", background: "#fff", borderBottom: "1px solid #E5E2DB" }}>
          {[{ key: "colaboradores", label: "👥 Colaboradores" }, { key: "proventos", label: "💰 Proventos" }].map((t) => (
            <button key={t.key} onClick={() => setSettingsTab(t.key)} style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "1px solid",
              borderColor: settingsTab === t.key ? "#1B2A4A" : "#E5E2DB", background: settingsTab === t.key ? "#1B2A4A" : "#fff",
              color: settingsTab === t.key ? "#fff" : "#6B7280", cursor: "pointer",
            }}>{t.label}</button>
          ))}
        </div>
      )}

      {/* ============================================================ */}
      {/* CONFIGURAÇÕES: COLABORADORES */}
      {/* ============================================================ */}
      {view === "settings" && settingsTab === "colaboradores" && (
        <div style={{ display: "flex", height: "calc(100vh - 113px)" }}>
          {/* LEFT: lista */}
          <div style={{ width: 380, borderRight: "1px solid #E5E2DB", display: "flex", flexDirection: "column", background: "#FFFFFF" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E5E2DB" }}>
              <button onClick={newCollab} style={{ width: "100%", padding: "10px", borderRadius: 8, background: "linear-gradient(135deg, #F59E0B, #EF4444)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, marginBottom: 10 }}>+ Adicionar colaborador</button>
              <input type="text" placeholder="Buscar colaborador..." value={collabSearch} onChange={(e) => setCollabSearch(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 13, background: "#F8F7F4", outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {allCollaborators.filter((c) => c.full_name.toLowerCase().includes(collabSearch.toLowerCase()) || (c.email || "").toLowerCase().includes(collabSearch.toLowerCase())).map((c) => (
                <div key={c.id} onClick={() => editExistingCollab(c)} style={{
                  padding: "12px 20px", borderBottom: "1px solid #F3F0EB", cursor: "pointer",
                  background: editCollab?.id === c.id ? "#FEF9EE" : "transparent",
                  borderLeft: editCollab?.id === c.id ? "3px solid #F59E0B" : "3px solid transparent",
                  opacity: c.is_active ? 1 : 0.5,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A" }}>{c.full_name}{!c.is_active && <span style={{ fontSize: 10, color: "#9CA3AF", marginLeft: 6 }}>(inativo)</span>}</div>
                  <div style={{ fontSize: 11, color: c.email ? "#6B7280" : "#DC2626", fontWeight: c.email ? 400 : 600 }}>{c.email || "⚠ sem e-mail"}</div>
                </div>
              ))}
            </div>
          </div>
          {/* RIGHT: formulário */}
          <div style={{ flex: 1, overflowY: "auto", padding: 32, background: "#EDEAE5" }}>
            {!editCollab ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#9CA3AF" }}>
                <span style={{ fontSize: 56, marginBottom: 16, opacity: 0.5 }}>👥</span>
                <div style={{ fontSize: 18, fontWeight: 600, color: "#6B7280" }}>Selecione ou adicione um colaborador</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>Aqui você edita o e-mail e os dados de cada pessoa</div>
              </div>
            ) : (
              <div style={{ maxWidth: 520, margin: "0 auto", background: "#fff", borderRadius: 12, padding: 28, border: "1px solid #D1D5DB" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1B2A4A", marginBottom: 4 }}>{editCollab.id ? "Editar colaborador" : "Novo colaborador"}</div>
                <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 20 }}>Código e CPF ajudam o PDF a casar com a pessoa certa.</div>
                {[
                  { f: "full_name", label: "Nome completo *", ph: "Nome completo" },
                  { f: "email", label: "E-mail", ph: "email@exemplo.com" },
                  { f: "role", label: "Cargo", ph: "Ex.: Professora" },
                  { f: "employee_code", label: "Código (matrícula)", ph: "Ex.: 000002" },
                  { f: "cpf", label: "CPF", ph: "000.000.000-00" },
                ].map((fld) => (
                  <div key={fld.f} style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>{fld.label}</label>
                    <input type="text" value={editCollab[fld.f] || ""} placeholder={fld.ph} onChange={(e) => updateEditCollabField(fld.f, e.target.value)}
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #E5E2DB", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                  </div>
                ))}
                <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                  <button onClick={saveCollab} disabled={savingCollab} style={{ flex: 1, padding: "12px", borderRadius: 10, background: savingCollab ? "#9CA3AF" : "linear-gradient(135deg, #22C55E, #16A34A)", color: "#fff", border: "none", cursor: savingCollab ? "default" : "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>{savingCollab ? <><Spinner /> Salvando...</> : "✓ Salvar"}</button>
                  {editCollab.id && (
                    <button onClick={toggleCollabActive} style={{ padding: "12px 18px", borderRadius: 10, background: "#fff", color: editCollab.is_active ? "#DC2626" : "#16A34A", border: `2px solid ${editCollab.is_active ? "#FCA5A5" : "#6EE7B7"}`, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>{editCollab.is_active ? "Desativar" : "Reativar"}</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* PROVENTOS (em Configurações) */}
      {/* ============================================================ */}
      {view === "settings" && settingsTab === "proventos" && (
        <div style={{ display: "flex", height: "calc(100vh - 113px)" }}>
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






