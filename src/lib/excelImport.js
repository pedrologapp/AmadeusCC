// Leitura da planilha mensal da folha (1 aba por colaborador).
// Lê o arquivo .xls/.xlsx inteiramente no navegador — não usa n8n nem servidor.
// A lógica foi validada contra a planilha real em scripts/parse-excel-proto.mjs.
import * as XLSX from 'xlsx';

// Abas que nunca são colaboradores
const IGNORE_SHEETS = ['Plan1'];

const norm = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const isNum = (v) => typeof v === 'number' && isFinite(v);

// Converte célula (número ou texto "-R$ 127,00" / "(127,00)") em número com sinal.
function toNumber(v) {
  if (isNum(v)) return v;
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s/g, '');
  if (!/\d/.test(t)) return null;
  const neg = t.includes('-') || /^\(.*\)$/.test(t);
  let digits = t.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(digits.replace(/[()]/g, ''));
  if (!isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function findRow(rows, predicate) {
  for (let i = 0; i < rows.length; i++) {
    for (const cell of rows[i]) {
      if (typeof cell === 'string' && predicate(cell)) return i;
    }
  }
  return -1;
}

// Coluna dos valores = última coluna numérica daquela linha (col "I" na planilha atual).
function lastNumericCol(row) {
  let idx = -1;
  for (let c = 0; c < row.length; c++) {
    if (toNumber(row[c]) != null) idx = c;
  }
  return idx;
}

// Sugere a categoria do sistema a partir da descrição.
function guessCategory(desc) {
  const d = desc.toLowerCase();
  if (/transporte|vale\s*transp/.test(d)) return 'transport';
  if (/refei[çc][ãa]o|alimenta/.test(d)) return 'meal';
  if (/sa[úu]de|plano/.test(d)) return 'health';
  if (/adiantamento/.test(d)) return 'advance';
  if (/empr[ée]stimo|cart[ãa]o/.test(d)) return 'loan';
  if (/material|livro|did[áa]tico/.test(d)) return 'material';
  if (/substitui/.test(d)) return 'replacement';
  if (/aula\s*extra/.test(d)) return 'extra_class';
  if (/b[ôo]nus|bonifica/.test(d)) return 'bonus';
  if (/falta/.test(d)) return 'absence';
  if (/atraso/.test(d)) return 'late';
  return 'other';
}

// Layout NOVO (gerado por scripts/build-new-excel.ps1): tabela Descrição | Tipo | Valor,
// CPF na linha 4 e "TOTAL A RECEBER" com fórmula. Detectado pelo cabeçalho da tabela.
function parseNewLayoutSheet(rows, sheetName, innerName, hdrRow) {
  let cpf = '';
  const cpfRow = findRow(rows, (s) => /^cpf\s*:/i.test(s.trim()));
  if (cpfRow >= 0) {
    const cell = rows[cpfRow].find((c) => typeof c === 'string' && /^cpf\s*:/i.test(c.trim()));
    const digits = (cell || '').replace(/\D/g, '');
    if (digits.length === 11) cpf = digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  const salRow = findRow(rows, (s) => /sal[aá]rio l[ií]quido/i.test(s));
  const salario = salRow >= 0 ? toNumber(rows[salRow][lastNumericCol(rows[salRow])]) : null;

  const totRow = findRow(rows, (s) => /total a receber/i.test(s));
  const grandTotal = totRow >= 0 ? toNumber(rows[totRow][lastNumericCol(rows[totRow])]) : null;

  const items = [];
  const end = totRow >= 0 ? totRow : rows.length;
  for (let r = hdrRow + 1; r < end; r++) {
    const desc = norm(rows[r][0]);
    const tipo = norm(rows[r][1]);
    const val = toNumber(rows[r][2]);
    if (!desc || val == null || val === 0) continue;
    // Tipo explícito manda; se a pessoa esqueceu de preencher, usa o sinal do valor.
    const isDeduction = /desconto/i.test(tipo) || (!tipo && val < 0);
    items.push({
      description: desc,
      value: round2(Math.abs(val)),
      type: isDeduction ? 'deduction' : 'addition',
      category: guessCategory(desc),
    });
  }

  const sumSigned = items.reduce((s, it) => s + (it.type === 'addition' ? it.value : -it.value), 0);
  const computedTotal = round2((salario || 0) + sumSigned);
  const reconciles = grandTotal != null ? Math.abs(computedTotal - grandTotal) < 0.5 : null;

  return {
    sheetName,
    innerName,
    cpf,
    salario,
    aReceber: grandTotal,
    items,
    sumSigned: round2(sumSigned),
    computedTotal,
    grandTotal: grandTotal != null ? round2(grandTotal) : null,
    reconciles,
    hasData: salRow >= 0,
  };
}

// Lê uma aba e devolve nome + lançamentos.
function parseSheet(ws, sheetName) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  // Nome de dentro da planilha (NÃO confiável — usado só como dica visual).
  let innerName = '';
  const funcRow = findRow(rows, (s) => /funcion[aá]rio/i.test(s));
  if (funcRow >= 0) {
    const cell = rows[funcRow].find((c) => typeof c === 'string' && /funcion/i.test(c));
    if (cell && cell.includes(':')) innerName = norm(cell.split(':').slice(1).join(':'));
  }

  // Layout novo? Cabeçalho "Descrição | Tipo | Valor" presente.
  const hdrRow = rows.findIndex(
    (r) =>
      typeof r[0] === 'string' && /descri/i.test(r[0]) &&
      typeof r[1] === 'string' && /^tipo$/i.test(norm(r[1]))
  );
  if (hdrRow >= 0) return parseNewLayoutSheet(rows, sheetName, innerName, hdrRow);

  const salRow = findRow(rows, (s) => /sal[aá]rio l[ií]quido/i.test(s));
  let valCol = -1;
  let salario = null;
  if (salRow >= 0) {
    valCol = lastNumericCol(rows[salRow]);
    if (valCol >= 0) salario = toNumber(rows[salRow][valCol]);
  }
  if (valCol < 0) valCol = 8; // fallback coluna I

  const recRow = findRow(rows, (s) => /a receber/i.test(s));
  const aReceber = recRow >= 0 ? toNumber(rows[recRow][valCol]) : null;

  const items = [];
  const start = salRow >= 0 ? salRow + 1 : 0;
  const end = recRow >= 0 ? recRow : rows.length;
  for (let r = start; r < end; r++) {
    const desc = norm(rows[r][0]);
    const val = toNumber(rows[r][valCol]);
    if (desc && val != null && val !== 0) {
      items.push({
        description: desc,
        value: round2(Math.abs(val)),
        type: val < 0 ? 'deduction' : 'addition',
        category: guessCategory(desc),
      });
    }
  }

  // Vale transporte: linha logo após "A RECEBER".
  if (recRow >= 0 && recRow + 1 < rows.length) {
    const v = toNumber(rows[recRow + 1][valCol]);
    if (v != null && v !== 0) {
      items.push({
        description: 'Vale Transporte',
        value: round2(Math.abs(v)),
        type: 'addition',
        category: 'transport',
      });
    }
  }

  const sumSigned = items.reduce((s, it) => s + (it.type === 'addition' ? it.value : -it.value), 0);
  const computedTotal = round2((salario || 0) + sumSigned);
  const grandTotal = recRow >= 0 && recRow + 2 < rows.length ? toNumber(rows[recRow + 2][valCol]) : null;

  // A planilha "fecha" se o total que calculamos bate com o total final dela.
  const reconciles = grandTotal != null ? Math.abs(computedTotal - grandTotal) < 0.5 : null;

  return {
    sheetName,
    innerName,
    cpf: '',
    salario,
    aReceber,
    items,
    sumSigned: round2(sumSigned),
    computedTotal,
    grandTotal: grandTotal != null ? round2(grandTotal) : null,
    reconciles,
    hasData: salRow >= 0,
  };
}

// Entrada principal: recebe o ArrayBuffer do arquivo e devolve a lista de abas.
export function parsePayrollWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellNF: false, cellText: false });
  const sheets = [];
  for (const name of wb.SheetNames) {
    if (IGNORE_SHEETS.includes(name)) continue;
    try {
      sheets.push(parseSheet(wb.Sheets[name], name));
    } catch (e) {
      sheets.push({ sheetName: name, error: e.message, items: [], hasData: false });
    }
  }
  return sheets;
}

// Normaliza nome para comparação (sem acento, minúsculo).
export function normalizeName(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Sugere o colaborador para uma aba: CPF primeiro (layout novo), depois nome.
export function suggestCollaborator(sheetName, collaborators, cpf) {
  if (cpf) {
    const digits = String(cpf).replace(/\D/g, '');
    const byCpf = collaborators.find((c) => c.cpf && c.cpf.replace(/\D/g, '') === digits);
    if (byCpf) return byCpf;
  }
  const sheet = normalizeName(sheetName).replace(/\(\d+\)/g, '').trim();
  const sheetFirst = sheet.split(' ')[0];
  // 1) match exato do começo do nome completo
  let m = collaborators.find((c) => normalizeName(c.full_name).startsWith(sheet));
  // 2) primeiro nome igual
  if (!m) m = collaborators.find((c) => normalizeName(c.full_name).split(' ')[0] === sheetFirst);
  // 3) nome da aba contido no nome completo
  if (!m) m = collaborators.find((c) => normalizeName(c.full_name).includes(sheet));
  return m || null;
}
