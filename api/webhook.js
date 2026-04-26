// webhook.js - VERSÃO COMPLETA DEFINITIVA
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
    try {
        const { error } = await supabase
            .from('pagamentos_processados')
            .select('id')
            .limit(1)
            .maybeSingle();
        
        if (error && error.message.includes('does not exist')) {
            console.log('📦 Tabela pagamentos_processados não existe. Continuando sem lock.');
        }
    } catch (error) {
        console.log('⚠️ Erro ao verificar tabela:', error.message);
    }
    return true;
}

// ===== FUNÇÃO PARA CONFIGURAR CORS =====
function configurarCORS(req, res) {
    const allowedOrigins = [
        'https://karaokemultiplayer.com.br',
        'https://www.karaokemultiplayer.com.br',
        'https://karaoke-multiplayer.pages.dev',
        'http://localhost:3000',
        'http://localhost:8080'
    ];
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
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
    const valorNum = parseFloat(valor);
    if (valorNum === 5.00 || valorNum === 5) return "mensal";
    if (valorNum === 49.90 || valorNum === 49.9) return "trimestral";
    if (valorNum === 89.90 || valorNum === 89.9) return "semestral";
    if (valorNum === 159.90 || valorNum === 159.9) return "anual";
    return "mensal";
}

// ================= VALIDAÇÃO DE E-MAIL =================
function emailEhValido(email) {
    if (!email) return false;
    if (typeof email !== 'string') return false;
    if (email === 'undefined' || email === 'null') return false;
    if (email.trim() === '') return false;
    if (!email.includes('@')) return false;

    const emailsFakes = [
        'testuser', 'test_user', 'noreply', 'no-reply', 
        '@mercadopago', '@mercadolivre', 'payment@mercadopago',
        'payment.mercadopago', 'email@email.com'
    ];
    if (emailsFakes.some(str => email.toLowerCase().includes(str))) {
        console.warn("⚠️ E-mail parece ser gerado automaticamente pelo MP:", email);
        return false;
    }

    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email.trim());
}

// ================= FUNÇÃO PARA BUSCAR EMAIL DIRETO DA API =================
async function buscarEmailDiretoDoMP(paymentId) {
    try {
        console.log(`🔍 Buscando email diretamente do MP para payment ${paymentId}...`);
        
        const accessToken = process.env.MP_ACCESS_TOKEN;
        const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        
        const payment = await response.json();
        console.log("📡 Resposta direta da API MP:", JSON.stringify({
            id: payment.id,
            status: payment.status,
            payer_email: payment.payer?.email,
            external_reference: payment.external_reference
        }, null, 2));
        
        return payment.payer?.email || null;
        
    } catch (error) {
        console.error("❌ Erro ao buscar email direto do MP:", error.message);
        return null;
    }
}

// ================= FUNÇÃO PRINCIPAL DE PROCESSAMENTO =================
async function processarPagamentoAprovado(email, plan, paymentId = null, paymentData = null) {
    console.log(`💰 Processando pagamento para ${email}`);
    console.log(`📦 Plano: ${plan}`);

    if (!emailEhValido(email)) {
        console.error("❌ E-mail inválido recebido:", email);

        if (paymentData && paymentData.payer?.email) {
            const emailRecuperado = paymentData.payer.email;
            if (emailEhValido(emailRecuperado)) {
                email = emailRecuperado;
                console.log("✅ Email recuperado do paymentData:", email);
            }
        }
        
        if (!emailEhValido(email) && paymentId) {
            try {
                const response = await mercadopago.payment.findById(paymentId);
                const payment = response.body;
                const emailRecuperado = payment.payer?.email;

                if (emailEhValido(emailRecuperado)) {
                    email = emailRecuperado;
                    console.log("✅ Email recuperado do pagamento via API:", email);
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
        const { error: updateError } = await supabase
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
            
        if (updateError) {
            console.error("❌ Erro ao atualizar usuário:", updateError);
        } else {
            console.log("✅ Usuário atualizado com sucesso");
        }
    } else {
        console.log("🆕 Criando novo usuário");
        const { error: insertError } = await supabase
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
            
        if (insertError) {
            console.error("❌ Erro ao criar usuário:", insertError);
        } else {
            console.log("✅ Usuário criado com sucesso");
        }
    }

    console.log(`✅ Usuário ${email} ativado com plano ${plan}`);
    console.log(`🔑 Senha: ${senhaTemporaria}`);
    console.log(`📅 Expira em: ${dataExpiracaoStr}`);

    // ================= ENVIAR E-MAIL =================
    try {
        console.log("📧 Enviando e-mail para:", email);

        if (!process.env.RESEND_API_KEY) {
            console.error("❌ RESEND_API_KEY não está configurada!");
        } else {
            const dataFormatada = dataExpiracao.toLocaleDateString("pt-BR");
            const planoCapitalizado = plan.charAt(0).toUpperCase() + plan.slice(1);

            const emailResult = await resend.emails.send({
                from: "Karaokê Multiplayer <onboarding@resend.dev>",
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
        }
    } catch (erroEmail) {
        console.error("❌ Erro ao enviar email:", erroEmail.message);
    }

    return { sucesso: true, email, plan, senha: senhaTemporaria };
}

// ================= WEBHOOK PRINCIPAL =================
module.exports = async (req, res) => {
    console.log("🚀 WEBHOOK FINAL ATIVO v5");
    console.log("📝 Method:", req.method);
    console.log("📝 Origin:", req.headers.origin);

    if (configurarCORS(req, res)) return;

    if (req.method !== "POST") {
        return res.status(200).end();
    }

    try {
        const body = req.body;
        console.log("📩 Webhook recebido");
        console.log("BODY:", JSON.stringify(body, null, 2));

        const action = body?.action;
        const type = body?.type;
        const topic = body?.topic;
        const dataId = body?.data?.id;

        console.log("📌 Evento recebido:", { action, type, topic, dataId });

        const isPaymentEvent = (type === "payment" || topic === "payment" || 
                                 action === "payment.created" || action === "payment.updated");
        
        if (isPaymentEvent) {
            const paymentId = dataId || body?.id;

            if (!paymentId) {
                console.log("❌ paymentId não encontrado");
                return res.status(200).json({ received: true });
            }

            console.log(`🧾 Processando payment ID: ${paymentId}`);

            await ensureTableExists();

            let payment = null;

            for (let i = 0; i < 5; i++) {
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
                return res.status(200).json({ received: true });
            }

            console.log("🔍 PAYMENT DEBUG:", JSON.stringify({
                id: payment.id,
                status: payment.status,
                transaction_amount: payment.transaction_amount,
                payer_email: payment.payer?.email,
                external_reference: payment.external_reference,
                metadata: payment.metadata
            }, null, 2));

            console.log("💳 Status pagamento:", payment.status);

            if (payment.status !== "approved") {
                console.log("⏳ Pagamento não aprovado. Status:", payment.status);
                return res.status(200).json({ received: true });
            }

            console.log("✅ Pagamento aprovado!");

            let email = null;
            let plan = null;

            if (payment.payer?.email && emailEhValido(payment.payer.email)) {
                email = payment.payer.email;
                console.log("✅ [1] Email encontrado no payer.email:", email);
            }

            if (!email && payment.external_reference && emailEhValido(payment.external_reference)) {
                email = payment.external_reference;
                console.log("✅ [2] Email encontrado no external_reference:", email);
            }

            if (!email && payment.metadata?.email && emailEhValido(payment.metadata.email)) {
                email = payment.metadata.email;
                plan = plan || payment.metadata.plan;
                console.log("✅ [3] Email encontrado no metadata:", email);
            }

            if (!email && payment.description) {
                const emailMatch = payment.description.match(/[\w\.-]+@[\w\.-]+\.\w+/);
                if (emailMatch && emailEhValido(emailMatch[0])) {
                    email = emailMatch[0];
                    console.log("✅ [4] Email encontrado na description:", email);
                }
            }

            if (!plan) {
                plan = extrairPlanoDoValor(payment.transaction_amount);
                console.log("✅ Plano extraído do valor:", plan);
            }

            if (!email) {
                console.error("❌ Email não encontrado em nenhuma fonte.");
                return res.status(200).json({ received: true, error: "Email not found" });
            }

            console.log(`👤 Cliente: ${email}`);
            console.log(`📦 Plano: ${plan}`);

            await processarPagamentoAprovado(email, plan, paymentId, payment);

            console.log("🎉 Pagamento processado com sucesso!");
            return res.status(200).json({ sucesso: true });
        }

        console.log("⛔ Evento ignorado:", { action, type, topic });
        return res.status(200).json({ received: true });

    } catch (err) {
        console.error("🔥 Erro no webhook:", err);
        return res.status(200).json({ received: true, error: err.message });
    }
};
