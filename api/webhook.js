// webhook.js - VERSÃO COMPLETA, CORRIGIDA E OTIMIZADA
const mercadopago = require('mercadopago');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

console.log("TOKEN WEBHOOK:", process.env.MP_ACCESS_TOKEN ? "Configurado" : "❌ FALTANDO");

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
    if (valor === 21.90 || valor === 21.9) return "mensal";
    if (valor === 59.90 || valor === 59.9) return "trimestral";
    if (valor === 99.90 || valor === 99.9) return "semestral";
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
    console.log(`💳 Processando pagamento para ${email}`);

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

    // Configuração dos planos
    let diasPlano = 30;
    let valorPlano = 21.90;
    if (plan === "trimestral") { diasPlano = 90; valorPlano = 59.90; }
    if (plan === "semestral") { diasPlano = 180; valorPlano = 99.90; }
    if (plan === "anual") { diasPlano = 365; valorPlano = 159.90; }

    const { data: usuarioExistente } = await supabase
        .from("usuarios")
        .select("*")
        .eq("email", email)
        .maybeSingle();

    let senhaTemporaria = null;
    let dataExpiracaoFinal = new Date();

    if (usuarioExistente) {
        // ================= USUÁRIO JÁ EXISTE (RENOVAÇÃO OU REATIVAÇÃO) =================
        console.log("🔄 Atualizando usuário existente (Renovação/Reativação)");

        // 1. Calcular a nova data de expiração somando os dias do plano
        const hoje = new Date();
        const dataExpiracaoAtual = new Date(usuarioExistente.data_expiracao);

        // Se a data atual for maior que hoje (ainda tem saldo), somamos a partir dela.
        // Se já venceu, somamos a partir de hoje.
        if (dataExpiracaoAtual > hoje) {
            dataExpiracaoFinal = new Date(dataExpiracaoAtual);
            dataExpiracaoFinal.setDate(dataExpiracaoFinal.getDate() + diasPlano);
        } else {
            dataExpiracaoFinal.setDate(hoje.getDate() + diasPlano);
        }
        
        const dataExpiracaoStr = dataExpiracaoFinal.toISOString().split('T')[0];

        // 2. Atualizar o banco (SEM MEXER NA SENHA!)
        await supabase
            .from("usuarios")
            .update({
                plano: plan,
                status: "ativo",
                data_expiracao: dataExpiracaoStr,
                ultimo_pagamento: new Date().toISOString(),
                updated_at: new Date().toISOString()
                // 🚨 NÃO ATUALIZAMOS A SENHA AQUI PARA NÃO QUEBRAR O ACESSO DO CLIENTE
            })
            .eq("email", email);

        // 3. (OPCIONAL) Se você baniu o usuário na tabela auth.users do Supabase, descomente a linha abaixo:
        // await supabase.auth.admin.updateUserById(usuarioExistente.auth_id, { ban_duration: 'none' });

        console.log(`✅ Usuário ${email} reativado com plano ${plan} até ${dataExpiracaoStr}`);

        // 4. Enviar e-mail de RENOVAÇÃO (Sem senha nova)
        try {
            console.log("📧 Enviando e-mail de renovação para:", email);
            const dataFormatada = dataExpiracaoFinal.toLocaleDateString("pt-BR");
            const planoCapitalizado = plan.charAt(0).toUpperCase() + plan.slice(1);

            await resend.emails.send({
                from: "Karaokê Multiplayer <noreply@karaokemultiplayer.com.br>",
                to: email,
                subject: "✅ Renovação Confirmada - Acesso Liberado!",
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
                    .button { background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0; font-weight: bold; }
                    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="header">
                      <img src="https://uploads.onecompiler.io/43v37pq3s/1783903529895/karaokeM01%20(1).png" alt="Karaokê Multiplayer">
                      <h1>🎤 Renovação Confirmada!</h1>
                      <p>Seu acesso ao Karaokê Multiplayer Premium foi renovado</p>
                    </div>
                    
                    <div class="content">
                      <h2>Olá ${email.split('@')[0]}!</h2>
                      <p>Recebemos a confirmação do seu pagamento e sua assinatura foi renovada com sucesso.</p>
                      
                      <p><strong>📋 Plano:</strong> ${planoCapitalizado}</p>
                      <p><strong>💳 Valor:</strong> R$ ${valorPlano.toFixed(2).replace('.', ',')}</p>
                      <p><strong>📅 Nova Data de Expiração:</strong> ${dataFormatada}</p>
                      
                      <p style="margin-top: 20px;">Você pode continuar usando suas credenciais de acesso atuais. Não é necessário trocar a senha.</p>
                      
                      <div style="text-align: center;">
                        <a href="https://karaokemultiplayer.com.br/login.html" class="button">ACESSAR KARAOKÊ</a>
                      </div>
                      
                      <p style="margin-top: 20px;">Qualquer dúvida, responda a este e-mail ou entre em contato com nosso suporte.</p>
                    </div>
                    
                    <div class="footer">
                      <p>© ${new Date().getFullYear()} Karaokê Multiplayer. Todos os direitos reservados.</p>
                    </div>
                  </div>
                </body>
                </html>
                `
            });
            console.log("✉️ E-mail de renovação enviado com sucesso!");
        } catch (erroEmail) {
            console.error("❌ Erro ao enviar email de renovação:", erroEmail.message);
        }

        return { sucesso: true, email, plan, tipo: 'renovacao' };

    } else {
        // ================= NOVO USUÁRIO (PRIMEIRA COMPRA) =================
        console.log("🆕 Criando novo usuário");
        
        senhaTemporaria = Math.random().toString(36).slice(-8);
        const senhaHash = await bcrypt.hash(senhaTemporaria, 10);
        
        dataExpiracaoFinal.setDate(dataExpiracaoFinal.getDate() + diasPlano);
        const dataExpiracaoStr = dataExpiracaoFinal.toISOString().split('T')[0];

        await supabase
            .from("usuarios")
            .insert({
                email,
                senha_hash: senhaHash, // Só cria senha para usuário NOVO
                nome: email.split('@')[0],
                plano: plan,
                status: "ativo",
                data_expiracao: dataExpiracaoStr,
                ultimo_pagamento: new Date().toISOString(),
                created_at: new Date().toISOString()
            });

        console.log(`✅ Novo usuário ${email} criado com plano ${plan}`);
        console.log(`🔑 Senha: ${senhaTemporaria}`);
        console.log(`📅 Expira em: ${dataExpiracaoStr}`);

        // ================= ENVIAR E-MAIL DE BOAS-VINDAS =================
        try {
            console.log("📧 Enviando e-mail de boas-vindas para:", email);
            const dataFormatada = dataExpiracaoFinal.toLocaleDateString("pt-BR");
            const planoCapitalizado = plan.charAt(0).toUpperCase() + plan.slice(1);

            await resend.emails.send({
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
                      <img src="https://uploads.onecompiler.io/43v37pq3s/1783903529895/karaokeM01%20(1).png" alt="Karaokê Multiplayer">
                      <h1>🎤 Pagamento Confirmado!</h1>
                      <p>Seu acesso ao Karaokê Multiplayer Premium está liberado</p>
                    </div>
                    
                    <div class="content">
                      <h2>Olá ${email.split('@')[0]}!</h2>
                      <p>Recebemos a confirmação do seu pagamento com sucesso. Aqui estão os detalhes da sua compra:</p>
                      
                      <p><strong>📋 Plano:</strong> ${planoCapitalizado}</p>
                      <p><strong>💳 Valor:</strong> R$ ${valorPlano.toFixed(2).replace('.', ',')}</p>
                      <p><strong>📅 Expira em:</strong> ${dataFormatada}</p>
                      
                      <div class="credential-box">
                        <h3 style="margin-top: 0;">🔑 SUAS CREDENCIAIS DE ACESSO</h3>
                        <p><strong>E-mail:</strong> ${email}</p>
                        <p><strong>Senha temporária:</strong></p>
                        <div class="senha">${senhaTemporaria}</div>
                        <p style="color: #e67e22; margin-top: 15px;">⚠️ Recomendamos trocar sua senha após o primeiro acesso</p>
                      </div>
                      
                      <div style="text-align: center;">
                        <a href="https://karaokemultiplayer.com.br/login.html" class="button">ACESSAR KARAOKÊ</a>
                      </div>
                      
                      <p style="margin-top: 20px;">Qualquer dúvida, responda a este e-mail ou entre em contato com nosso suporte.</p>
                    </div>
                    
                    <div class="footer">
                      <p>© ${new Date().getFullYear()} Karaokê Multiplayer. Todos os direitos reservados.</p>
                    </div>
                  </div>
                </body>
                </html>
                `
            });

            console.log("✉️ Email de boas-vindas enviado com sucesso!");

        } catch (erroEmail) {
            console.error("❌ Erro ao enviar email de boas-vindas:", erroEmail.message);
        }

        return { sucesso: true, email, plan, senha: senhaTemporaria, tipo: 'novo' };
    }
}

// ================= WEBHOOK PRINCIPAL =================
module.exports = async (req, res) => {
    console.log("🚀 WEBHOOK FINAL ATIVO v3");
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
                    console.log(`⏱ Tentativa ${i + 1} falhou:`, err.message);
                }
                await new Promise(r => setTimeout(r, 2000));
            }

            if (!payment || !payment.status) {
                console.log("❌ Não conseguiu obter pagamento");
                return res.status(200).end();
            }

            console.log("💰 Status pagamento:", payment.status);

            if (payment.status !== "approved") {
                console.log("⏱ Pagamento não aprovado");
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
