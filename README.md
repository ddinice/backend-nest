# Orders + Payments gRPC integration

This project has two independent services:

- `app-service` (HTTP API for orders, gRPC client for payments)
- `payment-service` (gRPC server with in-memory payment storage)

Contract between services is defined only in `proto/payments.proto`.

## 1. Proto contract

File: `proto/payments.proto`

- package: `payments.v1`
- service: `Payments`
- methods:
  - `Authorize`
  - `GetPaymentStatus`
  - `Capture` (stub)
  - `Refund` (stub)

`app-service` uses gRPC client interfaces that map to this contract and does not import payment-service internals.

## 2. Environment

Copy `.env.example` to `.env.dev` and adjust if needed.

Important variables:

- `APP_SERVICE_PORT` - HTTP port for orders API (default `3022`)
- `PAYMENTS_GRPC_BIND_URL` - bind address for payments gRPC server (default `0.0.0.0:5022`)
- `PAYMENTS_GRPC_URL` - endpoint used by app-service gRPC client (default `localhost:5022`)
- `PAYMENTS_GRPC_TIMEOUT_MS` - request timeout/deadline for gRPC calls from app-service
- `PAYMENTS_RPC_MAX_RETRIES`, `PAYMENTS_RPC_BACKOFF_MS` - retry policy for transient failures
- `DB_*` - Postgres connection for orders API

## 3. Run locally

All Nest/npm commands below are run from the **`app/`** directory (the workspace that contains `package.json` and `proto/`):

```bash
cd app
```

### 3.1 Start Postgres

From the **repository root** (parent of `app/`, where `docker-compose.yml` lives):

```bash
docker compose up -d db
```

This maps host port **5433** to Postgres (see `docker-compose.yml`). The app expects `DB_PORT=5433` in `.env.dev` (see `.env.example`).

### 3.2 Install and migrate

Install dependencies:

```bash
npm install
```

Run migrations + seed:

```bash
NODE_ENV=dev npm run db:migrate
NODE_ENV=dev npm run db:seed
```

Build once:

```bash
npm run build
```

Start services in separate terminals:

```bash
NODE_ENV=dev npm run start:payment-service
```

```bash
NODE_ENV=dev npm run start:app-service
```

## 4. Happy path (Orders -> Payments.Authorize)

1) Create an order:

```bash
curl -sS -X POST "http://localhost:3022/orders" \
  -H "content-type: application/json" \
  -d '{"items":[{"productId":"11111111-1111-1111-1111-111111111111","quantity":1}]}'
```

Response contains created `id` (order id).

2) Authorize payment for this order:

```bash
curl -sS -X POST "http://localhost:3022/orders/<ORDER_ID>/pay" \
  -H "content-type: application/json" \
  -d '{
    "userId":"22222222-2222-2222-2222-222222222222",
    "amount":"100.00",
    "currency":"USD",
    "paymentMethod":"card"
  }'
```

Expected response:

- `paymentId`
- `status` (typically `PAYMENT_STATUS_AUTHORIZED`)

## 4.1 Timeout / deadline path (slow Payments)

To hit the **client deadline** path (RxJS `timeout` on the gRPC call → **504 Gateway Timeout** with `Payments timeout: ...`), make the payment service slower than `PAYMENTS_GRPC_TIMEOUT_MS` on the app side.

1. Start **payment-service** and **app-service** as usual (two terminals, both from `app/` with `NODE_ENV=dev`).

2. In the app-service environment, set a **short** deadline (example: 200 ms):

   ```bash
   PAYMENTS_GRPC_TIMEOUT_MS=200 NODE_ENV=dev npm run start:app-service
   ```

3. Call pay with an artificial delay on the **Authorize** handler (field `simulateAuthorizeDelayMs` in the JSON body, forwarded over gRPC as `simulate_authorize_delay_ms`):

   ```bash
   curl -sS -X POST "http://localhost:3022/orders/<ORDER_ID>/pay" \
     -H "content-type: application/json" \
     -d '{
       "amount":"100.00",
       "currency":"USD",
       "paymentMethod":"card",
       "simulateAuthorizeDelayMs": 800
     }'
   ```

Expected: **504** and a message containing `Payments timeout` (this is the **deadline/timeout** path, not `UNAVAILABLE` from `simulateUnavailableOnce`).

## 5. Where proto is connected

- gRPC server: `src/payment-service/main.ts` (`Transport.GRPC`, `proto/payments.proto`)
- gRPC client: `src/app-service/orders/orders.module.ts` (`ClientsModule.registerAsync`, same proto path)
- service name constants: `src/constants/grpc.constants.ts`

## 6. Notes

- `GetPaymentStatus` returns data from in-memory store in `payment-service` (not mocked from thin air).
- `Capture` and `Refund` are declared and implemented as stubs for now.
- After successful `Authorize`, `app-service` updates order status to `PAID` and upserts a row in DB table `payments`.
- If a host port for gRPC is already in use (for example another container), point both services at a free port via `.env.dev`: set `PAYMENTS_GRPC_URL` (e.g. `localhost:22971` for the client) and `PAYMENTS_GRPC_BIND_URL` (e.g. `0.0.0.0:22971` for the payment server bind).

## 7. E2E test (Orders → Payments.Authorize)

From `app/`:

```bash
npm run test:e2e
```

The suite `test/orders-pay.e2e-spec.ts` runs **POST /orders** and **POST /orders/:id/pay** against the real HTTP stack (`ValidationPipe`, `OrdersController`). The database is not required: `OrdersService` and `PaymentsGrpcClient` are replaced with mocks; the mock `PaymentsGrpcClient` asserts the **Authorize** contract (order id, totals, payment method) and a successful authorize response is returned.
