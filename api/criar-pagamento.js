// ================= PAYMENT (desabilitado) =================
app.post('/api/criar-pagamento', (req, res) => {
  setCors(res);
  res.status(503).json({ 
    erro: 'Pagamento temporariamente indisponível',
    mensagem: 'Configure o MP_ACCESS_TOKEN no arquivo .env para ativar'
  });
});
