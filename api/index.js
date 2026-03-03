const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const mercadopago = require('mercadopago');

const app = express();
app.use(express.json());

// ================= CORS CONFIG (ÚNICO) =================
app.use((req, res, next) => {
    const allowedOrigins = [
        'https://karaoke-multiplayer.pages.dev',
        'http://localhost:8080',
        'http://127.0.0.1:8080'
    ];
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
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
      external_reference: JSON.stringify({ 
        email: email, 
        plan: plan,
        timestamp: Date.now()
      })
    };

    console.log('📤 Enviando para Mercado Pago...');
    
    const response = await mercadopago.preferences.create(preference);
    
    console.log('✅ Pagamento criado com ID:', response.body.id);
    console.log('🔗 Link de pagamento:', response.body.sandbox_init_point || response.body.init_point);

    // Retornar o link apropriado (sandbox ou produção)
    res.json({
      sucesso: true,
      id: response.body.id,
      init_point: isSandbox ? response.body.sandbox_init_point : response.body.init_point,
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

// ================= WEBHOOK =================
app.post('/api/webhook', async (req, res) => {
  console.log('📩 Webhook recebido:', req.body);
  
  const { type, data } = req.body;
  
  if (type === 'payment') {
    const paymentId = data.id;
    console.log(`💰 Pagamento ${paymentId} recebido`);
    
    try {
      const payment = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      }).then(res => res.json());

      if (payment.status === 'approved') {
        const { email, plan } = JSON.parse(payment.external_reference);
        
        const senhaTemporaria = Math.random().toString(36).slice(-8);
        const hash = await bcrypt.hash(senhaTemporaria, 10);

        await supabase.from('usuarios').insert([{
          email,
          senha_hash: hash,
          nome: email.split('@')[0],
          plano: plan,
          status: 'ativo'
        }]);

        console.log(`✅ Usuário ${email} criado com senha: ${senhaTemporaria}`);
        // TODO: Enviar e-mail com a senha
      }
    } catch (err) {
      console.error('Erro ao processar webhook:', err);
    }
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
