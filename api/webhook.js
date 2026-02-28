import mercadopago from 'mercadopago';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

function gerarSenha(tamanho = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let senha = '';
  for (let i = 0; i < tamanho; i++) {
    senha += chars[Math.floor(Math.random() * chars.length)];
  }
  return senha;
}

export default async function handler(req, res) {
  try {
    console.log('🔥 WEBHOOK CHAMADO');
    console.log('BODY RECEBIDO:', JSON.stringify(req.body));

    if (req.method !== 'POST') {
      return res.status(200).end();
    }

    // 🔒 Blindagem total do payload
    const paymentId =
      req.body?.data?.id ||
      req.query?.id ||
      null;

    if (!paymentId) {
      console.log('⚠️ Webhook sem paymentId, ignorado');
      return res.status(200).json({ ignorado: true });
    }

    // 🔍 Busca pagamento no Mercado Pago
    const paymentResponse = await mercadopago.payment.findById(paymentId);
    const payment = paymentResponse.body;

    if (payment.status !== 'approved') {
      console.log('⏳ Pagamento não aprovado:', payment.status);
      return res.status(200).json({ status: payment.status });
    }

    if (!payment.external_reference) {
      throw new Error('external_reference ausente');
    }

    // external_reference: user_123_plano_mensal
    const partes = payment.external_reference.split('_');
    const userId = partes[1];
    const plano = partes[3];

    const diasPlano = plano === 'trimestral' ? 90 : 30;
    const dataExpiracao = new Date();
    dataExpiracao.setDate(dataExpiracao.getDate() + diasPlano);

    const senha = gerarSenha();
    const senhaHash = await bcrypt.hash(senha, 10);

    const { data: usuario, error } = await supabase
      .from('usuarios')
      .update({
        status: 'ativo',
        senha_hash: senhaHash,
        data_expiracao: dataExpiracao.toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    await transporter.sendMail({
      from: `"Karaokê Multiplayer" <${process.env.SMTP_USER}>`,
      to: usuario.email,
      subject: '🎤 Acesso liberado - Karaokê Multiplayer',
      html: `
        <h2>Pagamento confirmado!</h2>
        <p><strong>Email:</strong> ${usuario.email}</p>
        <p><strong>Senha:</strong> ${senha}</p>
        <p><strong>Plano:</strong> ${plano}</p>
        <p><strong>Válido até:</strong> ${dataExpiracao.toLocaleDateString('pt-BR')}</p>
      `
    });

    console.log('✅ Usuário ativado com sucesso');
    return res.status(200).json({ sucesso: true });

  } catch (err) {
    console.error('❌ ERRO NO WEBHOOK:', err);
    return res.status(200).json({ erro: true });
  }
}
