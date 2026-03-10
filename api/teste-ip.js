require('dotenv').config();
const https = require('https');

const SUPABASE_IP = '104.18.38.10'; // use o IP descoberto
const SUPABASE_HOST = 'yvrskenfgfpgrcpmmeln.supabase.co';

const options = {
  hostname: SUPABASE_IP,
  path: '/rest/v1/',
  method: 'GET',
  headers: {
    'Host': SUPABASE_HOST,
    'apikey': process.env.SUPABASE_SERVICE_KEY
  }
};

const req = https.get(options, (res) => {
  console.log('✅ Status:', res.statusCode);
  res.on('data', (d) => {
    console.log('📦 Resposta:', d.toString());
  });
});

req.on('error', (e) => {
  console.error('❌ Erro:', e.message);
});

req.end();
