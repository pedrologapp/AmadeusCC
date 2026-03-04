const { PDFDocument } = require('pdf-lib');

module.exports = async (req, res) => {
  try {
    const { url, page, pages } = req.query;
    if (!url) return res.status(400).send('Missing url parameter');

    const response = await fetch(url);
    if (!response.ok) return res.status(500).send('Failed to fetch PDF');

    const pdfBytes = await response.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const newPdf = await PDFDocument.create();

    let pageList = [];
    if (pages) {
      pageList = pages.split(',').map(p => parseInt(p.trim(), 10));
    } else if (page) {
      pageList = [parseInt(page, 10)];
    } else {
      return res.status(400).send('Missing page or pages parameter');
    }

    for (const pageNum of pageList) {
      if (pageNum < 1 || pageNum > pdfDoc.getPageCount()) continue;
      const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageNum - 1]);
      newPdf.addPage(copiedPage);
    }

    const outputBytes = await newPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=page.pdf');
    res.send(Buffer.from(outputBytes));
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
};;
