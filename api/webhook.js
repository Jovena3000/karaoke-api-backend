// webhook.js - VERSÃO CORRIGIDA v2
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
        res.setHeader('Access-Control-Allow-Origin', 'https://karaokemultiplayer.com.br');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

    // Rejeita e-mails gerados automaticamente pelo Mercado Pago
    const emailsFakes = ['testuser', 'test_user', 'noreply', 'no-reply', '@mercadopago', '@mercadolivre'];
    if (emailsFakes.some(str => email.toLowerCase().includes(str))) {
        console.warn("⚠️ E-mail parece ser gerado automaticamente pelo MP:", email);
        return false;
    }

    // Valida formato básico com regex
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

        // Tenta recuperar do pagamento
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

    // Limpar e normalizar email
    email = email.trim().toLowerCase();
    console.log("📧 Email validado e normalizado:", email);

    // Definir dias do plano
    let diasPlano = 30;
    let valorPlano = 5.00;
    if (plan === "trimestral") { diasPlano = 90; valorPlano = 49.90; }
    if (plan === "semestral") { diasPlano = 180; valorPlano = 89.90; }
    if (plan === "anual") { diasPlano = 365; valorPlano = 159.90; }

    // Gerar senha
    const senhaTemporaria = Math.random().toString(36).slice(-8);
    const senhaHash = await bcrypt.hash(senhaTemporaria, 10);

    // Data de expiração
    const dataExpiracao = new Date();
    dataExpiracao.setDate(dataExpiracao.getDate() + diasPlano);
    const dataExpiracaoStr = dataExpiracao.toISOString().split('T')[0];

    // Verificar se usuário já existe
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
        console.log("📧 TIPO DO EMAIL:", typeof email);
        console.log("📧 TAMANHO:", email.length);

        const dataFormatada = dataExpiracao.toLocaleDateString("pt-BR");
        const planoCapitalizado = plan.charAt(0).toUpperCase() + plan.slice(1);

        const emailResult = await resend.emails.send({
            from: "Karaokê Multiplayer <noreply@karaokemultiplayer.com.br>",
            to: email,
            subject: "✅ Pagamento Confirmado - Acesso Liberado!",
            html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                    .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 10px 10px; }
                    .credential-box { background: #e8f5e9; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center; }
                    .senha { font-size: 28px; font-weight: bold; color: #2e7d32; letter-spacing: 2px; font-family: monospace; }
                    .button { background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0; font-weight: bold; }
                    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🎤 Pagamento Confirmado!</h1>
                        <p>Seu acesso ao Karaokê Multiplayer Premium está liberado</p>
                    </div>
                    <div class="content">
                        <h2>Olá ${email.split('@')[0]}!</h2>
                        <p>Recebemos a confirmação do seu pagamento com sucesso.</p>
                        
                        <p><strong>📋 Plano:</strong> Plano ${planoCapitalizado}</p>
                        <p><strong>💰 Valor:</strong> R$ ${valorPlano.toFixed(2).replace('.', ',')}</p>
                        <p><strong>📅 Expira em:</strong> ${dataFormatada}</p>
                        
                        <div class="credential-box">
                            <h3 style="margin-top: 0;">🔑 SUAS CREDENCIAIS DE ACESSO</h3>
                            <p><strong>E-mail:</strong> ${email}</p>
                            <p><strong>Senha temporária:</strong></p>
                            <div class="senha">${senhaTemporaria}</div>
                            <p style="color: #e67e22; margin-top: 15px;">⚠️ Recomendamos trocar sua senha após o primeiro acesso</p>
                        </div>
                        
                        <div style="text-align: center;">
                            <a href="https://karaokemultiplayer.com.br/login.html" class="button">🎤 ACESSAR KARAOKÊ</a>
                        </div>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} Karaokê Multiplayer. Todos os direitos reservados.</p>
                    </div>
                </div>
            </body>
            </html>
            `
        });

        console.log("✅ Email enviado com sucesso! ID:", emailResult?.id);

    } catch (erroEmail) {
        console.error("❌ Erro ao enviar email:", erroEmail.message);
        console.error("📧 Email que causou erro:", email);
        // Não lança o erro — o usuário já foi criado/atualizado no banco
    }

    return { sucesso: true, email, plan, senha: senhaTemporaria };
}

// ================= WEBHOOK PRINCIPAL =================
module.exports = async (req, res) => {
    console.log("🚀 WEBHOOK FINAL ATIVO v2");
    console.log("📝 Method:", req.method);
    console.log("📝 Origin:", req.headers.origin);

    if (configurarCORS(req, res)) return;

    if (req.method !== "POST") {
        return res.status(200).end();
    }

    try {
        console.log("📩 Webhook recebido");
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

            // Buscar pagamento com retentativas
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
                console.log("❌ Não conseguiu obter pagamento após todas as tentativas");
                return res.status(200).end();
            }

            // 🔍 LOG COMPLETO DO PAGAMENTO PARA DEBUG
            console.log("🔍 PAYMENT DEBUG:", JSON.stringify({
                status: payment.status,
                external_reference: payment.external_reference,
                metadata: payment.metadata,
                payer: payment.payer,
                transaction_amount: payment.transaction_amount
            }, null, 2));

            console.log("💳 Status pagamento:", payment.status);

            if (payment.status !== "approved") {
                console.log("⏳ Pagamento não aprovado. Status:", payment.status);
                return res.status(200).end();
            }

            console.log("✅ Pagamento aprovado!");

            // Extrair email e plano — ordem de prioridade
            let email = null;
            let plan = null;

            // 1️⃣ Prioridade máxima: external_reference com pipe
            if (payment.external_reference && payment.external_reference.includes('|')) {
                const parts = payment.external_reference.split('|');
                const emailCandidate = parts[0]?.trim();
                const planCandidate = parts[1]?.trim();

                if (emailEhValido(emailCandidate)) {
                    email = emailCandidate;
                    plan = planCandidate;
                    console.log("✅ [1] Extraído via external_reference pipe:", { email, plan });
                } else {
                    console.warn("⚠️ [1] external_reference tem pipe mas email inválido:", emailCandidate);
                }
            }

            // 2️⃣ external_reference sem pipe (só o e-mail)
            if (!email && payment.external_reference && emailEhValido(payment.external_reference.trim())) {
                email = payment.external_reference.trim();
                console.log("✅ [2] Extraído via external_reference (só email):", email);
            }

            // 3️⃣ metadata
            if (!email && payment.metadata?.email && emailEhValido(payment.metadata.email)) {
                email = payment.metadata.email;
                plan = plan || payment.metadata.plan;
                console.log("✅ [3] Extraído via metadata:", { email, plan });
            }

            // 4️⃣ payer.email (menos confiável — pode vir mascarado pelo MP)
            if (!email && payment.payer?.email && emailEhValido(payment.payer.email)) {
                email = payment.payer.email;
                console.log("✅ [4] Extraído via payer.email:", email);
            }

            // Fallback de plano pelo valor
            if (!plan) {
                plan = extrairPlanoDoValor(payment.transaction_amount);
                console.log("✅ Plano extraído do valor da transação:", plan);
            }

            if (!email) {
                console.log("❌ Email não encontrado em nenhuma fonte. Abortando.");
                return res.status(200).end();
            }

            console.log(`👤 Cliente: ${email}`);
            console.log(`📦 Plano: ${plan}`);

            await processarPagamentoAprovado(email, plan, paymentId);

            console.log("🎉 Pagamento processado com sucesso!");
            return res.status(200).json({ sucesso: true });
        }

        console.log("⛔ Evento ignorado:", { action, type, topic });
        return res.status(200).end();

    } catch (err) {
        console.error("🔥 Erro no webhook:", err);
        return res.status(200).end();
    }
};
