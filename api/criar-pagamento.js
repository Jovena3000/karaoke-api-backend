import { MercadoPagoConfig, Preference } from 'mercadopago';

const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN
});

export default async (req, res) => {
    try {
        const { plan, email } = req.body;

        if (!email || !plan) {
            return res.status(400).json({ erro: "Email e plano obrigatórios" });
        }

        const prices = {
            mensal: 5.00,
            trimestral: 24.90,
            semestral: 49.90,
            anual: 89.90
        };

        const valor = prices[plan];

        const preference = new Preference(client);

        const response = await preference.create({
            body: {
                items: [{
                    title: `Plano ${plan}`,
                    unit_price: valor,
                    quantity: 1,
                    currency_id: 'BRL'
                }],
                payer: { email },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',

                // 🔥 ESSENCIAL
                external_reference: `${email}|${plan}`,

                binary_mode: true
            }
        });

        return res.json({
            init_point: response.init_point
        });

    } catch (error) {
        console.error("ERRO REAL:", error);

        return res.status(500).json({
            erro: "Erro ao criar pagamento",
            detalhe: error.message
        });
    }
};
