# Harmattan

> *The Harmattan is the trade wind that sweeps across West Africa every year, crossing every border on its way.*

**Harmattan** is the backend for a stablecoin cross-border payments sandbox, built for **Cardtonic's Operation Borderless** assessment. It provides multi-currency wallets for **cNGN, cGHS, cXAF, USDx and EURx**: simulated deposits, FX swaps, cross-currency transfers, paginated history and live conversion rates.

The goal was a focused API that gets money right. Amounts use exact decimals, balance updates are atomic, every money-moving request is processed at most once, and an FX outage never takes the service down.

---

## Contents

- [Quick start](#quick-start)
- [Tech stack](#tech-stack)
- [Why MongoDB](#why-mongodb)
- [Running tests](#running-tests)
- [API walkthrough](#api-walkthrough)
- [Data model](#data-model)
- [Engineering decisions](#engineering-decisions)
  - [Money precision](#money-precision)
  - [Idempotency](#idempotency)
  - [Concurrency](#concurrency)
  - [FX rates and provider failure](#fx-rates-and-provider-failure)
- [Project structure](#project-structure)
- [Assumptions](#assumptions)
- [Known limitations and next steps](#known-limitations-and-next-steps)

---

## Quick start

```bash
docker compose up --build
```

That one command starts MongoDB as a single-node replica set, initialises the replica set, builds and starts the API, and fetches live FX rates.

| What                 | Where                                   |
| -------------------- | --------------------------------------- |
| API                  | http://localhost:3000/api/v1            |
| API reference (Scalar) | http://localhost:3000/docs           |
| OpenAPI JSON         | http://localhost:3000/openapi.json      |
| Committed spec       | [`docs/openapi.json`](docs/openapi.json)|

No migrations or seed step is needed. Mongoose builds the indexes on boot, and FX rates seed themselves: they come from the live provider, or from the built-in fallback table if the provider is unreachable.

The Scalar reference at **`/docs`** is fully interactive: every endpoint has examples and a "Test Request" button.

### Running locally without Docker

```bash
yarn install
cp .env.example .env      # point DB_URL at a MongoDB replica set
yarn start:dev
```

Transactions need a replica set. The quickest way is to run only the database from compose: `docker compose up mongo`.

---

## Tech stack

| Area      | Choice                                       | Why |
| --------- | -------------------------------------------- | --- |
| Runtime   | Node.js 22 LTS, TypeScript (`strict: true`)  | Required. Strict mode plus `noImplicitOverride` and `useUnknownInCatchVariables`. |
| Framework | **NestJS 11**                                | Modules, DI and decorators make the domain boundaries (`wallet`, `transaction`, `fx`) explicit and easy to test. DTO validation and the OpenAPI spec come from the same classes. |
| Database  | **MongoDB 8.2** via Mongoose                  | See [Why MongoDB](#why-mongodb). |
| Money     | `Decimal128` in storage, `decimal.js` in code | Exact decimal arithmetic end to end. No IEEE-754 floats anywhere. |
| FX        | [open.er-api.com](https://www.exchangerate-api.com/docs/free) | Free, keyless, and quotes NGN, GHS and XAF, which many free providers don't. |
| Docs      | `@nestjs/swagger` + **Scalar**               | The spec is generated from code, so it can't drift from the implementation. |
| Tests     | Jest, Supertest, `mongodb-memory-server`     | E2E tests run against a real in-memory **replica set**, so transactions behave as they do in production. |
| Tooling   | Yarn, ESLint (type-checked rules), Prettier  | Required. |
| Runtime   | Docker multi-stage build + Compose           | Small non-root image with a healthcheck. |

**No Redis or queue, deliberately.** The brief says to add them only where they earn their place. Here nothing does:
- FX rates are 5 numbers. They live in process memory and are persisted to Mongo as the last known good values.
- Every operation is synchronous and finishes in one database transaction, so there is no background work to queue.

Adding them would mean more moving parts with no correctness gain. [Next steps](#known-limitations-and-next-steps) notes where they would start to pay off.

---

## Why MongoDB

The brief allows PostgreSQL or MongoDB. Either can be correct for a ledger *if* you use it properly. I chose MongoDB because the guarantees this domain needs map directly onto its primitives:

1. **Multi-document ACID transactions** (replica set). A transfer's debit, its credit and the transaction record commit together or not at all.
2. **`Decimal128`** is a native, exact 128-bit decimal type, and `$inc` on it is exact decimal arithmetic. Precision is never lost, not even inside the database.
3. **Atomic conditional updates.** `updateOne({ _id, balance: { $gte: x } }, { $inc: { balance: -x } })` checks and decrements in one server-side step. That is the core overdraft guard, with no read-modify-write window.
4. **Unique (partial) indexes** enforce "one wallet per email or phone" and "one transaction per idempotency key", even under concurrent requests.
5. **The wallet is naturally a document.** It has one balance per coin, so the balance map is embedded, and a swap touches exactly one document.

**Trade-off, stated honestly.** PostgreSQL would give `NUMERIC`, `SELECT ... FOR UPDATE` and `CHECK (balance >= 0)` constraints out of the box, and it is the more conventional choice for a ledger. The cost of MongoDB is that transactions require a replica set. Compose handles that, and the test suite runs on one.

---

## Running tests

```bash
yarn test          # full suite: unit + e2e (82 tests)
yarn test:unit     # unit only
yarn test:e2e      # e2e only
yarn test:cov      # with coverage
yarn lint && yarn typecheck
```

No external services are needed. Each e2e file boots the real Nest app against an in-memory MongoDB 8.2 replica set and swaps the FX provider for a deterministic stub. The first run downloads the MongoDB binary (around 100 MB, cached afterwards).

What's covered:

| Suite | Highlights |
| ----- | ---------- |
| `wallets` | Zero balances in every coin; email is case-insensitive and phone is E.164-normalised; duplicates get `409`; **8 concurrent identical creates → exactly 1 wallet**; USD valuation. |
| `money-movement` | Deposits are exact (10 × `0.1` = `1.000000`); precision, sign, exponent and number-type validation; swaps at the recorded rate with truncation; overdraft rejected with nothing persisted; **a transfer to an unknown recipient rolls back the debit**. |
| `idempotency` | A replay returns `200` with `Idempotent-Replayed: true`; `"100"` and `"100.00"` count as the same request; key reuse with a different payload gets `422`; keys are scoped per wallet; **10 concurrent duplicates → processed once**; a failed request doesn't consume its key. |
| `concurrency` | **20 parallel swaps against a balance covering 10 → exactly 10 succeed and the balance ends at 0**; parallel fan-out transfers never overdraw; opposing A↔B transfers conserve the total. |
| `transactions` | Sent and received, newest first; pagination metadata; filters by type, by currency (either side) and by date; invalid queries get `400`; fetch by id. |
| `fx` | 20 pairs, each with `source`, `refreshedAt` and `stale`; quotes; outage keeps the last live rates; refreshed rates apply to new swaps; **if the provider never succeeds, the fallback table is used, flagged, and swaps still work**. |
| unit | Decimal maths and rounding, the response envelope, and FxService resolution order, partial data handling and single-flight refresh. |

---

## API walkthrough

Every response uses one envelope:

```jsonc
{ "code": 200, "message": "…", "data": { … }, "metadata": { … } /* lists only */ }
// errors
{ "code": 422, "message": "Insufficient USDx balance" }
{ "code": 400, "message": "Validation failed", "errors": ["amount must be a positive decimal string, e.g. \"100.50\""] }
```

**Amounts are always decimal strings** (`"1500.25"`), both in requests and in responses.

### Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/api/v1/wallets` | Create a wallet (email and/or phone) |
| `GET`  | `/api/v1/wallets/:walletId` | Balances + total in USD |
| `POST` | `/api/v1/wallets/:walletId/deposits` | Simulated deposit *(Idempotency-Key)* |
| `POST` | `/api/v1/wallets/:walletId/swaps` | Swap between coins *(Idempotency-Key)* |
| `POST` | `/api/v1/wallets/:walletId/transfers` | Send to another wallet, optionally cross-currency *(Idempotency-Key)* |
| `GET`  | `/api/v1/wallets/:walletId/transactions` | History: `page`, `limit`, `type`, `currency`, `startDate`, `endDate` |
| `GET`  | `/api/v1/transactions/:transactionId` | Single transaction |
| `GET`  | `/api/v1/fx/rates` | All 20 pair rates with freshness |
| `GET`  | `/api/v1/fx/quote?from&to&amount` | Preview a conversion |
| `GET`  | `/api/v1/health` | Liveness + DB status |

Responses below come from a real run against the live FX provider (your ids, keys and rates will differ).

### 1. Create wallets

```bash
curl -X POST localhost:3000/api/v1/wallets \
  -H 'Content-Type: application/json' \
  -d '{ "email": "ada@example.com" }'
```

```json
{
  "code": 201,
  "message": "Wallet created successfully",
  "data": {
    "id": "6ae38d039ff0eb06e79c36bd",
    "email": "ada@example.com",
    "balances": [
      { "currency": "cNGN", "amount": "0.000000", "usdValue": "0.00" },
      { "currency": "cGHS", "amount": "0.000000", "usdValue": "0.00" },
      { "currency": "cXAF", "amount": "0.000000", "usdValue": "0.00" },
      { "currency": "USDx", "amount": "0.000000", "usdValue": "0.00" },
      { "currency": "EURx", "amount": "0.000000", "usdValue": "0.00" }
    ],
    "totalUsd": "0.00",
    "createdAt": "2026-10-29T18:14:27.954Z"
  }
}
```

A wallet can also be created from a phone number: `{ "phone": "+233 20 123 4567" }` is stored as `+233201234567`. A second wallet for the same email or phone returns `409`.

### 2. Deposit

```bash
curl -X POST localhost:3000/api/v1/wallets/6ae38d039ff0eb06e79c36bd/deposits \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 0b6f7c1e-2d4a-4d38-9c8e-5f1a2b3c4d5e' \
  -d '{ "currency": "cNGN", "amount": "250000" }'
```

```json
{
  "code": 201,
  "message": "Deposit successful",
  "data": {
    "id": "6ae38d049ff0eb06e79c36c4",
    "type": "DEPOSIT",
    "senderWalletId": null,
    "receiverWalletId": "6ae38d039ff0eb06e79c36bd",
    "sourceCurrency": "cNGN",
    "sourceAmount": "250000.000000",
    "destinationCurrency": "cNGN",
    "destinationAmount": "250000.000000",
    "rate": "1",
    "rateSource": null,
    "rateRefreshedAt": null,
    "idempotencyKey": "0b6f7c1e-2d4a-4d38-9c8e-5f1a2b3c4d5e",
    "createdAt": "2026-10-29T18:14:28.222Z"
  }
}
```

### 3. Cross-currency transfer (cNGN → cGHS)

```bash
curl -X POST localhost:3000/api/v1/wallets/6ae38d039ff0eb06e79c36bd/transfers \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 9a1d3f5b-7c2e-4e60-8b4a-1c2d3e4f5a6b' \
  -d '{
        "recipientWalletId": "6ae38d049ff0eb06e79c36c0",
        "sourceCurrency": "cNGN",
        "destinationCurrency": "cGHS",
        "amount": "50000"
      }'
```

```json
{
  "code": 201,
  "message": "Transfer successful",
  "data": {
    "id": "6ae38d049ff0eb06e79c36c9",
    "type": "TRANSFER",
    "senderWalletId": "6ae38d039ff0eb06e79c36bd",
    "receiverWalletId": "6ae38d049ff0eb06e79c36c0",
    "sourceCurrency": "cNGN",
    "sourceAmount": "50000.000000",
    "destinationCurrency": "cGHS",
    "destinationAmount": "432.313068",
    "rate": "0.00864626137031",
    "rateSource": "LIVE",
    "rateRefreshedAt": "2026-10-29T18:14:11.080Z",
    "idempotencyKey": "9a1d3f5b-7c2e-4e60-8b4a-1c2d3e4f5a6b",
    "createdAt": "2026-10-29T18:14:28.358Z"
  }
}
```

Leave out `destinationCurrency` for a same-currency transfer (rate `1`). **Retry the exact same request** and you get the same transaction back with no second debit:

```
HTTP/1.1 200 OK
Idempotent-Replayed: true
{"code":200,"message":"Transfer successful (idempotent replay)","data":{"id":"6ae38d049ff0eb06e79c36c9", …}}
```

### 4. Swap

```bash
curl -X POST localhost:3000/api/v1/wallets/6ae38d039ff0eb06e79c36bd/swaps \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 4c8e2a6f-1b3d-4f57-9e0a-7b6c5d4e3f2a' \
  -d '{ "fromCurrency": "cNGN", "toCurrency": "USDx", "amount": "15000" }'
```

The response has the same shape as a transfer, with `type: "SWAP"` and the sender equal to the receiver. Swapping more than the balance returns:

```json
{ "code": 422, "message": "Insufficient cNGN balance" }
```

### 5. Balances, history and rates

```bash
curl localhost:3000/api/v1/wallets/6ae38d039ff0eb06e79c36bd
```

```json
{
  "code": 200,
  "message": "Wallet retrieved successfully",
  "data": {
    "id": "6ae38d039ff0eb06e79c36bd",
    "email": "ada@example.com",
    "balances": [
      { "currency": "cNGN", "amount": "200000.000000", "usdValue": "148.56" },
      { "currency": "cGHS", "amount": "0.000000", "usdValue": "0.00" },
      …
    ],
    "totalUsd": "148.56",
    "createdAt": "2026-10-29T18:14:27.954Z"
  }
}
```

```bash
curl 'localhost:3000/api/v1/wallets/6ae38d039ff0eb06e79c36bd/transactions?type=TRANSFER&currency=cGHS&page=1&limit=20'
```

```json
{
  "code": 200,
  "message": "Transactions retrieved successfully",
  "data": [ { "id": "6ae38d049ff0eb06e79c36c9", "type": "TRANSFER", … } ],
  "metadata": { "page": 1, "limit": 20, "totalDocs": 1, "totalPages": 1, "prevPage": null, "nextPage": null }
}
```

```bash
curl localhost:3000/api/v1/fx/rates
```

```json
{
  "code": 200,
  "message": "FX rates retrieved successfully",
  "data": [
    { "from": "cNGN", "to": "cGHS", "rate": "0.00864626137031",  "source": "LIVE", "refreshedAt": "2026-10-29T18:14:11.080Z", "stale": false },
    { "from": "cNGN", "to": "USDx", "rate": "0.000742811320143", "source": "LIVE", "refreshedAt": "2026-10-29T18:14:11.080Z", "stale": false },
    …
  ]
}
```

---

## Data model

```
wallets                                   transactions (immutable)
─────────────────────────────────         ──────────────────────────────────────────
_id                ObjectId               _id                  ObjectId
email?             string  (unique*)      type                 DEPOSIT | SWAP | TRANSFER
phone?             string  (unique*, E.164) initiatorWalletId  ObjectId  ┐ unique: idempotency
balances                                  idempotencyKey       string    ┘ scope per wallet
  cNGN             Decimal128             requestHash          sha256 of normalised request
  cGHS             Decimal128             senderWalletId       ObjectId | null
  cXAF             Decimal128             receiverWalletId     ObjectId
  USDx             Decimal128             sourceCurrency       Stablecoin
  EURx             Decimal128             sourceAmount         Decimal128
createdAt, updatedAt                      destinationCurrency  Stablecoin
                                          destinationAmount    Decimal128
* partial unique index                    rate                 Decimal128  (exact rate applied)
                                          rateSource           LIVE | FALLBACK | null
fx_rates                                  rateRefreshedAt      Date | null
─────────────────────────────────         createdAt            Date
currency      Stablecoin (unique)
unitsPerUsd   Decimal128                  indexes: {initiatorWalletId, idempotencyKey} unique
source        LIVE                                 {senderWalletId, createdAt, _id}
refreshedAt   Date                                 {receiverWalletId, createdAt, _id}
```

**One shape for all three transaction types.** Each record says who sent, who received, how much of what left, how much of what arrived, at what rate, and when:

| type     | sender | receiver  | source → destination |
| -------- | ------ | --------- | -------------------- |
| DEPOSIT  | `null` | wallet    | same coin, rate `1`  |
| SWAP     | wallet | wallet    | coin A → coin B      |
| TRANSFER | wallet | recipient | coin A → coin A or B |

So "transactions for wallet X" is just `sender = X OR receiver = X`, served by two compound indexes that are already sorted by `createdAt`. The currency filter matches either side, so a cNGN → cGHS transfer appears under both `currency=cNGN` and `currency=cGHS`.

---

## Engineering decisions

### Money precision

- **No floats anywhere.** Requests take amounts as strings validated by a strict pattern: positive, no exponent, at most 6 decimals per coin, and capped at 10¹². JSON numbers are rejected, because `0.1 + 0.2` must never touch an amount.
- **Storage is `Decimal128`** and **arithmetic is `decimal.js`** (40-digit precision, isolated through a `Money` constructor in `core/money.ts`). Balance changes are `$inc` on Decimal128, so even the database does exact decimal arithmetic.
- **Every coin has 6 decimals** (the precision of real cNGN). Amounts that are more precise than that are rejected with `400`, not silently truncated.
- **Rates carry 12 significant digits**, and conversions **truncate** (round down) to the destination coin's smallest unit. The platform never creates value from rounding. A conversion that would yield 0 units is rejected.
- **Every conversion can be audited.** The *exact* rate used is the one stored, so `destinationAmount = truncate(sourceAmount × rate)` can be recomputed from the transaction record alone.

### Idempotency

Deposits, swaps and transfers all **require** an `Idempotency-Key` header (8–128 chars, UUID recommended).

- A key is unique **per initiating wallet**: there is a unique index on `{initiatorWalletId, idempotencyKey}`.
- Each request is fingerprinted with the SHA-256 of its *normalised* payload, so `"100"` and `"100.00"` hash the same.
- **Same key, same payload:** the original transaction is returned with `200` and `Idempotent-Replayed: true`. Money moves only once.
- **Same key, different payload:** `422`, which catches client bugs instead of silently returning the wrong result.
- **Failed requests don't consume the key.** The record is written in the same transaction as the balance changes, so a rejected request (for example, insufficient funds) leaves no trace and can be retried with the same key once it is fixed.
- **Concurrent duplicates are handled.** If two identical requests race, either the second hits a write conflict (the driver retries it, finds the committed record and replays it), or it hits the unique index (caught, then replayed). The tests fire 10 identical transfers in parallel and assert exactly one `201` and nine `200`s.

### Concurrency

Every money movement runs inside **one MongoDB transaction** (snapshot read concern, majority write concern) through Mongoose's `connection.transaction()`. That helper automatically retries transient write conflicts.

```ts
// wallet.service.ts — the overdraft guard
updateOne(
  { _id: walletId, 'balances.cNGN': { $gte: amount } },   // check…
  { $inc: { 'balances.cNGN': -amount } },                 // …and decrement, atomically
)
```

- The balance check and the decrement are a **single atomic server-side operation**. There is no "read the balance, then write it" race, so a balance can't go negative under any interleaving.
- The debit, the credit and the transaction record **commit together or not at all**. A transfer to a missing recipient rolls the sender's debit back.
- Opposing transfers (A→B and B→A at the same time) can't deadlock. MongoDB detects the write conflict and the driver retries the transaction.
- Proven by tests: 20 parallel swaps against a balance that covers only 10 give exactly 10 successes and a final balance of `0.000000`.

### FX rates and provider failure

Rates are kept as **units per USD** for each coin (cNGN→NGN, cGHS→GHS, cXAF→XAF, USDx→USD, EURx→EUR) and crossed through USD. So `cNGN→cGHS = GHS per USD / NGN per USD`, and all 20 pairs are always consistent with each other (no triangular arbitrage).

For each coin, rates are resolved in this order:

1. **Live.** Refreshed from open.er-api.com on boot and then every 10 minutes (`FX_REFRESH_INTERVAL_MS`). The provider call has a 5 s timeout, and concurrent refreshes share one request.
2. **Last known good.** Every successful refresh is saved to `fx_rates`, so the rates survive restarts and outages.
3. **Fallback table.** A fixed, indicative table in `core/constants.ts`, used only until the provider has succeeded at least once.

How failures are handled:

- **A provider outage never blocks a request.** Rates are served from memory, and the refresh runs in the background. Failures are logged, and the last good rates stay in use.
- **Partial or bad data is handled per currency.** A missing, negative or non-numeric quote for one coin keeps that coin's previous rate and updates the others.
- **Transparency.** Every rate carries `source` (`LIVE` only if *both* legs are live), `refreshedAt` (the older leg) and `stale` (older than `FX_MAX_RATE_AGE_MS`, 24 h by default). Each transaction records the `rateSource` and `rateRefreshedAt` it used, so you can always tell which trades ran on fallback rates.

---

## Project structure

```
src/
├── main.ts                    # bootstrap + Scalar docs
├── app.setup.ts               # global prefix, ValidationPipe, exception filter (shared with tests)
├── app.module.ts / app.controller.ts (health)
├── core/
│   ├── response.ts            # ResponseService envelope, PaginateDTO, Swagger response decorators
│   ├── request.ts             # RequestService (axios wrapper for outbound HTTP)
│   ├── money.ts               # Decimal maths: parse, convert, round, format
│   ├── configuration.ts       # typed env config
│   ├── constants.ts           # collection names, coin registry, fallback rates
│   ├── docs.ts                # OpenAPI document + Scalar setup
│   ├── helpers.ts
│   ├── base.schema.ts
│   ├── decorators/            # @IsAmount, @IdempotencyKey
│   ├── filters/               # global exception → envelope
│   └── pipes/                 # ParseObjectIdPipe
├── enums/                     # Stablecoin, TransactionType, RateSource
├── wallet/                    # wallets, balances, atomic credit/debit
├── transaction/               # deposits, swaps, transfers, history, idempotent executor
└── fx/                        # rate provider, cache, fallback, quotes
test/                          # e2e suites + in-memory replica-set harness
scripts/generate-openapi.ts    # yarn docs:generate → docs/openapi.json (no DB needed)
```

---

## Assumptions

- **No authentication**, per the brief. Anyone who knows a wallet id can act on it. In production every route would sit behind auth, and wallet ownership would be checked against the caller.
- **Deposits are simulated.** They credit immediately, with no external payment rail and no pending state.
- **Stablecoins track their fiat 1:1**, so the coin rates *are* the fiat FX rates from the provider. All coins use 6 decimals.
- **No fees or spread.** Conversions use the mid-market rate. A fee or spread would be one extra field in `movement()`.
- **Transfers are addressed by wallet id.** Sending by email or phone would need a lookup endpoint, which raises enumeration and privacy questions that need auth first.
- A wallet may be created with an email, a phone number, or both. Each identifier can belong to only one wallet.
- **Rates are indicative.** A swap uses the rate current at execution time. There is no quote-lock.

## Known limitations and next steps

What I deliberately left out to keep the scope tight and correct, and what I'd do next:

1. **Double-entry ledger.** Today the transaction record plus atomic balance updates are consistent, but balances are the source of truth. Next I'd add immutable debit and credit ledger entries per movement, derive or reconcile balances from them, and run a nightly invariant check (sum of entries = balances).
2. **Quote-lock for FX.** `POST /fx/quotes` would return a quote id valid for about 30 s, and swaps and transfers would accept it, so users execute at the price they were shown. The rate is then recorded against the quote.
3. **Multi-provider FX with sanity checks.** Query a second provider, compare the two, and reject a refresh that moves more than X% from the last good value (protection against bad data). Optionally block conversions when rates are `stale`, as a configurable risk control.
4. **Horizontal scaling.** Each instance currently refreshes FX on its own, which is harmless but wasteful. At scale I'd move the refresh to a single scheduled worker (BullMQ repeatable job) and share rates through Redis or the existing `fx_rates` collection with change streams.
5. **Idempotency key retention.** Keys currently live as long as their transaction. I'd add a separate TTL'd key store (for example, 24 h) if keys should be reusable after expiry.
6. **Auth, rate limiting and limits.** API keys or JWT, `@nestjs/throttler`, per-wallet daily limits, KYC tiers.
7. **Cursor pagination** for very long histories, using `(createdAt, _id)` keyset pagination instead of offsets.
8. **Observability.** Structured JSON logs with request ids, Prometheus metrics (FX staleness, transaction-retry counts), and an outbox for transaction events (webhooks).
