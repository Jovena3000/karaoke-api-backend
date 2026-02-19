const express = require('express');
const cors = require('cors');
const mercadopago = require('mercadopago');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ===== CONFIGURAR MERCADO PAGO =====
// O token vem da variável de ambiente configurada no Vercel
mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

// ===== ROTA PRINCIPAL =====
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        message: '🎤 API Karaokê funcionando!',
        mercado_pago: process.env.MP_ACCESS_TOKEN ? '✅ configurado' : '❌ não configurado',
        timestamp: new Date().toISOString()
    });
});

// ===== ROTA DE STATUS =====
app.get('/api/status', (req, res) => {
    res.json({ 
        servidor: '🟢 Online',
        ambiente: process.env.NODE_ENV || 'development',
        token_mp: process.env.MP_ACCESS_TOKEN ? '✅ presente' : '❌ ausente'
    });
});

// ===== ROTA DE CRIAÇÃO DE PAGAMENTO =====
app.post('/api/criar-pagamento', async (req, res) => {
    try {
        const { plano, email } = req.body;
        
        // Validação básica
        if (!plano || !email) {
            return res.status(400).json({ 
                erro: 'Plano e email são obrigatórios' 
            });
        }

        // Definir valores baseado no plano
        let valor = 0;
        let titulo = '';
        
        if (plano === 'mensal') {
            valor = 11.90;
            titulo = 'Plano Mensal - Karaokê Multiplayer';
        } else if (plano === 'trimestral') {
            valor = 24.90;
            titulo = 'Plano Trimestral - Karaokê Multiplayer (Economize R$10,80)';
        } else {
            return res.status(400).json({ erro: 'Plano inválido' });
        }

        console.log('📩 Criando pagamento:', { plano, email, valor });

        // Criar preferência no Mercado Pago
        const preference = {
            items: [
                {
                    title: titulo,
                    unit_price: valor,
                    quantity: 1,
                    currency_id: 'BRL',
                    description: `Acesso premium ao Karaokê Multiplayer - ${plano}`
                }
            ],
            payer: {
                email: email
            },
            back_urls: {
                success: 'https://karaoke-multiplayer.pages.dev/sucesso.html',
                failure: 'https://karaoke-multiplayer.pages.dev/erro.html',
                pending: 'https://karaoke-multiplayer.pages.dev/pendente.html'
            },
            auto_return: 'approved',
            external_reference: `${plano}_${email}_${Date.now()}`,
            statement_descriptor: 'KARAOKE MULTIPLAYER'
        };

        const response = await mercadopago.preferences.create(preference);
        
        console.log('✅ Preferência criada:', response.body.id);

        // Retornar URL de pagamento
        res.json({
            sucesso: true,
            mensagem: 'Pagamento processado com sucesso',
            dados_pedido: {
                plano: titulo,
                valor: `R$ ${valor.toFixed(2)}`,
                email: email
            },
            pagamento: {
                init_point: response.body.init_point,
                preference_id: response.body.id
            }
        });

    } catch (error) {
        console.error('❌ Erro no Mercado Pago:', error);
        
        // Se for erro de autenticação (token inválido)
        if (error.message && error.message.includes('401')) {
            return res.status(500).json({ 
                erro: 'Token do Mercado Pago inválido ou não configurado',
                sucesso: false 
            });
        }
        
        res.status(500).json({ 
            erro: 'Erro interno no servidor',
            detalhe: error.message,
            sucesso: false
        });
    }
});

// ===== WEBHOOK PARA RECEBER CONFIRMAÇÕES =====
app.post('/api/webhook', (req, res) => {
    console.log('📩 Webhook recebido:', req.body);
    
    // Processar notificação
    const { type, data } = req.body;
    
    if (type === 'payment') {
        const paymentId = data.id;
        console.log(`💰 Pagamento ${paymentId} atualizado`);
        // Aqui você pode salvar no banco de dados
    }
    
    res.status(200).json({ received: true });
});

// ===== EXPORTAÇÃO PARA VERCEL =====
module.exports = app;

// ===== PORTA LOCAL PARA TESTES =====
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
        console.log(`🔑 Token configurado: ${process.env.MP_ACCESS_TOKEN ? '✅' : '❌'}`);
    });
}