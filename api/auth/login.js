import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET;

function setCors(req, res) {
  const allowedOrigins = [
    'https://karaokemultiplayer.com.br',
];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

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

    const senhaCorreta = await bcrypt.compare(senha, user.senha_hash);
    if (!senhaCorreta) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    if (user.status !== 'ativo') {
      return res.status(403).json({ erro: 'Pagamento pendente' });
    }

    if (user.data_expiracao && new Date(user.data_expiracao) < new Date()) {
      return res.status(403).json({ erro: 'Plano expirado' });
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        plano: user.plano 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      sucesso: true,
      token,
      usuario: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        plano: user.plano
      }
    });

  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).json({ erro: 'Erro interno do servidor' });
  }
}
