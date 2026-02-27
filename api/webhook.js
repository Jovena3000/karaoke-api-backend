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

// 📧 Configuração de email (SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// 🔐 Gera senha aleatória
function gerarSenha(tamanho = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let senha = '';
  for (let i = 0; i < tamanho; i++) {
    senha += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return senha;
}

export default async function handler(req, res) {
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

    if (info.status !== 'approved') {
      return res.status(200).json({ status: 'Pagamento não aprovado' });
    }

    // Elimina duplicidade
    if (!info.external_reference) {
      throw new Error('external_reference ausente');
    }

    // 🔎 external_reference: user_123_plano_mensal
    const [_, userId, __, plano] = info.external_reference.split('_');

    // 📆 Define validade
    const diasPlano = plano === 'trimestral' ? 90 : 30;
    const dataExpiracao = new Date();
    dataExpiracao.setDate(dataExpiracao.getDate() + diasPlano);

    // 🔐 Gera e criptografa senha
    const senha = gerarSenha();
    const senhaHash = await bcrypt.hash(senha, 10);

    // 🔄 Atualiza usuário
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

    // ✉️ Envia email
    await transporter.sendMail({
      from: `"Karaokê Multiplayer" <${process.env.SMTP_USER}>`,
      to: usuario.email,
      subject: '🎤 Acesso liberado - Karaokê Multiplayer',
      html: `
        <h2>Pagamento confirmado!</h2>
        <p>Seu acesso foi liberado com sucesso.</p>
        <p><strong>Login:</strong> ${usuario.email}</p>
        <p><strong>Senha:</strong> ${senha}</p>
        <p><strong>Plano:</strong> ${plano}</p>
        <p><strong>Válido até:</strong> ${new Date(dataExpiracao).toLocaleDateString('pt-BR')}</p>
        <br>
        <p>Acesse agora:</p>
        <a href="https://karaoke-multiplayer.pages.dev/login.html">Entrar no Karaokê</a>
      `
    });

    return res.status(200).json({ sucesso: true });

  } catch (err) {
    console.error('Erro no webhook:', err);
    return res.status(500).json({ erro: 'Erro no webhook' });
  }
}
