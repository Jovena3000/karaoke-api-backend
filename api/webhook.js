// webhook.js
const { MercadoPagoConfig, Payment } = require('mercadopago');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

// ===== CONFIG =====
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

const paymentClient = new Payment(client);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ================= FUNÇÃO AUXILIAR =================
async function ensureTableExists() {
  const { error } = await supabase
    .from('pagamentos_processados')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (error && error.message.includes('does not exist')) {
    console.log('⚠️ Tabela pagamentos_processados não existe.');
  }

  return true;
}

// ================= PLANO =================
function extrairPlanoDoValor(valor) {
  if (valor == 5.00) return "mensal";
  if (valor == 49.90) return "trimestral";
  if (valor == 89.90) return "semestral";
  if (valor == 159.90) return "anual";
  return "mensal";
}

// ================= VALIDAÇÃO =================
function isValidEmail(email) {
  return email && typeof email === 'string' && email.includes('@');
}

// ================= PROCESSAR PAGAMENTO =================
async function processarPagamentoAprovado(email, plan) {
  console.log(`💰 Processando: ${email} | ${plan}`);

  if (!isValidEmail(email)) {
    console.log("❌ Email inválido");
    return;
  }

  let dias = 30;
  let valor = 5;

  if (plan === "trimestral") { dias = 90; valor = 49.9; }
  if (plan === "semestral") { dias = 180; valor = 89.9; }
  if (plan === "anual") { dias = 365; valor = 159.9; }

  const senha = Math.random().toString(36).slice(-8);
  const hash = await bcrypt.hash(senha, 10);

  const exp = new Date();
  exp.setDate(exp.getDate() + dias);

  const { data: user } = await supabase
    .from("usuarios")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (user) {
    await supabase.from("usuarios").update({
      plano: plan,
      status: "ativo",
      data_expiracao: exp.toISOString(),
      senha_hash: hash
    }).eq("email", email);
  } else {
    await supabase.from("usuarios").insert({
      email,
      senha_hash: hash,
      plano: plan,
      status: "ativo",
      data_expiracao: exp.toISOString()
    });
  }

  // EMAIL
  try {
    await resend.emails.send({
      from: "Karaokê <noreply@karaokemultiplayer.com.br>",
      to: email,
      subject: "Pagamento aprovado!",
      html: `<h1>Pagamento aprovado</h1><p>Senha: ${senha}</p>`
    });
  } catch (e) {
    console.log("Erro email:", e.message);
  }
}

// ================= WEBHOOK PRINCIPAL =================
module.exports = async (req, res) => {
  console.log("🚀 WEBHOOK ATIVO");

  if (req.method !== 'POST') {
    return res.status(200).end();
  }

  try {
    const { type, data } = req.body;
    const paymentId = data?.id;

    if (!paymentId || type !== 'payment') {
      return res.status(200).end();
    }

    console.log("🔎 Buscando pagamento:", paymentId);

    await ensureTableExists();

    const { data: existente } = await supabase
      .from('pagamentos_processados')
      .select('id')
      .eq('id', String(paymentId))
      .maybeSingle();

    if (existente) {
      console.log("⚠️ Já processado");
      return res.status(200).end();
    }

    // 🔥 SDK NOVO CORRETO
    const payment = await paymentClient.get({ id: paymentId });

    console.log("💳 Status:", payment.status);

    if (payment.status !== 'approved') {
      return res.status(200).end();
    }

    let email = payment.payer?.email;
    let plan = null;

    if (payment.external_reference?.includes('|')) {
      const [e, p] = payment.external_reference.split('|');
      email = e;
      plan = p;
    }

    if (!plan) {
      plan = extrairPlanoDoValor(payment.transaction_amount);
    }

    if (!email) {
      console.log("❌ Sem email");
      return res.status(200).end();
    }

    await processarPagamentoAprovado(email, plan);

    await supabase.from('pagamentos_processados').insert({
      id: String(paymentId),
      email
    });

    console.log("✅ FINALIZADO");

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("❌ ERRO:", err.message);
    return res.status(200).end();
  }
};

// EXPORT
module.exports.processarPagamentoAprovado = processarPagamentoAprovado;
