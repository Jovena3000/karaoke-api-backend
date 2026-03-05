import mercadopago from 'mercadopago';
import bcrypt from 'bcryptjs';
import { Resend } from 'resend'; // ou outro serviço de e-mail
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

// EMAIL: serviço Resend (melhor para Vercel)
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(200).end();
    }

    // Pega paymentId mesmo que venha em formatos variados
    const paymentId = req.body?.data?.id || req.body?.id;
    if (!paymentId) {
      console.log('⚠️ Webhook sem paymentId');
      return res.status(200).end();
    }

    // Busca pagamento no Mercado Pago
    const paymentResponse = await mercadopago.payment.findById(paymentId);
    const payment = paymentResponse.body;

    // Somente processa se aprovado
    if (payment.status !== 'approved') {
      console.log('Pagamento não aprovado:', payment.status);
      return res.status(200).end();
    }

    // Pega email e plano
    const { email, plan } = JSON.parse(payment.external_reference);

    // Gera senha temporária
    const senhaTemporaria = Math.random().toString(36).slice(-8);
    const senhaHash = await bcrypt.hash(senhaTemporaria, 10);

    // Atualiza usuário existente no Supabase
    const { error } = await supabase
      .from('usuarios')
      .update({
        senha_hash: senhaHash,
        plano: plan,
        status: 'ativo',
        data_expiracao: new Date(new Date().setDate(new Date().getDate() + (plan === 'mensal' ? 30 : 90)))
      })
      .eq('email', email);

    if (error) {
      console.error('Erro ao atualizar usuário no Supabase:', error);
    }

    // Envia e-mail com a senha
    await resend.emails.send({
      from: 'Karaokê Multiplayer <onboarding@seu-dominio.com>',
      to: email,
      subject: '🎤 Sua conta Karaokê Multiplayer está ativa!',
      html: `
        <h2>Olá!</h2>
        <p>Seu pagamento foi aprovado e sua conta já está ativa.</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Senha:</strong> ${senhaTemporaria}</p>
        <p>Faça login em:</p>
        <a href="https://karaoke-multiplayer.pages.dev/login.html">https://karaoke-multiplayer.pages.dev/login.html</a>
      `
    });

    console.log(`📧 Email enviado para ${email}`);

    return res.status(200).json({ sucesso: true });
  } catch (err) {
    console.error('❌ ERRO NO WEBHOOK:', err);
    return res.status(500).json({ erro: 'Erro interno webhook' });
  }
}
