import mercadopago from 'mercadopago';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

// Configurações
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Email config
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Gera senha aleatória (APENAS para novos usuários)
function gerarSenha(tamanho = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let senha = '';
  for (let i = 0; i < tamanho; i++) {
    senha += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return senha;
}

export default async function handler(req, res) {
  console.log('🔥 WEBHOOK CHAMADO');
  console.log('BODY:', JSON.stringify(req.body, null, 2));

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  try {
    const { type, data } = req.body;

    // Mercado Pago envia vários tipos — queremos apenas pagamento
    if (type !== 'payment') {
      return res.status(200).json({ recebido: true });
    }

    // 🔍 Busca detalhes do pagamento
    const payment = await mercadopago.payment.findById(data.id);
    const info = payment.body;

    // Log para debug
    console.log('Payment status:', info.status);
    console.log('External reference:', info.external_reference);

    if (info.status !== 'approved') {
      return res.status(200).json({ status: 'Pagamento não aprovado' });
    }

    if (!info.external_reference) {
      throw new Error('external_reference ausente');
    }

    // 🔎 Parse seguro do external_reference (JSON)
    let externalRef;
    try {
      externalRef = JSON.parse(info.external_reference);
    } catch (e) {
      // Fallback para o formato antigo (user_123_plano_mensal)
      const [_, userId, __, plano] = info.external_reference.split('_');
      externalRef = { userId, plano };
    }

    const { userId, plano, email } = externalRef;

    if (!userId) {
      throw new Error('userId não encontrado no external_reference');
    }

    // 📆 Define validade baseada no plano
    const diasPlano = plano === 'trimestral' ? 90 : 30;
    const dataExpiracao = new Date();
    dataExpiracao.setDate(dataExpiracao.getDate() + diasPlano);

    // 🔄 Busca usuário existente
    const { data: usuarioExistente, error: buscaError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', userId)
      .single();

    if (buscaError || !usuarioExistente) {
      throw new Error('Usuário não encontrado');
    }

    // Preparar dados para atualização
    const updateData = {
      status: 'ativo',
      data_expiracao: dataExpiracao.toISOString(),
      plano: plano
    };

    // Só gera nova senha se for um novo usuário (não é o caso aqui)
    // Para usuários existentes, mantém a senha atual

    // 🔄 Atualiza usuário (sem mudar a senha!)
    const { data: usuario, error: updateError } = await supabase
      .from('usuarios')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log('Usuário atualizado:', usuario.email);

    // ✉️ Envia email de confirmação (sem incluir senha!)
    await transporter.sendMail({
      from: `"Karaokê Multiplayer" <${process.env.SMTP_USER}>`,
      to: usuario.email,
      subject: '🎤 Pagamento confirmado - Karaokê Multiplayer',
      html: `
        <h2>Pagamento confirmado!</h2>
        <p>Seu acesso foi renovado com sucesso.</p>
        <p><strong>Plano:</strong> ${plano}</p>
        <p><strong>Válido até:</strong> ${new Date(dataExpiracao).toLocaleDateString('pt-BR')}</p>
        <p><strong>Email de acesso:</strong> ${usuario.email}</p>
        <p><em>Sua senha permanece a mesma.</em></p>
        <br>
        <a href="https://karaoke-multiplayer.pages.dev/login.html" style="background:#ff4d94;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">
          Entrar no Karaokê
        </a>
      `
    });

    return res.status(200).json({ sucesso: true });

  } catch (err) {
    console.error('❌ Erro no webhook:', err);
    // Sempre retornar 200 para o Mercado Pago não ficar reenviando
    return res.status(200).json({ erro: err.message, recebido: true });
  }
}
