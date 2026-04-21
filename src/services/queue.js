const { Queue, Worker } = require('bullmq');
const redis = require('../config/redis');

const QUEUE_NAME = 'request-payloads';

const payloadQueue = new Queue(QUEUE_NAME, { 
    connection: redis,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100
    }
});

const worker = new Worker(QUEUE_NAME, async (job) => {
    console.log(`[Worker] Processing Job ${job.id} for User: ${job.data.userId}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { status: 'completed', processedAt: Date.now() };
}, { 
    connection: redis,
    concurrency: 5
});

worker.on('completed', (job) => console.log(`✅ Job ${job.id} completed!`));
worker.on('failed', (job, err) => console.error(`❌ Job ${job.id} failed:`, err.message));
worker.on('error', (err) => console.error('⚠️ BullMQ Worker Error:', err.message));

const gracefulShutdown = async () => {
    try {
        await worker.close();
        console.log('BullMQ worker closed successfully.');
    } catch (err) {
        console.error('Error closing BullMQ worker:', err.message);
    }
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = { payloadQueue };