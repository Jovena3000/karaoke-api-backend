import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {

  // ===== CORS =====
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

    // 🔍 Buscar usuário pelo token + email
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

    // 🔐 Gerar hash da nova senha
    const senhaHash = await bcrypt.hash(novaSenha, 10);

    // 💾 Atualizar senha
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
        mensagem: 'Erro ao salvar nova senha'
      });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Senha redefinida com sucesso!'
    });

  } catch (err) {
    console.error('Erro geral:', err);
    return res.status(500).json({
      sucesso: false,
      mensagem: 'Erro interno'
    });
  }
}
