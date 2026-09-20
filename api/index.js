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
// ✅ ADICIONADO: MIDDLEWARE DE AUTENTICAÇÃO + RASTREAMENTO ONLINE
// =================================================================
async function verificarToken(req, res, next) {
  try {
    // 1. Pega o token do cabeçalho Authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ erro: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];

    // 2. Valida o token JWT
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ erro: 'Token inválido ou expirado' });
    }

    const userId = decoded.userId;

    // 3. Verifica se o usuário ainda está ativo no banco
    //    (Isso aqui impede que usuários bloqueados continuem usando o token antigo)
    const { data: user, error } = await supabase
      .from('usuarios')
      .select('id, email, status, data_expiracao, plano, nome, token_version')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ erro: 'Usuário não encontrado' });
    }

    // ✅ Bloqueia se não estiver ativo
    if (user.status !== 'ativo') {
      return res.status(403).json({ erro: 'Conta bloqueada ou inativa' });
    }

    // ✅ Bloqueia se a data de expiração já passou
    if (user.data_expiracao && new Date(user.data_expiracao) < new Date()) {
      return res.status(403).json({ erro: 'Assinatura expirada' });
    }

    // ✅ Verifica se o token_version do token bate com o do banco (se você usar essa estratégia)
    // Se você usou o token_version, o token precisa ter essa info. Vou deixar comentado
    // caso você não tenha implementado ainda.
    // if (decoded.tokenVersion !== user.token_version) {
    //   return res.status(401).json({ erro: 'Sessão invalidada. Faça login novamente.' });
    // }

    // 4. ✅ ADICIONADO: Atualiza o último acesso (marca como "online")
    await supabase
      .from('usuarios')
      .update({ ultimo_acesso: new Date().toISOString() })
      .eq('id', userId);

    // 5. Anexa os dados do usuário na requisição para uso nas rotas
    req.user = user;
    next();

  } catch (erro) {
    console.error('❌ Erro no middleware:', erro.message);
    return res.status(500).json({ erro: 'Erro interno de autenticação' });
  }
}

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

    // ✅ ADICIONADO: Verifica se a data de expiração já passou
    if (user.data_expiracao && new Date(user.data_expiracao) < new Date()) {
      return res.status(403).json({ erro: 'Assinatura expirada. Renove seu plano.' });
    }

    // ✅ ADICIONADO: Inclui o tokenVersion (se você usar essa estratégia)
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        tokenVersion: user.token_version || 1 // ✅ Adicionado
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // ✅ ADICIONADO: Registra o último acesso logo no login também
    await supabase
      .from('usuarios')
      .update({ ultimo_acesso: new Date().toISOString() })
      .eq('id', user.id);

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

// =================================================================
// ✅ ADICIONADO: ROTA PARA O FRONTEND AVISAR QUE ESTÁ ONLINE
// O frontend pode chamar essa rota a cada 2 minutos para manter
// o usuário "online" no banco de dados.
// =================================================================
app.post('/api/atividade', verificarToken, (req, res) => {
  // Se chegou até aqui, o middleware já atualizou o ultimo_acesso
  res.json({ sucesso: true, mensagem: 'Atividade registrada' });
});

// =================================================================
// ✅ ADICIONADO: EXEMPLO DE ROTA PROTEGIDA
// Qualquer rota que você quiser proteger, é só adicionar o
// 'verificarToken' antes do (req, res) => {}
// =================================================================
app.get('/api/meus-dados', verificarToken, (req, res) => {
  res.json({
    sucesso: true,
    usuario: {
      id: req.user.id,
      email: req.user.email,
      nome: req.user.nome,
      plano: req.user.plano,
      status: req.user.status,
      data_expiracao: req.user.data_expiracao
    }
  });
});

// =================================================================
// ✅ ADICIONADO: ROTA ADMIN PARA VER QUEM ESTÁ ONLINE
// Proteja essa rota depois com uma senha admin!
// =================================================================
app.get('/api/admin/online', async (req, res) => {
  try {
    // Pega quem teve atividade nos últimos 5 minutos
    const cincoMinutosAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('usuarios')
      .select('id, email, nome, plano, ultimo_acesso')
      .gt('ultimo_acesso', cincoMinutosAtras)
      .eq('status', 'ativo')
      .order('ultimo_acesso', { ascending: false });

    if (error) throw error;

    res.json({
      sucesso: true,
      total_online: data.length,
      usuarios: data
    });
  } catch (error) {
    console.error('❌ Erro ao buscar online:', error);
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
      mensal: 21.90,
      trimestral: 59.90,
      semestral: 99.90,
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
