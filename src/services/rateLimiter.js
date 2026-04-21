const redis = require('../config/redis');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 5;

redis.defineCommand('slidingWindowRateLimit', {
    numberOfKeys: 1,
    lua: `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local windowMs = tonumber(ARGV[2])
        local maxRequests = tonumber(ARGV[3])
        local windowStart = now - windowMs

        redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
        local currentCount = redis.call('ZCARD', key)

        if currentCount >= maxRequests then
            local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
            local retryAfterMs = windowMs
            if oldest[2] then
                retryAfterMs = tonumber(oldest[2]) + windowMs - now
            end
            return { 0, math.max(0, retryAfterMs) }
        end

        redis.call('ZADD', key, now, now)
        redis.call('PEXPIRE', key, windowMs)

        return { 1, maxRequests - currentCount - 1 }
    `
});

async function consume(userId) {
    const key = `rate_limit:${userId}`;
    const now = Date.now();

    const [status, val] = await redis.slidingWindowRateLimit(
        key, now, WINDOW_MS, MAX_REQUESTS
    );

    const isAllowed = status === 1;

    return { 
        allowed: isAllowed, 
        remaining: isAllowed ? val : 0, 
        retryAfterMs: isAllowed ? 0 : val 
    };
}

async function getStats() {
    const stats = {};
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    const stream = redis.scanStream({
        match: 'rate_limit:*',
        count: 100 
    });

    for await (const keysBatch of stream) {
        if (keysBatch.length === 0) continue;

        const pipeline = redis.pipeline();
        for (const key of keysBatch) {
            pipeline.zcount(key, windowStart, '+inf');
        }

        const results = await pipeline.exec();

        keysBatch.forEach((key, index) => {
            const userId = key.split(':')[1];
            const currentWindowUsed = results[index][1]; 
            
            if (currentWindowUsed > 0) {
                stats[userId] = { current_window_used: currentWindowUsed };
            }
        });
    }

    return stats;
}

module.exports = { consume, getStats, MAX_REQUESTS, WINDOW_MS };