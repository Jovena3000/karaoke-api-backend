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

// =================================================================
// MIDDLEWARE DE AUTENTICAÇÃO + RASTREAMENTO ONLINE
// =================================================================
async function verificarToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ erro: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ erro: 'Token inválido ou expirado' });
    }

    const userId = decoded.userId;

    const { data: user, error } = await supabase
      .from('usuarios')
      .select('id, email, status, data_expiracao, plano, nome, token_version')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ erro: 'Usuário não encontrado' });
    }

    if (user.status !== 'ativo') {
      return res.status(403).json({ erro: 'Conta bloqueada ou inativa', codigo: 'CONTA_INATIVA' });
    }

    if (user.data_expiracao && new Date(user.data_expiracao) < new Date()) {
      return res.status(403).json({ erro: 'Assinatura expirada', codigo: 'PLANO_VENCIDO' });
    }

    // ✅ Corrigido: parêntese extra no final do update
    await supabase
      .from('usuarios')
      .update({ ultimo_acesso: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }) })
      .eq('id', userId);

    req.user = user;
    next();

  } catch (erro) {
    console.error('❌ Erro no middleware:', erro.message);
    return res.status(500).json({ erro: 'Erro interno de autenticação' });
  }
}

// ================= ROTAS =================

// ✅ Corrigido: chaves fechadas no res.json
app.get('/api/status', (req, res) => {
  res.json({ servidor: '🟢 Online', timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }) });
});

// ✅ ADICIONADO: Rota que o frontend procurava e não existia
app.get('/api/verificar-sessao', verificarToken, (req, res) => {
  return res.status(200).json({
    sucesso: true,
    usuario: { nome: req.user.nome, email: req.user.email, plano: req.user.plano },
    plano_expira_em: req.user.data_expiracao
  });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'Email e senha obrigatórios' });

    const { data: user } = await supabase.from('usuarios').select('*').eq('email', email).single();
    if (!user) return res.status(401).json({ erro: 'Credenciais inválidas' });

    const senhaValida = await bcrypt.compare(senha, user.senha_hash);
    if (!senhaValida) return res.status(401).json({ erro: 'Credenciais inválidas' });

    if (user.status !== 'ativo') return res.status(403).json({ erro: 'Pagamento pendente' });
    if (user.data_expiracao && new Date(user.data_expiracao) < new Date()) {
      return res.status(403).json({ erro: 'Assinatura expirada. Renove seu plano.' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, tokenVersion: user.token_version || 1 },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // ✅ Corrigido: parêntese extra no final do update
    await supabase
      .from('usuarios')
      .update({ ultimo_acesso: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }) })
      .eq('id', user.id);

    res.json({ sucesso: true, token });
  } catch (error) {
    console.error('❌ Erro no login:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, senha, nome, plano } = req.body;
    if (!email || !senha || !nome || !plano) return res.status(400).json({ erro: 'Campos obrigatórios' });

    const senhaHash = await bcrypt.hash(senha, 10);
    await supabase.from('usuarios').insert([{
      email, senha_hash: senhaHash, nome, plano, status: 'inativo',
      created_at: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    }]);

    res.json({ sucesso: true });
  } catch (error) {
    console.error('❌ Erro no registro:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.post('/api/atividade', verificarToken, (req, res) => {
  res.json({ sucesso: true, mensagem: 'Atividade registrada' });
});

app.get('/api/meus-dados', verificarToken, (req, res) => {
  res.json({
    sucesso: true,
    usuario: {
      id: req.user.id, email: req.user.email, nome: req.user.nome,
      plano: req.user.plano, status: req.user.status, data_expiracao: req.user.data_expiracao
    }
  });
});

app.get('/api/admin/online', async (req, res) => {
  try {
    const cincoMinutosAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, email, nome, plano, ultimo_acesso')
      .gt('ultimo_acesso', cincoMinutosAtras)
      .eq('status', 'ativo')
      .order('ultimo_acesso', { ascending: false });

    if (error) throw error;
    res.json({ sucesso: true, total_online: data.length, usuarios: data });
  } catch (error) {
    console.error('❌ Erro ao buscar online:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.post('/api/criar-pagamento', async (req, res) => {
  console.log("🔥🔥🔥 ROTA /api/criar-pagamento VERSÃO 2.0 - CHECKOUT BRICKS 🔥🔥🔥");
  try {
    const { plan, email, metodo, token, payment_method_id, installments, issuer_id, cpf } = req.body;

    if (!email || !email.includes('@')) return res.status(400).json({ sucesso: false, erro: 'E-mail inválido' });

    const precos = { mensal: 21.90, trimestral: 59.90, semestral: 99.90, anual: 159.90 };
    const valor = precos[plan];
    if (!valor) return res.status(400).json({ sucesso: false, erro: 'Plano inválido' });

    if (metodo === 'pix') {
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

    if (metodo === 'card') {
      if (!token) return res.status(400).json({ sucesso: false, erro: 'Token não enviado' });

      const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : null;
      const paymentData = {
        transaction_amount: Number(valor),
        token: token,
        description: `Plano ${plan} - Karaokê`,
        installments: Number(installments) || 1,
        payment_method_id: payment_method_id || 'master',
        payer: {
          email: email,
          ...(cpfLimpo && cpfLimpo.length === 11 && {
            identification: { type: 'CPF', number: cpfLimpo }
          })
        },
        notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
        external_reference: `${email}|${plan}`
      };

      if (issuer_id) paymentData.issuer_id = String(issuer_id);

      const response = await mercadopago.payment.create(paymentData);
      const payment = response.body;

      if (payment.status === 'approved') {
        return res.json({ sucesso: true, status: payment.status, id: payment.id });
      }
      return res.json({ sucesso: false, status: payment.status, erro: payment.status_detail || 'Pagamento não aprovado' });
    }

    return res.status(400).json({ sucesso: false, erro: 'Método inválido' });
  } catch (error) {
    console.error('❌ ERRO:', error.message);
    return res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/webhook', async (req, res) => {
  console.log('📩 Webhook recebido');
  res.status(200).json({ received: true });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Karaokê API - Checkout Bricks' });
});

module.exports = app;
