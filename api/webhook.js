// webhook.js - VERSÃO CORRIGIDA COM IDEMPOTÊNCIA
const { MercadoPagoConfig, Payment } = require('mercadopago');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const paymentApi = new Payment(client);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// ===== IDEMPOTÊNCIA =====
async function jaProcessado(paymentId) {
  const { data, error } = await supabase
    .from('pagamentos_processados')
    .select('payment_id')
    .eq('payment_id', paymentId)
    .maybeSingle();

  if (error && error.code === '42P01') {
    console.log('⚠️ Tabela pagamentos_processados não existe. Continuando sem idempotência.');
    return false;
  }
  return !!data;
}

async function marcarProcessado(paymentId) {
  const { error } = await supabase
    .from('pagamentos_processados')
    .insert({ payment_id: paymentId, processado_em: new Date().toISOString() });

  if (error && error.code !== '42P01') {
    console.error('Erro ao marcar como processado:', error.message);
  }
}

// ===== PROCESSAMENTO PRINCIPAL =====
async function processarPagamentoAprovado(email, plan, paymentId) {
  // 1) Verifica idempotência ANTES de qualquer coisa
  if (await jaProcessado(paymentId)) {
    console.log(`⏭ Pagamento ${paymentId} já processado. Ignorando.`);
    return { sucesso: true, ignorado: true };
  }

  // (O restante da lógica de usuário/plano/e-mail permanece igual ao seu código original)
  // ...

  // 2) Marca como processado ao final
  await marcarProcessado(paymentId);
  return { sucesso: true };
}

// ===== WEBHOOK =====
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'Webhook ativo' });
  }
  if (req.method !== 'POST') return res.status(200).end();

  try {
    const { type, topic, action, data } = req.body;
    const paymentId = data?.id || req.body?.id;

    if (!paymentId) return res.status(200).end();

    const isPayment = type === 'payment' || topic === 'payment' ||
      action === 'payment.created' || action === 'payment.updated';

    if (!isPayment) return res.status(200).end();

    // Busca o pagamento com retry (o MP pode demorar a disponibilizar)
    let paymentData = null;
    for (let i = 0; i < 6; i++) {
      try {
        const result = await paymentApi.get({ id: paymentId });
        paymentData = result;
        if (paymentData?.status) break;
      } catch (err) {
        console.log(`Tentativa ${i + 1} falhou:`, err.message);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!paymentData || paymentData.status !== 'approved') return res.status(200).end();

    // Extrai email e plano
    let email = null, plan = null;
    if (paymentData.external_reference?.includes('|')) {
      [email, plan] = paymentData.external_reference.split('|');
    }
    if (!email && paymentData.metadata) {
      email = paymentData.metadata.email;
      plan = paymentData.metadata.plan;
    }
    if (!email && paymentData.payer?.email) {
      email = paymentData.payer.email;
    }
    if (!plan) {
      plan = extrairPlanoDoValor(paymentData.transaction_amount);
    }
    if (!email) return res.status(200).end();

    await processarPagamentoAprovado(email, plan, paymentId);

    return res.status(200).json({ sucesso: true });

  } catch (err) {
    console.error('🔥 Erro no webhook:', err);
    return res.status(500).end(); // 500 para o MP reenviar
  }
};
