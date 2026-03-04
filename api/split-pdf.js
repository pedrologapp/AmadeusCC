const { PDFDocument } = require('pdf-lib');

module.exports = async function handler(req, res) {
  const params = req.method === 'POST' ? req.body : req.query;
  const { url, page } = params;
  if (!url || !page) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: url, page' });
  }
  const pageNum = parseInt(page);
  if (isNaN(pageNum) || pageNum < 1) {
    return res.status(400).json({ error: 'page deve ser um numero >= 1' });
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({ error: 'Falha ao baixar PDF: ' + response.status });
    }
    const pdfBytes = await response.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();
    if (pageNum > totalPages) {
      return res.status(400).json({
        error: 'Pagina ' + pageNum + ' nao existe. O PDF tem ' + totalPages + ' paginas.'
      });
    }
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageNum - 1]);
    newPdf.addPage(copiedPage);
    const newPdfBytes = await newPdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="page_' + pageNum + '.pdf"');
    res.status(200).send(Buffer.from(newPdfBytes));
  } catch (error) {
    res.status(500).json({ error: 'Erro ao processar PDF', details: error.message });
  }
};
