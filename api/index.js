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

// ================= PAYMENT (CORRIGIDO) =================
// ================= PAYMENT (VERSÃO CORRIGIDA COM SANDBOX) =================
app.post('/api/criar-pagamento', async (req, res) => {
  // Log da requisição para debug
  console.log('📥 REQUISIÇÃO DE PAGAMENTO:', {
    body: req.body,
    headers: req.headers['content-type']
  });

  try {
    const { plan, email } = req.body;
    
    console.log('📦 Dados recebidos:', { plan, email });

    // Validação
    if (!plan || !email) {
      console.log('❌ Campos obrigatórios faltando');
      return res.status(400).json({ 
        sucesso: false, 
        erro: 'Plano e email são obrigatórios' 
      });
    }

    // Tabela de preços dos planos
    const prices = {
      mensal: 19.90,
      trimestral: 24.90,
      semestral: 44.90,
      anual: 79.90
    };

    const price = prices[plan] || 24.90;
    console.log('💰 Preço calculado:', { plan, price });

    // Verificar se está em ambiente de teste
    const isTest = process.env.NODE_ENV !== 'production' || process.env.USE_SANDBOX === 'true';
    
    // Escolher o token correto (teste ou produção)
    const accessToken = isTest 
      ? process.env.MP_ACCESS_TOKEN_TESTE 
      : process.env.MP_ACCESS_TOKEN;

    if (!accessToken) {
      console.log('⚠️ Token do Mercado Pago não configurado, usando modo simulação');
      
      // Modo simulação - retorna link fictício
      return res.json({
        sucesso: true,
        simulado: true,
        id: 'SIMULADO_' + Date.now(),
        init_point: `https://mercadopago.com.br/checkout?plan=${plan}&email=${encodeURIComponent(email)}`,
        mensagem: 'MODO TESTE: Pagamento simulado. Use cartão 5031 4332 1540 6351'
      });
    }

    // Configurar Mercado Pago
    mercadopago.configure({
      access_token: accessToken,
      sandbox: isTest // Ativa modo sandbox se for teste
    });

    console.log('⚙️ Mercado Pago configurado:', { 
      sandbox: isTest,
      hasToken: !!accessToken 
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
    
    // Criar preferência no Mercado Pago
    const response = await mercadopago.preferences.create(preference);
    
    console.log('✅ Pagamento criado com sucesso!');
    console.log('📌 ID:', response.body.id);
    console.log('🔗 Sandbox init_point:', response.body.sandbox_init_point);
    console.log('🔗 Produção init_point:', response.body.init_point);

    // Retornar o link apropriado (sandbox ou produção)
    res.json({
      sucesso: true,
      id: response.body.id,
      init_point: isTest ? response.body.sandbox_init_point : response.body.init_point,
      sandbox: isTest
    });

  } catch (error) {
    console.error('❌ ERRO NO PAGAMENTO:');
    console.error('Mensagem:', error.message);
    console.error('Stack:', error.stack);
    console.error('Nome:', error.name);
    
    // Mensagem amigável para o usuário
    let mensagemErro = 'Erro ao processar pagamento';
    
    if (error.message.includes('access_token')) {
      mensagemErro = 'Token do Mercado Pago inválido ou não configurado';
    } else if (error.message.includes('connection')) {
      mensagemErro = 'Erro de conexão com o Mercado Pago';
    }
    
    res.status(500).json({ 
      sucesso: false, 
      erro: mensagemErro,
      detalhe: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

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
