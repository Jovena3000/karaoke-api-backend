const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

// Pool único e reaproveitado. NÃO chamar pool.end() em serverless.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1
});

// CORREÇÃO: createTransport (sem o "er")
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS // deve ser "Senha de app" do Google
  }
});

function gerarSenhaTemporaria() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * dados = { email, nome, plano, valor, idTransacao }
 * Retorna { ok, emailEnviado }. Só lança erro se falhar ao gravar no banco.
 */
async function aprovarPagamento(dados) {
  const email = String(dados.email || '').trim().toLowerCase();
  if (!email) throw new Error('aprovarPagamento: e-mail ausente');

  const nome = dados.nome || email.split('@')[0];
  const plano = dados.plano || 'mensal';
  const valor = Number(dados.valor) || 0;

  const senhaTemporaria = gerarSenhaTemporaria();
  const hash = await bcrypt.hash(senhaTemporaria, 10);

  // 1) Banco: se falhar, lança erro (o webhook deve responder 500 para o MP tentar de novo)
  const existe = await pool.query('SELECT email FROM usuarios WHERE email = $1', [email]);

  if (existe.rows.length > 0) {
    await pool.query(
      `UPDATE usuarios
         SET senha_hash = $1, plano = $2, status = $3, nome = COALESCE(nome, $4)
       WHERE email = $5`,
      [hash, plano, 'ativo', nome, email]
    );
    console.log('Usuário atualizado:', email);
  } else {
    await pool.query(
      `INSERT INTO usuarios (email, nome, senha_hash, plano, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [email, nome, hash, plano, 'ativo']
    );
    console.log('Usuário criado:', email);
  }

  // 2) E-mail: se falhar, NÃO desfaz a ativação (o cliente já pagou e já está no banco)
  let emailEnviado = false;
  try {
    const planoNome = plano.charAt(0).toUpperCase() + plano.slice(1);
    const info = await transporter.sendMail({
      from: `"Karaokê Multiplayer" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '✅ Pagamento Confirmado - Acesso Liberado!',
      html: `...` // (mesmo HTML que você já tem, sem alterações)
    });
    emailEnviado = true;
    console.log('E-mail enviado:', info.messageId);
  } catch (err) {
    console.error('Falha ao enviar e-mail para', email, '-', err.message);
  }

  return { ok: true, emailEnviado };
}

module.exports = aprovarPagamento;
