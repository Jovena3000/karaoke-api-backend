import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function setCors(req, res) {
  const allowedOrigins = [
    'https://karaokemultiplayer.com.br',
    'http://localhost:3000'
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ sucesso: false });
  }

  try {
    const { token, email, novaSenha } = req.body;

    if (!token || !email || !novaSenha) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Dados incompletos'
      });
    }

    if (novaSenha.length < 6) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Senha muito curta'
      });
    }

    // 🔍 Buscar usuário
    const { data: user, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .eq('reset_token', token)
      .single();

    if (error || !user) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Token inválido'
      });
    }

    // ⏱️ Verificar expiração (CORRETO)
    if (!user.reset_expires || new Date(user.reset_expires) < new Date()) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Token expirado'
      });
    }

    // 🔐 Criptografar senha
    const senhaHash = await bcrypt.hash(novaSenha, 10);

    // 💾 Atualizar senha + limpar token
    const { error: updateError } = await supabase
      .from('usuarios')
      .update({
        senha_hash: senhaHash,
        reset_token: null,
        reset_expires: null
      })
      .eq('email', email);

    if (updateError) {
      console.error(updateError);
      return res.status(500).json({
        sucesso: false,
        mensagem: 'Erro ao atualizar senha'
      });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Senha redefinida com sucesso!'
    });

  } catch (err) {
    console.error('ERRO GERAL:', err);
    return res.status(500).json({
      sucesso: false,
      mensagem: 'Erro interno'
    });
  }
}
