import mercadopago from 'mercadopago';

// ================= CONFIG =================
mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

export default async function handler(req, res) {
    // ================= CORS =================
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        console.log("📩 Criar pagamento iniciado");

        const { title, price, plan, email } = req.body;

        // ================= VALIDAÇÃO =================
        if (!email || !plan) {
            console.log("❌ Dados faltando:", { email, plan });
            return res.status(400).json({
                erro: "Email e plano são obrigatórios"
            });
        }

        const planosValidos = ['mensal', 'trimestral', 'semestral', 'anual'];

        if (!planosValidos.includes(plan)) {
            console.log("❌ Plano inválido:", plan);
            return res.status(400).json({
                erro: "Plano inválido"
            });
        }

        // ================= PREÇOS =================
        const prices = {
            mensal: 5.00,
            trimestral: 24.90,
            semestral: 49.90,
            anual: 89.90
        };

        const valor = price ? parseFloat(price) : prices[plan];

        if (!valor || isNaN(valor)) {
            console.log("❌ Valor inválido:", valor);
            return res.status(400).json({
                erro: "Valor inválido"
            });
        }

        const titulo = title || `Plano ${plan} - Karaokê Multiplayer`;

        console.log("💰 Criando pagamento:", { email, plan, valor });

        // ================= PREFERENCE =================
        const preference = {
            items: [
                {
                    title: titulo,
                    unit_price: valor,
                    quantity: 1,
                    currency_id: 'BRL',
                    description: `Plano ${plan}`
                }
            ],
            payer: {
                email: email
            },
            back_urls: {
                success: 'https://karaokemultiplayer.com.br/pagamento-sucesso.html',
                failure: 'https://karaokemultiplayer.com.br/erro.html',
                pending: 'https://karaokemultiplayer.com.br/pendente.html'
            },
            auto_return: 'approved',

            // 🔥 MUITO IMPORTANTE
            notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',

            // 🔥 PADRÃO CORRETO PARA SEU WEBHOOK
            external_reference: `${email}|${plan}`
        };

        // ================= CRIAR PAGAMENTO =================
        const response = await mercadopago.preferences.create(preference);

        console.log("✅ Preferência criada:", response.body.id);

        return res.status(200).json({
            sucesso: true,
            id: response.body.id,
            init_point: response.body.init_point
        });

    } catch (error) {
        console.error("🔥 ERRO REAL:", error);

        return res.status(500).json({
            erro: "Erro ao criar pagamento",
            detalhe: error.message
        });
    }
}
