const express = require('express');

const rateLimitMiddleware = require('./middlewares/middleware');
const { getStats } = require('./services/rateLimiter');
const { payloadQueue } = require('./services/queue');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', uptime: process.uptime() });
});

app.post('/request', rateLimitMiddleware, async (req, res, next) => {
    try {
        const { payload } = req.body;
        const job = await payloadQueue.add('process-payload', {
            userId: req.userId,
            payload
        });

        res.status(202).json({
            message: 'Request accepted and queued',
            job_id: job.id,
            user_id: req.userId,
            rate_limit_remaining: res.getHeader('X-RateLimit-Remaining')
        });
    } catch (error) {
        next(error);
    }
});

app.get('/stats', async (req, res, next) => {
    try {
        const stats = await getStats();
        res.status(200).json({ active_users_in_window: stats });
    } catch (error) {
        next(error);
    }
});

app.use((err, req, res, next) => {
    console.error('🚨 Unhandled API Error:', err.message);
    
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Bad Request', message: 'Invalid JSON body' });
    }

    res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

const gracefulShutdown = () => {
    console.log('Shutting down HTTP server gracefully...');
    server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
    });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);