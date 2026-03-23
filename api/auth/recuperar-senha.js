// api/auth/recuperar-senha.js
import { createTransport } from 'nodemailer';
import crypto from 'crypto';

// Configuração do banco de dados (ajuste conforme seu DB)
// Supondo que você tenha um módulo de banco de dados
import { findUserByEmail, saveResetToken } from '../../lib/db.js';

export default async function handler(req, res) {
    // ===== CONFIGURAÇÃO CORS CORRIGIDA =====
    // Lista de origens permitidas
    const allowedOrigins = [
        'https://karaokemultiplayer.com.br',
        'https://www.karaokemultiplayer.com.br',
        'http://localhost:3000',
        'http://localhost:5500'
    ];
    
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        // Fallback para o domínio principal
        res.setHeader('Access-Control-Allow-Origin', 'https://karaokemultiplayer.com.br');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // 🔥 ADICIONADO
    res.setHeader('Access-Control-Max-Age', '86400'); // 🔥 ADICIONADO (cache de 24h)
    
    // Responder OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Apenas POST é permitido
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            sucesso: false, 
            mensagem: 'Método não permitido' 
        });
    }
    
    try {
        const { email } = req.body;
        
        console.log('📧 Recebido email:', email); // 🔥 ADICIONADO para debug
        
        if (!email || !email.includes('@')) {
            return res.status(400).json({ 
                sucesso: false, 
                mensagem: 'E-mail inválido' 
            });
        }
        
        // 1. Verificar se o e-mail existe no banco de dados
        const user = await findUserByEmail(email);
        
        // 2. Gerar token (sempre geramos, mesmo se usuário não existir - por segurança)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpires = new Date(Date.now() + 3600000); // 1 hora
        
        if (user) {
            // 3. Salvar token no banco apenas se usuário existe
            await saveResetToken(email, resetToken, tokenExpires);
            console.log(`✅ Token salvo para ${email}`);
        } else {
            console.log(`⚠️ Usuário não encontrado: ${email}`);
        }
        
        // 4. Construir link de recuperação (sempre construímos, mesmo se usuário não existe)
        const resetLink = `https://karaokemultiplayer.com.br/redefinir-senha.html?token=${resetToken}&email=${encodeURIComponent(email)}`;
        
        console.log(`🔗 Link de recuperação: ${resetLink}`);
        
        // 5. Enviar e-mail (apenas se usuário existe, para não enviar spam)
        if (user) {
            try {
                await enviarEmailRecuperacao(email, resetLink);
                console.log(`📧 E-mail enviado para ${email}`);
            } catch (emailError) {
                console.error('Erro ao enviar e-mail:', emailError);
                // Continua mesmo se o e-mail falhar
            }
        }
        
        // Por segurança, retorna sucesso mesmo se o e-mail não existir
        return res.status(200).json({ 
            sucesso: true, 
            mensagem: user 
                ? 'E-mail de recuperação enviado! Verifique sua caixa de entrada.' 
                : 'Se o e-mail estiver cadastrado, você receberá as instruções.'
        });
        
    } catch (error) {
        console.error('❌ Erro na recuperação de senha:', error);
        return res.status(500).json({ 
            sucesso: false, 
            mensagem: 'Erro ao processar solicitação. Tente novamente.' 
        });
    }
}

// Função para enviar e-mail
async function enviarEmailRecuperacao(email, resetLink) {
    // Para teste, apenas logue o link
    console.log(`📧 [TESTE] Link de recuperação para ${email}: ${resetLink}`);
    
    // 🔥 DESCOMENTE QUANDO CONFIGURAR O SMTP REAL 🔥
    /*
    const transporter = createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
    
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Recuperação de Senha - Karaokê Multiplayer</title>
        </head>
        <body style="font-family: Arial, sans-serif;">
            <div style="max-width: 500px; margin: 0 auto; padding: 30px;">
                <h2>Recuperação de Senha</h2>
                <p>Você solicitou a recuperação de senha. Clique no link abaixo:</p>
                <a href="${resetLink}" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Redefinir Senha</a>
                <p>Este link expira em 1 hora.</p>
                <p>Se não foi você, ignore este e-mail.</p>
            </div>
        </body>
        </html>
    `;
    
    await transporter.sendMail({
        from: `"Karaokê Multiplayer" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Recuperação de Senha - Karaokê Multiplayer',
        html: htmlContent
    });
    */
}
