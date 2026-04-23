// api/criar-pagamento.js - VERSÃO 1.6.0 (Checkout Bricks)
const mercadopago = require('mercadopago');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    console.log("🚀 CREATE PAYMENT v1.6.0");

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const {
            plan,
            email,
            metodo,
            // Campos vindos do Checkout Bricks
            token,
            payment_method_id,
            installments,
            issuer_id,
            cpf
        } = req.body;

        console.log('📩 Dados recebidos:', {
            email,
            plan,
            metodo,
            token:             token             ? '✅' : '❌',
            payment_method_id: payment_method_id || '—',
            installments:      installments      || 1,
            issuer_id:         issuer_id         || '—',
            cpf:               cpf               ? '✅' : '—'
        });

        // Validações básicas
        if (!email || !email.includes('@')) {
            return res.status(400).json({ sucesso: false, erro: 'E-mail inválido' });
        }
        if (!plan) {
            return res.status(400).json({ sucesso: false, erro: 'Plano não informado' });
        }

        const precos = {
            mensal:     5.00,
            trimestral: 49.90,
            semestral:  89.90,
            anual:      159.90
        };

        const valor = precos[plan];
        if (!valor) {
            return res.status(400).json({ sucesso: false, erro: `Plano inválido: ${plan}` });
        }

        const descricao = `Plano ${plan} - Karaokê Multiplayer`;

        // ================= PIX =================
        if (metodo === 'pix') {
            console.log('📱 Criando pagamento PIX...');

            const payment = await mercadopago.payment.create({
                transaction_amount: valor,
                description:        descricao,
                payment_method_id:  'pix',
                payer:              { email },
                notification_url:   'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: `${email}|${plan}`,
                metadata:           { email, plan }
            });

            const data = payment.body;
            console.log('✅ PIX criado! ID:', data.id);

            return res.status(200).json({
                sucesso:        true,
                metodo:         'pix',
                id:             data.id,
                qr_code:        data.point_of_interaction?.transaction_data?.qr_code,
                qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64
            });
        }

        // ================= CARTÃO (via Checkout Bricks) =================
        if (metodo === 'card') {
            console.log('💳 Processando pagamento com cartão (Bricks)...');

            if (!token) {
                return res.status(400).json({ sucesso: false, erro: 'Token do cartão não enviado' });
            }
            if (!payment_method_id) {
                console.warn('⚠️ payment_method_id não enviado — usando fallback "master"');
            }

            // O Brick já envia installments corretamente (mínimo 1)
            const parcelas = Number(installments) || 1;

            const paymentData = {
                transaction_amount: Number(valor),
                token,
                description:        descricao,
                installments:       parcelas,
                payment_method_id:  payment_method_id || 'master',
                payer: {
                    email,
                    identification: {
                        type:   'CPF',
                        // CPF vindo do Brick ou do body
                        number: (cpf || '').replace(/\D/g, '') || '19119119100'
                    }
                },
                // issuer_id necessário para algumas bandeiras (Elo, Hipercard, etc.)
                ...(issuer_id ? { issuer_id: String(issuer_id) } : {}),
                notification_url:   'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: `${email}|${plan}`,
                metadata:           { email, plan }
            };

            console.log('📤 Enviando para o Mercado Pago...');
            console.log('💳 Bandeira:', paymentData.payment_method_id);
            console.log('💳 Parcelas:', paymentData.installments);
            console.log('💳 Emissor (issuer_id):', issuer_id || '—');

            const response = await mercadopago.payment.create(paymentData);
            const payment  = response.body;

            console.log('💳 Status:', payment.status);
            console.log('💳 Status detail:', payment.status_detail);
            console.log('💳 ID:', payment.id);

            if (payment.status === 'approved') {
                return res.status(200).json({
                    sucesso:  true,
                    status:   payment.status,
                    id:       payment.id,
                    mensagem: 'Pagamento aprovado!'
                });
            }

            // Mensagens de erro amigáveis por status_detail
            const mensagensErro = {
                cc_rejected_insufficient_amount:      'Saldo insuficiente no cartão.',
                cc_rejected_bad_filled_security_code: 'CVV inválido.',
                cc_rejected_bad_filled_date:          'Data de validade inválida.',
                cc_rejected_bad_filled_other:         'Dados do cartão incorretos.',
                cc_rejected_card_disabled:            'Cartão desabilitado. Entre em contato com seu banco.',
                cc_rejected_duplicated_payment:       'Pagamento duplicado detectado.',
                cc_rejected_high_risk:                'Pagamento recusado por segurança. Tente outro cartão.',
                pending_contingency:                  'Pagamento em processamento. Aguarde a confirmação.',
                pending_review_manual:                'Pagamento em análise. Você será notificado em breve.',
            };

            const detalhe = payment.status_detail || '';
            const msgErro = mensagensErro[detalhe]
                || `Pagamento não aprovado (${detalhe || payment.status})`;

            console.warn('⚠️ Pagamento não aprovado:', detalhe);

            return res.status(200).json({
                sucesso:  false,
                status:   payment.status,
                detalhe,
                id:       payment.id,
                erro:     msgErro
            });
        }

        return res.status(400).json({
            sucesso: false,
            erro:    'Método inválido. Use "pix" ou "card".'
        });

    } catch (error) {
        console.error('❌ ERRO:', error.message);
        if (error.response?.data) {
            console.error('📦 Detalhes MP:', JSON.stringify(error.response.data, null, 2));
        }
        return res.status(500).json({
            sucesso: false,
            erro:    error.message || 'Erro interno do servidor'
        });
    }
};
