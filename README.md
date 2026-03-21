# Orders Async Workflow with RabbitMQ

This project implements a reliable async order-processing flow:

- API quickly accepts `POST /orders`
- heavy processing runs in worker/consumer
- controlled retry with limit
- dead-letter queue (DLQ) for exhausted messages
- idempotent consumer (no duplicate side effects by `messageId`)

## 1) Run locally

### Prerequisites

- Node.js 20+
- Docker + Docker Compose

### Start infrastructure

Postgres and RabbitMQ are defined in `docker-compose.yml`. From the project root:

```bash
docker compose up -d
```

This publishes Postgres and RabbitMQ on **host** ports (defaults below). Override them in a root `.env` if they clash with other stacks:

| Variable | Default | Container |
| --- | --- | --- |
| `POSTGRES_HOST_PORT` | `5432` | `5432` (Postgres) |
| `RABBITMQ_AMQP_HOST_PORT` | `5673` | `5672` (AMQP) |
| `RABBITMQ_MANAGEMENT_HOST_PORT` | `15673` | `15672` (management UI) |

When Nest runs **on the host**, set `DB_HOST=localhost`, `DB_PORT` to the same value as `POSTGRES_HOST_PORT`, and point `RABBITMQ_URL` at `localhost` and `RABBITMQ_AMQP_HOST_PORT`. See `.env.example` and `.env.recheck` for a consistent example.

### Install and start API+worker

```bash
npm install
npm run db:migrate
npm run start:dev
```

The worker is part of the same Nest app (`OrdersWorkerService`) and starts automatically.

## 2) Environment variables

Copy `.env.example` to `.env.dev` (or `.env`) and adjust if needed. For a ready-made host-to-compose wiring checklist, see `.env.recheck`.

Key RabbitMQ/worker settings:

- `RABBITMQ_URL` - broker connection URL
- `RABBITMQ_PREFETCH` - consumer prefetch
- `ORDERS_MAX_ATTEMPTS` - max processing attempts (default `3`)
- `ORDERS_RETRY_DELAY_MS` - retry delays in milliseconds (comma-separated; default `5000,15000,30000`)
- `ORDERS_WORKER_SIMULATED_DELAY_MS` - optional processing delay simulation
- `ORDERS_WORKER_FAIL_ON_ATTEMPTS` - for demo/testing retries (`0,1,2`, etc.); leave empty to disable forced failures

## 3) RabbitMQ topology

### Exchange

- `orders.exchange` (`direct`, durable)

### Queues

- `orders.process` (main work queue, durable)
- `orders.retry.1`, `orders.retry.2`, `orders.retry.3` (retry delay queues, durable)
- `orders.dlq` (dead-letter queue, durable)

### Routing keys

- `orders.process` -> `orders.process`
- `orders.retry.1` -> `orders.retry.1`
- `orders.retry.2` -> `orders.retry.2`
- `orders.retry.3` -> `orders.retry.3`
- `orders.dlq` -> `orders.dlq`

### Bindings and flow

1. API publishes new order message to `orders.exchange` with key `orders.process`.
2. Worker consumes `orders.process` with manual ack.
3. If processing fails and attempts remain:
   - worker republishes message with incremented `attempt` to `orders.retry.N`
   - original message is acked
   - retry queue TTL expires and message dead-letters back to `orders.process`
4. If attempts are exhausted:
   - worker publishes to `orders.dlq`
   - original message is acked

## 4) Message format

```json
{
  "messageId": "uuid",
  "orderId": "uuid",
  "createdAt": "ISO date",
  "attempt": 0,
  "correlationId": "uuid",
  "producer": "orders-api",
  "eventName": "orders.process.requested"
}
```

## 5) Processing guarantees

### Manual ack and transaction boundary

Worker flow:

1. receive message
2. open DB transaction
3. perform idempotency insert (`processed_messages`)
4. process order (`status=PROCESSED`, `processedAt=now`)
5. commit transaction
6. ack message

If transaction fails, worker performs retry/DLQ logic and only then acks original message.

### Idempotency (at-least-once safe)

Table `processed_messages`:

- `message_id` (`UNIQUE`)
- `processed_at`
- `order_id`
- `handler`

Algorithm:

1. insert `message_id` in transaction
2. if unique violation (`23505`) -> duplicate delivery -> ack and exit
3. otherwise process normally and commit

This works correctly with parallel workers due to DB unique constraint.

## 6) API behavior

`POST /orders`:

- creates order with `status=PENDING`
- generates `messageId` (UUID)
- publishes message to RabbitMQ
- returns HTTP response immediately (no heavy sync processing in controller)

## 7) Logging

Worker logs include:

- `messageId`
- `orderId`
- `attempt`
- `result=success|duplicate|retry|dlq|nack`
- short `reason` on failures

## 8) Demo scenarios

Use RabbitMQ Management UI: `http://localhost:<RABBITMQ_MANAGEMENT_HOST_PORT>` (default [http://localhost:15673](http://localhost:15673) if you use compose defaults; `guest`/`guest` unless overridden).

### 8.1 Happy path

1. Ensure `ORDERS_WORKER_FAIL_ON_ATTEMPTS=` (empty) or unset variable
2. `POST /orders` -> order stored as `PENDING`
3. Worker consumes and updates order to `PROCESSED`

### 8.2 Retry

1. Set `ORDERS_WORKER_FAIL_ON_ATTEMPTS=0,1`
2. Create order
3. Observe retries through `orders.retry.1` and `orders.retry.2`
4. Third attempt succeeds

### 8.3 DLQ

1. Set `ORDERS_WORKER_FAIL_ON_ATTEMPTS=0,1,2`
2. Create order
3. After max attempts, message appears in `orders.dlq`

### 8.4 Idempotency

1. Republish same payload with same `messageId` into `orders.process`
2. Worker logs `result=duplicate`
3. No repeated side effects for that message
