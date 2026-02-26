const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// Importar rota de pagamento REAL
const criarPagamento = require('./criar-pagamento');

const app = express();

// ===== CONFIGURAÇÃO CORS ROBUSTA =====
app.use(cors({ 
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ===== TRATAMENTO EXPLÍCITO PARA PREFLIGHT OPTIONS =====
app.options('*', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.sendStatus(200);
});

// ===== CONFIGURAÇÕES =====
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET;

// ===== ROTAS PÚBLICAS =====
app.get('/', (req, res) => {
    res.json({ status: 'online', message: '🎤 API Karaokê' });
});

app.get('/api/status', (req, res) => {
    res.json({ 
        servidor: '🟢 Online',
        ambiente: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

// ===== ROTA DE PAGAMENTO (REAL - Mercado Pago) =====
app.post('/api/criar-pagamento', criarPagamento);

// ===== ROTAS DE AUTENTICAÇÃO (REAIS) =====
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, senha, nome, plano } = req.body;
        
        // Validação básica
        if (!email || !senha || !nome || !plano) {
            return res.status(400).json({ erro: 'Todos os campos são obrigatórios' });
        }

        // Verificar se usuário já existe
        const { data: existingUser } = await supabase
            .from('usuarios')
            .select('id')
            .eq('email', email)
            .single();

        if (existingUser) {
            return res.status(400).json({ erro: 'Email já cadastrado' });
        }

        // Criar hash da senha
        const senhaHash = await bcrypt.hash(senha, 10);
        
        // Inserir usuário no banco
        const { data: newUser, error } = await supabase
            .from('usuarios')
            .insert([{
                email,
                senha_hash: senhaHash,
                nome,
                plano,
                status: 'inativo' // Começa inativo, será ativado pelo webhook
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ 
            sucesso: true, 
            mensagem: 'Usuário criado. Aguarde confirmação do pagamento.' 
        });
    } catch (error) {
        console.error('Erro no registro:', error);
        res.status(500).json({ erro: 'Erro interno no servidor' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        // Validação básica
        if (!email || !senha) {
            return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
        }

        // Buscar usuário
        const { data: user, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .single();

        if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        }

        // Verificar se está ativo
        if (user.status !== 'ativo') {
            return res.status(403).json({ erro: 'Acesso não autorizado. Pagamento pendente.' });
        }

        // Gerar token JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email, plano: user.plano },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ 
            sucesso: true, 
            token, 
            usuario: { 
                nome: user.nome, 
                email: user.email, 
                plano: user.plano 
            } 
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ erro: 'Erro interno no servidor' });
    }
});

// ===== EXPORTAÇÃO =====
module.exports = app;