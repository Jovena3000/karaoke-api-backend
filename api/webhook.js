const mercadopago = require('mercadopago');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const fetch = require("node-fetch");

// ===== CONFIG =====
mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ===== FUNÇÃO AUXILIAR PARA CRIAR TABELA DE LOG (se não existir) =====
async function ensureTableExists() {
    const { error } = await supabase
        .from('pagamentos_processados')
        .select('id')
        .limit(1)
        .maybeSingle();
    
    if (error && error.message.includes('does not exist')) {
        console.log('📦 Criando tabela pagamentos_processados...');
        // Criar tabela se não existir
        await supabase.rpc('create_pagamentos_table').catch(async () => {
            // Se a função RPC não existir, criar a tabela via SQL
            const { error: createError } = await supabase
                .from('pagamentos_processados')
                .insert({ id: 'temp' })
                .select();
            if (createError && createError.message.includes('does not exist')) {
                console.log('⚠️ Tabela pagamentos_processados não existe. Continuando sem lock.');
                return false;
            }
        });
    }
    return true;
}

// ================= FUNÇÃO AUXILIAR PARA PROCESSAR PAGAMENTO =================
async function processarPagamentoAprovado(email, plan, paymentId = null, merchantOrderId = null) {
    console.log(`💰 Processando pagamento para ${email}`);
    console.log(`📦 Plano: ${plan}`);
    
    // Definir dias do plano
    let diasPlano = 30;
    if (plan === "trimestral") diasPlano = 90;
    if (plan === "semestral") diasPlano = 180;
    if (plan === "anual") diasPlano = 365;
    
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
    
    // ================= ENVIAR EMAIL =================
    try {
        console.log("📧 Enviando e-mail...");
        
        const dataFormatada = dataExpiracao.toLocaleDateString("pt-BR");
        
        await resend.emails.send({
            from: "Karaokê Multiplayer <noreply@karaokemultiplayer.com.br>",
            to: email,
            subject: "🎤 Sua conta está ativa!",
            html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #FF4D94, #6C63FF); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                    .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
                    .info-box { background: white; padding: 15px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #FF4D94; }
                    .code { background: #e8f5e9; padding: 15px; text-align: center; font-size: 24px; font-family: monospace; border-radius: 5px; color: #2e7d32; }
                    .button { background: #FF4D94; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0; }
                    .footer { text-align: center; padding: 15px; color: #666; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2>🎤 Pagamento Confirmado!</h2>
                        <p>Seu acesso está liberado</p>
                    </div>
                    <div class="content">
                        <h3>Olá ${email.split('@')[0]}!</h3>
                        <p>Recebemos a confirmação do seu pagamento com sucesso.</p>
                        
                        <div class="info-box">
                            <p><strong>📋 Plano:</strong> ${plan}</p>
                            <p><strong>📅 Expira em:</strong> ${dataFormatada}</p>
                        </div>

                        <h3>🔑 SUAS CREDENCIAIS DE ACESSO</h3>
                        <div class="info-box">
                            <p><strong>📧 E-mail:</strong> ${email}</p>
                            <p><strong>🔐 Senha:</strong> <span class="code">${senhaTemporaria}</span></p>
                        </div>
                        
                        <p style="color: #e67e22;"><strong>⚠️ Importante:</strong> Troque sua senha após o primeiro acesso.</p>
                        
                        <div style="text-align: center;">
                            <a href="https://karaokemultiplayer.com.br/login.html" class="button">
                                🎤 ACESSAR KARAOKÊ PREMIUM
                            </a>
                        </div>
                    </div>
                    <div class="footer">
                        <p>© 2026 Karaokê Multiplayer. Todos os direitos reservados.</p>
                    </div>
                </div>
            </body>
            </html>
            `
        });
        
        console.log("✅ Email enviado com sucesso");
        
    } catch (erroEmail) {
        console.error("❌ Erro ao enviar email:", erroEmail.message);
    }
    
    return { sucesso: true, email, plan, senha: senhaTemporaria };
}

module.exports = async (req, res) => {
    console.log("🚀 WEBHOOK FINAL ATIVO");

    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(200).end();
    }

    try {
        console.log("📩 Webhook recebido");
        console.log("BODY:", JSON.stringify(req.body));

        // ================= PEGAR TIPO DO EVENTO =================
        const tipo = req.body?.type || req.query?.type;
        const topic = req.body?.topic;
        
        console.log("📌 Tipo do evento:", { tipo, topic });

                                    
                               
               
        
        // ================= PROCESSAR PAYMENT (fluxo original) =================
        if (tipo && tipo !== "payment") {
            console.log("⛔ Ignorado (não é pagamento):", tipo);
            return res.status(200).end();
        }

        // ================= PEGAR PAYMENT ID =================
        const paymentId = req.body?.data?.id || req.body?.id || req.query?.id;

        if (!paymentId) {
            console.log("❌ paymentId não encontrado");
            return res.status(200).end();
        }

        console.log("🧾 Payment ID:", paymentId);

        // ================= 🔒 LOCK ANTI-DUPLICAÇÃO =================
        await ensureTableExists();
        
        try {
            const { error: lockError } = await supabase
                .from("pagamentos_processados")
                .insert({ id: String(paymentId), processado_em: new Date().toISOString(), tipo: 'payment' });

            if (lockError) {
                console.log("⚠️ Já processado (evitando duplicidade):", paymentId);
                return res.status(200).end();
            }
        } catch (lockErr) {
            console.log("⚠️ Erro no lock, continuando mesmo assim:", lockErr.message);
        }

        // ================= BUSCAR PAGAMENTO (RETRY) =================
        let payment = null;

        for (let i = 0; i < 6; i++) {
            try {
                console.log(`🔄 Tentativa ${i + 1}...`);

                const response = await mercadopago.payment.findById(paymentId);
                payment = response.body;

                if (payment && payment.status) {
                    console.log("✅ Pagamento encontrado");
                    break;
                }
            } catch (err) {
                if (err.status === 404 || (err.message && err.message.includes('404'))) {
                    console.log("⏳ Payment ainda não disponível...");
                } else {
                    console.error("❌ Erro inesperado:", err.message);
                }
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

        console.log("✅ Pagamento aprovado");

        // ================= DADOS DO CLIENTE =================
        if (!payment.external_reference) {
            console.log("❌ external_reference vazio");
            return res.status(200).end();
        }

        const [email, plan] = payment.external_reference.split('|');

if (!email || !plan) {
    console.log("❌ external_reference inválido");
    return res.status(200).end();
}

        if (!email || !plan) {
            console.log("❌ Dados inválidos");
            return res.status(200).end();
        }

        console.log("👤 Cliente:", email);
        console.log("📦 Plano:", plan);

        // ================= PROCESSAR PAGAMENTO =================
        await processarPagamentoAprovado(email, plan, paymentId);

        console.log("🎉 Processo finalizado com sucesso");

        return res.status(200).json({ sucesso: true });

    } catch (err) {
        console.error("🔥 Erro no webhook:", err);
        return res.status(200).end();
    }
};
