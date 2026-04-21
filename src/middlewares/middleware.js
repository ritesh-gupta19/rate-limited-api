const { consume, MAX_REQUESTS, WINDOW_MS } = require('../services/rateLimiter');

async function rateLimitMiddleware(req, res, next) {
    const rawUserId = req.headers['x-user-id'] || req.body?.user_id || req.query?.user_id;

    if (!rawUserId) {
        return res.status(400).json({ 
            error: 'Bad Request',
            message: 'user_id is required in body, query, or X-User-ID header' 
        });
    }

    const userId = String(rawUserId).trim();

    try {
        const { allowed, remaining, retryAfterMs } = await consume(userId);

        res.set({
            'X-RateLimit-Limit': MAX_REQUESTS,
            'X-RateLimit-Remaining': remaining,
            'X-RateLimit-Window': `${WINDOW_MS / 1000}s`,
        });

        if (!allowed) {
            const retryAfterSec = Math.ceil(retryAfterMs / 1000);
            res.set('Retry-After', retryAfterSec);
            
            return res.status(429).json({
                error: 'Too Many Requests',
                message: `Limit of ${MAX_REQUESTS} requests per minute exceeded.`,
                retry_after_seconds: retryAfterSec,
            });
        }

        req.userId = userId;
        next();
        
    } catch (error) {
        console.error("Rate Limiter Middleware Error:", error.message);
        next(error); 
    }
}

module.exports = rateLimitMiddleware;