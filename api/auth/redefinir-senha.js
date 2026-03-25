import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {

  // ===== CORS =====
  const allowedOrigins = [
    'https://karaokemultiplayer.com.br',
    'https://www.karaokemultiplayer.com.br',
    'http://localhost:3000'
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ sucesso: false, mensagem: 'Método não permitido' });
  }

  try {
    const { token, novaSenha, email } = req.body;

    if (!token || !novaSenha || !email) {
      return res.status(400).json({ sucesso: false, mensagem: 'Dados incompletos' });
    }

    if (novaSenha.length < 6) {
      return res.status(400).json({ sucesso: false, mensagem: 'Senha mínima: 6 caracteres' });
    }

    console.log('🔍 Validando token...');

    // ===== BUSCAR USUÁRIO COM TOKEN =====
    const { data: user, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .eq('reset_token', token)
      .single();

    if (error || !user) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Token inválido ou expirado'
      });
    }

    // ===== VERIFICAR EXPIRAÇÃO =====
    if (!user.reset_token_expira || new Date(user.reset_token_expira) < new Date()) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Token expirado'
      });
    }

    console.log('🔐 Gerando nova senha...');

    const senhaHash = await bcrypt.hash(novaSenha, 10);

    // ===== ATUALIZAR SENHA =====
    const { error: updateError } = await supabase
      .from('usuarios')
      .update({
        senha_hash: senhaHash,
        reset_token: null,
        reset_token_expira: null
      })
      .eq('email', email);

    if (updateError) {
      console.error('❌ Erro ao atualizar senha:', updateError);
      return res.status(500).json({
        sucesso: false,
        mensagem: 'Erro ao salvar nova senha'
      });
    }

    console.log('✅ Senha atualizada com sucesso');

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Senha redefinida com sucesso'
    });

  } catch (error) {
    console.error('🔥 Erro:', error);
    return res.status(500).json({
      sucesso: false,
      mensagem: 'Erro interno'
    });
  }
}
