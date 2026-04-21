# Rate-Limited API Service

## Setup

```bash
npm install
npm start          # production
npm run dev        # with auto-reload (nodemon)
```

Server starts on `http://localhost:3000`.

---

## Endpoints

### POST /request

Accepts a payload and processes it (rate-limited: 5 requests per user per minute).

**Request**
```bash
curl -s -X POST http://localhost:3000/request \
  -H "Content-Type: application/json" \
  -d '{"user_id": "alice", "payload": {"action": "buy", "item": "book"}}'
```

**200 Response**
```json
{
  "success": true,
  "request_id": "f4a3c2d1-...",
  "user_id": "alice",
  "payload_received": { "action": "buy", "item": "book" },
  "processed_at": "2024-01-15T10:30:00.000Z",
  "rate_limit": {
    "remaining": 4,
    "limit": 5,
    "window": "60s"
  }
}
```

**429 Response (when limit is exceeded)**
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit of 5 requests per 60s exceeded.",
  "retry_after_seconds": 38
}
```

Response Headers:
```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 4
X-RateLimit-Window: 60s
Retry-After: 38   ← only on 429
```

---

### GET /stats

Returns real-time rate-limit state for all tracked users (or a specific user).

```bash
# All users
curl http://localhost:3000/stats

# Single user
curl http://localhost:3000/stats?user_id=alice
```

**Response**
```json
{
  "stats": {
    "alice": {
      "current_window_used": 3,
      "current_window_remaining": 2,
      "rate_limit": 5,
      "window_duration_seconds": 60,
      "retry_after_seconds": 0,
      "total_requests_all_time": 12,
      "last_request_at": "2024-01-15T10:30:00.000Z"
    }
  },
  "total_tracked_users": 1,
  "snapshot_at": "2024-01-15T10:30:05.000Z"
}
```

---

### GET /health

Liveness probe — no rate limiting.

```bash
curl http://localhost:3000/health
# { "status": "ok", "uptime": 42.1 }
```

---

## Testing concurrent requests manually

```bash
# Fire 7 requests for the same user in parallel
for i in $(seq 1 7); do
  curl -s -X POST http://localhost:3000/request \
    -H "Content-Type: application/json" \
    -d '{"user_id":"bob","payload":"test"}' &
done
wait
```

First 5 → 200, last 2 → 429.

---

## Rate Limiting Design: Sliding Window

Unlike a fixed window (resets every full minute), a **sliding window** tracks
timestamps of the last N requests. This prevents burst exploitation around
window reset boundaries.

Example: limit = 5/min, fixed window
- 23:59:58 → 5 requests (fills window)
- 00:00:01 → 5 more requests (new window!) → 10 in 3 seconds ✗

Sliding window sees all 10 timestamps within 60s → blocks correctly.

---

## Production Limitations

| Limitation | Impact | Fix |
|---|---|---|
| In-memory store | Lost on restart; not shared across processes | Redis with atomic INCR/EXPIRE |
| Single process only | PM2 cluster / k8s multi-pod breaks shared state | Redis Lua scripts or Redlock |
| No persistence | Stats reset on deploy | Redis or a time-series DB |
| No authentication | user_id is self-reported (trust-based) | JWT / API key verification |
| No payload processing | Echo-only | Queue (BullMQ, SQS) + worker |
| Memory growth | Map grows unboundedly with unique users | TTL-based eviction or LRU cache |

---

## Bonus Additions (Optional)

### Redis-backed rate limiting

Replace `rateLimiter.js` with `ioredis` + a Lua script for atomic sliding window:

```js
const redis = require('ioredis');
const client = new redis();

async function consume(userId) {
  const now = Date.now();
  const key = `rl:${userId}`;
  const windowStart = now - 60000;

  const pipeline = client.pipeline();
  pipeline.zremrangebyscore(key, '-inf', windowStart); // evict old
  pipeline.zcard(key);                                  // count remaining
  pipeline.zadd(key, now, `${now}`);                    // add current
  pipeline.pexpire(key, 60000);                         // TTL cleanup

  const results = await pipeline.exec();
  const countBefore = results[1][1];
  if (countBefore >= 5) {
    await client.zrem(key, `${now}`); // undo the add
    return { allowed: false };
  }
  return { allowed: true, remaining: 5 - countBefore - 1 };
}
```

### BullMQ queue (async processing)

```bash
npm install bullmq ioredis
```

```js
const { Queue, Worker } = require('bullmq');
const queue = new Queue('requests');

router.post('/request', rateLimitMiddleware, async (req, res) => {
  const job = await queue.add('process', { userId: req.userId, payload: req.body.payload });
  res.status(202).json({ job_id: job.id, status: 'queued' });
});

new Worker('requests', async (job) => {
  console.log('Processing', job.data);
  // Your actual business logic here
});
```

### Retry logic (client-side example)

```js
async function requestWithRetry(userId, payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch('http://localhost:3000/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, payload }),
    });

    if (res.status !== 429) return res.json();

    const { retry_after_seconds } = await res.json();
    if (attempt < maxRetries) {
      console.log(`Rate limited. Retrying in ${retry_after_seconds}s...`);
      await new Promise((r) => setTimeout(r, retry_after_seconds * 1000));
    }
  }
  throw new Error('Max retries exceeded');
}
```

### Advanced Architecture (Implemented)
* **Distributed Rate Limiting:** Uses **Redis Sorted Sets (ZSET)** to implement a highly accurate sliding window. This allows the API to be scaled horizontally across multiple servers while maintaining a strict global rate limit.
* **Queueing & Async Processing:** Integrated **BullMQ**. Instead of blocking the HTTP response, the API immediately returns `202 Accepted` and offloads the payload to a Redis-backed queue. Background workers process the jobs asynchronously.
* **Retry Logic:** * *Server-Side:* BullMQ is configured to automatically retry failed payload processing 3 times with exponential backoff.
  * *Client-Side:* The API provides a `Retry-After` header on `429` responses, allowing clients to implement intelligent delay rather than polling.

### Cloud Deployment (Azure / AWS / GCP)
The project includes a `Dockerfile` and `docker-compose.yml`. 
1. **Azure Web Apps for Containers:** Simply push the Docker image to Azure Container Registry (ACR), point Azure App Service to the image, and provide a managed Azure Cache for Redis connection string via the `REDIS_URL` environment variable.