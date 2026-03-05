const nodemailer = require("nodemailer");
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// ================= CONFIGURAÇÕES =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Configurar Nodemailer (use seus dados)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "dominio3000@gmail.com",
    pass: "vwtv iiai zagc eqie"
  }
});

// ================= DADOS DO USUÁRIO PARA SIMULAR =================
const dadosSimulacao = {
  email: "dominio3002@gmail.com",        // E-mail do usuário que não recebeu
  nome: "Jovenil Silva",                  // Nome do usuário
  plano: "trimestral",                     // Plano escolhido
  valor: 49.90,                            // Valor pago
  idTransacao: "1345222337"                 // ID da transação real
};

// ================= FUNÇÃO PRINCIPAL =================
async function simularAprovacaoEEnviarEmail() {
  console.log('🚀 Iniciando simulação de aprovação...');
  console.log('📧 Usuário:', dadosSimulacao.email);
  console.log('📋 Plano:', dadosSimulacao.plano);

  try {
    // 1️⃣ Gerar senha temporária
    const senhaTemporaria = Math.random().toString(36).slice(-8);
    console.log('🔑 Senha gerada:', senhaTemporaria);

    // 2️⃣ Criar hash da senha
    const hash = await bcrypt.hash(senhaTemporaria, 10);
    console.log('🔒 Hash criado');

    // 3️⃣ Verificar se usuário existe no Supabase
    const { data: usuario, error: buscaError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', dadosSimulacao.email)
      .single();

    if (buscaError && buscaError.code === 'PGRST116') {
      console.log('⚠️ Usuário não encontrado. Criando novo usuário...');
      
      // Criar usuário se não existir
      const { error: insertError } = await supabase
        .from('usuarios')
        .insert([{
          email: dadosSimulacao.email,
          nome: dadosSimulacao.nome,
          senha_hash: hash,
          plano: dadosSimulacao.plano,
          status: 'ativo',
          created_at: new Date().toISOString()
        }]);

      if (insertError) throw insertError;
      console.log('✅ Usuário criado com sucesso');
      
    } else {
      // 4️⃣ Atualizar usuário existente
      const { error: updateError } = await supabase
        .from('usuarios')
        .update({
          senha_hash: hash,
          plano: dadosSimulacao.plano,
          status: 'ativo'
        })
        .eq('email', dadosSimulacao.email);

      if (updateError) throw updateError;
      console.log('✅ Usuário atualizado com sucesso');
    }

    // 5️⃣ ENVIAR E-MAIL DE CONFIRMAÇÃO
    console.log('📧 Enviando e-mail...');

    // Tabela de preços para exibir
    const prices = {
      mensal: 19.90,
      trimestral: 49.90,
      semestral: 89.90,
      anual: 159.90
    };

    // Nome do plano formatado
    const nomePlano = dadosSimulacao.plano.charAt(0).toUpperCase() + dadosSimulacao.plano.slice(1);

    const mailOptions = {
      from: '"Karaokê Multiplayer" <dominio3000@gmail.com>',
      to: dadosSimulacao.email,
      subject: '✅ Pagamento Confirmado - Seu acesso está liberado!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
            .info-box { background: white; padding: 15px; border-radius: 5px; margin: 10px 0; }
            .code { background: #e8f5e9; padding: 15px; text-align: center; font-size: 24px; font-family: monospace; border-radius: 5px; color: #2e7d32; font-weight: bold; }
            .warning { background: #fff3cd; border: 1px solid #ffeeba; color: #856404; padding: 15px; border-radius: 5px; margin: 10px 0; }
            .button { background: #4CAF50; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0; font-weight: bold; }
            .footer { text-align: center; padding: 15px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎤 Pagamento Confirmado!</h1>
              <p>Seu acesso ao Karaokê Multiplayer Premium está liberado</p>
            </div>
            
            <div class="content">
              <h2>Olá ${dadosSimulacao.nome}!</h2>
              <p>Recebemos a confirmação do seu pagamento com sucesso. Aqui estão os detalhes da sua compra:</p>
              
              <div class="info-box">
                <p><strong>📋 Plano:</strong> Plano ${nomePlano}</p>
                <p><strong>💰 Valor:</strong> R$ ${dadosSimulacao.valor.toFixed(2)}</p>
                <p><strong>🆔 ID da Transação:</strong> ${dadosSimulacao.idTransacao}</p>
                <p><strong>📅 Data:</strong> ${new Date().toLocaleDateString('pt-BR')}</p>
              </div>

              <h3>🔑 SUAS CREDENCIAIS DE ACESSO</h3>
              <div class="info-box">
                <p><strong>📧 E-mail de acesso:</strong> ${dadosSimulacao.email}</p>
                <p><strong>🔐 Senha temporária:</strong></p>
                <div class="code">${senhaTemporaria}</div>
              </div>
              
              <div class="warning">
                <p><strong>⚠️ IMPORTANTE:</strong> Por segurança, recomendamos trocar sua senha após o primeiro acesso.</p>
              </div>
              
              <div style="text-align: center;">
                <a href="https://karaoke-multiplayer.pages.dev/login" class="button">
                  ACESSAR KARAOKÊ PREMIUM AGORA
                </a>
              </div>
              
              <div style="margin-top: 20px; padding: 15px; background: #e7f3ff; border-radius: 5px;">
                <h4>📱 Como acessar:</h4>
                <ol>
                  <li>Clique no botão "ACESSAR KARAOKÊ PREMIUM AGORA"</li>
                  <li>Use seu e-mail <strong>${dadosSimulacao.email}</strong> e a senha temporária acima</li>
                  <li>Na primeira vez, vá em "Perfil" e troque sua senha</li>
                  <li>Pronto! Todo conteúdo premium estará liberado</li>
                </ol>
              </div>
            </div>
            
            <div class="footer">
              <p>Este é um e-mail automático. Por favor, não responda.</p>
              <p>Precisa de ajuda? Entre em contato com nosso suporte.</p>
              <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
              <p style="font-size: 11px; color: #999;">
                © ${new Date().getFullYear()} Karaokê Multiplayer. Todos os direitos reservados.<br>
                Rua Exemplo, 123 - São Paulo/SP
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    // Enviar e-mail
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ E-mail enviado com sucesso!');
    console.log('📨 ID da mensagem:', info.messageId);
    console.log('📧 Destinatário:', dadosSimulacao.email);
    
    // Resumo final
    console.log('\n📊 ===== RESUMO DA SIMULAÇÃO =====');
    console.log(`✅ Usuário ativado: ${dadosSimulacao.email}`);
    console.log(`🔑 Senha: ${senhaTemporaria}`);
    console.log(`📧 E-mail enviado: SIM`);
    console.log(`💡 Próximo passo: Peça para o usuário fazer login em https://karaoke-multiplayer.pages.dev/login`);
    console.log('================================\n');

  } catch (error) {
    console.error('❌ Erro durante a simulação:');
    console.error('Mensagem:', error.message);
    if (error.response) {
      console.error('Detalhes:', error.response);
    }
  }
}

// ================= EXECUTAR =================
simularAprovacaoEEnviarEmail();
