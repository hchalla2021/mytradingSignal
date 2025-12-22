app.get('/auth/zerodha/callback', async (req, res) => {
    const { request_token } = req.query;
    
    try {
        // Exchange request token for access token
        const response = await kiteConnect.generateSession(request_token);
        
        res.json({
            access_token: response.access_token,
            user_id: response.user_id
        });
    } catch (error) {
        console.error('Token generation failed:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});