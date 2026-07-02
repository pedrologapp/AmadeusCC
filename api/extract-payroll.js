// Função serverless (Vercel) que substitui o processamento do n8n.
// Recebe a URL do PDF + uma lista de páginas (um "lote"), recorta essas páginas,
// e usa o Claude para extrair os contracheques daquele lote.
// A chave da IA fica em process.env.ANTHROPIC_API_KEY (configurada no Vercel — nunca no navegador).

const EXTRACTION_PROMPT = `Extraia os dados de TODOS os contracheques deste PDF. ATENÇÃO: alguns colaboradores ocupam MAIS de uma página. Identifique o número da página (ou páginas) de cada colaborador, começando a contar em 1. Ignore vias duplicadas (1ª via/2ª via do mesmo colaborador na mesma página). Para cada colaborador, retorne um JSON. Responda APENAS com um array JSON, sem markdown, sem explicação:
[
  {
    "employee_code": "000002",
    "employee_name": "NOME COMPLETO",
    "cpf": "000.000.000-00",
    "role": "cargo",
    "gross_salary": 0.00,
    "total_deductions": 0.00,
    "net_salary": 0.00,
    "pages": [1],
    "details": [
      {"code": "5", "description": "Salário mensalista", "reference": "30,00", "earnings": 0.00, "deductions": 0.00}
    ]
  }
]
IMPORTANTE: o campo "pages" deve conter a lista de páginas que aquele colaborador ocupa NESTE PDF. Se ocupa 2 páginas, exemplo: "pages": [1, 2]`;

module.exports = async (req, res) => {
  // Libera o site a chamar esta função (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no Vercel' });

    const { pdf_url, pages, origin } = req.body || {};
    if (!pdf_url || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Envie pdf_url e pages (array de números de página)' });
    }

    // 1) Recorta só as páginas deste lote usando a função split-pdf que já existe
    const base = origin || `https://${req.headers.host}`;
    const splitUrl = `${base}/api/split-pdf?url=${encodeURIComponent(pdf_url)}&pages=${pages.join(',')}`;
    const pdfResp = await fetch(splitUrl);
    // status 500 (não 502/504): o Cloudflare troca respostas 502/504 pela página HTML dele e esconde a mensagem
    if (!pdfResp.ok) return res.status(500).json({ error: `Falha ao recortar páginas (${pdfResp.status})` });
    const pdfBase64 = Buffer.from(await pdfResp.arrayBuffer()).toString('base64');

    // 2) Manda o lote (pequeno) pro Claude
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        // claude-sonnet-4-20250514 foi aposentado pela Anthropic (jun/2026)
        model: 'claude-sonnet-5',
        max_tokens: 8000,
        // Extração direta: sem "pensamento" (mais rápido e barato; no Sonnet 5 ele viria ligado por padrão)
        thinking: { type: 'disabled' },
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        }],
      }),
    });

    if (!claudeResp.ok) {
      const t = await claudeResp.text();
      return res.status(500).json({ error: `Claude (${claudeResp.status}): ${t.slice(0, 300)}` });
    }

    const claudeData = await claudeResp.json();
    // Pega o bloco de texto (o primeiro bloco pode não ser texto em modelos novos)
    const textBlock = (claudeData.content || []).find((b) => b.type === 'text');
    let txt = (textBlock?.text || '').trim();
    if (txt.startsWith('```json')) txt = txt.slice(7);
    if (txt.startsWith('```')) txt = txt.slice(3);
    if (txt.endsWith('```')) txt = txt.slice(0, -3);
    txt = txt.trim();

    let employees;
    try {
      employees = JSON.parse(txt);
    } catch (e) {
      return res.status(500).json({ error: 'Resposta da IA não veio em JSON', raw: txt.slice(0, 300) });
    }

    // 3) Converte as páginas relativas (1..N do lote) para as páginas absolutas do PDF original
    const mapped = (Array.isArray(employees) ? employees : []).map((emp) => ({
      ...emp,
      pages: (emp.pages || [1]).map((p) => pages[p - 1]).filter(Boolean),
    }));

    return res.status(200).json({ employees: mapped, batch_pages: pages });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
