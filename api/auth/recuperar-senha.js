// api/auth/recuperar-senha.js
import { Resend } from 'resend';
import crypto from 'crypto';

// Usando a mesma configuração dos seus outros e-mails
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
    // Configurar CORS
    const allowedOrigins = [
        'https://karaokemultiplayer.com.br',
        'https://www.karaokemultiplayer.com.br',
        'http://localhost:3000'
    ];
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://karaokemultiplayer.com.br');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ sucesso: false, mensagem: 'Método não permitido' });
    }
    
    try {
        const { email } = req.body;
        
        if (!email || !email.includes('@')) {
            return res.status(400).json({ sucesso: false, mensagem: 'E-mail inválido' });
        }
        
        console.log(`📧 Solicitação de recuperação para: ${email}`);
        
        // Gerar token (em produção, você deve salvar no banco)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetLink = `https://karaokemultiplayer.com.br/redefinir-senha.html?token=${resetToken}&email=${encodeURIComponent(email)}`;
        
        console.log(`🔗 Link de recuperação: ${resetLink}`);
        
        // 🔥 ENVIAR E-MAIL USANDO RESEND (mesma configuração dos seus e-mails de compra)
        const { data, error } = await resend.emails.send({
            from: 'Karaokê Multiplayer <naoresponder@karaokemultiplayer.com.br>',
            to: email,
            subject: 'Recuperação de Senha - Karaokê Multiplayer',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Recuperação de Senha</title>
                </head>
                <body style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 40px;">
                    <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
                        <div style="text-align: center; margin-bottom: 30px;">
                            <span style="font-size: 48px;">🎤</span>
                            <h1 style="color: #667eea; margin: 10px 0;">Karaokê Multiplayer</h1>
                        </div>
                        
                        <h2 style="color: #333;">Recuperação de Senha</h2>
                        
                        <p style="color: #666; line-height: 1.6; margin: 20px 0;">
                            Você solicitou a recuperação de senha para sua conta. Clique no botão abaixo para redefinir sua senha:
                        </p>
                        
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetLink}" 
                               style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; font-weight: bold;">
                                Redefinir Minha Senha
                            </a>
                        </div>
                        
                        <p style="color: #999; font-size: 12px; text-align: center;">
                            Este link expira em 1 hora. Se você não solicitou, ignore este e-mail.
                        </p>
                    </div>
                </body>
                </html>
            `
        });
        
        if (error) {
            console.error('❌ Erro ao enviar e-mail:', error);
            return res.status(500).json({ 
                sucesso: false, 
                mensagem: 'Erro ao enviar e-mail. Tente novamente.' 
            });
        }
        
        console.log(`✅ E-mail enviado para ${email} - ID: ${data?.id}`);
        
        return res.status(200).json({ 
            sucesso: true, 
            mensagem: 'E-mail de recuperação enviado! Verifique sua caixa de entrada.' 
        });
        
    } catch (error) {
        console.error('❌ Erro no endpoint:', error);
        return res.status(500).json({ 
            sucesso: false, 
            mensagem: 'Erro ao processar solicitação. Tente novamente.' 
        });
    }
}
