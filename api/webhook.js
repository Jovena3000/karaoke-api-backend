// webhook.js - VERSÃO COMPLETA E CORRIGIDA
const mercadopago = require('mercadopago');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

// ===== CONFIG =====
mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ===== FUNÇÃO AUXILIAR PARA CRIAR TABELA DE LOG =====
async function ensureTableExists() {
    const { error } = await supabase
        .from('pagamentos_processados')
        .select('id')
        .limit(1)
        .maybeSingle();
    
    if (error && error.message.includes('does not exist')) {
        console.log('📦 Tabela pagamentos_processados não existe. Continuando sem lock.');
    }
    return true;
}

// ===== FUNÇÃO PARA CONFIGURAR CORS =====
function configurarCORS(req, res) {
    const allowedOrigins = [
        'https://karaokemultiplayer.com.br',
        'https://www.karaokemultiplayer.com.br',
        'https://karaoke-multiplayer.pages.dev',
        'http://localhost:3000'
    ];
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
}

// ================= FUNÇÃO PARA EXTRAIR PLANO DO VALOR =================
function extrairPlanoDoValor(valor) {
    if (valor === 5.00 || valor === 5) return "mensal";
    if (valor === 49.90 || valor === 49.9) return "trimestral";
    if (valor === 89.90 || valor === 89.9) return "semestral";
    if (valor === 159.90 || valor === 159.9) return "anual";
    return "trimestral";
}

// ================= VALIDAÇÃO DE E-MAIL =================
function emailEhValido(email) {
    if (!email) return false;
    if (typeof email !== 'string') return false;
    if (email === 'undefined' || email === 'null') return false;
    if (email.trim() === '') return false;
    if (!email.includes('@')) return false;

    const emailsFakes = ['testuser', 'test_user', 'noreply', 'no-reply', '@mercadopago', '@mercadolivre'];
    if (emailsFakes.some(str => email.toLowerCase().includes(str))) {
        console.warn("⚠️ E-mail parece ser gerado automaticamente pelo MP:", email);
        return false;
    }

    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email.trim());
}

// ================= FUNÇÃO PRINCIPAL DE PROCESSAMENTO =================
async function processarPagamentoAprovado(email, plan, paymentId = null) {
    console.log(`💰 Processando pagamento para ${email}`);
    console.log(`📦 Plano: ${plan}`);

    // 🔥 VALIDAÇÃO ROBUSTA DO E-MAIL
    if (!emailEhValido(email)) {
        console.error("❌ E-mail inválido recebido:", email);

        if (paymentId) {
            try {
                const response = await mercadopago.payment.findById(paymentId);
                const payment = response.body;
                const emailRecuperado = payment.payer?.email;

                if (emailEhValido(emailRecuperado)) {
                    email = emailRecuperado;
                    console.log("✅ Email recuperado do pagamento:", email);
                } else {
                    console.error("❌ payer.email também é inválido:", emailRecuperado);
                }
            } catch (err) {
                console.error("❌ Não foi possível recuperar email do pagamento:", err.message);
            }
        }

        if (!emailEhValido(email)) {
            console.error("❌ Abortando: nenhum e-mail válido encontrado.");
            return { sucesso: false, erro: "E-mail inválido" };
        }
    }

    email = email.trim().toLowerCase();
    console.log("📧 Email validado e normalizado:", email);

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

    console.log(`✅ Usuário ${email} ativado com plano ${plan}`);
    console.log(`🔑 Senha: ${senhaTemporaria}`);
    console.log(`📅 Expira em: ${dataExpiracaoStr}`);

    // ================= ENVIAR E-MAIL =================
    try {
        console.log("📧 Enviando e-mail para:", email);

        const dataFormatada = dataExpiracao.toLocaleDateString("pt-BR");
        const planoCapitalizado = plan.charAt(0).toUpperCase() + plan.slice(1);

        await resend.emails.send({
            from: "Karaokê Multiplayer <noreply@karaokemultiplayer.com.br>",
            to: email,
            subject: "✅ Pagamento Confirmado - Acesso Liberado!",
            html: `
            <div style="font-family: Arial; max-width: 600px; margin: 0 auto;">
                <h2>🎤 Pagamento Confirmado!</h2>
                <p>Olá ${email.split('@')[0]}!</p>
                <p>Seu pagamento foi <strong>APROVADO</strong>!</p>
                <p><strong>Plano:</strong> ${planoCapitalizado}</p>
                <p><strong>Valor:</strong> R$ ${valorPlano.toFixed(2).replace('.', ',')}</p>
                <p><strong>Expira em:</strong> ${dataFormatada}</p>
                <p><strong>Sua senha:</strong> <code style="background:#f0f0f0;padding:5px;">${senhaTemporaria}</code></p>
                <a href="https://karaokemultiplayer.com.br/login.html">Acessar</a>
            </div>
            `
        });

        console.log("✅ Email enviado com sucesso!");

    } catch (erroEmail) {
        console.error("❌ Erro ao enviar email:", erroEmail.message);
    }

    return { sucesso: true, email, plan, senha: senhaTemporaria };
}

// ================= WEBHOOK PRINCIPAL =================
module.exports = async (req, res) => {
    console.log("🚀 WEBHOOK FINAL ATIVO v2");
    console.log("📝 Method:", req.method);
    console.log("📝 Origin:", req.headers.origin);

    if (configurarCORS(req, res)) return;

    // 🔥 ACEITAR GET PARA VALIDAÇÃO DO MERCADO PAGO
    if (req.method === 'GET') {
        console.log("🔍 Webhook verificado com sucesso (GET)");
        return res.status(200).json({ 
            status: 'ok', 
            message: 'Webhook ativo e funcionando',
            timestamp: new Date().toISOString()
        });
    }

    if (req.method !== "POST") {
        console.log("⛔ Método não permitido:", req.method);
        return res.status(200).end();
    }

    try {
        console.log("📩 Webhook recebido (POST)");
        console.log("BODY:", JSON.stringify(req.body));

        const action = req.body?.action;
        const type = req.body?.type;
        const topic = req.body?.topic;
        const dataId = req.body?.data?.id;

        console.log("📌 Evento recebido:", { action, type, topic, dataId });

        if (type === "payment" || topic === "payment" || action === "payment.created" || action === "payment.updated") {
            const paymentId = dataId || req.body?.id;

            if (!paymentId) {
                console.log("❌ paymentId não encontrado");
                return res.status(200).end();
            }

            console.log(`🧾 Processando payment ID: ${paymentId}`);

            await ensureTableExists();

            let payment = null;

            for (let i = 0; i < 6; i++) {
                try {
                    console.log(`🔄 Tentativa ${i + 1} de buscar pagamento...`);
                    const response = await mercadopago.payment.findById(paymentId);
                    payment = response.body;
                    if (payment && payment.status) {
                        console.log("✅ Pagamento encontrado");
                        break;
                    }
                } catch (err) {
                    console.log(`⏳ Tentativa ${i + 1} falhou:`, err.message);
                }
                await new Promise(r => setTimeout(r, 2000));
            }

            if (!payment || !payment.status) {
                console.log("❌ Não conseguiu obter pagamento");
                return res.status(200).end();
            }

            console.log("💳 Status pagamento:", payment.status);

            if (payment.status !== "approved") {
                console.log("⏳ Pagamento não aprovado");
                return res.status(200).end();
            }

            console.log("✅ Pagamento aprovado!");

            let email = null;
            let plan = null;

            if (payment.external_reference && payment.external_reference.includes('|')) {
                const parts = payment.external_reference.split('|');
                email = parts[0];
                plan = parts[1];
                console.log("✅ Extraído via pipe:", { email, plan });
            }

            if (!email && payment.metadata) {
                email = payment.metadata.email;
                plan = payment.metadata.plan;
                console.log("✅ Extraído via metadata:", { email, plan });
            }

            if (!email && payment.payer?.email) {
                email = payment.payer.email;
                console.log("✅ Extraído via payer.email:", email);
            }

            if (!plan) {
                plan = extrairPlanoDoValor(payment.transaction_amount);
                console.log("✅ Plano extraído do valor:", plan);
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
        }

        console.log("⛔ Evento ignorado");
        return res.status(200).end();

    } catch (err) {
        console.error("🔥 Erro no webhook:", err);
        return res.status(200).end();
    }
};
