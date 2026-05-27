const https = require('https');

const SUPABASE_URL = 'https://ivdjgxutjafwjvroltjf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2ZGpneHV0amFmd2p2cm9sdGpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1Njc3NjcsImV4cCI6MjA5MzE0Mzc2N30.qN8Jxh3e2amTmI74kyGMbCr1O7rdKsunQ7noMp_eE5E';

module.exports = async function handler(req, res) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/Applications?select=id&limit=1`;
    const result = await new Promise((resolve, reject) => {
      const request = https.get(url, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, data }));
      });
      request.on('error', reject);
    });

    return res.status(200).json({ ok: true, supabase_status: result.status, timestamp: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
