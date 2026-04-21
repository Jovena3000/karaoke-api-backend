// api/webhook.js - VERSÃO OFICIAL CORRIGIDA
const { MercadoPagoConfig, Payment } = require('mercadopago');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

// ===== CONFIGURAÇÕES =====
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN
});
const paymentClient = new Payment(client);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ===== FUNÇÕES AUXILIARES =====
function extrairPlanoDoValor(valor) {
    if (valor === 5.00 || valor === 5) return "mensal";
    if (valor === 49.90 || valor === 49.9) return "trimestral";
    if (valor === 89.90 || valor === 89.9) return "semestral";
    if (valor === 159.90 || valor === 159.9) return "anual";
    return "trimestral";
}

function isValidEmail(email) {
    if (!email) return false;
    if (typeof email !== 'string') return false;
    if (email === 'undefined' || email === 'null') return false;
    if (email.trim() === '') return false;
    if (!email.includes('@')) return false;
    return true;
}

// ===== PROCESSAR PAGAMENTO APROVADO =====
async function processarPagamentoAprovado(email, plan, paymentId = null) {
    console.log(`💰 Processando pagamento para ${email}`);
    console.log(`📦 Plano: ${plan}`);

    if (!isValidEmail(email)) {
        console.error(`❌ E-mail inválido: "${email}"`);
        return { sucesso: false, erro: 'E-mail inválido' };
    }

    let diasPlano = 30;
    let valorPlano = 5.00;
    if (plan === "trimestral") { diasPlano = 90; valorPlano = 49.90; }
    if (plan === "semestral") { diasPlano = 180; valorPlano = 89.90; }
    if (plan === "anual") { diasPlano = 365; valorPlano = 159.90; }

    const senhaTemporaria = Math.random().toString(36).slice(-8);
    const senhaHash = await bcrypt.hash(senhaTemporaria, 10);

    const dataExpiracao = new Date();
    dataExpiracao.setDate(dataExpiracao.getDate() + diasPlano);
    const dataExpiracaoStr = dataExpiracao.toISOString().split('T')[0];

    const { data: usuarioExistente } = await supabase
        .from("usuarios")
        .select("*")
        .eq("email", email)
        .maybeSingle();

    if (usuarioExistente) {
        console.log("🔄 Atualizando usuário existente");
        await supabase
            .from("usuarios")
            .update({
                plano: plan,
                status: "ativo",
                data_expiracao: dataExpiracaoStr,
                senha_hash: senhaHash,
                ultimo_pagamento: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq("email", email);
    } else {
        console.log("🆕 Criando novo usuário");
        await supabase
            .from("usuarios")
            .insert({
                email,
                senha_hash: senhaHash,
                nome: email.split('@')[0],
                plano: plan,
                status: "ativo",
                data_expiracao: dataExpiracaoStr,
                ultimo_pagamento: new Date().toISOString(),
                created_at: new Date().toISOString()
            });
    }

    // ===== ENVIAR EMAIL =====
    try {
        console.log("📧 Enviando e-mail para:", email);
        const dataFormatada = dataExpiracao.toLocaleDateString("pt-BR");
        const planoCapitalizado = plan.charAt(0).toUpperCase() + plan.slice(1);

        await resend.emails.send({
            from: "Karaokê Multiplayer <noreply@karaokemultiplayer.com.br>",
            to: email,
            subject: "✅ Pagamento Confirmado - Acesso Liberado!",
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                        <h1 style="color: white; margin: 0;">🎤 Pagamento Confirmado!</h1>
                    </div>
                    <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #ddd;">
                        <h2>Olá ${email.split('@')[0]}!</h2>
                        <p>Seu pagamento foi <strong style="color: #4CAF50;">APROVADO</strong> com sucesso!</p>
                        <div style="background: #f0f3ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <p><strong>📋 Plano:</strong> ${planoCapitalizado}</p>
                            <p><strong>💰 Valor:</strong> R$ ${valorPlano.toFixed(2).replace('.', ',')}</p>
                            <p><strong>📅 Expira em:</strong> ${dataFormatada}</p>
                            <p><strong>🔑 Senha:</strong> <code style="background: #e0e0e0; padding: 5px 10px; border-radius: 5px;">${senhaTemporaria}</code></p>
                        </div>
                        <div style="text-align: center;">
                            <a href="https://karaokemultiplayer.com.br/login.html" style="background: #667eea; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none;">🎤 ACESSAR KARAOKÊ</a>
                        </div>
                    </div>
                </div>
            `
        });
        console.log("✅ Email enviado com sucesso!");
    } catch (erroEmail) {
        console.error("❌ Erro ao enviar email:", erroEmail.message);
    }

    return { sucesso: true, email, plan, senha: senhaTemporaria };
}

// ===== WEBHOOK PRINCIPAL =====
module.exports = async (req, res) => {
    // CORS
    const origin = req.headers.origin;
    const allowedOrigins = [
        'https://karaokemultiplayer.com.br',
        'https://www.karaokemultiplayer.com.br',
        'https://karaoke-multiplayer.pages.dev'
    ];

    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
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
            console.log("⛔ Evento ignorado");
            return res.status(200).end();
        }

        console.log(`🧾 Processando payment ID: ${paymentId}`);

        const payment = await paymentClient.get({ id: paymentId });
        console.log("💳 Status:", payment.status);

        if (payment.status !== 'approved') {
            console.log("⏳ Pagamento não aprovado");
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
            console.log("❌ Email não encontrado");
            return res.status(200).end();
        }

        console.log(`👤 Cliente: ${email}`);
        console.log(`📦 Plano: ${plan}`);

        await processarPagamentoAprovado(email, plan, paymentId);

        console.log("🎉 Pagamento processado com sucesso!");
        return res.status(200).json({ sucesso: true });

    } catch (err) {
        console.error("🔥 Erro no webhook:", err.message);
        return res.status(200).end();
    }
};

// Exportar função auxiliar
module.exports.processarPagamentoAprovado = processarPagamentoAprovado;
