const nodemailer = require("nodemailer");
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const mercadopago = require('mercadopago');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
app.use(express.json());

app.use(cors({
  origin: [
    'https://karaoke-multiplayer.pages.dev',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "dominio3000@gmail.com",
    pass: "vwtv iiai zagc eqie"
  }
});
// ================= CONFIG =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET;

if (process.env.MP_ACCESS_TOKEN) {
  mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
  });
  console.log('✅ Mercado Pago configurado');
} else {
  console.log('⚠️  Mercado Pago não configurado');
}

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

    const { data: user } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    if (user.status !== 'ativo') {
      return res.status(403).json({ erro: 'Pagamento pendente' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, plano: user.plano },
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
    console.error('Login error:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ================= REGISTER =================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, senha, nome, plano } = req.body;

    if (!email || !senha || !nome || !plano) {
      return res.status(400).json({ erro: 'Todos os campos obrigatórios' });
    }

    const { data: existingUser } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email)
      .single();

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
        status: 'inativo'
      }]);

    if (error) throw error;

    res.status(201).json({
      sucesso: true,
      mensagem: 'Usuário criado. Aguarde confirmação do pagamento.'
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
});
// ================= PAYMENT (VERSÃO CORRIGIDA) =================
app.post('/api/criar-pagamento', async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { plan, email } = req.body;
    
    console.log('📥 Requisição recebida:', { plan, email });

    // Validação
    if (!plan || !email) {
      return res.status(400).json({ 
        sucesso: false, 
        erro: 'Plano e email são obrigatórios' 
      });
    }

    // Tabela de preços dos planos
    const prices = {
      mensal: 19.90,
      trimestral: 49.90,
      semestral: 89.90,
      anual: 159.90
    };

    const price = prices[plan] || 49.90;

    // Verificar se está em ambiente de teste (sandbox)
    const isSandbox = process.env.NODE_ENV !== 'production' || true; // Forçar sandbox para testes
    
    // Configurar Mercado Pago
    mercadopago.configure({
      access_token: process.env.MP_ACCESS_TOKEN,
      sandbox: isSandbox
    });

    // Criar preferência de pagamento
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
        success: 'https://karaoke-multiplayer.pages.dev/pagamento-sucesso.html',
        failure: 'https://karaoke-multiplayer.pages.dev/erro.html',
        pending: 'https://karaoke-multiplayer.pages.dev/pendente.html'
      },
      auto_return: 'approved',
      notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
     external_reference: email + "|" + plan
    };

    console.log('📤 Enviando para Mercado Pago...');
    
    const response = await mercadopago.preferences.create(preference);
    
    console.log('✅ Pagamento criado com ID:', response.body.id);
    console.log('🔗 Link de pagamento:', response.body.sandbox_init_point || response.body.init_point);

    // Retornar o link apropriado (sandbox ou produção)
    res.json({
      sucesso: true,
      id: response.body.id,
      res.json({
  sucesso: true,
  id: response.body.id,
  init_point: response.body.init_point
});
      sandbox: isSandbox
    });

  } catch (error) {
    console.error('❌ ERRO DETALHADO:');
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
      return res.status(200).json({ ignored: true });
    }

    const paymentResponse = await mercadopago.payment.findById(paymentId);
    const payment = paymentResponse.body;

    if (payment.status !== 'approved') {
      console.log('⏳ Pagamento não aprovado:', payment.status);
      return res.status(200).json({ ok: true });
    }
    const [email, plan] = payment.external_reference.split("|");
    
    // Buscar nome do usuário no banco
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nome')
      .eq('email', email)
      .single();

    const senhaTemporaria = Math.random().toString(36).slice(-8);
    const hash = await bcrypt.hash(senhaTemporaria, 10);

    await supabase
      .from('usuarios')
      .update({
        senha_hash: hash,
        plano: plan,
        status: 'ativo'
      })
      .eq('email', email);

    console.log(`✅ Usuário ${email} ativado`);

    // ✅ AGORA ENVIA O E-MAIL
    try {
      // Tabela de preços para exibir no e-mail
      const prices = {
        mensal: 19.90,
        trimestral: 49.90,
        semestral: 89.90,
        anual: 159.90
      };
      
      await transporter.sendMail({
        from: '"Karaokê Multiplayer" <dominio3000@gmail.com>',
        to: email, // E-mail do cliente
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
              .footer { text-align: center; padding: 15px; color: #666; font-size: 12px; }
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
                <h2>Olá ${usuario?.nome || 'Cliente'}!</h2>
                <p>Recebemos a confirmação do seu pagamento com sucesso. Aqui estão os detalhes:</p>
                
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
                
                <p style="color: #e67e22;"><strong>⚠️ Importante:</strong> Recomendamos trocar sua senha após o primeiro acesso.</p>
                
                <div style="text-align: center;">
                  <a href="https://karaoke-multiplayer.pages.dev/login" class="button">
                    ACESSAR KARAOKÊ PREMIUM
                  </a>
                </div>
                
                <p style="margin-top: 20px; font-size: 14px; color: #666;">
                  <strong>Como acessar:</strong><br>
                  1. Use o e-mail e senha acima para fazer login<br>
                  2. Na primeira vez, você pode trocar sua senha<br>
                  3. Pronto! Todo conteúdo premium estará liberado
                </p>
              </div>
              
              <div class="footer">
                <p>Enviamos este e-mail porque seu pagamento foi processado com sucesso.</p>
                <p>Precisa de ajuda? Responda este e-mail ou entre em contato pelo suporte.</p>
                <p>© 2024 Karaokê Multiplayer. Todos os direitos reservados.</p>
              </div>
            </div>
          </body>
          </html>
        `
      });
      
      console.log(`📧 E-mail enviado para ${email}`);
      
    } catch (emailError) {
      console.error('❌ Erro ao enviar e-mail:', emailError);
      // Não interrompe o fluxo mesmo se e-mail falhar
    }

  } catch (err) {
    console.error('❌ Erro webhook:', err);
  }

  res.status(200).json({ received: true });
});

// ================= ROOT =================
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: '🎤 API Karaokê'
  });
});

// ================= INICIAR SERVIDOR (para desenvolvimento local) =================
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
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
