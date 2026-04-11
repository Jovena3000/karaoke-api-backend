const mercadopago = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const fetch = require("node-fetch");

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ================= PROCESSAR USUÁRIO =================
async function ativarUsuario(email, plan) {

    const senha = Math.random().toString(36).slice(-8);
    const hash = await bcrypt.hash(senha, 10);

    let dias = 30;
    if (plan === "trimestral") dias = 90;
    if (plan === "semestral") dias = 180;
    if (plan === "anual") dias = 365;

    const exp = new Date();
    exp.setDate(exp.getDate() + dias);

    const { data } = await supabase
        .from("usuarios")
        .select("*")
        .eq("email", email)
        .maybeSingle();

    if (data) {
        await supabase.from("usuarios").update({
            plano: plan,
            status: "ativo",
            data_expiracao: exp,
            senha_hash: hash
        }).eq("email", email);
    } else {
        await supabase.from("usuarios").insert({
            email,
            plano: plan,
            status: "ativo",
            data_expiracao: exp,
            senha_hash: hash
        });
    }

    // EMAIL
    await resend.emails.send({
        from: "Karaokê <noreply@karaokemultiplayer.com.br>",
        to: email,
        subject: "🎤 Acesso liberado",
        html: `<h2>Login:</h2><p>${email}</p><p>Senha: ${senha}</p>`
    });
}

// ================= ANTI DUPLICAÇÃO =================
async function jaProcessado(id) {
    const { data } = await supabase
        .from("pagamentos_processados")
        .select("*")
        .eq("id", String(id))
        .maybeSingle();

    return !!data;
}

async function salvarProcessado(id) {
    await supabase.from("pagamentos_processados").insert({
        id: String(id),
        processado_em: new Date()
    });
}

// ================= WEBHOOK =================
module.exports = async (req, res) => {

    if (req.method !== "POST") return res.status(200).end();

    try {
        const topic = req.body?.type || req.body?.topic;
        const id = req.body?.data?.id || req.query?.id;

        console.log("📩 Webhook:", topic, id);

        // ================= MERCHANT ORDER =================
        if (topic === "merchant_order") {

            const response = await fetch(`https://api.mercadopago.com/merchant_orders/${id}`, {
                headers: {
                    Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
                }
            });

            const order = await response.json();

            const approved = order.payments?.find(p => p.status === "approved");

            if (!approved) return res.status(200).end();

            if (await jaProcessado(approved.id)) return res.status(200).end();

            const payment = await mercadopago.payment.findById(approved.id);
            const data = payment.body;

            const [email, plan] = data.external_reference.split('|');

            await ativarUsuario(email, plan);
            await salvarProcessado(approved.id);

            return res.status(200).end();
        }

        // ================= PAYMENT =================
        if (topic === "payment") {

            if (await jaProcessado(id)) return res.status(200).end();

            const payment = await mercadopago.payment.findById(id);
            const data = payment.body;

            if (data.status !== "approved") return res.status(200).end();

            const [email, plan] = data.external_reference.split('|');

            await ativarUsuario(email, plan);
            await salvarProcessado(id);

            return res.status(200).end();
        }

        return res.status(200).end();

    } catch (err) {
        console.error("ERRO:", err);
        return res.status(200).end();
    }
};
