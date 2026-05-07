const PDFDocument = require('pdfkit');
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');

const resend = new Resend('re_D9tacW4F_BpenLgZHz1MryaoxcSgaQGxb');

function buildPDF(record) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const pageWidth = 612;
    const leftMargin = 50;
    const labelX = leftMargin;
    const valueX = 230;
    const rightEdge = pageWidth - 50;

    // Logo area - Company name as header
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1B7FD4')
       .text('FAIRMONT CREDIT PARTNERS', leftMargin, 50, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor('#666666')
       .text('Private Business Lending', { align: 'center' });

    // Date - top right
    doc.fontSize(9).font('Helvetica').fillColor('#333333')
       .text('Date: ' + new Date().toLocaleDateString('en-US'), leftMargin, 50, { align: 'right' });

    // Line separator
    doc.moveTo(leftMargin, 100).lineTo(rightEdge, 100).strokeColor('#1B7FD4').lineWidth(2).stroke();

    // ─── BUSINESS INFORMATION ───
    let y = 115;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#1B7FD4')
       .text('BUSINESS INFORMATION', leftMargin, y);
    y += 28;

    const fields1 = [
      ['Business Name', record.business_name],
      ['TAX / EIN', record.tax_ein],
      ['Entity Type', record.entity_type],
      ['Nature of Business', record.nature_of_business],
      ['Product / Service', record.product_service],
      ['Length of Ownership', record.length_of_ownership],
      ['Date of Incorporation', record.date_of_incorporation],
      ['Business Address', record.business_address],
      ['Capital Looking For', record.capital_looking_for],
      ['Use of Funds', record.use_of_funds],
      ['Accept Credit Cards?', record.accept_credit_cards],
      ['Open MCA Positions?', record.open_mca],
    ];

    fields1.forEach(([label, value]) => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
         .text(label + ':', labelX, y, { width: 170 });
      doc.fontSize(10).font('Helvetica').fillColor('#000000')
         .text(value || '', valueX, y, { width: rightEdge - valueX });
      y += 22;
    });

    // Line separator
    y += 8;
    doc.moveTo(leftMargin, y).lineTo(rightEdge, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    y += 15;

    // ─── OWNER INFORMATION ───
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#1B7FD4')
       .text('OWNER INFORMATION', leftMargin, y);
    y += 28;

    const fields2 = [
      ['Owner\'s Name', record.owner_name],
      ['SSN #', record.ssn],
      ['Date of Birth', record.dob],
      ['Home Address', record.home_address],
      ['Credit Score', record.credit_score],
    ];

    fields2.forEach(([label, value]) => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
         .text(label + ':', labelX, y, { width: 170 });
      doc.fontSize(10).font('Helvetica').fillColor('#000000')
         .text(value || '', valueX, y, { width: rightEdge - valueX });
      y += 22;
    });

    // Line separator
    y += 8;
    doc.moveTo(leftMargin, y).lineTo(rightEdge, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    y += 15;

    // ─── TERMS ───
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#1B7FD4')
       .text('TERMS OF USE', leftMargin, y);
    y += 22;

    doc.fontSize(7).font('Helvetica').fillColor('#555555')
       .text('By signing below, each of the above listed business and business owner/officer (individually and collectively, "you") authorize Fairmont Credit Partners ("FCP") and each of its representatives, successors, assigns and designees that may be involved with or acquire commercial loans having daily repayment features or purchases of future receivables including Merchant Cash Advance transactions, including without limitation the application therefor (collectively, "Transactions") to obtain consumer or personal, business and investigative reports and other information about you, including credit card processor statements and bank statements, from one or more consumer reporting agencies, such as TransUnion, Experian and Equifax, Identity IQ and from other credit bureaus, banks, creditors, government agencies and other third parties (the "Recipients"). You also authorize FCP to transmit this application form, along with any of the foregoing information obtained in connection with this application, to any or all of the Recipients for the foregoing purposes.', leftMargin, y, { width: rightEdge - leftMargin });

    y = doc.y + 20;

    // Signature
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
       .text('Signature:', labelX, y, { width: 170 });
    doc.fontSize(10).font('Helvetica').fillColor('#000000')
       .text(record.signature && record.signature.startsWith('http') ? 'See attached' : (record.signature || 'Signed'), valueX, y);
    y += 22;

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
       .text('Sign Date:', labelX, y, { width: 170 });
    doc.fontSize(10).font('Helvetica').fillColor('#000000')
       .text(record.sign_date || '', valueX, y);

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { record } = req.body;
    if (!record) {
      return res.status(400).json({ error: 'No record provided' });
    }

    const pdfBuffer = await buildPDF(record);

    const attachments = [
      {
        filename: `FCP_Application_${(record.business_name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
        content: pdfBuffer,
      },
    ];

    // If signature is a URL, add it as attachment
    if (record.signature && record.signature.startsWith('http')) {
      attachments.push({
        filename: 'signature.png',
        path: record.signature,
      });
    }

    // If file_urls exist, add them as attachments
    if (record.file_urls) {
      const urls = record.file_urls.split('\n').filter(Boolean);
      urls.forEach((url, i) => {
        const ext = url.split('.').pop() || 'pdf';
        attachments.push({
          filename: `statement_${i + 1}.${ext}`,
          path: url,
        });
      });
    }

    const { error } = await resend.emails.send({
      from: 'Fairmont Credit Partners <onboarding@resend.dev>',
      to: 'deals@fairmontcp.net',
      subject: `Application: ${record.business_name || 'Unknown Business'}`,
      html: `<h2>New Application Received</h2>
             <p><strong>Business:</strong> ${record.business_name || ''}</p>
             <p><strong>Owner:</strong> ${record.owner_name || ''}</p>
             <p><strong>Capital Requested:</strong> ${record.capital_looking_for || ''}</p>
             <p>Full application PDF attached along with signature and statements.</p>`,
      attachments,
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};
