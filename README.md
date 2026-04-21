# 🚦 Rate-Limited API Service

**Live API:** [https://rate-limited-api-bk0f.onrender.com](https://rate-limited-api-bk0f.onrender.com)

A production-ready, distributed REST API service that enforces a strict limit of **5 requests per minute per user** using a **Sliding Window** algorithm backed by **Redis**, with asynchronous payload processing via **BullMQ**.

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (v18+) |
| Framework | Express.js |
| Data Store / Cache | Redis (via `ioredis`) |
| Background Queue | BullMQ |
| Infrastructure | Docker & Docker Compose |

---

## ⚙️ Setup & Installation

### Option A: Docker (Recommended)

The fastest way to spin up the application and its Redis dependency together.

```bash
docker-compose up -d
```

### Option B: Local Node.js

Requires a local Redis instance running on port `6379`.

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

> Server starts on **http://localhost:3000**

---

## 📡 API Endpoints

### `POST /request`

Accepts a payload and queues it for background processing. Rate-limited to **5 requests per user per 60 seconds**.

**Request**
```bash
curl -s -X POST http://localhost:3000/request \
  -H "Content-Type: application/json" \
  -d '{"user_id": "alice", "payload": {"action": "buy", "item": "book"}}'
```

**`202 Accepted` — Success**
```json
{
  "message": "Request accepted and queued",
  "job_id": "1",
  "user_id": "alice",
  "rate_limit_remaining": 4
}
```

**`429 Too Many Requests` — Limit Exceeded**
```json
{
  "error": "Too Many Requests",
  "message": "Limit of 5 requests per minute exceeded.",
  "retry_after_seconds": 38
}
```

**Response Headers**

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum requests allowed per window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Window` | Window duration (`60s`) |
| `Retry-After` | Seconds until the limit resets *(only on `429`)* |

---

### `GET /stats`

Returns real-time rate-limit state for all active users within the current window. **Not rate-limited.**

```bash
curl http://localhost:3000/stats
```

```json
{
  "active_users_in_window": {
    "alice": {
      "current_window_used": 3
    }
  }
}
```

---

### `GET /health`

Liveness probe for cloud load balancers and container orchestration.

```bash
curl http://localhost:3000/health
```

```json
{ "status": "UP", "uptime": 42.1 }
```

---

## 🏗️ Architecture & Design Decisions

### 1. Distributed Rate Limiting (Redis Lua Scripting)

This service uses a **Redis Sorted Set (ZSET)** to implement an exact Sliding Window algorithm, avoiding the burst-exploitation vulnerability of a fixed-window approach.

- **Atomicity:** Validation, eviction of stale timestamps, and insertion of new requests are executed via a custom Lua script — guaranteeing 100% atomicity and preventing race conditions under heavy parallel load across multiple Node.js instances.
- **Non-Blocking Stats:** The `/stats` endpoint uses `scanStream` instead of the blocking `KEYS *` command to safely fetch active user metrics without stalling the Redis event loop.

### 2. Asynchronous Processing (BullMQ)

The `POST /request` endpoint never blocks on payload processing. It immediately returns `202 Accepted` and offloads work to a Redis-backed queue, where background workers consume jobs asynchronously.

- **Resilience:** BullMQ is configured to automatically retry failed jobs **3 times** with exponential backoff.

### 3. Production Readiness

| Feature | Implementation |
|---|---|
| Graceful Shutdown | `SIGINT` / `SIGTERM` handlers cleanly drain the Express server, BullMQ workers, and Redis connections |
| HTTP Security | `helmet` middleware for secure response headers |
| Request Logging | `morgan` for structured request logging |

---

## 🧪 Testing Concurrency

To verify sliding window logic and Redis atomicity, fire parallel requests against the same user:

```bash
# Fire 7 parallel requests for the same user
for i in {1..7}; do
  curl -s -o /dev/null -w "Request $i: HTTP %{http_code}\n" \
    -X POST http://localhost:3000/request \
    -H "Content-Type: application/json" \
    -d '{"user_id": "spammer_user", "payload": "spam"}' &
done
wait
```

**Expected result:** The first 5 requests return `HTTP 202`; the remaining 2 return `HTTP 429`.

---

## ☁️ Cloud Deployment

This project is fully **cloud-agnostic**. The included `Dockerfile` uses a multi-stage, least-privilege (`USER node`) build optimised for production via `npm ci`.

### Azure Web Apps for Containers

1. Push the Docker image to **Azure Container Registry (ACR)**.
2. Point **Azure App Service** to the image.
3. Provide an **Azure Cache for Redis** connection string via the `REDIS_URL` environment variable.

### AWS ECS / Fargate

Deploy the container using an **Elasticache Redis** backend as the data store and queue broker.
