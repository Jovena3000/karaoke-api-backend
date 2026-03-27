const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const mercadopago = require('mercadopago');
const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// ================= CONFIGURAÇÃO =================
const app = express();
app.use(express.json());

// ================= CORS CORRIGIDO (VERCEL) =================
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://karaokemultiplayer.com.br',
    'https://www.karaokemultiplayer.com.br',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

// ================= VARIÁVEIS DE AMBIENTE =================
const JWT_SECRET = process.env.JWT_SECRET;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ================= VALIDAÇÃO =================
if (!JWT_SECRET) console.error('❌ JWT_SECRET não configurada!');
if (!MP_ACCESS_TOKEN) console.error('❌ MP_ACCESS_TOKEN não configurada!');
if (!SUPABASE_URL) console.error('❌ SUPABASE_URL não configurada!');
if (!SUPABASE_SERVICE_KEY) console.error('❌ SUPABASE_SERVICE_KEY não configurada!');

// ================= SERVIÇOS =================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

mercadopago.configure({
  access_token: MP_ACCESS_TOKEN
});

let resend = null;
if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER || "dominio3000@gmail.com",
    pass: process.env.GMAIL_PASS
  }
});

// ================= STATUS =================
app.get('/api/status', (req, res) => {
  res.json({
    servidor: '🟢 Online',
    timestamp: new Date().toISOString()
  });
});

// ================= LOGIN =================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: 'Email e senha obrigatórios' });
    }

    const { data: user } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    if (!user) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    const senhaValida = await bcrypt.compare(senha, user.senha_hash);
    if (!senhaValida) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    if (user.status !== 'ativo') {
      return res.status(403).json({ erro: 'Pagamento pendente' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ sucesso: true, token });

  } catch (error) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ================= REGISTER =================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, senha, nome, plano } = req.body;

    if (!email || !senha || !nome || !plano) {
      return res.status(400).json({ erro: 'Campos obrigatórios' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    await supabase.from('usuarios').insert([{
      email,
      senha_hash: senhaHash,
      nome,
      plano,
      status: 'inativo',
      created_at: new Date().toISOString()
    }]);

    res.json({ sucesso: true });

  } catch (error) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ================= CRIAR PAGAMENTO =================
app.post('/api/criar-pagamento', async (req, res) => {
  try {
    const { plan, email, metodo } = req.body;

    const prices = {
      mensal: 5.00,
      trimestral: 24.90,
      semestral: 49.90,
      anual: 89.90
    };

    const price = prices[plan];

    if (!price) {
      return res.status(400).json({ erro: 'Plano inválido' });
    }

    // PIX
    if (metodo === 'pix') {
      const payment = await mercadopago.payment.create({
        transaction_amount: price,
        description: `Plano ${plan}`,
        payment_method_id: 'pix',
        payer: { email }
      });

      return res.json({
        sucesso: true,
        qr_code_base64: payment.body.point_of_interaction.transaction_data.qr_code_base64,
        qr_code: payment.body.point_of_interaction.transaction_data.qr_code
      });
    }

    // CARTÃO
    const preference = await mercadopago.preferences.create({
      items: [{
        title: `Plano ${plan}`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: price
      }],
      payer: { email },
      back_urls: {
        success: 'https://karaokemultiplayer.com.br/pagamento-sucesso.html'
      },
      notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook'
    });

    res.json({
      sucesso: true,
      init_point: preference.body.init_point
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: 'Erro pagamento' });
  }
});

// ================= WEBHOOK =================
app.post('/api/webhook', async (req, res) => {
  console.log('📩 Webhook:', req.body);
  return res.status(200).json({ received: true });
});

// ================= ROOT =================
app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// ================= EXPORT =================
module.exports = app;
