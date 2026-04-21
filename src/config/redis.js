const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    family: 4,
    enableReadyCheck: true
});

redis.on('connect', () => console.log('🟢 Redis connection established'));
redis.on('ready', () => console.log('✅ Redis is ready to receive commands'));
redis.on('reconnecting', () => console.warn('⚠️ Redis is reconnecting...'));
redis.on('error', (err) => console.error('❌ Redis Client Error:', err.message));
redis.on('end', () => console.log('🛑 Redis connection closed'));

const gracefulShutdown = async () => {
    try {
        await redis.quit();
        console.log('Redis connection closed successfully.');
    } catch (err) {
        console.error('Error during Redis shutdown:', err.message);
    }
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = redis;