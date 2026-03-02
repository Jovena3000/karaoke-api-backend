// ================= PAYMENT (VERSÃO CORRIGIDA) =================
app.post('/api/criar-pagamento', async (req, res) => {
  console.log('📥 REQUISIÇÃO RECEBIDA:', {
    body: req.body,
    headers: req.headers['content-type'],
    method: req.method
  });

  try {
    const { plan, email } = req.body;
    
    console.log('📦 Dados extraídos:', { plan, email });

    if (!plan || !email) {
      console.log('❌ Campos faltando');
      return res.status(400).json({ 
        sucesso: false, 
        erro: 'Plano e email são obrigatórios' 
      });
    }

    // Tabela de preços
    const prices = {
      mensal: 19.90,
      trimestral: 24.90,
      semestral: 44.90,
      anual: 79.90
    };

    const price = prices[plan] || 24.90;
    console.log('💰 Preço calculado:', { plan, price });

    // Verificar se Mercado Pago está configurado
    if (!process.env.MP_ACCESS_TOKEN) {
      console.log('⚠️ MP_ACCESS_TOKEN não configurado, usando simulação');
      return res.json({
        sucesso: true,
        simulado: true,
        id: 'SIM_' + Date.now(),
        init_point: `https://mercadopago.com.br/checkout?plan=${plan}&email=${encodeURIComponent(email)}`
      });
    }

    // Configurar Mercado Pago
    mercadopago.configure({
      access_token: process.env.MP_ACCESS_TOKEN
    });

    const preference = {
      items: [{
        title: `Plano Karaokê ${plan}`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: price
      }],
      payer: { email },
      back_urls: {
        success: 'https://karaoke-multiplayer.pages.dev/pagamento-sucesso.html',
        failure: 'https://karaoke-multiplayer.pages.dev/erro.html',
        pending: 'https://karaoke-multiplayer.pages.dev/pendente.html'
      },
      auto_return: 'approved',
      notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
      external_reference: JSON.stringify({ email, plan })
    };

    console.log('📤 Enviando para Mercado Pago...');
    const response = await mercadopago.preferences.create(preference);
    
    console.log('✅ Pagamento criado:', response.body.id);
    
    res.json({
      sucesso: true,
      id: response.body.id,
      init_point: response.body.init_point
    });

  } catch (error) {
    console.error('❌ ERRO DETALHADO:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    res.status(500).json({ 
      sucesso: false, 
      erro: 'Erro no pagamento',
      detalhe: error.message 
    });
  }
});
