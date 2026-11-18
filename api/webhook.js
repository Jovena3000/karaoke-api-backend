// webhook.js - versão corrigida
// Mudanças principais:
//  1) Idempotência: cada payment_id é processado UMA vez (tabela pagamentos_processados)
//  2) Erros do Supabase e do Resend são verificados (antes eram ignorados)
//  3) Responde 500 em falha real, para o Mercado Pago tentar de novo
//  4) Senha com crypto.randomBytes e NUNCA escrita nos logs
//  5) Loga status_detail quando o pagamento não é aprovado (motivo da recusa)
const mp = require('mercadopago');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

console.log('TOKEN WEBHOOK:', process.env.MP_ACCESS_TOKEN ? 'Configurado' : '❌ FALTANDO');

// Compatível com o SDK novo (MercadoPagoConfig/Payment) e com o antigo (configure/payment.findById)
const SDK_NOVO = typeof mp.MercadoPagoConfig === 'function';
let paymentApi = null;
if (SDK_NOVO) {
    paymentApi = new mp.Payment(new mp.MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN }));
} else {
    mp.configure({ access_token: process.env.MP_ACCESS_TOKEN });
}

async function consultarPagamentoMP(id) {
    if (SDK_NOVO) return await paymentApi.get({ id });
    const response = await mp.payment.findById(id);
    return response.body;
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// ===== CONFIGURAÇÕES =====
const FROM = 'Karaokê Multiplayer <noreply@karaokemultiplayer.com.br>';
const LOGIN_URL = 'https://karaokemultiplayer.com.br/login.html';
const LOGO_URL = 'https://uploads.onecompiler.io/43v37pq3s/1783903529895/karaokeM01%20(1).png';

// O checkout promete "7 dias grátis adicionais". Se quiser cumprir isso, coloque 7.
const BONUS_DIAS = 0;

const PLANOS = {
    mensal:     { dias: 30,  valor: 21.90 },
    trimestral: { dias: 90,  valor: 59.90 },
    semestral:  { dias: 180, valor: 99.90 },
    anual:      { dias: 365, valor: 159.90 }
};

// ===== UTILITÁRIOS =====
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function gerarSenhaTemporaria() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(10);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function emailEhValido(email) {
    if (!email || typeof email !== 'string') return false;
    const e = email.trim().toLowerCase();
    if (!e || e === 'undefined' || e === 'null') return false;
    const fakes = ['testuser', 'test_user', 'noreply', 'no-reply', '@mercadopago', '@mercadolivre'];
    if (fakes.some((s) => e.includes(s))) {
        console.warn('⚠️ E-mail parece gerado automaticamente pelo MP:', e);
        return false;
    }
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function planoPeloValor(valor) {
    const v = Number(valor);
    for (const [nome, cfg] of Object.entries(PLANOS)) {
        if (Math.abs(cfg.valor - v) < 0.01) return nome;
    }
    console.warn('⚠️ Valor sem plano correspondente:', valor, '- usando trimestral');
    return 'trimestral';
}

function calcularExpiracao(dataAtual, dias) {
    const hoje = new Date();
    const atual = dataAtual ? new Date(dataAtual) : null;
    const base = atual && !isNaN(atual) && atual > hoje ? new Date(atual) : new Date(hoje);
    base.setDate(base.getDate() + dias + BONUS_DIAS);
    return base;
}

function formatarBRL(valor) {
    return Number(valor).toFixed(2).replace('.', ',');
}

// ===== E-MAIL =====
function montarEmail({ titulo, subtitulo, conteudo }) {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
    .header img { max-width: 180px; margin-bottom: 10px; }
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
      <img src="${LOGO_URL}" alt="Karaokê Multiplayer">
      <h1>${titulo}</h1>
      <p>${subtitulo}</p>
    </div>
    <div class="content">
      ${conteudo}
      <div style="text-align: center;">
        <a href="${LOGIN_URL}" class="button">ACESSAR KARAOKÊ</a>
      </div>
      <p style="margin-top: 20px;">Qualquer dúvida, responda a este e-mail ou entre em contato com nosso suporte.</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Karaokê Multiplayer. Todos os direitos reservados.</p>
    </div>
  </div>
</body>
</html>`;
}

async function enviarEmail(to, subject, html) {
    // O SDK do Resend devolve { data, error } em vez de lançar exceção
    const resp = await resend.emails.send({ from: FROM, to, subject, html });
    if (resp && resp.error) {
        throw new Error(resp.error.message || JSON.stringify(resp.error));
    }
}

// ===== IDEMPOTÊNCIA =====
// Retorna 'ok' (lock criado), 'duplicado' (já processado) ou 'sem_lock' (tabela indisponível)
async function adquirirLock(paymentId, email, plano) {
    const { error } = await supabase
        .from('pagamentos_processados')
        .insert({ payment_id: String(paymentId), email, plano });

    if (!error) return 'ok';
    if (error.code === '23505') return 'duplicado';

    console.error('⚠️ Lock indisponível (rode o SQL pagamentos_processados.sql):', error.code, error.message);
    return 'sem_lock';
}

async function liberarLock(paymentId) {
    const { error } = await supabase
        .from('pagamentos_processados')
        .delete()
        .eq('payment_id', String(paymentId));
    if (error) console.error('⚠️ Falha ao liberar lock:', error.message);
}

// ===== PROCESSAMENTO DO PAGAMENTO APROVADO =====
async function processarPagamentoAprovado({ email, plan, valorPago, paymentId }) {
    const cfg = PLANOS[plan];
    if (!cfg) throw new Error(`Plano desconhecido: ${plan}`);

    const planoNome = plan.charAt(0).toUpperCase() + plan.slice(1);
    const nomeCliente = escapeHtml(email.split('@')[0]);
    const valor = valorPago || cfg.valor;

    const { data: usuario, error: erroBusca } = await supabase
        .from('usuarios')
        .select('*')
        .eq('email', email)
        .maybeSingle();
    if (erroBusca) throw new Error('Erro ao buscar usuário: ' + erroBusca.message);

    // ---------- RENOVAÇÃO / REATIVAÇÃO (não mexe na senha) ----------
    if (usuario) {
        const expiracao = calcularExpiracao(usuario.data_expiracao, cfg.dias);
        const expiracaoStr = expiracao.toISOString().split('T')[0];

        const { error } = await supabase
            .from('usuarios')
            .update({
                plano: plan,
                status: 'ativo',
                data_expiracao: expiracaoStr,
                ultimo_pagamento: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('email', email);
        if (error) throw new Error('Erro ao renovar usuário: ' + error.message);

        console.log(`✅ ${email} renovado: plano ${plan} até ${expiracaoStr}`);

        // Falha de e-mail na renovação não desfaz nada: o acesso já foi estendido
        try {
            await enviarEmail(email, '✅ Renovação Confirmada - Acesso Liberado!', montarEmail({
                titulo: '🎤 Renovação Confirmada!',
                subtitulo: 'Seu acesso ao Karaokê Multiplayer Premium foi renovado',
                conteudo: `
      <h2>Olá ${nomeCliente}!</h2>
      <p>Recebemos a confirmação do seu pagamento e sua assinatura foi renovada com sucesso.</p>
      <p><strong>📋 Plano:</strong> Plano ${escapeHtml(planoNome)}</p>
      <p><strong>💰 Valor:</strong> R$ ${formatarBRL(valor)}</p>
      <p><strong>🆔 ID da Transação:</strong> ${escapeHtml(paymentId)}</p>
      <p><strong>📅 Data:</strong> ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
      <p><strong>⏳ Nova data de expiração:</strong> ${expiracao.toLocaleDateString('pt-BR')}</p>
      <p style="margin-top: 20px;">Continue usando suas credenciais atuais. Não é necessário trocar a senha.</p>`
            }));
            console.log('✉️ E-mail de renovação enviado');
        } catch (err) {
            console.error('❌ Falha no e-mail de renovação:', err.message);
        }

        return { tipo: 'renovacao' };
    }

    // ---------- NOVO USUÁRIO ----------
    const senhaTemporaria = gerarSenhaTemporaria();
    const senhaHash = await bcrypt.hash(senhaTemporaria, 10);
    const expiracao = calcularExpiracao(null, cfg.dias);
    const expiracaoStr = expiracao.toISOString().split('T')[0];

    const { error: erroInsert } = await supabase.from('usuarios').insert({
        email,
        senha_hash: senhaHash,
        nome: email.split('@')[0],
        plano: plan,
        status: 'ativo',
        data_expiracao: expiracaoStr,
        ultimo_pagamento: new Date().toISOString(),
        created_at: new Date().toISOString()
    });
    if (erroInsert) throw new Error('Erro ao criar usuário: ' + erroInsert.message);

    console.log(`✅ Novo usuário ${email} criado: plano ${plan} até ${expiracaoStr}`);

    try {
        await enviarEmail(email, '✅ Pagamento Confirmado - Acesso Liberado!', montarEmail({
            titulo: '🎤 Pagamento Confirmado!',
            subtitulo: 'Seu acesso ao Karaokê Multiplayer Premium está liberado',
            conteudo: `
      <h2>Olá ${nomeCliente}!</h2>
      <p>Recebemos a confirmação do seu pagamento com sucesso. Aqui estão os detalhes da sua compra:</p>
      <p><strong>📋 Plano:</strong> Plano ${escapeHtml(planoNome)}</p>
      <p><strong>💰 Valor:</strong> R$ ${formatarBRL(valor)}</p>
      <p><strong>🆔 ID da Transação:</strong> ${escapeHtml(paymentId)}</p>
      <p><strong>📅 Data:</strong> ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
      <p><strong>⏳ Expira em:</strong> ${expiracao.toLocaleDateString('pt-BR')}</p>
      <div class="credential-box">
        <h3 style="margin-top: 0;">🔑 SUAS CREDENCIAIS DE ACESSO</h3>
        <p><strong>E-mail:</strong> ${escapeHtml(email)}</p>
        <p><strong>Senha temporária:</strong></p>
        <div class="senha">${senhaTemporaria}</div>
        <p style="color: #e67e22; margin-top: 15px;">⚠️ Recomendamos trocar sua senha após o primeiro acesso</p>
      </div>`
        }));
        console.log('✉️ E-mail de boas-vindas enviado');
    } catch (err) {
        // A senha só existe neste e-mail. Se ele falhou, desfaz o usuário para que a
        // nova tentativa do Mercado Pago recrie tudo com uma senha nova e reenvie.
        console.error('❌ Falha no e-mail de boas-vindas, desfazendo usuário:', err.message);
        const { error: erroDelete } = await supabase.from('usuarios').delete().eq('email', email);
        if (erroDelete) console.error('❌ Não foi possível desfazer o usuário:', erroDelete.message);
        throw new Error('Falha ao enviar e-mail de boas-vindas: ' + err.message);
    }

    return { tipo: 'novo' };
}

// ===== BUSCA DO PAGAMENTO NO MERCADO PAGO =====
async function buscarPagamento(paymentId) {
    let ultimoErro = null;
    for (let i = 0; i < 6; i++) {
        try {
            console.log(`🔄 Tentativa ${i + 1} de buscar pagamento...`);
            const payment = await consultarPagamentoMP(paymentId);
            if (payment && payment.status) {
                console.log('✅ Pagamento encontrado');
                return { payment };
            }
        } catch (err) {
            ultimoErro = err;
            console.log(`⏱ Tentativa ${i + 1} falhou:`, err.message);
            // ID inexistente (ex.: notificação de teste): não adianta insistir
            if (err.status === 404 || err.statusCode === 404 || /not found/i.test(err.message || '')) {
                return { naoExiste: true };
            }
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    return { erro: ultimoErro };
}

// ===== HANDLER PRINCIPAL =====
module.exports = async (req, res) => {
    // O Mercado Pago chama este endpoint de servidor para servidor: CORS não é necessário.
    if (req.method === 'GET') {
        return res.status(200).json({ status: 'ok', message: 'Webhook ativo', timestamp: new Date().toISOString() });
    }
    if (req.method !== 'POST') {
        return res.status(200).end();
    }

    let paymentId = null;
    let lockAdquirido = false;

    try {
        const body = req.body || {};
        const query = req.query || {};

        const action = body.action;
        const type = body.type || query.type;
        const topic = body.topic || query.topic;
        paymentId = body.data?.id || query['data.id'] || (topic === 'payment' ? query.id : null);

        console.log('📩 Webhook recebido:', { action, type, topic, paymentId });

        const ehPagamento = type === 'payment' || topic === 'payment' ||
            action === 'payment.created' || action === 'payment.updated';
        if (!ehPagamento) {
            console.log('⛔ Evento ignorado');
            return res.status(200).end();
        }
        if (!paymentId) {
            console.log('❌ payment id não encontrado no evento');
            return res.status(200).end();
        }

        const resultado = await buscarPagamento(paymentId);
        if (resultado.naoExiste) {
            console.log('⛔ Pagamento inexistente no Mercado Pago:', paymentId);
            return res.status(200).end();
        }
        if (!resultado.payment) {
            console.error('🔥 Não foi possível obter o pagamento (MP tentará de novo)');
            return res.status(500).json({ erro: 'Falha ao consultar pagamento' });
        }
        const payment = resultado.payment;

        // Aqui aparece o MOTIVO da recusa, quando houver
        console.log('💰 Status:', payment.status, '| detalhe:', payment.status_detail);

        if (payment.status !== 'approved') {
            return res.status(200).json({ ignorado: payment.status });
        }

        // ----- Descobrir e-mail e plano -----
        let emailBruto = null;
        let plan = null;

        if (payment.external_reference && payment.external_reference.includes('|')) {
            const [refEmail, refPlan] = payment.external_reference.split('|');
            emailBruto = refEmail;
            plan = refPlan;
        }

        const candidatos = [emailBruto, payment.metadata?.email, payment.payer?.email];
        const email = candidatos.find(emailEhValido);
        if (!email) {
            console.error('❌ Nenhum e-mail válido encontrado para o pagamento', paymentId);
            return res.status(200).end();
        }
        const emailFinal = email.trim().toLowerCase();

        if (!plan && payment.metadata?.plan) plan = payment.metadata.plan;
        if (!PLANOS[plan]) plan = planoPeloValor(payment.transaction_amount);

        console.log(`👤 Cliente: ${emailFinal} | 📦 Plano: ${plan}`);

        // ----- Idempotência -----
        const lock = await adquirirLock(paymentId, emailFinal, plan);
        if (lock === 'duplicado') {
            console.log('🔁 Pagamento já processado, ignorando:', paymentId);
            return res.status(200).json({ sucesso: true, duplicado: true });
        }
        lockAdquirido = lock === 'ok';

        // ----- Liberação do acesso -----
        const r = await processarPagamentoAprovado({
            email: emailFinal,
            plan,
            valorPago: payment.transaction_amount,
            paymentId
        });

        console.log(`🎉 Pagamento ${paymentId} processado (${r.tipo})`);
        return res.status(200).json({ sucesso: true });

    } catch (err) {
        console.error('🔥 Erro no webhook:', err.message);
        // Permite que o Mercado Pago reenvie e que o pagamento seja processado de novo
        if (lockAdquirido && paymentId) await liberarLock(paymentId);
        return res.status(500).json({ erro: 'Falha ao processar pagamento' });
    }
};
