// api/auth/recuperar-senha.js
import { createTransport } from 'nodemailer';
import crypto from 'crypto';

// Configuração do banco de dados (ajuste conforme seu DB)
// Supondo que você tenha um módulo de banco de dados
import { findUserByEmail, saveResetToken } from '../../lib/db.js';

export default async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', 'https://karaokemultiplayer.com.br');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
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
        
        if (!email || !email.includes('@')) {
            return res.status(400).json({ 
                sucesso: false, 
                mensagem: 'E-mail inválido' 
            });
        }
        
        // 1. Verificar se o e-mail existe no banco de dados
        const user = await findUserByEmail(email);
        
        if (!user) {
            // Por segurança, retorna sucesso mesmo se não encontrar
            return res.status(200).json({ 
                sucesso: true, 
                mensagem: 'Se o e-mail estiver cadastrado, você receberá as instruções' 
            });
        }
        
        // 2. Gerar token único para recuperação (expira em 1 hora)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpires = new Date(Date.now() + 3600000); // 1 hora
        
        // 3. Salvar token no banco
        await saveResetToken(email, resetToken, tokenExpires);
        
        // 4. Construir link de recuperação
        const resetLink = `https://karaokemultiplayer.com.br/redefinir-senha.html?token=${resetToken}&email=${encodeURIComponent(email)}`;
        
        // 5. Enviar e-mail (opcional - pode retornar sucesso sem enviar)
        try {
            await enviarEmailRecuperacao(email, resetLink);
        } catch (emailError) {
            console.error('Erro ao enviar e-mail:', emailError);
            // Continua mesmo se o e-mail falhar, mas registra o erro
        }
        
        return res.status(200).json({ 
            sucesso: true, 
            mensagem: 'E-mail de recuperação enviado! Verifique sua caixa de entrada.' 
        });
        
    } catch (error) {
        console.error('Erro na recuperação de senha:', error);
        return res.status(500).json({ 
            sucesso: false, 
            mensagem: 'Erro ao processar solicitação. Tente novamente.' 
        });
    }
}

// Função para enviar e-mail (opcional - pode ser comentada para teste)
async function enviarEmailRecuperacao(email, resetLink) {
    // Se não tiver configurado SMTP, comente esta função ou retorne true
    // Para teste, apenas logue o link
    console.log(`Link de recuperação para ${email}: ${resetLink}`);
    
    // Configuração real quando tiver SMTP
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
    
    await transporter.sendMail({
        from: `"Karaokê Multiplayer" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Recuperação de Senha - Karaokê Multiplayer',
        html: htmlContent
    });
    */
}
