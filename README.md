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

## 5. Where proto is connected

- gRPC server: `src/payment-service/main.ts` (`Transport.GRPC`, `proto/payments.proto`)
- gRPC client: `src/app-service/orders/orders.module.ts` (`ClientsModule.registerAsync`, same proto path)
- service name constants: `src/constants/grpc.constants.ts`

## 6. Notes

- `GetPaymentStatus` returns data from in-memory store in `payment-service` (not mocked from thin air).
- `Capture` and `Refund` are declared and implemented as stubs for now.
- After successful `Authorize`, `app-service` updates order status to `PAID` and upserts a row in DB table `payments`.
