// webhook.js
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

// ===== CORS =====
function configurarCORS(req, res) {
    const allowedOrigins = [
        'https://karaokemultiplayer.com.br',
        'https://www.karaokemultiplayer.com.br',
        'https://karaoke-multiplayer.pages.dev',
        'http://localhost:3000',
        'http://localhost:5173'
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

    // 🔥 ESSENCIAL PRA NÃO QUEBRAR NO VERCEL
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }

    return false;
}
// ===== FUNÇÃO AUXILIAR PARA CRIAR TABELA DE LOG =====
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

// ================= FUNÇÃO PRINCIPAL DE PROCESSAMENTO =================
async function processarPagamentoAprovado(email, plan, paymentId = null) {
    console.log(`💰 Processando pagamento para ${email}`);
    console.log(`📦 Plano: ${plan}`);
    
    // 🔧 VALIDAÇÃO DO E-MAIL
    const emailValido = isValidEmail(email);
    if (!emailValido) {
        console.error(`❌ E-mail inválido: "${email}"`);
        return { sucesso: false, erro: 'E-mail inválido' };
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
            console.error("❌ Erro ao atualizar:", updateError);
        } else {
            console.log("✅ Usuário atualizado");
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
            console.error("❌ Erro ao inserir:", insertError);
        } else {
            console.log("✅ Usuário criado");
        }
    }
    
    // ================= ENVIAR EMAIL =================
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

// ================= WEBHOOK PRINCIPAL =================
const webhookHandler = async (req, res) => {
    console.log("🚀 WEBHOOK ATIVO");
    
    if (configurarCORS(req, res)) return;
    
    if (req.method !== "POST") {
        return res.status(200).end();
    }
    
    try {
        console.log("📩 Webhook recebido");
        console.log("BODY:", JSON.stringify(req.body));
        
        const { type, data } = req.body;
        const paymentId = data?.id;
        
        if (!paymentId || type !== 'payment') {
            console.log("⛔ Evento ignorado");
            return res.status(200).end();
        }
        
        console.log(`🧾 Processando payment ID: ${paymentId}`);
        
        await ensureTableExists();
        
        // Evitar duplicidade
        const { data: existente } = await supabase
            .from('pagamentos_processados')
            .select('id')
            .eq('id', String(paymentId))
            .maybeSingle();
        
        if (existente) {
            console.log("⚠️ Pagamento já processado");
            return res.status(200).end();
        }
        
        // Buscar pagamento
        const response = await mercadopago.payment.findById(paymentId);
        const payment = response.body;
        
        console.log("💳 Status:", payment.status);
        
        if (payment.status !== 'approved') {
            console.log("⏳ Pagamento não aprovado");
            return res.status(200).end();
        }
        
        // Extrair email e plano
        let email = payment.payer?.email;
        let plan = null;
        
        if (payment.external_reference) {
            if (payment.external_reference.includes('|')) {
                const parts = payment.external_reference.split('|');
                email = parts[0];
                plan = parts[1];
            }
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
        
        // Salvar como processado
        await supabase
            .from('pagamentos_processados')
            .insert({ id: String(paymentId), email, processado_em: new Date().toISOString() });
        
        console.log("🎉 Pagamento processado com sucesso!");
        return res.status(200).json({ sucesso: true });
        
    } catch (err) {
        console.error("🔥 Erro no webhook:", err);
        return res.status(200).end();
    }
};

// ================= EXPORTAÇÕES =================
module.exports = webhookHandler;
module.exports.processarPagamentoAprovado = processarPagamentoAprovado;
