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
    'https://karaoke-multiplayer.pages.dev',
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

// ================= CRIAR PAGAMENTO (CHECKOUT BRICKS) =================
app.post('/api/criar-pagamento', async (req, res) => {
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

    console.log('📩 Dados recebidos do Brick:', {
      email,
      plan,
      metodo,
      hasToken: !!token,
      payment_method_id: payment_method_id || '—',
      installments: installments || 1,
      hasCpf: !!cpf
    });

    // Validações básicas
    if (!email || !email.includes('@')) {
      return res.status(400).json({ sucesso: false, erro: 'E-mail inválido' });
    }

    if (!plan) {
      return res.status(400).json({ sucesso: false, erro: 'Plano não informado' });
    }

    // Tabela de preços
    const precos = {
      mensal: 5.00,
      trimestral: 49.90,
      semestral: 89.90,
      anual: 159.90
    };

    const valor = precos[plan];
    if (!valor) {
      return res.status(400).json({ sucesso: false, erro: `Plano inválido: ${plan}` });
    }

    const descricao = `Plano ${plan} - Karaokê Multiplayer`;

    // ================= PIX =================
    if (metodo === 'pix') {
      console.log('📱 Processando PIX...');

      const payment = await mercadopago.payment.create({
        transaction_amount: valor,
        description: descricao,
        payment_method_id: 'pix',
        payer: { email },
        notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
        external_reference: `${email}|${plan}`,
        metadata: { email, plan }
      });

      const data = payment.body;
      console.log('✅ PIX criado! ID:', data.id);

      return res.status(200).json({
        sucesso: true,
        metodo: 'pix',
        id: data.id,
        qr_code: data.point_of_interaction?.transaction_data?.qr_code,
        qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64
      });
    }

    // ================= CARTÃO (CHECKOUT BRICKS) =================
    if (metodo === 'card') {
      console.log('💳 Processando pagamento com cartão via Checkout Bricks...');

      if (!token) {
        return res.status(400).json({
          sucesso: false,
          erro: 'Token do cartão não enviado. Recarregue a página e tente novamente.'
        });
      }

      const parcelas = Number(installments) || 1;

      // Prepara os dados do pagamento
      const paymentData = {
        transaction_amount: Number(valor),
        token: token,
        description: descricao,
        installments: parcelas,
        payment_method_id: payment_method_id || 'master',
        payer: {
          email: email,
          identification: {
            type: 'CPF',
            number: cpf ? cpf.replace(/\D/g, '') : '19119119100'
          }
        },
        notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
        external_reference: `${email}|${plan}`,
        metadata: { email, plan }
      };

      // Adiciona issuer_id se fornecido (necessário para algumas bandeiras)
      if (issuer_id) {
        paymentData.issuer_id = String(issuer_id);
      }

      console.log('📤 Enviando para o Mercado Pago...');
      console.log('   - Valor:', paymentData.transaction_amount);
      console.log('   - Bandeira:', paymentData.payment_method_id);
      console.log('   - Parcelas:', paymentData.installments);
      console.log('   - Email:', paymentData.payer.email);

      // CRIA O PAGAMENTO (não preferência!)
      const response = await mercadopago.payment.create(paymentData);
      const payment = response.body;

      console.log('💳 Resposta do Mercado Pago:');
      console.log('   - Status:', payment.status);
      console.log('   - Status detail:', payment.status_detail);
      console.log('   - Payment ID:', payment.id);

      // ✅ Pagamento aprovado
      if (payment.status === 'approved') {
        return res.status(200).json({
          sucesso: true,
          status: payment.status,
          id: payment.id,
          mensagem: 'Pagamento aprovado com sucesso!'
        });
      }

      // ❌ Pagamento recusado - Mensagens amigáveis
      const mensagensErro = {
        'cc_rejected_insufficient_amount': 'Saldo insuficiente no cartão.',
        'cc_rejected_bad_filled_security_code': 'Código de segurança (CVV) inválido.',
        'cc_rejected_bad_filled_date': 'Data de validade inválida.',
        'cc_rejected_bad_filled_other': 'Dados do cartão incorretos. Verifique o número.',
        'cc_rejected_card_disabled': 'Cartão desabilitado. Entre em contato com seu banco.',
        'cc_rejected_duplicated_payment': 'Este pagamento já foi processado. Aguarde alguns minutos.',
        'cc_rejected_high_risk': 'Pagamento recusado por segurança. Tente outro cartão.',
        'pending_contingency': 'Pagamento em processamento. Aguarde a confirmação.',
        'pending_review_manual': 'Pagamento em análise. Você receberá notificação por e-mail.'
      };

      const detalhe = payment.status_detail || '';
      const msgErro = mensagensErro[detalhe] ||
        `Pagamento não aprovado. Motivo: ${detalhe || payment.status}`;

      console.warn('⚠️ Pagamento recusado:', detalhe);

      return res.status(200).json({
        sucesso: false,
        status: payment.status,
        detalhe: detalhe,
        id: payment.id,
        erro: msgErro
      });
    }

    // Método inválido
    return res.status(400).json({
      sucesso: false,
      erro: 'Método inválido. Use "pix" ou "card".'
    });

  } catch (error) {
    console.error('❌ ERRO NO BACKEND:', error.message);
    
    // Log detalhado do erro do Mercado Pago
    if (error.response?.data) {
      console.error('📦 Detalhes do erro MP:', JSON.stringify(error.response.data, null, 2));
    }
    
    return res.status(500).json({
      sucesso: false,
      erro: error.message || 'Erro interno do servidor'
    });
  }
});

// ================= WEBHOOK =================
app.post('/api/webhook', async (req, res) => {
  console.log('📩 Webhook recebido:', JSON.stringify(req.body, null, 2));
  
  try {
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log(`💰 Pagamento ${paymentId} atualizado`);
      
      // Busca detalhes do pagamento
      const payment = await mercadopago.payment.findById(paymentId);
      const status = payment.body.status;
      const externalRef = payment.body.external_reference;
      
      console.log(`📊 Status: ${status}, Referência: ${externalRef}`);
      
      if (status === 'approved') {
        // Extrai email e plano do external_reference
        const [email, plan] = externalRef.split('|');
        
        // Atualiza o usuário no banco
        if (email && plan) {
          await supabase
            .from('usuarios')
            .update({ 
              status: 'ativo',
              plano: plan,
              updated_at: new Date().toISOString()
            })
            .eq('email', email);
          
          console.log(`✅ Usuário ${email} atualizado para plano ${plan}`);
        }
      }
    }
    
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.status(200).json({ received: true }); // Sempre retorna 200 para o MP
  }
});

// ================= ROOT =================
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Karaokê Multiplayer API - Checkout Bricks',
    version: '2.0.0'
  });
});

// ================= EXPORT =================
module.exports = app;
