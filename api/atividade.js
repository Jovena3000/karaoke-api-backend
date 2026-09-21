// api/atividade.js
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET;

module.exports = async (req, res) => {
  // CORS
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  try {
    // 1. Valida o token
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

    // 2. Busca o usuário
    const { data: user, error } = await supabase
      .from('usuarios')
      .select('id, status, data_expiracao')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ erro: 'Usuário não encontrado' });
    }
    if (user.status !== 'ativo') {
      return res.status(403).json({ erro: 'Conta bloqueada' });
    }
    if (user.data_expiracao && new Date(user.data_expiracao) < new Date()) {
      return res.status(403).json({ erro: 'Assinatura expirada' });
    }

    // 3. Atualiza o último acesso
    await supabase
      .from('usuarios')
      .update({ ultimo_acesso: new Date().toISOString() })
      .eq('id', userId);

    return res.json({ sucesso: true, mensagem: 'Atividade registrada' });

  } catch (erro) {
    console.error('❌ Erro:', erro.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
