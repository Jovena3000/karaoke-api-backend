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

// ================= CORS =================
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://karaokemultiplayer.com.br',
    'https://www.karaokemultiplayer.com.br',
    'https://karaoke-multiplayer.pages.dev',
    'http://localhost:3000',
    'http://localhost:8080'
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

// ================= VARIÁVEIS =================
const JWT_SECRET = process.env.JWT_SECRET;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ================= SERVIÇOS =================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
mercadopago.configure({ access_token: MP_ACCESS_TOKEN });

// ================= STATUS =================
app.get('/api/status', (req, res) => {
  res.json({ servidor: '🟢 Online', timestamp: new Date().toISOString() });
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
    console.error('❌ Erro no login:', error);
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
    console.error('❌ Erro no registro:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ================= CRIAR PAGAMENTO - CHECKOUT BRICKS =================
app.post('/api/criar-pagamento', async (req, res) => {
  console.log("🔥🔥🔥 ROTA /api/criar-pagamento VERSÃO 2.0 - CHECKOUT BRICKS 🔥🔥🔥");
  
  try {
    const {
      plan,
      email,
      metodo,
      token,
      payment_method_id,
      installments,
      issuer_id,
      cpf
    } = req.body;

    console.log('📩 Dados recebidos:', {
      email,
      plan,
      metodo,
      hasToken: !!token,
      payment_method_id: payment_method_id || '—'
    });

    if (!email || !email.includes('@')) {
      return res.status(400).json({ sucesso: false, erro: 'E-mail inválido' });
    }

    const precos = {
      mensal: 5.00,
      trimestral: 49.90,
      semestral: 89.90,
      anual: 159.90
    };

    const valor = precos[plan];
    if (!valor) {
      return res.status(400).json({ sucesso: false, erro: 'Plano inválido' });
    }

    // ================= PIX =================
    if (metodo === 'pix') {
      console.log('📱 Processando PIX...');
      
      const payment = await mercadopago.payment.create({
        transaction_amount: valor,
        description: `Plano ${plan} - Karaokê`,
        payment_method_id: 'pix',
        payer: { email },
        notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
        external_reference: `${email}|${plan}`
      });

      return res.json({
        sucesso: true,
        qr_code: payment.body.point_of_interaction.transaction_data.qr_code,
        qr_code_base64: payment.body.point_of_interaction.transaction_data.qr_code_base64
      });
    }

    // ================= CARTÃO =================
    if (metodo === 'card') {
      console.log('💳 Processando pagamento com cartão...');
      
      if (!token) {
        return res.status(400).json({ sucesso: false, erro: 'Token não enviado' });
      }

      // ✅ FIX CPF: remove não-dígitos e valida 11 dígitos antes de usar
      //    Remove o fallback '19119119100' — não envia CPF falso se vier vazio
      const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : null;
      console.log('👤 CPF recebido:', cpfLimpo
        ? `${cpfLimpo.substring(0, 3)}.***.***-${cpfLimpo.slice(-2)}`
        : '❌ não enviado');

      const paymentData = {
        transaction_amount: Number(valor),
        token: token,
        description: `Plano ${plan} - Karaokê`,
        installments: Number(installments) || 1,
        payment_method_id: payment_method_id || 'master',
        payer: {
          email: email,
          // ✅ FIX CPF: inclui identification apenas se CPF real com 11 dígitos
          //    Sem fallback — se não veio, não envia o campo (MP aceita sem CPF)
          ...(cpfLimpo && cpfLimpo.length === 11 && {
            identification: {
              type: 'CPF',
              number: cpfLimpo
            }
          })
        },
        notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
        external_reference: `${email}|${plan}`
      };

      if (issuer_id) {
        paymentData.issuer_id = String(issuer_id);
      }

      console.log('📤 Enviando para MP:', { valor: paymentData.transaction_amount, bandeira: paymentData.payment_method_id });

      const response = await mercadopago.payment.create(paymentData);
      const payment = response.body;

      console.log('💳 Resposta MP:', { status: payment.status, id: payment.id });

      if (payment.status === 'approved') {
        return res.json({ sucesso: true, status: payment.status, id: payment.id });
      }

      return res.json({ 
        sucesso: false, 
        status: payment.status,
        erro: payment.status_detail || 'Pagamento não aprovado'
      });
    }

    return res.status(400).json({ sucesso: false, erro: 'Método inválido' });

  } catch (error) {
    console.error('❌ ERRO:', error.message);
    if (error.response?.data) {
      console.error('📦 Detalhes MP:', JSON.stringify(error.response.data, null, 2));
    }
    return res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ================= WEBHOOK =================
app.post('/api/webhook', async (req, res) => {
  console.log('📩 Webhook recebido');
  res.status(200).json({ received: true });
});

// ================= ROOT =================
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Karaokê API - Checkout Bricks' });
});

// ================= EXPORT =================
module.exports = app;
