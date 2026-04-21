// webhook.js - VERSÃO SIMPLIFICADA E CORRETA
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

// ================= FUNÇÕES AUXILIARES =================
function extrairPlanoDoValor(valor) {
    if (valor == 5.00 || valor == 5) return "mensal";
    if (valor == 49.90 || valor == 49.9) return "trimestral";
    if (valor == 89.90 || valor == 89.9) return "semestral";
    if (valor == 159.90 || valor == 159.9) return "anual";
    return "mensal";
}

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
            data_expiracao: exp.toISOString().split('T')[0],
            senha_hash: hash
        }).eq("email", email);
    } else {
        await supabase.from("usuarios").insert({
            email,
            senha_hash: hash,
            plano: plan,
            status: "ativo",
            data_expiracao: exp.toISOString().split('T')[0]
        });
    }

    // EMAIL
    try {
        await resend.emails.send({
            from: "Karaokê Multiplayer <noreply@karaokemultiplayer.com.br>",
            to: email,
            subject: "✅ Pagamento Confirmado!",
            html: `<h1>Pagamento aprovado!</h1><p>Sua senha: <strong>${senha}</strong></p><p>Plano: ${plan}</p><p>Expira em: ${exp.toLocaleDateString('pt-BR')}</p>`
        });
        console.log("✅ Email enviado!");
    } catch (e) {
        console.log("❌ Erro email:", e.message);
    }
}

// ================= WEBHOOK PRINCIPAL =================
module.exports = async (req, res) => {
    // CORS
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

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

        // Buscar pagamento
        const payment = await paymentClient.get({ id: paymentId });
        console.log("💳 Status:", payment.status);

        if (payment.status !== 'approved') {
            return res.status(200).end();
        }

        let email = payment.payer?.email;
        let plan = null;

        if (payment.external_reference && payment.external_reference.includes('|')) {
            const parts = payment.external_reference.split('|');
            email = parts[0];
            plan = parts[1];
        }

        if (!plan) {
            plan = extrairPlanoDoValor(payment.transaction_amount);
        }

        if (!email) {
            console.log("❌ Sem email");
            return res.status(200).end();
        }

        console.log(`👤 Cliente: ${email}, 📦 Plano: ${plan}`);

        await processarPagamentoAprovado(email, plan);

        console.log("✅ FINALIZADO!");
        return res.status(200).json({ ok: true });

    } catch (err) {
        console.error("❌ ERRO:", err.message);
        return res.status(200).end();
    }
};

// Exportar função auxiliar
module.exports.processarPagamentoAprovado = processarPagamentoAprovado;
