// api/criar-pagamento.js - VERSÃO FINAL CORRIGIDA
const mercadopago = require('mercadopago');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

const WEBHOOK_URL      = 'https://karaoke-api-backend3.vercel.app/api/webhook';
const PLANOS = {
    mensal:     5.00,
    trimestral: 49.90,
    semestral:  89.90,
    anual:      159.90
};

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

    try {
        const { metodo, email, plan, token, payment_method_id, installments, issuer_id, cpf } = req.body;

        console.log('📦 Criando pagamento:', { email, plan, metodo });

        // Validações
        if (!email || !email.includes('@')) {
            return res.status(400).json({ sucesso: false, erro: 'E-mail inválido' });
        }
        if (!plan || !PLANOS[plan]) {
            return res.status(400).json({ sucesso: false, erro: 'Plano inválido' });
        }

        const valor    = PLANOS[plan];
        const descricao = `Plano ${plan} - Karaokê Multiplayer`;

        // ================= PIX =================
        if (metodo === 'pix') {
            console.log('📱 Gerando PIX...');

            const payment = await mercadopago.payment.create({
                transaction_amount: valor,
                description:        descricao,
                payment_method_id:  'pix',
                payer: {
                    email:      email,
                    first_name: email.split('@')[0]
                },
                // ✅ ESSENCIAL: sem isso o webhook não identifica o cliente
                external_reference: `${email}|${plan}`,
                // ✅ ESSENCIAL: sem isso o MP não sabe para onde enviar o webhook
                notification_url:   WEBHOOK_URL,
                metadata: { email, plan }
            });

            console.log('✅ PIX criado! ID:', payment.body.id);
            console.log('✅ external_reference:', `${email}|${plan}`);
            console.log('✅ notification_url:', WEBHOOK_URL);

            return res.status(200).json({
                sucesso:        true,
                metodo:         'pix',
                id:             payment.body.id,
                qr_code:        payment.body.point_of_interaction?.transaction_data?.qr_code,
                qr_code_base64: payment.body.point_of_interaction?.transaction_data?.qr_code_base64
            });
        }

        // ================= CARTÃO =================
        if (metodo === 'card') {
            console.log('💳 Processando cartão...');

            if (!token) {
                return res.status(400).json({ sucesso: false, erro: 'Token do cartão não enviado' });
            }

            const paymentData = {
                transaction_amount: Number(valor),
                token,
                description:        descricao,
                installments:       Number(installments) || 1,
                payment_method_id:  payment_method_id || 'master',
                payer: {
                    email,
                    identification: {
                        type:   'CPF',
                        number: (cpf || '').replace(/\D/g, '') || '19119119100'
                    }
                },
                // ✅ ESSENCIAL: garante que o webhook receba e identifique o pagamento
                external_reference: `${email}|${plan}`,
                notification_url:   WEBHOOK_URL,
                metadata: { email, plan }
            };

            if (issuer_id) paymentData.issuer_id = String(issuer_id);

            console.log('📤 Enviando para MP...');
            console.log('   Bandeira:', paymentData.payment_method_id);
            console.log('   Parcelas:', paymentData.installments);

            const response = await mercadopago.payment.create(paymentData);
            const payment  = response.body;

            console.log('💳 Status:', payment.status);
            console.log('💳 ID:', payment.id);

            if (payment.status === 'approved') {
                return res.status(200).json({
                    sucesso:  true,
                    status:   payment.status,
                    id:       payment.id,
                    mensagem: 'Pagamento aprovado!'
                });
            }

            // Mensagens de erro amigáveis
            const mensagensErro = {
                cc_rejected_insufficient_amount:      'Saldo insuficiente no cartão.',
                cc_rejected_bad_filled_security_code: 'CVV inválido.',
                cc_rejected_bad_filled_date:          'Data de validade inválida.',
                cc_rejected_bad_filled_other:         'Dados do cartão incorretos.',
                cc_rejected_card_disabled:            'Cartão desabilitado. Contate seu banco.',
                cc_rejected_duplicated_payment:       'Pagamento duplicado detectado.',
                cc_rejected_high_risk:                'Pagamento recusado por segurança.',
                pending_contingency:                  'Pagamento em processamento. Aguarde.',
                pending_review_manual:                'Pagamento em análise. Você será notificado.',
            };

            const detalhe = payment.status_detail || '';
            const msgErro = mensagensErro[detalhe] || `Pagamento não aprovado (${detalhe || payment.status})`;

            return res.status(200).json({
                sucesso:  false,
                status:   payment.status,
                detalhe,
                id:       payment.id,
                erro:     msgErro
            });
        }

        return res.status(400).json({ sucesso: false, erro: 'Método inválido. Use "pix" ou "card".' });

    } catch (error) {
        console.error('❌ Erro:', error.message);
        if (error.response?.data) {
            console.error('📦 Detalhes MP:', JSON.stringify(error.response.data, null, 2));
        }
        return res.status(500).json({
            sucesso: false,
            erro:    error.message || 'Erro interno do servidor'
        });
    }
};
