const nodemailer = require("nodemailer");
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

console.log('🚀 Iniciando simulação de aprovação de pagamento...\n');

// Configuração do banco de dados (já testada e funcionando)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Configuração do e-mail (já testada e funcionando)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASS
}
});

async function aprovarPagamento(dados) {
  try {
    // 1️⃣ Gerar senha temporária
    const senhaTemporaria = Math.random().toString(36).slice(-8);
    console.log('🔑 Senha temporária gerada:', senhaTemporaria);

    // 2️⃣ Criar hash da senha
    const hash = await bcrypt.hash(senhaTemporaria, 10);
    console.log('🔒 Hash da senha criado');

    // 3️⃣ Verificar se usuário já existe no banco
    console.log('📡 Verificando usuário no banco...');
    const existe = await pool.query(
      'SELECT email FROM usuarios WHERE email = $1',
      [dados.email]
    );

    let resultado;
    if (existe.rows.length > 0) {
      // Atualizar usuário existente
      resultado = await pool.query(
        `UPDATE usuarios 
         SET senha_hash = $1, plano = $2, status = $3 
         WHERE email = $4 
         RETURNING email, nome, plano, status`,
        [hash, dados.plano, 'ativo', dados.email]
      );
      console.log('✅ Usuário ATUALIZADO com sucesso!');
    } else {
      // Criar novo usuário
      resultado = await pool.query(
        `INSERT INTO usuarios (email, nome, senha_hash, plano, status) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING email, nome, plano, status`,
        [dados.email, dados.nome, hash, dados.plano, 'ativo']
      );
      console.log('✅ Novo usuário CRIADO com sucesso!');
    }

    console.log('📊 Dados salvos:', resultado.rows[0]);

    // 4️⃣ Enviar e-mail de confirmação
    console.log('📧 Preparando envio de e-mail...');
    
    const info = await transporter.sendMail({
      from: '"Karaokê Multiplayer" <dominio3000@gmail.com>',
      to: dados.email,
      subject: '✅ Pagamento Confirmado - Acesso Liberado!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 10px 10px; }
            .credential-box { background: #e8f5e9; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center; }
            .senha { font-size: 28px; font-weight: bold; color: #2e7d32; letter-spacing: 2px; font-family: monospace; }
            .button { background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0; font-weight: bold; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎤 Pagamento Confirmado!</h1>
              <p>Seu acesso ao Karaokê Multiplayer Premium está liberado</p>
            </div>
            
            <div class="content">
              <h2>Olá ${dados.nome}!</h2>
              <p>Recebemos a confirmação do seu pagamento com sucesso. Aqui estão os detalhes da sua compra:</p>
              
              <p><strong>📋 Plano:</strong> Plano ${dados.plano.charAt(0).toUpperCase() + dados.plano.slice(1)}</p>
              <p><strong>💰 Valor:</strong> R$ ${dados.valor.toFixed(2)}</p>
              <p><strong>🆔 ID da Transação:</strong> ${dados.idTransacao}</p>
              <p><strong>📅 Data:</strong> ${new Date().toLocaleDateString('pt-BR')}</p>
              
              <div class="credential-box">
                <h3 style="margin-top: 0;">🔑 SUAS CREDENCIAIS DE ACESSO</h3>
                <p><strong>E-mail:</strong> ${dados.email}</p>
                <p><strong>Senha temporária:</strong></p>
                <div class="senha">${senhaTemporaria}</div>
                <p style="color: #e67e22; margin-top: 15px;">⚠️ Recomendamos trocar sua senha após o primeiro acesso</p>
              </div>
              
              <div style="text-align: center;">
                <a href="https://karaoke-multiplayer.pages.dev/login" class="button">ACESSAR KARAOKÊ</a>
              </div>
              
              <p style="margin-top: 20px;">Qualquer dúvida, responda a este e-mail ou entre em contato com nosso suporte.</p>
            </div>
            
            <div class="footer">
              <p>© ${new Date().getFullYear()} Karaokê Multiplayer. Todos os direitos reservados.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    console.log('✅ E-mail enviado com sucesso!');
    console.log('📨 ID da mensagem:', info.messageId);
    
    // 5️⃣ Mostrar resumo final
    console.log('\n📊 ===== RESUMO DA SIMULAÇÃO =====');
    console.log(`👤 Usuário: ${dados.email}`);
    console.log(`🔑 Senha: ${senhaTemporaria}`);
    console.log(`📋 Plano: ${dados.plano}`);
    console.log(`💰 Valor: R$ ${dados.valor}`);
    console.log(`📧 E-mail enviado: SIM`);
    console.log(`🔗 Link de login: https://karaoke-multiplayer.pages.dev/login`);
    console.log('================================\n');

  } catch (error) {
    console.error('❌ ERRO DURANTE A SIMULAÇÃO:');
    console.error('Mensagem:', error.message);
    if (error.code) console.error('Código:', error.code);
    if (error.detail) console.error('Detalhe:', error.detail);
  } finally {
    await pool.end();
    console.log('🔌 Conexão com banco fechada');
  }
}

// Executar aprovarPagamento
module.exports = aprovarPagamento;
