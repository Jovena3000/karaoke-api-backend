const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const mercadopago = require('mercadopago');

const app = express();
app.use(express.json());

// ================= CORS HELPER =================
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://karaoke-multiplayer.pages.dev');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// ================= CONFIG =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET;

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

// ================= STATUS =================
app.get('/api/status', (req, res) => {
  setCors(res);
  res.json({
    servidor: '🟢 Online',
    ambiente: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// ================= LOGIN =================
app.post('/api/auth/login', async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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

// ================= PAYMENT =================
app.post('/api/criar-pagamento', async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { title, price, plan, email } = req.body;

    const preference = {
      items: [{
        title: title || 'Plano Karaokê',
        unit_price: parseFloat(price) || 24.90,
        quantity: 1,
        currency_id: 'BRL',
        description: plan || 'Plano Trimestral'
      }],
      payer: { email },
      back_urls: {
        success: 'https://karaoke-multiplayer.pages.dev/pagamento-sucesso.html',
        failure: 'https://karaoke-multiplayer.pages.dev/erro.html',
        pending: 'https://karaoke-multiplayer.pages.dev/pendente.html'
      },
      auto_return: 'approved',
      notification_url: 'https://karaoke-api-backend2-omega.vercel.app/api/webhook',
      external_reference: `pedido_${Date.now()}`
    };

    const response = await mercadopago.preferences.create(preference);

    res.json({
      sucesso: true,
      id: response.body.id,
      init_point: response.body.init_point
    });

  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ erro: 'Erro no pagamento' });
  }
});

// ================= WEBHOOK =================
app.post('/api/webhook', (req, res) => {
  setCors(res);
  console.log('Webhook recebido:', req.body);
  res.status(200).json({ received: true });
});

// ================= ROOT =================
app.get('/', (req, res) => {
  setCors(res);
  res.json({
    status: 'online',
    message: '🎤 API Karaokê'
  });
});

module.exports = app;
