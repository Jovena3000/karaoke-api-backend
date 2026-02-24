const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    // Pegar token do header Authorization
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ erro: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Verificar token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Adicionar usuário à requisição
        req.user = decoded;
        
        next();
    } catch (error) {
        return res.status(403).json({ erro: 'Token inválido ou expirado' });
    }
};

module.exports = authMiddleware;
