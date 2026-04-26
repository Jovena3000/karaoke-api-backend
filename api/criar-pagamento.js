// api/criar-pagamento.js
const mercadopago = require('mercadopago');

// Configurar o Mercado Pago
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
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
    const { metodo, token, payment_method_id, installments, issuer_id, cpf, email, plan } = req.body;

    console.log('📦 Dados recebidos:', { metodo, email, plan, hasToken: !!token });

    const PLANOS = {
      mensal: 5.00,
      trimestral: 49.90,
      semestral: 89.90,
      anual: 159.90
    };

    const valor = PLANOS[plan];
    if (!valor) {
      return res.status(400).json({ erro: 'Plano inválido' });
    }

    // ========== PAGAMENTO COM CARTÃO ==========
    if (metodo === 'card') {
      if (!token) {
        return res.status(400).json({ erro: 'Token do cartão não fornecido' });
      }

      console.log('💳 Processando pagamento com cartão...');

      const paymentData = {
        transaction_amount: valor,
        token: token,
        description: `Plano ${plan} - Karaokê Multiplayer`,
        payment_method_id: payment_method_id,
        installments: Number(installments),
        payer: {
          email: email,
          identification: {
            type: 'CPF',
            number: cpf || '12345678909'
          }
        }
      };

      if (issuer_id) {
        paymentData.issuer_id = issuer_id;
      }

      console.log('📤 Enviando para MP:', JSON.stringify(paymentData, null, 2));

      const response = await mercadopago.payment.create({ body: paymentData });
      const payment = response.body;

      console.log('✅ Resposta MP:', payment.status, payment.id);

      if (payment.status === 'approved') {
        // Atualizar usuário no Supabase
        await atualizarUsuario(email, plan);

        // Enviar email de confirmação
        await enviarEmailConfirmacao(email, plan);

        return res.status(200).json({
          sucesso: true,
          pagamento_id: payment.id,
          status: payment.status
        });
      } else {
        return res.status(400).json({
          sucesso: false,
          erro: `Pagamento ${payment.status}`,
          detalhes: payment.status_detail
        });
      }
    }

    // ========== PAGAMENTO COM PIX ==========
    else if (metodo === 'pix') {
      console.log('📱 Gerando PIX...');

      const response = await mercadopago.payment.create({
        body: {
          transaction_amount: valor,
          description: `Plano ${plan} - Karaokê Multiplayer`,
          payment_method_id: 'pix',
          payer: {
            email: email,
            first_name: email.split('@')[0]
          }
        }
      });

      const payment = response.body;

      console.log('✅ PIX gerado:', payment.id);

      return res.status(200).json({
        sucesso: true,
        id: payment.id,
        qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
        qr_code_base64: payment.point_of_interaction?.transaction_data?.qr_code_base64,
        expires_at: payment.date_of_expiration
      });
    }

    else {
      return res.status(400).json({ erro: 'Método de pagamento inválido' });
    }

  } catch (error) {
    console.error('❌ Erro no pagamento:', error);
    
    // Detalhar erro do Mercado Pago
    if (error.cause && error.cause.api_response) {
      console.error('📄 Resposta MP:', error.cause.api_response.data);
      return res.status(400).json({
        sucesso: false,
        erro: error.cause.api_response.data.message || error.message
      });
    }

    return res.status(500).json({
      sucesso: false,
      erro: error.message || 'Erro interno no processamento'
    });
  }
};

// ================= FUNÇÕES AUXILIARES =================
async function atualizarUsuario(email, plano) {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const diasPlano = {
    mensal: 30,
    trimestral: 90,
    semestral: 180,
    anual: 365
  };

  const dataExpiracao = new Date();
  dataExpiracao.setDate(dataExpiracao.getDate() + diasPlano[plano]);

  const { error } = await supabase
    .from('usuarios')
    .update({
      plano: plano,
      status: 'ativo',
      data_expiracao: dataExpiracao.toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('email', email.toLowerCase());

  if (error) {
    console.error('❌ Erro ao atualizar Supabase:', error);
  } else {
    console.log('✅ Usuário atualizado no Supabase');
  }
}

async function enviarEmailConfirmacao(email, plano) {
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'Karaokê Multiplayer <suporte@karaokemultiplayer.com.br>',
      to: email,
      subject: '✅ Pagamento Confirmado!',
      html: `
        <h1>Pagamento aprovado!</h1>
        <p>Seu plano <strong>${plano}</strong> foi ativado com sucesso.</p>
        <p>Acesse: <a href="https://karaokemultiplayer.com.br">karaokemultiplayer.com.br</a></p>
      `
    });

    console.log('✅ Email enviado para:', email);
  } catch (error) {
    console.error('❌ Erro ao enviar email:', error);
  }
}
