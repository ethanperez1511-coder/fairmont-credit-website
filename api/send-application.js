const ExcelJS = require('exceljs');
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');

const resend = new Resend('re_D9tacW4F_BpenLgZHz1MryaoxcSgaQGxb');

// Map of label row -> value row, column B for labels, values go in row below
const FIELD_MAP = {
  business_name: { row: 13, col: 2 },
  tax_ein: { row: 17, col: 2 },
  entity_type: { row: 19, col: 2 },
  nature_of_business: { row: 21, col: 2 },
  product_service: { row: 23, col: 2 },
  length_of_ownership: { row: 25, col: 2 },
  business_address: { row: 27, col: 2 },
  capital_looking_for: { row: 30, col: 2 },
  use_of_funds: { row: 32, col: 2 },
  accept_credit_cards: { row: 34, col: 2 },
  open_mca: { row: 36, col: 2 },
  owner_name: { row: 44, col: 2 },
  ssn: { row: 46, col: 2 },
  dob: { row: 48, col: 2 },
  home_address: { row: 50, col: 2 },
  credit_score: { row: 52, col: 2 },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook secret
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { record } = req.body;
    if (!record) {
      return res.status(400).json({ error: 'No record provided' });
    }

    // Load template
    const templatePath = path.join(__dirname, 'template.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const ws = workbook.getWorksheet('Sheet1');

    // Fill in values
    for (const [field, pos] of Object.entries(FIELD_MAP)) {
      const value = record[field];
      if (value) {
        ws.getCell(pos.row, pos.col).value = value;
      }
    }

    // Generate Excel buffer
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // Send email with Excel attachment
    const { error } = await resend.emails.send({
      from: 'Fairmont Credit Partners <onboarding@resend.dev>',
      to: 'deals@fairmontcp.net',
      subject: `Application: ${record.business_name || 'Unknown Business'}`,
      html: `<h2>New Application Received</h2>
             <p><strong>Business:</strong> ${record.business_name || ''}</p>
             <p><strong>Owner:</strong> ${record.owner_name || ''}</p>
             <p><strong>Capital Requested:</strong> ${record.capital_looking_for || ''}</p>
             <p>Full application attached as Excel file.</p>`,
      attachments: [
        {
          filename: `FCP_Application_${(record.business_name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`,
          content: excelBuffer,
        },
      ],
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
