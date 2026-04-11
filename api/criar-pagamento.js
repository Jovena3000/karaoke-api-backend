import mercadopago from 'mercadopago';

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

export default async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

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

        const valor = prices[plan] || 24.90;

        const preference = {
            items: [{
                title: `Plano ${plan} - Karaokê Multiplayer`,
                unit_price: valor,
                quantity: 1,
                currency_id: 'BRL'
            }],
            payer: { email },
            notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
            external_reference: `${email}|${plan}`, // 🔥 ESSENCIAL
            binary_mode: true,
            back_urls: {
                success: 'https://karaokemultiplayer.com.br/sucesso.html',
                failure: 'https://karaokemultiplayer.com.br/erro.html',
                pending: 'https://karaokemultiplayer.com.br/pendente.html'
            }
        };

        const response = await mercadopago.preferences.create(preference);

        return res.json({
            init_point: response.body.init_point
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ erro: err.message });
    }
};
