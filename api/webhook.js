const mercadopago = require("mercadopago");
const bcrypt = require("bcryptjs");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(200).end();
  }

  try {

    const paymentId =
      req.body?.data?.id ||
      req.body?.id ||
      req.query?.id;

    if (!paymentId) {
      console.log("Webhook sem paymentId");
      return res.status(200).end();
    }

    const paymentResponse = await mercadopago.payment.findById(paymentId);
    const payment = paymentResponse.body;

    if (payment.status !== "approved") {
      console.log("Pagamento não aprovado:", payment.status);
      return res.status(200).end();
    }

    console.log("Pagamento aprovado:", paymentId);

    const { email, plan } = JSON.parse(payment.external_reference);

    const senhaTemporaria = Math.random().toString(36).slice(-8);
    const senhaHash = await bcrypt.hash(senhaTemporaria, 10);

    let diasPlano = 30;

    if (plan === "trimestral") diasPlano = 90;
    if (plan === "semestral") diasPlano = 180;
    if (plan === "anual") diasPlano = 365;

    const dataExpiracao = new Date();
    dataExpiracao.setDate(dataExpiracao.getDate() + diasPlano);

    const { error } = await supabase
      .from("usuarios")
      .upsert({
        email: email,
        senha_hash: senhaHash,
        plano: plan,
        status: "ativo",
        data_expiracao: dataExpiracao
      });

    if (error) {
      console.error("Erro Supabase:", error);
    }

    await resend.emails.send({
      from: "Karaokê Multiplayer <onboarding@resend.dev>",
      to: email,
      subject: "🎤 Sua conta Karaokê Multiplayer está ativa!",
      html: `
        <h2>Pagamento aprovado!</h2>
        <p>Email: ${email}</p>
        <p>Senha temporária: <b>${senhaTemporaria}</b></p>
        <a href="https://karaoke-multiplayer.pages.dev/login.html">Entrar no Karaokê</a>
      `
    });

    console.log("Email enviado:", email);

    return res.status(200).json({ sucesso: true });

  } catch (err) {

    console.error("Erro webhook:", err);

    return res.status(500).json({
      erro: "Erro interno webhook"
    });

  }

};
