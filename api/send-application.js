const PDFDocument = require('pdfkit');
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const resend = new Resend('re_D9tacW4F_BpenLgZHz1MryaoxcSgaQGxb');

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function buildPDF(record) {
  // Try to fetch signature image
  let sigBuffer = null;
  if (record.signature && record.signature.startsWith('http')) {
    try {
      sigBuffer = await fetchBuffer(record.signature);
    } catch (e) {
      console.error('Failed to fetch signature:', e);
    }
  }

  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 40, bottom: 50, left: 50, right: 50 } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const pageWidth = 612;
    const leftMargin = 50;
    const rightEdge = pageWidth - 50;
    const valueX = 270;

    // ─── LOGO ───
    const logoPath = path.join(__dirname, 'logo.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, leftMargin, 25, { width: 160 });
    }

    // ─── DATE (top right) ───
    doc.fontSize(10).font('Helvetica').fillColor('#333333')
       .text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), 350, 45, { align: 'right', width: rightEdge - 350 });

    let y = 115;

    // ─── BUSINESS INFORMATION header ───
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0e1a2b')
       .text('BUSINESS INFORMATION', leftMargin, y);
    y += 24;

    function drawField(label, value) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0e1a2b')
         .text(label, leftMargin, y, { width: 210 });
      doc.fontSize(10).font('Helvetica').fillColor('#333333')
         .text(value || '', valueX, y, { width: rightEdge - valueX });
      y += 20;
    }

    drawField('Business Name', record.business_name);
    drawField('Business DBA', record.business_dba);
    drawField('TAX / EIN', record.tax_ein);
    drawField('Entity Type', record.entity_type);
    drawField('Nature of Business', record.nature_of_business);
    drawField('Product / Service', record.product_service);
    drawField('Length of Ownership', record.length_of_ownership);
    drawField('Date of Incorporation', record.date_of_incorporation);
    drawField('Business Address', record.business_address);
    drawField('How much are you looking for?', record.capital_looking_for);
    drawField('Use of Funds', record.use_of_funds);
    drawField('Do you Accept Credit Cards?', record.accept_credit_cards);
    drawField('Do you have open MCA?', record.open_mca);

    y += 12;

    // ─── OWNER INFORMATION header ───
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0e1a2b')
       .text('OWNER INFORMATION', leftMargin, y);
    y += 24;

    drawField("Owner's Name", record.owner_name);
    drawField('SSN #', record.ssn);
    drawField('Date of Birth', record.dob);
    drawField('Home Address', record.home_address);
    drawField('Credit Score', record.credit_score);

    y += 12;

    // ─── TERMS ───
    doc.fontSize(6.5).font('Helvetica').fillColor('#444444')
       .text('By signing below, each of the above listed business and business owner/officer (individually and collectively, "you") authorize Fairmont Credit Partners ("FCP") and each of its representatives, successors, assigns and designees that may be involved with or acquire commercial loans having daily repayment features or purchases of future receivables including Merchant Cash Advance transactions, including without limitation the application therefor (collectively, "Transactions") to obtain consumer or personal, business and investigative reports and other information about you, including credit card processor statements and bank statements, from one or more consumer reporting agencies, such as TransUnion, Experian and Equifax, Identity IQ and from other credit bureaus, banks, creditors, government agencies and other third parties (the "Recipients"). You also authorize FCP to transmit this application form, along with any of the foregoing information obtained in connection with this application, to any or all of the Recipients for the foregoing purposes. You also consent to the release, by any creditor or financial institution, of any information relating to any of you, to FCP and to each of the Recipients, on its own behalf and authorize FCP to communicate with the Recipients on your behalf and represent you with the Recipients. You also authorize FCP and each of its Recipients to contact you via text message, automated call or email message at the contact information listed above.', leftMargin, y, { width: rightEdge - leftMargin });

    y = doc.y + 12;

    // ─── SIGNATURE (inline, no extra page) ───
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#0e1a2b')
       .text('Signature:', leftMargin, y);

    if (sigBuffer) {
      try {
        doc.image(sigBuffer, valueX, y - 5, { width: 150, height: 35 });
      } catch (e) {
        doc.fontSize(10).font('Helvetica').text('Signed', valueX, y);
      }
    } else {
      doc.fontSize(10).font('Helvetica').text('Signed', valueX, y);
    }

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

    // Add statement files as attachments
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
             <p>Full application PDF attached with signature and statements.</p>`,
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
