const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const mercadopago = require('mercadopago');
const { Resend } = require('resend');
const cors = require('cors');
const nodemailer = require('nodemailer');

// ================= CONFIGURAÇÃO =================
const app = express();
app.use(express.json());

// Configuração CORS
app.use(cors({
  origin: [
    'https://karaoke-multiplayer.pages.dev',
    'https://karaokemultiplayer.com.br',
    'https://www.karaokemultiplayer.com.br',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ================= VARIÁVEIS DE AMBIENTE =================
const JWT_SECRET = process.env.JWT_SECRET || 'seu-segredo-aqui-mude-em-producao';
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ================= CONFIGURAÇÃO SUPABASE =================
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    db: {
      schema: 'public'
    },
    global: {
      headers: {
        'X-Client-Info': 'supabase-js/2.x'
      }
    },
    fetch: (url, options) => {
      return fetch(url, {
        ...options,
        timeout: 30000
      });
    }
  }
);

// ================= CONFIGURAÇÃO MERCADO PAGO =================
mercadopago.configure({
  access_token: MP_ACCESS_TOKEN
});

// ================= CONFIGURAÇÃO RESEND =================
const resend = new Resend(RESEND_API_KEY);

// ================= CONFIGURAÇÃO NODEMAILER (FALLBACK) =================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER || "dominio3000@gmail.com",
    pass: process.env.GMAIL_PASS || "vwtv iiai zagc eqie"
  }
});

// ================= STATUS =================
app.get('/api/status', (req, res) => {
  res.json({
    servidor: '🟢 Online',
    ambiente: process.env.NODE_ENV || 'development',
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

    const { data: user, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
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
      { 
        userId: user.id, 
        email: user.email, 
        plano: user.plano,
        nome: user.nome 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      sucesso: true,
      token,
      usuario: {
        nome: user.nome,
        email: user.email,
        plano: user.plano
      }
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ erro: 'Erro interno no servidor' });
  }
});

// ================= REGISTER =================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, senha, nome, plano } = req.body;

    if (!email || !senha || !nome || !plano) {
      return res.status(400).json({ erro: 'Todos os campos são obrigatórios' });
    }

    // Verificar se email já existe
    const { data: existingUser } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ erro: 'Email já cadastrado' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const { error } = await supabase
      .from('usuarios')
      .insert([{
        email,
        senha_hash: senhaHash,
        nome,
        plano,
        status: 'inativo',
        created_at: new Date().toISOString()
      }]);

    if (error) throw error;

    res.status(201).json({
      sucesso: true,
      mensagem: 'Usuário criado. Aguarde confirmação do pagamento.'
    });

  } catch (error) {
    console.error('❌ Register error:', error);
    res.status(500).json({ erro: 'Erro interno no servidor' });
  }
});

// ================= CRIAR PAGAMENTO (CORRIGIDO) =================
app.post('/api/criar-pagamento', async (req, res) => {
  try {
    const { plan, email, metodo } = req.body;
    
    console.log('📥 Requisição recebida:', { plan, email, metodo });

    if (!plan || !email) {
      return res.status(400).json({ 
        sucesso: false, 
        erro: 'Plano e email são obrigatórios' 
      });
    }

    // Tabela de preços CORRIGIDA
    const prices = {
      mensal: 5,00,      // ← CORRIGIDO (era 19.90)
      trimestral: 49.90,
      semestral: 89.90,
      anual: 159.90
    };

    if (!prices[plan]) {
      return res.status(400).json({ 
        sucesso: false, 
        erro: 'Plano inválido' 
      });
    }

    const price = prices[plan];

    // FLUXO PARA PIX
    if (metodo === 'pix') {
      console.log('💰 Gerando pagamento PIX...');
      
      const payment_data = {
        transaction_amount: price,
        description: `Plano Karaokê ${plan}`,
        payment_method_id: 'pix',
        payer: {
          email: email
        }
      };

      const payment = await mercadopago.payment.create(payment_data);
      const paymentBody = payment.body;

      console.log('✅ PIX gerado. ID:', paymentBody.id);

      return res.json({
        sucesso: true,
        id: paymentBody.id,
        qr_code_base64: paymentBody.point_of_interaction?.transaction_data?.qr_code_base64,
        qr_code: paymentBody.point_of_interaction?.transaction_data?.qr_code,
        ticket_url: paymentBody.point_of_interaction?.transaction_data?.ticket_url
      });
    }

    // FLUXO PARA CARTÃO
    console.log('📤 Criando preferência para cartão...');

    const preference = {
      items: [{
        title: `Plano Karaokê ${plan}`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: price
      }],
      payer: { 
        email: email
      },
      back_urls: {
        success: 'https://karaokemultiplayer.com.br/pagamento-sucesso',
        failure: 'https://karaokemultiplayer.com.br/erro',
        pending: 'https://karaokemultiplayer.com.br/pendente'
      },
      auto_return: 'approved',
      notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
      external_reference: JSON.stringify({
        email: email,
        plan: plan,
        created_at: Date.now()
      })
    };
    
    const response = await mercadopago.preferences.create(preference);
    
    console.log('✅ Preferência criada. ID:', response.body.id);

    return res.json({
      sucesso: true,
      id: response.body.id,
      init_point: response.body.init_point
    });

  } catch (error) {
    console.error('❌ Erro detalhado:');
    console.error('Mensagem:', error.message);
    console.error('Stack:', error.stack);
    
    res.status(500).json({ 
      sucesso: false, 
      erro: 'Erro ao processar pagamento',
      detalhe: error.message
    });
  }
});

// ================= WEBHOOK CORRIGIDO =================
app.post('/api/webhook', async (req, res) => {
  console.log('📩 Webhook recebido:', req.body);

  try {
    const paymentId = req.body?.data?.id;

    if (!paymentId) {
      console.log('⚠️ Sem paymentId');
      return res.status(200).json({ received: true });
    }

    const paymentResponse = await mercadopago.payment.findById(paymentId);
    const payment = paymentResponse.body;

    if (payment.status !== 'approved') {
      console.log('⏳ Pagamento não aprovado:', payment.status);
      return res.status(200).json({ received: true });
    }

    // Extrair dados do external_reference
    let email, plan;
    try {
      const externalRef = JSON.parse(payment.external_reference);
      email = externalRef.email;
      plan = externalRef.plan;
    } catch (e) {
      console.log('⚠️ external_reference não é JSON, tentando split');
      [email, plan] = payment.external_reference.split('|');
    }

    if (!email || !plan) {
      console.log('❌ Não foi possível extrair email/plan');
      return res.status(200).json({ received: true });
    }
    
    // Buscar usuário no banco
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nome, email')
      .eq('email', email)
      .maybeSingle();

    const senhaTemporaria = Math.random().toString(36).slice(-8);
    const hash = await bcrypt.hash(senhaTemporaria, 10);

    if (usuario) {
      // Usuário existe: atualizar
      await supabase
        .from('usuarios')
        .update({
          senha_hash: hash,
          plano: plan,
          status: 'ativo',
          updated_at: new Date().toISOString()
        })
        .eq('email', email);
    } else {
      // Usuário não existe: criar
      await supabase
        .from('usuarios')
        .insert([{
          email: email,
          senha_hash: hash,
          nome: email.split('@')[0],
          plano: plan,
          status: 'ativo',
          created_at: new Date().toISOString()
        }]);
    }

    console.log(`✅ Usuário ${email} ativado com plano ${plan}`);

    // ================= ENVIAR E-MAIL =================
    try {
      const prices = {
        mensal: 24.90,
        trimestral: 49.90,
        semestral: 89.90,
        anual: 159.90
      };
      
      // Tentar enviar com Resend primeiro
      if (RESEND_API_KEY) {
        await resend.emails.send({
          from: 'Karaokê Multiplayer <onboarding@resend.dev>',
          to: email,
          subject: '✅ Pagamento Confirmado - Acesso Liberado!',
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
                .info-box { background: white; padding: 15px; border-radius: 5px; margin: 10px 0; }
                .code { background: #e8f5e9; padding: 15px; text-align: center; font-size: 24px; font-family: monospace; border-radius: 5px; color: #2e7d32; }
                .button { background: #4CAF50; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>🎤 Pagamento Confirmado!</h1>
                  <p>Seu acesso premium está liberado</p>
                </div>
                
                <div class="content">
                  <h2>Olá ${usuario?.nome || email.split('@')[0]}!</h2>
                  <p>Recebemos a confirmação do seu pagamento com sucesso.</p>
                  
                  <div class="info-box">
                    <p><strong>📋 Plano:</strong> Plano ${plan}</p>
                    <p><strong>💰 Valor:</strong> R$ ${prices[plan]?.toFixed(2) || '49,90'}</p>
                    <p><strong>🆔 ID da Transação:</strong> ${paymentId}</p>
                    <p><strong>📅 Data:</strong> ${new Date().toLocaleDateString('pt-BR')}</p>
                  </div>

                  <h3>🔑 SUAS CREDENCIAIS DE ACESSO</h3>
                  <div class="info-box">
                    <p><strong>📧 E-mail:</strong> ${email}</p>
                    <p><strong>🔐 Senha temporária:</strong> <span class="code">${senhaTemporaria}</span></p>
                  </div>
                  
                  <p style="color: #e67e22;"><strong>⚠️ Importante:</strong> Troque sua senha após o primeiro acesso.</p>
                  
                  <div style="text-align: center;">
                    <a href="https://karaokemultiplayer.com.br/login" class="button">
                      ACESSAR KARAOKÊ PREMIUM
                    </a>
                  </div>
                </div>
                
                <div style="text-align: center; padding: 15px; color: #666; font-size: 12px;">
                  <p>© 2026 Karaokê Multiplayer. Todos os direitos reservados.</p>
                </div>
              </div>
            </body>
            </html>
          `
        });
      } else {
        // Fallback para nodemailer
        await transporter.sendMail({
          from: '"Karaokê Multiplayer" <dominio3000@gmail.com>',
          to: email,
          subject: '✅ Pagamento Confirmado - Acesso Liberado!',
          html: `<p>Olá, seu pagamento foi confirmado! Sua senha é: <b>${senhaTemporaria}</b></p>`
        });
      }
      
      console.log(`📧 E-mail enviado para ${email}`);
      
    } catch (emailError) {
      console.error('❌ Erro ao enviar e-mail:', emailError);
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('❌ Erro webhook:', err);
    return res.status(200).json({ received: true });
  }
});

// ================= ROTA RAIZ =================
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: '🎤 API Karaokê Multiplayer',
    versao: '2.0.0',
    ambiente: process.env.NODE_ENV || 'development'
  });
});

// ================= INICIAR SERVIDOR =================
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📝 Endpoints disponíveis:`);
    console.log(`   GET  /`);
    console.log(`   GET  /api/status`);
    console.log(`   POST /api/auth/login`);
    console.log(`   POST /api/auth/register`);
    console.log(`   POST /api/criar-pagamento`);
    console.log(`   POST /api/webhook\n`);
  });
}

module.exports = app;
