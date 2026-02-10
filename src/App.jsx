import { useState, useEffect, useRef } from "react";

const MOCK_EMPLOYEES = [
  { id: 1, name: "Ana Paula Silva", email: "ana.silva@escola.com", role: "Professora de Matemática", baseSalary: 3200.00 },
  { id: 2, name: "Carlos Eduardo Santos", email: "carlos.santos@escola.com", role: "Professor de História", baseSalary: 2800.00 },
  { id: 3, name: "Mariana Costa Oliveira", email: "mariana.oliveira@escola.com", role: "Professora de Português", baseSalary: 3100.00 },
  { id: 4, name: "Roberto Lima Pereira", email: "roberto.pereira@escola.com", role: "Professor de Educação Física", baseSalary: 2600.00 },
  { id: 5, name: "Fernanda Alves Rodrigues", email: "fernanda.rodrigues@escola.com", role: "Coordenadora Pedagógica", baseSalary: 4500.00 },
  { id: 6, name: "João Pedro Martins", email: "joao.martins@escola.com", role: "Professor de Ciências", baseSalary: 2900.00 },
  { id: 7, name: "Patrícia Souza Lima", email: "patricia.lima@escola.com", role: "Professora de Inglês", baseSalary: 2750.00 },
  { id: 8, name: "Lucas Ferreira Gomes", email: "lucas.gomes@escola.com", role: "Professor de Geografia", baseSalary: 2850.00 },
];

const formatCurrency = (value) => {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
};

const StatusBadge = ({ status }) => {
  const config = {
    pending: { label: "Pendente", bg: "#FEF3C7", color: "#92400E", border: "#FCD34D" },
    reviewed: { label: "Validado", bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" },
    sent: { label: "Enviado", bg: "#DBEAFE", color: "#1E40AF", border: "#93C5FD" },
  };
  const c = config[status] || config.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      letterSpacing: 0.3, textTransform: "uppercase",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", background: c.color,
      }} />
      {c.label}
    </span>
  );
};

const AdjustmentRow = ({ adj, onRemove, index }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 10,
    padding: "8px 12px", borderRadius: 8,
    background: adj.type === "add" ? "#F0FDF4" : "#FEF2F2",
    border: `1px solid ${adj.type === "add" ? "#BBF7D0" : "#FECACA"}`,
    fontSize: 13,
  }}>
    <span style={{
      width: 22, height: 22, borderRadius: "50%", display: "flex",
      alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700,
      background: adj.type === "add" ? "#22C55E" : "#EF4444", color: "#fff",
    }}>
      {adj.type === "add" ? "+" : "−"}
    </span>
    <span style={{ flex: 1, color: "#374151" }}>{adj.description}</span>
    <span style={{
      fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
      color: adj.type === "add" ? "#16A34A" : "#DC2626",
    }}>
      {adj.type === "add" ? "+" : "−"} {formatCurrency(adj.value)}
    </span>
    <button onClick={() => onRemove(index)} style={{
      background: "none", border: "none", cursor: "pointer",
      color: "#9CA3AF", fontSize: 16, padding: 2,
      transition: "color 0.2s",
    }} onMouseOver={e => e.target.style.color = "#EF4444"}
       onMouseOut={e => e.target.style.color = "#9CA3AF"}>
      ✕
    </button>
  </div>
);

export default function PayrollApp() {
  const [employees, setEmployees] = useState(
    MOCK_EMPLOYEES.map(e => ({
      ...e,
      status: "pending",
      adjustments: [],
      paycheckExtracted: false,
      extractedValue: null,
    }))
  );
  const [selectedId, setSelectedId] = useState(null);
  const [pdfUploaded, setPdfUploaded] = useState(false);
  const [pdfProcessing, setPdfProcessing] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);
  const [emailsSent, setEmailsSent] = useState(0);
  const [newAdj, setNewAdj] = useState({ type: "add", description: "", value: "" });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [currentMonth] = useState(() => {
    const d = new Date();
    return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  });

  const selected = employees.find(e => e.id === selectedId);

  const handlePdfUpload = () => {
    setPdfProcessing(true);
    setPdfProgress(0);
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 15 + 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setPdfProcessing(false);
        setPdfUploaded(true);
        setEmployees(prev => prev.map(e => ({
          ...e,
          paycheckExtracted: true,
          extractedValue: e.baseSalary + (Math.random() * 400 - 200),
        })));
      }
      setPdfProgress(Math.min(progress, 100));
    }, 300);
  };

  const addAdjustment = () => {
    if (!newAdj.description || !newAdj.value || !selectedId) return;
    setEmployees(prev => prev.map(e =>
      e.id === selectedId
        ? { ...e, adjustments: [...e.adjustments, { ...newAdj, value: parseFloat(newAdj.value) }] }
        : e
    ));
    setNewAdj({ type: "add", description: "", value: "" });
  };

  const removeAdjustment = (index) => {
    setEmployees(prev => prev.map(e =>
      e.id === selectedId
        ? { ...e, adjustments: e.adjustments.filter((_, i) => i !== index) }
        : e
    ));
  };

  const validateEmployee = () => {
    setEmployees(prev => prev.map(e =>
      e.id === selectedId ? { ...e, status: "reviewed" } : e
    ));
    const currentIndex = filteredEmployees.findIndex(e => e.id === selectedId);
    const next = filteredEmployees[currentIndex + 1];
    if (next) setSelectedId(next.id);
  };

  const unvalidateEmployee = () => {
    setEmployees(prev => prev.map(e =>
      e.id === selectedId ? { ...e, status: "pending" } : e
    ));
  };

  const getTotal = (emp) => {
    if (!emp) return 0;
    const base = emp.extractedValue || emp.baseSalary;
    const adds = emp.adjustments.filter(a => a.type === "add").reduce((s, a) => s + a.value, 0);
    const subs = emp.adjustments.filter(a => a.type === "sub").reduce((s, a) => s + a.value, 0);
    return base + adds - subs;
  };

  const handleSendAll = () => {
    setSendingEmails(true);
    setEmailsSent(0);
    const reviewed = employees.filter(e => e.status === "reviewed");
    let count = 0;
    const interval = setInterval(() => {
      count++;
      setEmailsSent(count);
      if (count >= reviewed.length) {
        clearInterval(interval);
        setTimeout(() => {
          setEmployees(prev => prev.map(e =>
            e.status === "reviewed" ? { ...e, status: "sent" } : e
          ));
          setSendingEmails(false);
          setShowSendModal(false);
        }, 600);
      }
    }, 400);
  };

  const filteredEmployees = employees.filter(e => {
    const matchesSearch = e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.role.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === "all" || e.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: employees.length,
    pending: employees.filter(e => e.status === "pending").length,
    reviewed: employees.filter(e => e.status === "reviewed").length,
    sent: employees.filter(e => e.status === "sent").length,
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F8F7F4",
      fontFamily: "'Outfit', 'Segoe UI', sans-serif",
      color: "#1a1a1a",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <header style={{
        background: "#1B2A4A",
        color: "#fff",
        padding: "0 32px",
        height: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100,
        boxShadow: "0 2px 12px rgba(27,42,74,0.15)",
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
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{
            fontSize: 13, background: "rgba(255,255,255,0.12)",
            padding: "6px 14px", borderRadius: 8, fontWeight: 500,
            textTransform: "capitalize",
          }}>
            📅 {currentMonth}
          </span>
        </div>
      </header>

      <div style={{ display: "flex", height: "calc(100vh - 64px)" }}>

        {/* LEFT PANEL */}
        <div style={{
          width: 380, borderRight: "1px solid #E5E2DB",
          display: "flex", flexDirection: "column",
          background: "#FFFFFF",
        }}>
          {/* PDF Upload Area */}
          <div style={{ padding: 20, borderBottom: "1px solid #E5E2DB" }}>
            {!pdfUploaded && !pdfProcessing ? (
              <button onClick={handlePdfUpload} style={{
                width: "100%", padding: 20, borderRadius: 12,
                border: "2px dashed #CBD5E1",
                background: "#F8FAFC",
                cursor: "pointer",
                display: "flex", flexDirection: "column",
                alignItems: "center", gap: 8,
                transition: "all 0.2s",
              }}
              onMouseOver={e => { e.currentTarget.style.borderColor = "#F59E0B"; e.currentTarget.style.background = "#FFFBEB"; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = "#CBD5E1"; e.currentTarget.style.background = "#F8FAFC"; }}
              >
                <span style={{ fontSize: 28 }}>📄</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A" }}>
                  Upload do PDF de Contracheques
                </span>
                <span style={{ fontSize: 11, color: "#94A3B8" }}>
                  Clique para selecionar o arquivo
                </span>
              </button>
            ) : pdfProcessing ? (
              <div style={{
                padding: 20, borderRadius: 12,
                background: "#FFFBEB", border: "1px solid #FCD34D",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>⚙️</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#92400E" }}>
                    Processando PDF com IA...
                  </span>
                </div>
                <div style={{
                  height: 6, borderRadius: 3, background: "#FEF3C7", overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    background: "linear-gradient(90deg, #F59E0B, #EF4444)",
                    width: `${pdfProgress}%`,
                    transition: "width 0.3s ease",
                  }} />
                </div>
                <div style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>
                  Separando páginas e identificando colaboradores...
                </div>
              </div>
            ) : (
              <div style={{
                padding: 14, borderRadius: 12,
                background: "#F0FDF4", border: "1px solid #BBF7D0",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: "#22C55E", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16, fontWeight: 700,
                }}>✓</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#065F46" }}>
                    PDF processado com sucesso
                  </div>
                  <div style={{ fontSize: 11, color: "#059669" }}>
                    {employees.length} contracheques extraídos
                  </div>
                </div>
                <button onClick={() => { setPdfUploaded(false); setEmployees(prev => prev.map(e => ({ ...e, paycheckExtracted: false, extractedValue: null, status: "pending", adjustments: [] }))); }}
                  style={{
                    marginLeft: "auto", background: "none", border: "none",
                    color: "#6B7280", cursor: "pointer", fontSize: 12, textDecoration: "underline",
                  }}>
                  Reenviar
                </button>
              </div>
            )}
          </div>

          {/* Stats */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8, padding: "12px 20px",
            borderBottom: "1px solid #E5E2DB",
          }}>
            {[
              { label: "Pendentes", value: stats.pending, color: "#F59E0B" },
              { label: "Validados", value: stats.reviewed, color: "#22C55E" },
              { label: "Enviados", value: stats.sent, color: "#3B82F6" },
            ].map(s => (
              <div key={s.label} style={{
                textAlign: "center", padding: "8px 4px", borderRadius: 8,
                background: "#F8F7F4",
              }}>
                <div style={{
                  fontSize: 22, fontWeight: 800, color: s.color,
                  fontFamily: "'JetBrains Mono', monospace",
                }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "#6B7280", fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Search & Filter */}
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #E5E2DB" }}>
            <input
              type="text"
              placeholder="Buscar colaborador..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 8,
                border: "1px solid #E5E2DB", fontSize: 13,
                background: "#F8F7F4", outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={e => e.target.style.borderColor = "#F59E0B"}
              onBlur={e => e.target.style.borderColor = "#E5E2DB"}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {[
                { key: "all", label: "Todos" },
                { key: "pending", label: "Pendentes" },
                { key: "reviewed", label: "Validados" },
                { key: "sent", label: "Enviados" },
              ].map(f => (
                <button key={f.key} onClick={() => setFilterStatus(f.key)} style={{
                  padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500,
                  border: "1px solid",
                  borderColor: filterStatus === f.key ? "#1B2A4A" : "#E5E2DB",
                  background: filterStatus === f.key ? "#1B2A4A" : "transparent",
                  color: filterStatus === f.key ? "#fff" : "#6B7280",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Employee List */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filteredEmployees.map(emp => (
              <div
                key={emp.id}
                onClick={() => setSelectedId(emp.id)}
                style={{
                  padding: "14px 20px",
                  borderBottom: "1px solid #F3F0EB",
                  cursor: "pointer",
                  background: selectedId === emp.id ? "#FEF9EE" : "transparent",
                  borderLeft: selectedId === emp.id ? "3px solid #F59E0B" : "3px solid transparent",
                  transition: "all 0.15s",
                }}
                onMouseOver={e => { if (selectedId !== emp.id) e.currentTarget.style.background = "#FAFAF8"; }}
                onMouseOut={e => { if (selectedId !== emp.id) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A", marginBottom: 2 }}>
                      {emp.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#6B7280" }}>{emp.role}</div>
                  </div>
                  <StatusBadge status={emp.status} />
                </div>
                {emp.paycheckExtracted && (
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    marginTop: 8,
                  }}>
                    <span style={{
                      fontSize: 13, fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      color: "#1B2A4A",
                    }}>
                      {formatCurrency(getTotal(emp))}
                    </span>
                    {emp.adjustments.length > 0 && (
                      <span style={{
                        fontSize: 10, color: "#F59E0B", fontWeight: 600,
                        background: "#FEF3C7", padding: "2px 6px", borderRadius: 4,
                      }}>
                        {emp.adjustments.length} ajuste{emp.adjustments.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Send Button */}
          {stats.reviewed > 0 && (
            <div style={{ padding: 16, borderTop: "1px solid #E5E2DB" }}>
              <button onClick={() => setShowSendModal(true)} style={{
                width: "100%", padding: "12px 20px", borderRadius: 10,
                background: "linear-gradient(135deg, #1B2A4A, #2D4A7A)",
                color: "#fff", border: "none", cursor: "pointer",
                fontSize: 14, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                boxShadow: "0 4px 12px rgba(27,42,74,0.3)",
                transition: "transform 0.2s, box-shadow 0.2s",
              }}
              onMouseOver={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 16px rgba(27,42,74,0.4)"; }}
              onMouseOut={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(27,42,74,0.3)"; }}
              >
                📧 Enviar Lote ({stats.reviewed} contracheques)
              </button>
            </div>
          )}
        </div>

        {/* RIGHT PANEL - Detail */}
        <div style={{ flex: 1, overflowY: "auto", padding: 32 }}>
          {!selected ? (
            <div style={{
              height: "100%", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              color: "#9CA3AF",
            }}>
              <span style={{ fontSize: 56, marginBottom: 16, opacity: 0.5 }}>📋</span>
              <div style={{ fontSize: 18, fontWeight: 600, color: "#6B7280" }}>
                Selecione um colaborador
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {pdfUploaded
                  ? "Clique em um nome na lista para revisar o contracheque"
                  : "Faça upload do PDF para começar a validação"}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
              {/* Employee Header */}
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                marginBottom: 28,
              }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                    <h2 style={{ fontSize: 24, fontWeight: 800, color: "#1B2A4A", margin: 0 }}>
                      {selected.name}
                    </h2>
                    <StatusBadge status={selected.status} />
                  </div>
                  <div style={{ fontSize: 14, color: "#6B7280" }}>{selected.role}</div>
                  <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>
                    ✉️ {selected.email}
                  </div>
                </div>
              </div>

              {/* Paycheck Card */}
              <div style={{
                background: "#fff", borderRadius: 16, padding: 24,
                border: "1px solid #E5E2DB",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                marginBottom: 20,
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: 1, color: "#9CA3AF", marginBottom: 16,
                }}>
                  Contracheque — {currentMonth}
                </div>

                {selected.paycheckExtracted ? (
                  <>
                    {/* Base Value */}
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "12px 0",
                      borderBottom: "1px solid #F3F0EB",
                    }}>
                      <span style={{ fontSize: 14, color: "#374151" }}>Valor do Contracheque (PDF)</span>
                      <span style={{
                        fontSize: 18, fontWeight: 700,
                        fontFamily: "'JetBrains Mono', monospace",
                        color: "#1B2A4A",
                      }}>
                        {formatCurrency(selected.extractedValue || selected.baseSalary)}
                      </span>
                    </div>

                    {/* Adjustments List */}
                    {selected.adjustments.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <div style={{
                          fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                          letterSpacing: 1, color: "#9CA3AF", marginBottom: 10,
                        }}>
                          Ajustes
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {selected.adjustments.map((adj, i) => (
                            <AdjustmentRow
                              key={i}
                              adj={adj}
                              index={i}
                              onRemove={selected.status !== "sent" ? removeAdjustment : () => {}}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Total */}
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "16px 0 0",
                      marginTop: 16,
                      borderTop: "2px solid #1B2A4A",
                    }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#1B2A4A" }}>
                        Total a Receber
                      </span>
                      <span style={{
                        fontSize: 26, fontWeight: 800,
                        fontFamily: "'JetBrains Mono', monospace",
                        color: getTotal(selected) >= 0 ? "#16A34A" : "#DC2626",
                      }}>
                        {formatCurrency(getTotal(selected))}
                      </span>
                    </div>
                  </>
                ) : (
                  <div style={{
                    padding: 32, textAlign: "center", color: "#9CA3AF",
                  }}>
                    <span style={{ fontSize: 32 }}>📄</span>
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      Faça upload do PDF para ver o contracheque
                    </div>
                  </div>
                )}
              </div>

              {/* Add Adjustment Form */}
              {selected.paycheckExtracted && selected.status !== "sent" && (
                <div style={{
                  background: "#fff", borderRadius: 16, padding: 24,
                  border: "1px solid #E5E2DB",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  marginBottom: 20,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: 1, color: "#9CA3AF", marginBottom: 16,
                  }}>
                    Adicionar Ajuste
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        onClick={() => setNewAdj(p => ({ ...p, type: "add" }))}
                        style={{
                          padding: "8px 14px", borderRadius: "8px 0 0 8px", fontSize: 13,
                          fontWeight: 600, cursor: "pointer",
                          border: "1px solid",
                          borderColor: newAdj.type === "add" ? "#22C55E" : "#E5E2DB",
                          background: newAdj.type === "add" ? "#22C55E" : "#fff",
                          color: newAdj.type === "add" ? "#fff" : "#6B7280",
                        }}
                      >
                        + Adicional
                      </button>
                      <button
                        onClick={() => setNewAdj(p => ({ ...p, type: "sub" }))}
                        style={{
                          padding: "8px 14px", borderRadius: "0 8px 8px 0", fontSize: 13,
                          fontWeight: 600, cursor: "pointer",
                          border: "1px solid",
                          borderColor: newAdj.type === "sub" ? "#EF4444" : "#E5E2DB",
                          background: newAdj.type === "sub" ? "#EF4444" : "#fff",
                          color: newAdj.type === "sub" ? "#fff" : "#6B7280",
                        }}
                      >
                        − Desconto
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Descrição (ex: Aula extra, Vale transporte)"
                      value={newAdj.description}
                      onChange={e => setNewAdj(p => ({ ...p, description: e.target.value }))}
                      style={{
                        flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 8,
                        border: "1px solid #E5E2DB", fontSize: 13, outline: "none",
                      }}
                      onFocus={e => e.target.style.borderColor = "#F59E0B"}
                      onBlur={e => e.target.style.borderColor = "#E5E2DB"}
                    />
                    <input
                      type="number"
                      placeholder="Valor (R$)"
                      value={newAdj.value}
                      onChange={e => setNewAdj(p => ({ ...p, value: e.target.value }))}
                      style={{
                        width: 120, padding: "8px 12px", borderRadius: 8,
                        border: "1px solid #E5E2DB", fontSize: 13, outline: "none",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                      onFocus={e => e.target.style.borderColor = "#F59E0B"}
                      onBlur={e => e.target.style.borderColor = "#E5E2DB"}
                    />
                    <button onClick={addAdjustment} style={{
                      padding: "8px 20px", borderRadius: 8,
                      background: "#F59E0B", color: "#fff",
                      border: "none", cursor: "pointer",
                      fontSize: 13, fontWeight: 700,
                      transition: "background 0.2s",
                    }}
                    onMouseOver={e => e.currentTarget.style.background = "#D97706"}
                    onMouseOut={e => e.currentTarget.style.background = "#F59E0B"}
                    >
                      Adicionar
                    </button>
                  </div>
                </div>
              )}

              {/* Email Preview */}
              {selected.paycheckExtracted && (
                <div style={{
                  background: "#fff", borderRadius: 16, padding: 24,
                  border: "1px solid #E5E2DB",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  marginBottom: 20,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: 1, color: "#9CA3AF", marginBottom: 16,
                  }}>
                    Prévia do E-mail
                  </div>
                  <div style={{
                    background: "#F8F7F4", borderRadius: 10, padding: 20,
                    fontSize: 13, lineHeight: 1.7, color: "#374151",
                    border: "1px solid #E5E2DB",
                  }}>
                    <div style={{ marginBottom: 6 }}>
                      <strong>Para:</strong> {selected.email}
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <strong>Assunto:</strong> Contracheque — {currentMonth}
                    </div>
                    <hr style={{ border: "none", borderTop: "1px solid #E5E2DB", margin: "12px 0" }} />
                    <p>Olá, {selected.name.split(" ")[0]}!</p>
                    <p>Segue em anexo o seu contracheque referente a <strong>{currentMonth}</strong>.</p>
                    {selected.adjustments.length > 0 && (
                      <>
                        <p>Informamos os seguintes ajustes neste mês:</p>
                        <ul style={{ paddingLeft: 20 }}>
                          {selected.adjustments.map((adj, i) => (
                            <li key={i}>
                              {adj.description}: <strong style={{
                                color: adj.type === "add" ? "#16A34A" : "#DC2626",
                              }}>
                                {adj.type === "add" ? "+" : "−"} {formatCurrency(adj.value)}
                              </strong>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <p><strong>Valor total a receber: {formatCurrency(getTotal(selected))}</strong></p>
                    <p>Em caso de dúvidas, entre em contato com o setor administrativo.</p>
                    <p>Atenciosamente,<br />Administração Escolar</p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              {selected.paycheckExtracted && selected.status !== "sent" && (
                <div style={{ display: "flex", gap: 12 }}>
                  {selected.status === "pending" ? (
                    <button onClick={validateEmployee} style={{
                      flex: 1, padding: "14px 24px", borderRadius: 12,
                      background: "linear-gradient(135deg, #22C55E, #16A34A)",
                      color: "#fff", border: "none", cursor: "pointer",
                      fontSize: 15, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      boxShadow: "0 4px 12px rgba(34,197,94,0.3)",
                      transition: "transform 0.2s",
                    }}
                    onMouseOver={e => e.currentTarget.style.transform = "translateY(-1px)"}
                    onMouseOut={e => e.currentTarget.style.transform = "none"}
                    >
                      ✓ Validar e Próximo
                    </button>
                  ) : (
                    <button onClick={unvalidateEmployee} style={{
                      flex: 1, padding: "14px 24px", borderRadius: 12,
                      background: "#fff",
                      color: "#F59E0B", border: "2px solid #F59E0B", cursor: "pointer",
                      fontSize: 15, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      transition: "all 0.2s",
                    }}
                    onMouseOver={e => { e.currentTarget.style.background = "#FEF3C7"; }}
                    onMouseOut={e => { e.currentTarget.style.background = "#fff"; }}
                    >
                      ↩ Reabrir para Edição
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Send Modal */}
      {showSendModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 200,
          backdropFilter: "blur(4px)",
        }} onClick={() => !sendingEmails && setShowSendModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, padding: 32,
            width: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          }}>
            {!sendingEmails ? (
              <>
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                  <span style={{ fontSize: 48 }}>📧</span>
                  <h3 style={{ fontSize: 20, fontWeight: 800, color: "#1B2A4A", margin: "12px 0 4px" }}>
                    Enviar Contracheques
                  </h3>
                  <p style={{ fontSize: 14, color: "#6B7280", margin: 0 }}>
                    Você está prestes a enviar {stats.reviewed} contracheque{stats.reviewed > 1 ? "s" : ""} por e-mail.
                  </p>
                </div>
                <div style={{
                  background: "#F8F7F4", borderRadius: 12, padding: 16, marginBottom: 24,
                  maxHeight: 200, overflowY: "auto",
                }}>
                  {employees.filter(e => e.status === "reviewed").map(e => (
                    <div key={e.id} style={{
                      display: "flex", justifyContent: "space-between",
                      padding: "6px 0", fontSize: 13,
                      borderBottom: "1px solid #E5E2DB",
                    }}>
                      <span style={{ color: "#374151" }}>{e.name}</span>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 600, color: "#1B2A4A",
                      }}>
                        {formatCurrency(getTotal(e))}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button onClick={() => setShowSendModal(false)} style={{
                    flex: 1, padding: "12px 20px", borderRadius: 10,
                    background: "#F3F4F6", color: "#6B7280",
                    border: "none", cursor: "pointer",
                    fontSize: 14, fontWeight: 600,
                  }}>
                    Cancelar
                  </button>
                  <button onClick={handleSendAll} style={{
                    flex: 1, padding: "12px 20px", borderRadius: 10,
                    background: "linear-gradient(135deg, #1B2A4A, #2D4A7A)",
                    color: "#fff", border: "none", cursor: "pointer",
                    fontSize: 14, fontWeight: 700,
                    boxShadow: "0 4px 12px rgba(27,42,74,0.3)",
                  }}>
                    Confirmar Envio
                  </button>
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{
                  width: 64, height: 64, borderRadius: "50%",
                  background: "#F0FDF4", border: "3px solid #22C55E",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 28, margin: "0 auto 16px",
                }}>
                  📤
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1B2A4A", margin: "0 0 8px" }}>
                  Enviando e-mails...
                </h3>
                <div style={{
                  fontSize: 32, fontWeight: 800, color: "#22C55E",
                  fontFamily: "'JetBrains Mono', monospace",
                  margin: "12px 0",
                }}>
                  {emailsSent} / {stats.reviewed}
                </div>
                <div style={{
                  height: 6, borderRadius: 3, background: "#F3F4F6",
                  overflow: "hidden", margin: "0 40px",
                }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    background: "linear-gradient(90deg, #22C55E, #16A34A)",
                    width: `${(emailsSent / stats.reviewed) * 100}%`,
                    transition: "width 0.3s ease",
                  }} />
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
        ::-webkit-scrollbar-thumb:hover { background: #9CA3AF; }
      `}</style>
    </div>
  );
}




































