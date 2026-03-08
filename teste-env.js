require('dotenv').config();
console.log('MP_ACCESS_TOKEN:', process.env.MP_ACCESS_TOKEN ? '✅ OK' : '❌ NÃO ENCONTRADO');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ OK' : '❌ NÃO ENCONTRADO');
