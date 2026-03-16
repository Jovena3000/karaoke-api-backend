const mercadopago = require("mercadopago");
const bcrypt = require("bcryptjs");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

// Configurar Mercado Pago
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

// Configurar Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Configurar envio de e-mail
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(200).end();
  }

  try {

    console.log("📩 Webhook recebido");

    const paymentId = req.body?.data?.id || req.body?.id || req.query?.id;

    if (!paymentId) {
      console.log("❌ paymentId não encontrado");
      return res.status(200).end();
    }

    console.log("🔎 Payment ID:", paymentId);

    // 🔴 CORREÇÃO: Buscar pagamento REAL no Mercado Pago
    const paymentResponse = await mercadopago.payment.findById(paymentId);
    const payment = paymentResponse.body;
    
    console.log("💳 Status pagamento:", payment.status);

    if (payment.status !== "approved") {
      console.log("⚠️ Pagamento ainda não aprovado");
      return res.status(200).end();
    }

    console.log("✅ Pagamento aprovado");

    // Garantir que external_reference existe
    if (!payment.external_reference) {
      console.log("❌ external_reference vazio");
      return res.status(200).end();
    }

    let email;
    let plan;

    try {
      const externalRef = JSON.parse(payment.external_reference);
      email = externalRef.email;  // ← AGORA USA O EMAIL REAL DO PAGAMENTO
      plan = externalRef.plan;
    } catch (err) {
      console.log("❌ external_reference inválido");
      return res.status(200).end();
    }

    if (!email || !plan) {
      console.log("❌ Email ou plano ausente");
      return res.status(200).end();
    }

    console.log("👤 Cliente:", email);  // ← AGORA MOSTRA O EMAIL CORRETO
    console.log("📦 Plano:", plan);

    // Gerar senha temporária
    const senhaTemporaria = Math.random().toString(36).slice(-8);
    const senhaHash = await bcrypt.hash(senhaTemporaria, 10);
    
    console.log("🔑 Senha hash gerada");

    // Definir duração do plano
    let diasPlano = 30;

    if (plan === "trimestral") diasPlano = 90;
    if (plan === "semestral") diasPlano = 180;
    if (plan === "anual") diasPlano = 365;

    const dataExpiracao = new Date();
    dataExpiracao.setDate(dataExpiracao.getDate() + diasPlano);

    // Verificar usuário existente
    const { data: usuarioExistente, error: erroBusca } = await supabase
      .from("usuarios")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (erroBusca) {
      console.error("❌ Erro ao buscar usuário:", erroBusca);
    }

    if (usuarioExistente) {

      console.log("🔄 Atualizando usuário existente");

      const { error } = await supabase
        .from("usuarios")
        .update({
          plano: plan,
          status: "ativo",
          data_expiracao: dataExpiracao,
          senha_hash: senhaHash  // ← GARANTE QUE A SENHA É ATUALIZADA
        })
        .eq("email", email);

      if (error) {
        console.error("❌ Erro ao atualizar usuário:", error);
      } else {
        console.log("✅ Usuário atualizado com sucesso");
      }

    } else {

      console.log("🆕 Criando novo usuário");

      const { error } = await supabase
        .from("usuarios")
        .insert({
          email: email,
          senha_hash: senhaHash,
          plano: plan,
          status: "ativo",
          data_expiracao: dataExpiracao
        });

      if (error) {
        console.error("❌ Erro ao criar usuário:", error);
      } else {
        console.log("✅ Usuário criado com sucesso");
      }
    }

    // Enviar e-mail
    try {

      console.log("📧 Enviando e-mail para:", email);  // ← LOG PARA CONFIRMAR

      await resend.emails.send({
        from: "Karaokê Multiplayer <noreply@karaokemultiplayer.com.br>",
        to: email,  // ← AGORA USA O EMAIL CORRETO
        subject: "🎤 Sua conta Karaokê Multiplayer está ativa!",
        html: `
        <div style="font-family: Arial; max-width:600px; margin:auto">

        <h2 style="color:#4CAF50">✅ Pagamento aprovado!</h2>

        <p>Seu acesso ao <b>Karaokê Multiplayer Premium</b> foi liberado.</p>

        <div style="background:#f5f5f5;padding:20px;border-radius:8px">

        <p><b>Email:</b> ${email}</p>
        <p><b>Senha temporária:</b> ${senhaTemporaria}</p>
        <p><b>Plano:</b> ${plan}</p>
        <p><b>Válido até:</b> ${dataExpiracao.toLocaleDateString("pt-BR")}</p>

        </div>

        <br>

        <a href="https://karaokemultiplayer.com.br/login.html"
        style="background:#4CAF50;color:white;padding:12px 24px;text-decoration:none;border-radius:5px">
        🔐 Entrar no Karaokê
        </a>

        <p style="margin-top:30px;font-size:12px;color:#777">
        Troque sua senha após o primeiro acesso.
        </p>

        </div>
        `
      });

      console.log("📧 Email enviado com sucesso para:", email);

    } catch (erroEmail) {

      console.error("❌ Falha ao enviar email:", erroEmail);

    }

    console.log("🎉 Processo finalizado");

    return res.status(200).json({ sucesso: true });

  } catch (err) {

    console.error("🔥 Erro no webhook:", err);
    console.error("📄 Stack:", err.stack);

    return res.status(500).json({
      erro: "Erro interno webhook"
    });

  }
};
