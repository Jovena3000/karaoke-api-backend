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

// ===== FUNÇÃO AUXILIAR PARA CRIAR TABELA DE LOG (se não existir) =====
async function ensureTableExists() {
    const { error } = await supabase
        .from('pagamentos_processados')
        .select('id')
        .limit(1)
        .maybeSingle();
    
    if (error && error.message.includes('does not exist')) {
        console.log('📦 Criando tabela pagamentos_processados...');
        await supabase.rpc('create_pagamentos_table').catch(async () => {
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
        'http://localhost:3000',
        'http://localhost:5173'
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

// ================= FUNÇÃO PARA VALIDAR E-MAIL =================
function isValidEmail(email) {
    if (!email) return false;
    if (typeof email !== 'string') return false;
    if (email === 'undefined' || email === 'null') return false;
    if (email.trim() === '') return false;
    if (!email.includes('@')) return false;
    if (email.split('@').length !== 2) return false;
    return true;
}

// ================= FUNÇÃO AUXILIAR PARA PROCESSAR PAGAMENTO =================
async function processarPagamentoAprovado(email, plan, paymentId = null, merchantOrderId = null) {
    console.log(`💰 Processando pagamento para ${email}`);
    console.log(`📦 Plano: ${plan}`);
    
    // 🔧 VALIDAÇÃO DO E-MAIL
    const emailValido = isValidEmail(email);
    if (!emailValido) {
        console.error(`❌ E-mail inválido: "${email}" - Não será enviado e-mail, mas o usuário será criado no banco`);
    } else {
        console.log(`✅ E-mail válido: ${email}`);
    }
    
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
    let usuarioExistente = null;
    if (emailValido) {
        const { data } = await supabase
            .from("usuarios")
            .select("*")
            .eq("email", email)
            .maybeSingle();
        usuarioExistente = data;
    }
    
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
    } else if (emailValido) {
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
    } else {
        console.log("⚠️ E-mail inválido, usuário NÃO foi criado no banco");
    }
    
    if (emailValido) {
        console.log(`✅ Usuário ${email} ativado com plano ${plan}`);
        console.log(`🔑 Senha: ${senhaTemporaria}`);
        console.log(`📅 Expira em: ${dataExpiracaoStr}`);
    }
    
    // ================= ENVIAR EMAIL (APENAS SE EMAIL FOR VÁLIDO) =================
    if (emailValido) {
        try {
            console.log("📧 Enviando e-mail para:", email);
            
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
            
            console.log("✅ Email enviado com sucesso para:", email);
            
        } catch (erroEmail) {
            console.error("❌ Erro ao enviar email:", erroEmail.message);
            console.error("📧 Email que causou erro:", email);
        }
    } else {
        console.log("⚠️ E-mail inválido, e-mail NÃO foi enviado.");
    }
    
    return { sucesso: true, email, plan, senha: senhaTemporaria, emailEnviado: emailValido };
}

// ================= WEBHOOK PRINCIPAL =================
module.exports = async (req, res) => {
    console.log("🚀 WEBHOOK FINAL ATIVO");
    console.log("📝 Method:", req.method);

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
            console.log("💳 Status detalhe:", payment.status_detail);
            console.log("💳 Método pagamento:", payment.payment_method_id);
            console.log("💳 Valor:", payment.transaction_amount);
            console.log("🔑 external_reference:", payment.external_reference);
            
            if (payment.status !== "approved") {
                console.log("⏳ Pagamento ainda não aprovado. Status:", payment.status);
                return res.status(200).end();
            }
            
            console.log("✅ Pagamento aprovado!");
            
            // ========== EXTRAIR EMAIL E PLANO ==========
            let email = null;
            let plan = null;
            
            // Tentativa 1: external_reference
            if (payment.external_reference) {
                console.log("📦 external_reference encontrado:", payment.external_reference);
                
                if (payment.external_reference.includes('|')) {
                    const parts = payment.external_reference.split('|');
                    email = parts[0];
                    plan = parts[1];
                    console.log("✅ Extraído via pipe:", { email, plan });
                } else {
                    try {
                        const ref = JSON.parse(payment.external_reference);
                        email = ref.email;
                        plan = ref.plan;
                        console.log("✅ Extraído via JSON:", { email, plan });
                    } catch (e) {
                        console.log("⚠️ external_reference não é JSON válido:", e.message);
                    }
                }
            } else {
                console.log("⚠️ external_reference está VAZIO!");
            }
            
            // Tentativa 2: metadata
            if (!email && payment.metadata) {
                email = payment.metadata.email;
                plan = payment.metadata.plan;
                console.log("✅ Extraído via metadata:", { email, plan });
            }
            
            // Tentativa 3: payer.email
            if (!email && payment.payer?.email) {
                email = payment.payer.email;
                console.log("✅ Extraído via payer.email:", email);
            }
            
            // Tentativa 4: extrair plano do valor
            if (!plan) {
                plan = extrairPlanoDoValor(payment.transaction_amount);
                console.log("✅ Plano extraído do valor:", plan);
            }
            
            // Validação final do email
            if (!email) {
                console.log("❌ Não foi possível extrair o email do pagamento!");
                console.log("📦 Dados disponíveis:", {
                    external_reference: payment.external_reference,
                    metadata: payment.metadata,
                    payer_email: payment.payer?.email
                });
                // Continua mesmo sem email? Não, pois precisa do email para salvar
                return res.status(200).end();
            }
            
            // Garantir que email é string
            email = String(email).trim();
            
            console.log("========== DADOS FINAIS ==========");
            console.log("👤 Cliente email:", email);
            console.log("📦 Plano:", plan);
            console.log("💳 Método:", payment.payment_method_id === 'pix' ? 'PIX' : 'Cartão');
            console.log("=================================");
            
            await processarPagamentoAprovado(email, plan, paymentId);
            
            await supabase
                .from("pagamentos_processados")
                .update({ email: email })
                .eq("id", String(paymentId));
            
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
