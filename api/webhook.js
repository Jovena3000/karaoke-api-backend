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

// ===== FUNÇÃO PARA CONFIGURAR CORS =====
function configurarCORS(req, res) {
    const allowedOrigins = [
        'https://karaokemultiplayer.com.br',
        'https://www.karaokemultiplayer.com.br',
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
    
    // Se for OPTIONS, responde e retorna true
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
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

// ================= FUNÇÃO PARA EXTRAIR PLANO DO VALOR =================
function extrairPlanoDoValor(valor) {
    if (valor === 5.00 || valor === 5) return "mensal";
    if (valor === 49.90 || valor === 49.9) return "trimestral";
    if (valor === 89.90 || valor === 89.9) return "semestral";
    if (valor === 159.90 || valor === 159.9) return "anual";
    return "trimestral";
}

// ================= WEBHOOK PRINCIPAL =================
module.exports = async (req, res) => {
    console.log("🚀 WEBHOOK FINAL ATIVO");
    console.log("📝 Method:", req.method);
    console.log("📝 Origin:", req.headers.origin);

    // Configurar CORS (se for OPTIONS, já responde)
    if (configurarCORS(req, res)) {
        return;
    }

    if (req.method !== "POST") {
        return res.status(200).end();
    }

    try {
        console.log("📩 Webhook recebido");
        console.log("BODY:", JSON.stringify(req.body));

        // ================= PEGAR TIPO DO EVENTO =================
        const action = req.body?.action;
        const type = req.body?.type;
        const topic = req.body?.topic;
        const dataId = req.body?.data?.id;
        
        console.log("📌 Evento recebido:", { action, type, topic, dataId });

        // ================= PROCESSAR PAYMENT (PIX e CARTÃO) =================
        if (type === "payment" || topic === "payment" || action === "payment.created" || action === "payment.updated") {
            const paymentId = dataId || req.body?.id;
            
            if (!paymentId) {
                console.log("❌ paymentId não encontrado");
                return res.status(200).end();
            }
            
            console.log(`🧾 Processando payment ID: ${paymentId}`);
            
            // 🔒 LOCK ANTI-DUPLICAÇÃO
            await ensureTableExists();
            
            try {
                const { error: lockError } = await supabase
                    .from("pagamentos_processados")
                    .insert({ 
                        id: String(paymentId), 
                        processado_em: new Date().toISOString(), 
                        tipo: 'payment',
                        payment_id: paymentId
                    });
                
                if (lockError && lockError.code === '23505') {
                    console.log("⚠️ Pagamento já processado (evitando duplicidade):", paymentId);
                    return res.status(200).end();
                }
            } catch (lockErr) {
                console.log("⚠️ Erro no lock, continuando:", lockErr.message);
            }
            
            // Buscar detalhes do pagamento
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
                    if (err.status === 404 || (err.message && err.message.includes('404'))) {
                        console.log("⏳ Payment ainda não disponível, aguardando...");
                    } else {
                        console.error("❌ Erro inesperado:", err.message);
                    }
                }
                await new Promise(r => setTimeout(r, 2000));
            }
            
            if (!payment || !payment.status) {
                console.log("❌ Não conseguiu obter pagamento após tentativas");
                return res.status(200).end();
            }
            
            console.log("💳 Status pagamento:", payment.status);
            console.log("💳 Método pagamento:", payment.payment_method_id);
            console.log("💳 Valor:", payment.transaction_amount);
            
            if (!(payment.status === "approved" && payment.status_detail === "accredited")) {
    console.log("⏳ Pagamento ainda não confirmado totalmente");
    return res.status(200).end();
}

console.log("✅ Pagamento confirmado de verdade");
            
            // Extrair email
            let email = null;
            let plan = null;
            
            if (payment.external_reference) {
    if (payment.external_reference.includes('|')) {
        const parts = payment.external_reference.split('|');
        email = parts[0];
        plan = parts[1];
    } else {
        try {
            const ref = JSON.parse(payment.external_reference);
            email = ref.email;
            plan = ref.plan;
        } catch (e) {
            console.log("⚠️ external_reference inválido");
        }
    }
}
            
            if (!email && payment.payer?.email) {
                email = payment.payer.email;
            }
            
            if (!email) {
                console.log("❌ Não foi possível extrair o email do pagamento");
                return res.status(200).end();
            }
            
            if (!plan) {
                plan = extrairPlanoDoValor(payment.transaction_amount);
            }
            
            console.log("👤 Cliente:", email);
            console.log("📦 Plano:", plan);
            console.log("💳 Método:", payment.payment_method_id === 'pix' ? 'PIX' : 'Cartão');
            
            await processarPagamentoAprovado(email, plan, paymentId);
            
            await supabase
                .from("pagamentos_processados")
                .update({ email: email })
                .eq("id", String(paymentId));
            
            console.log("🎉 Pagamento processado com sucesso!");
            return res.status(200).json({ sucesso: true });
        }
        
        // ================= PROCESSAR MERCHANT_ORDER =================
        if (topic === "merchant_order" || type === "merchant_order") {
            console.log("📦 Processando merchant_order...");
            
            const resourceUrl = req.body?.resource;
            const merchantOrderId = resourceUrl?.split('/').pop() || req.body?.id;
            
            if (!merchantOrderId) {
                console.log("❌ merchantOrderId não encontrado");
                return res.status(200).end();
            }
            
            try {
                const response = await fetch(`https://api.mercadopago.com/merchant_orders/${merchantOrderId}`, {
                    headers: {
                        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
                    }
                });
                const merchantOrder = await response.json();
                
                if (merchantOrder.status !== 'closed') {
                    console.log("⏳ Merchant order não fechado");
                    return res.status(200).end();
                }
                
                let email = merchantOrder?.payer?.email;
                
                if (!email) {
                    console.log("❌ Email não encontrado");
                    return res.status(200).end();
                }
                
                const valor = merchantOrder?.total_amount || 0;
                const plan = extrairPlanoDoValor(valor);
                
                console.log(`✅ Merchant order processado para ${email} | Plano: ${plan}`);
                
                await processarPagamentoAprovado(email, plan, null, merchantOrderId);
                
                console.log("🎉 Merchant order processado com sucesso");
                return res.status(200).json({ sucesso: true });
                
            } catch (err) {
                console.error("❌ Erro ao processar merchant_order:", err);
                return res.status(200).end();
            }
        }
        
        console.log("⛔ Evento ignorado");
        return res.status(200).end();
        
    } catch (err) {
        console.error("🔥 Erro no webhook:", err);
        return res.status(200).end();
    }
};
