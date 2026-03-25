// api/auth/recuperar-senha.js

import { Resend } from 'resend';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const resend = new Resend(process.env.RESEND_API_KEY);

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
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ sucesso: false, mensagem: 'Método não permitido' });
  }

  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ sucesso: false, mensagem: 'E-mail inválido' });
    }

    console.log(`📧 Recuperação solicitada para: ${email}`);

    // ===== VERIFICAR USUÁRIO =====
    const { data: user, error: userError } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    // Segurança: não revelar se existe
    if (userError || !user) {
      return res.status(200).json({
        sucesso: true,
        mensagem: 'Se o e-mail existir, você receberá instruções.'
      });
    }

    // ===== GERAR TOKEN =====
    const resetToken = crypto.randomBytes(32).toString('hex');

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // ===== SALVAR TOKEN =====
    const { error: saveError } = await supabase
      .from('usuarios')
      .update({
        reset_token: resetToken,
        reset_expires: expiresAt   // 🔥 PADRÃO CORRETO
      })
      .eq('email', email);

    if (saveError) {
      console.error('❌ Erro ao salvar token:', saveError);
      return res.status(500).json({
        sucesso: false,
        mensagem: 'Erro interno ao gerar token'
      });
    }

    const resetLink = `https://karaokemultiplayer.com.br/redefinir-senha.html?token=${resetToken}&email=${encodeURIComponent(email)}`;

    console.log(`🔗 Link: ${resetLink}`);

    // ===== ENVIAR EMAIL =====
    const { error: emailError } = await resend.emails.send({
      from: 'Karaokê Multiplayer <naoresponder@karaokemultiplayer.com.br>',
      to: email,
      subject: 'Recuperação de Senha - Karaokê Multiplayer',
      html: `
        <div style="font-family: Arial; padding:20px">
          <h2>🎤 Recuperação de Senha</h2>
          <p>Clique no botão abaixo para redefinir sua senha:</p>

          <a href="${resetLink}"
             style="background:#667eea;color:#fff;padding:12px 25px;border-radius:8px;text-decoration:none">
             Redefinir Senha
          </a>

          <p style="margin-top:20px;font-size:12px;color:#777">
          Este link expira em 1 hora.
          </p>
        </div>
      `
    });

    if (emailError) {
      console.error('❌ Erro ao enviar email:', emailError);
      return res.status(500).json({
        sucesso: false,
        mensagem: 'Erro ao enviar e-mail'
      });
    }

    console.log(`✅ Email enviado para ${email}`);

    return res.status(200).json({
      sucesso: true,
      mensagem: 'E-mail de recuperação enviado!'
    });

  } catch (error) {
    console.error('🔥 Erro geral:', error);
    return res.status(500).json({
      sucesso: false,
      mensagem: 'Erro interno'
    });
  }
}
