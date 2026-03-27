import { MercadoPagoConfig, Payment } from "mercadopago";
import bcrypt from "bcryptjs";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

// ===== CONFIG =====
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

const paymentApi = new Payment(client);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {

  console.log("🚀 WEBHOOK DISPARADO");

  if (req.method !== "POST") {
    return res.status(200).end();
  }

  try {

    console.log("📩 Webhook recebido");
    console.log("BODY:", JSON.stringify(req.body));

    // ===== PEGAR PAYMENT ID =====
    const paymentId =
      req.body?.data?.id ||
      req.body?.id ||
      req.query?.id;

    if (!paymentId) {
      console.log("❌ paymentId não encontrado");
      return res.status(200).end();
    }

    console.log("🧾 Payment ID:", paymentId);

    // 🚫 EVITAR DUPLICIDADE
    const { data: jaProcessado } = await supabase
      .from("pagamentos_processados")
      .select("id")
      .eq("id", paymentId)
      .maybeSingle();

    if (jaProcessado) {
      console.log("⚠️ Pagamento já processado:", paymentId);
      return res.status(200).end();
    }

    // ===== BUSCAR PAGAMENTO =====
    const payment = await paymentApi.get({ id: paymentId });

    console.log("💳 Status:", payment.status);

    if (payment.status !== "approved") {
      console.log("⏳ Ainda não aprovado");
      return res.status(200).end();
    }

    console.log("✅ Pagamento aprovado");

    // ===== VALIDAR external_reference =====
    if (!payment.external_reference) {
      console.log("❌ external_reference vazio");
      return res.status(200).end();
    }

    let email;
    let plan;

    try {
      const ref = JSON.parse(payment.external_reference);
      email = ref.email;
      plan = ref.plan;
    } catch {
      console.log("❌ external_reference inválido");
      return res.status(200).end();
    }

    if (!email || !plan) {
      console.log("❌ Email ou plano ausente");
      return res.status(200).end();
    }

    console.log("👤 Cliente:", email);
    console.log("📦 Plano:", plan);

    // ===== GERAR SENHA =====
    const senhaTemporaria = Math.random().toString(36).slice(-8);
    const senhaHash = await bcrypt.hash(senhaTemporaria, 10);

    // ===== DEFINIR PRAZO =====
    let diasPlano = 30;
    if (plan === "trimestral") diasPlano = 90;
    if (plan === "semestral") diasPlano = 180;
    if (plan === "anual") diasPlano = 365;

    const dataExpiracao = new Date();
    dataExpiracao.setDate(dataExpiracao.getDate() + diasPlano);

    // ===== VERIFICAR USUÁRIO =====
    const { data: usuarioExistente } = await supabase
      .from("usuarios")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (usuarioExistente) {
      console.log("🔄 Atualizando usuário");

      await supabase
        .from("usuarios")
        .update({
          plano: plan,
          status: "ativo",
          data_expiracao: dataExpiracao,
          senha_hash: senhaHash
        })
        .eq("email", email);

    } else {
      console.log("🆕 Criando usuário");

      await supabase
        .from("usuarios")
        .insert({
          email,
          senha_hash: senhaHash,
          plano: plan,
          status: "ativo",
          data_expiracao: dataExpiracao
        });
    }

    // ===== ENVIAR EMAIL =====
    try {
      console.log("📧 Enviando email...");

      await resend.emails.send({
        from: "Karaokê Multiplayer <noreply@karaokemultiplayer.com.br>",
        to: email,
        subject: "🎤 Sua conta está ativa!",
        html: `
        <div style="font-family: Arial; max-width:600px; margin:auto">
          <h2 style="color:#4CAF50">✅ Pagamento aprovado!</h2>

          <p>Seu acesso foi liberado.</p>

          <div style="background:#f5f5f5;padding:20px;border-radius:8px">
            <p><b>Email:</b> ${email}</p>
            <p><b>Senha:</b> ${senhaTemporaria}</p>
            <p><b>Plano:</b> ${plan}</p>
            <p><b>Expira:</b> ${dataExpiracao.toLocaleDateString("pt-BR")}</p>
          </div>

          <br>

          <a href="https://karaokemultiplayer.com.br/login.html"
          style="background:#4CAF50;color:white;padding:12px 24px;text-decoration:none;border-radius:5px">
          🔐 Entrar
          </a>
        </div>
        `
      });

      console.log("✅ Email enviado");

    } catch (erroEmail) {
      console.error("❌ Erro email:", erroEmail);
    }

    // ✅ MARCAR COMO PROCESSADO (ESSENCIAL)
    await supabase
      .from("pagamentos_processados")
      .insert({
        id: paymentId
      });

    console.log("🎉 Finalizado com sucesso");

    return res.status(200).json({ sucesso: true });

  } catch (err) {
    console.error("🔥 Erro webhook:", err);
    return res.status(500).json({
      erro: "Erro interno webhook"
    });
  }
}
