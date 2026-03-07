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
    const paymentId = req.body?.data?.id || req.body?.id || req.query?.id;

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

    // Parse seguro do external_reference
    let email, plan;
    try {
      const externalRef = JSON.parse(payment.external_reference);
      email = externalRef.email;
      plan = externalRef.plan;
      
      if (!email || !plan) {
        throw new Error("Email ou plano não encontrados");
      }
    } catch (err) {
      console.error("Erro ao parsear external_reference:", err);
      return res.status(200).json({ erro: "external_reference inválido" });
    }

    const senhaTemporaria = Math.random().toString(36).slice(-8);
    const senhaHash = await bcrypt.hash(senhaTemporaria, 10);

    let diasPlano = 30;
    if (plan === "trimestral") diasPlano = 90;
    if (plan === "semestral") diasPlano = 180;
    if (plan === "anual") diasPlano = 365;

    const dataExpiracao = new Date();
    dataExpiracao.setDate(dataExpiracao.getDate() + diasPlano);

    // Verificar se usuário já existe
    const { data: usuarioExistente } = await supabase
      .from("usuarios")
      .select("email")
      .eq("email", email)
      .single();

    if (usuarioExistente) {
      // Atualizar usuário existente
      const { error } = await supabase
        .from("usuarios")
        .update({
          plano: plan,
          status: "ativo",
          data_expiracao: dataExpiracao
        })
        .eq("email", email);
        
      if (error) console.error("Erro ao atualizar usuário:", error);
    } else {
      // Inserir novo usuário
      const { error } = await supabase
        .from("usuarios")
        .insert({
          email: email,
          senha_hash: senhaHash,
          plano: plan,
          status: "ativo",
          data_expiracao: dataExpiracao
        });
        
      if (error) console.error("Erro ao inserir usuário:", error);
    }

    // Enviar e-mail com template melhorado
    await resend.emails.send({
      from: "Karaokê Multiplayer <onboarding@resend.dev>",
      to: email,
      subject: "🎤 Sua conta Karaokê Multiplayer está ativa!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4CAF50;">✅ Pagamento aprovado!</h2>
          
          <p>Olá,</p>
          
          <p>Seu acesso ao <strong>Karaokê Multiplayer Premium</strong> está liberado.</p>
          
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>📧 Email:</strong> ${email}</p>
            <p><strong>🔑 Senha temporária:</strong> <code style="background: #eee; padding: 5px;">${senhaTemporaria}</code></p>
            <p><strong>📅 Plano:</strong> ${plan}</p>
            <p><strong>⏰ Válido até:</strong> ${dataExpiracao.toLocaleDateString('pt-BR')}</p>
          </div>
          
          <p style="margin: 30px 0;">
            <a href="https://karaoke-multiplayer.pages.dev/login.html" 
               style="background: #4CAF50; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 5px; font-weight: bold;">
              🔐 Fazer login no sistema
            </a>
          </p>
          
          <p>Ou copie este link:<br>
          <a href="https://karaoke-multiplayer.pages.dev/login.html">
            https://karaoke-multiplayer.pages.dev/login.html
          </a></p>
          
          <p style="color: #666; font-size: 12px; margin-top: 40px;">
            ⚠️ Por segurança, altere sua senha após o primeiro acesso.
          </p>
        </div>
      `
    });

    console.log("Email enviado para:", email);
    return res.status(200).json({ sucesso: true });

  } catch (err) {
    console.error("Erro webhook:", err);
    return res.status(500).json({ erro: "Erro interno webhook" });
  }
};
