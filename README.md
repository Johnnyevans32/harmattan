# Harmattan

> *The Harmattan is the trade wind that sweeps across West Africa every year, crossing every border on its way.*

**Harmattan** is the backend for a stablecoin cross-border payments sandbox, built for **Cardtonic's Operation Borderless** assessment. Each user gets one wallet per stablecoin (**cNGN, cGHS, cXAF, USDx, EURx**). On top of that it provides simulated deposits, FX swaps, cross-currency transfers, paginated history and live conversion rates.

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

| What                   | Where                                    |
| ---------------------- | ---------------------------------------- |
| API                    | http://localhost:3000/api/v1             |
| API reference (Scalar) | http://localhost:3000/docs               |
| OpenAPI JSON           | http://localhost:3000/openapi.json       |
| Committed spec         | [`docs/openapi.json`](docs/openapi.json) |

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
| Framework | **NestJS 11**                                | Modules, DI and decorators make the domain boundaries (`user`, `wallet`, `transaction`, `fx`) explicit and easy to test. DTO validation and the OpenAPI spec come from the same classes. |
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

1. **Multi-document ACID transactions** (replica set). A transfer's debit, its credit and the transaction record commit together or not at all. The same goes for creating a user together with their five wallets.
2. **`Decimal128`** is a native, exact 128-bit decimal type, and `$inc` on it is exact decimal arithmetic. Precision is never lost, not even inside the database.
3. **Atomic conditional updates.** `updateOne({ _id, balance: { $gte: x } }, { $inc: { balance: -x } })` checks and decrements in one server-side step. That is the core overdraft guard, with no read-modify-write window.
4. **Unique (partial) indexes** enforce "one user per email or phone", "one wallet per user per coin" and "one transaction per idempotency key", even under concurrent requests.

**Trade-off, stated honestly.** PostgreSQL would give `NUMERIC`, `SELECT ... FOR UPDATE` and `CHECK (balance >= 0)` constraints out of the box, and it is the more conventional choice for a ledger. The cost of MongoDB is that transactions require a replica set. Compose handles that, and the test suite runs on one.

---

## Running tests

```bash
yarn test          # full suite: unit + e2e (90 tests)
yarn test:unit     # unit only
yarn test:e2e      # e2e only
yarn test:cov      # with coverage
yarn lint && yarn typecheck
```

No external services are needed. Each e2e file boots the real Nest app against an in-memory MongoDB 8.2 replica set and swaps the FX provider for a deterministic stub. The first run downloads the MongoDB binary (around 100 MB, cached afterwards).

What's covered:

| Suite | Highlights |
| ----- | ---------- |
| `users-wallets` | A user is created with exactly one zero-balance wallet per coin, **atomically**; email is case-insensitive and phone is E.164-normalised; duplicates get `409`; **8 concurrent identical signups → 1 user and 5 wallets**; USD valuation. |
| `money-movement` | Deposits are exact (10 × `0.1` = `1.000000`); precision, sign, exponent and number-type validation; swaps into the same user's other wallet at the recorded rate, with truncation; overdraft rejected with nothing persisted; transfers convert into the recipient wallet's coin; transfers between your own wallets are rejected (use a swap). |
| `idempotency` | A replay returns `200` with `Idempotent-Replayed: true`; `"100"` and `"100.00"` count as the same request; key reuse with a different payload gets `422`; keys are scoped per wallet; **10 concurrent duplicates → processed once**; a failed request doesn't consume its key. |
| `concurrency` | **20 parallel swaps against a balance covering 10 → exactly 10 succeed and the balance ends at 0**; parallel fan-out transfers never overdraw; opposing A↔B transfers conserve the total; one user's different wallets don't block each other. |
| `transactions` | User-level history (across all wallets) and wallet-level history; newest first; pagination metadata; filters by type, by currency (either side) and by date; invalid queries get `400`; fetch by id. |
| `fx` | 20 pairs, each with `source`, `refreshedAt` and `stale`; quotes; outage keeps the last live rates; refreshed rates apply to new swaps; **if the provider never succeeds, the fallback table is used, flagged, and swaps still work**. |
| unit | Decimal maths and rounding, the response envelope, and FxService resolution order, partial data handling and single-flight refresh. |

---

## API walkthrough

Every response uses one envelope:

```jsonc
{ "code": 200, "message": "…", "data": { … }, "metadata": { … } /* lists only */ }
// errors
{ "code": 422, "message": "Insufficient cNGN balance" }
{ "code": 400, "message": "Validation failed", "errors": ["amount must be a positive decimal string, e.g. \"100.50\""] }
```

**Amounts are always decimal strings** (`"1500.25"`), both in requests and in responses. **Money always moves between wallets**, and each wallet holds exactly one coin, so the wallet decides the currency.

### Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/api/v1/users` | Create a user (email and/or phone) and their 5 wallets |
| `GET`  | `/api/v1/users/:userId` | All wallets + total in USD |
| `GET`  | `/api/v1/users/:userId/transactions` | History across all of the user's wallets |
| `GET`  | `/api/v1/wallets/:walletId` | A single wallet |
| `POST` | `/api/v1/wallets/:walletId/deposits` | Simulated deposit *(Idempotency-Key)* |
| `POST` | `/api/v1/wallets/:walletId/swaps` | Swap into the same user's wallet for another coin *(Idempotency-Key)* |
| `POST` | `/api/v1/wallets/:walletId/transfers` | Send to another user's wallet, converting automatically *(Idempotency-Key)* |
| `GET`  | `/api/v1/wallets/:walletId/transactions` | History for one wallet |
| `GET`  | `/api/v1/transactions/:transactionId` | Single transaction |
| `GET`  | `/api/v1/fx/rates` | All 20 pair rates with freshness |
| `GET`  | `/api/v1/fx/quote?from&to&amount` | Preview a conversion |
| `GET`  | `/api/v1/health` | Liveness + DB status |

Both history endpoints accept `page`, `limit`, `type`, `currency`, `startDate` and `endDate`.

Responses below come from a real run against the live FX provider (your ids and rates will differ).

### 1. Create users

```bash
curl -X POST localhost:3000/api/v1/users \
  -H 'Content-Type: application/json' \
  -d '{ "email": "ada@example.com" }'
```

```json
{
  "code": 201,
  "message": "User created successfully",
  "data": {
    "id": "6ae394faa9f614cda2d171fe",
    "email": "ada@example.com",
    "wallets": [
      { "id": "6ae394faa9f614cda2d17200", "userId": "6ae394faa9f614cda2d171fe", "currency": "cNGN", "balance": "0.000000", "usdValue": "0.00", "createdAt": "2026-10-29T18:48:26.614Z" },
      { "id": "6ae394faa9f614cda2d17202", "userId": "6ae394faa9f614cda2d171fe", "currency": "cGHS", "balance": "0.000000", "usdValue": "0.00", "createdAt": "2026-10-29T18:48:26.616Z" },
      { "id": "6ae394faa9f614cda2d17204", "userId": "6ae394faa9f614cda2d171fe", "currency": "cXAF", "balance": "0.000000", "usdValue": "0.00", "createdAt": "2026-10-29T18:48:26.618Z" },
      { "id": "6ae394faa9f614cda2d17206", "userId": "6ae394faa9f614cda2d171fe", "currency": "USDx", "balance": "0.000000", "usdValue": "0.00", "createdAt": "2026-10-29T18:48:26.619Z" },
      { "id": "6ae394faa9f614cda2d17208", "userId": "6ae394faa9f614cda2d171fe", "currency": "EURx", "balance": "0.000000", "usdValue": "0.00", "createdAt": "2026-10-29T18:48:26.620Z" }
    ],
    "totalUsd": "0.00",
    "createdAt": "2026-10-29T18:48:26.609Z"
  }
}
```

A user can also be created from a phone number: `{ "phone": "+233 20 123 4567" }` is stored as `+233201234567`. A second user for the same email or phone returns `409`.

### 2. Deposit into a wallet

```bash
curl -X POST localhost:3000/api/v1/wallets/6ae394faa9f614cda2d17200/deposits \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 0b6f7c1e-2d4a-4d38-9c8e-5f1a2b3c4d5e' \
  -d '{ "amount": "250000" }'
```

```json
{
  "code": 201,
  "message": "Deposit successful",
  "data": {
    "id": "6ae394fba9f614cda2d1721a",
    "type": "DEPOSIT",
    "senderUserId": null,
    "senderWalletId": null,
    "receiverUserId": "6ae394faa9f614cda2d171fe",
    "receiverWalletId": "6ae394faa9f614cda2d17200",
    "sourceCurrency": "cNGN",
    "sourceAmount": "250000.000000",
    "destinationCurrency": "cNGN",
    "destinationAmount": "250000.000000",
    "rate": "1",
    "rateSource": null,
    "rateRefreshedAt": null,
    "idempotencyKey": "0b6f7c1e-2d4a-4d38-9c8e-5f1a2b3c4d5e",
    "createdAt": "2026-10-29T18:48:27.298Z"
  }
}
```

### 3. Swap (cNGN → USDx)

The amount is taken from this wallet and credited to the same user's USDx wallet.

```bash
curl -X POST localhost:3000/api/v1/wallets/6ae394faa9f614cda2d17200/swaps \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 4c8e2a6f-1b3d-4f57-9e0a-7b6c5d4e3f2a' \
  -d '{ "toCurrency": "USDx", "amount": "15000" }'
```

```json
{
  "code": 201,
  "message": "Swap successful",
  "data": {
    "id": "6ae394fba9f614cda2d17221",
    "type": "SWAP",
    "senderUserId": "6ae394faa9f614cda2d171fe",
    "senderWalletId": "6ae394faa9f614cda2d17200",
    "receiverUserId": "6ae394faa9f614cda2d171fe",
    "receiverWalletId": "6ae394faa9f614cda2d17206",
    "sourceCurrency": "cNGN",
    "sourceAmount": "15000.000000",
    "destinationCurrency": "USDx",
    "destinationAmount": "11.142169",
    "rate": "0.000742811320143",
    "rateSource": "LIVE",
    "rateRefreshedAt": "2026-10-29T18:45:15.278Z",
    "idempotencyKey": "4c8e2a6f-1b3d-4f57-9e0a-7b6c5d4e3f2a",
    "createdAt": "2026-10-29T18:48:27.454Z"
  }
}
```

Swapping more than the balance returns `{ "code": 422, "message": "Insufficient cNGN balance" }`.

### 4. Cross-currency transfer (cNGN → another user's cGHS wallet)

The recipient wallet's coin decides what they receive. When it differs from the sender's coin, the amount is converted at the current rate.

```bash
curl -X POST localhost:3000/api/v1/wallets/6ae394faa9f614cda2d17200/transfers \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 9a1d3f5b-7c2e-4e60-8b4a-1c2d3e4f5a6b' \
  -d '{ "recipientWalletId": "6ae394faa9f614cda2d1720f", "amount": "50000" }'
```

```json
{
  "code": 201,
  "message": "Transfer successful",
  "data": {
    "id": "6ae394fba9f614cda2d17228",
    "type": "TRANSFER",
    "senderUserId": "6ae394faa9f614cda2d171fe",
    "senderWalletId": "6ae394faa9f614cda2d17200",
    "receiverUserId": "6ae394faa9f614cda2d1720b",
    "receiverWalletId": "6ae394faa9f614cda2d1720f",
    "sourceCurrency": "cNGN",
    "sourceAmount": "50000.000000",
    "destinationCurrency": "cGHS",
    "destinationAmount": "432.313068",
    "rate": "0.00864626137031",
    "rateSource": "LIVE",
    "rateRefreshedAt": "2026-10-29T18:45:15.278Z",
    "idempotencyKey": "9a1d3f5b-7c2e-4e60-8b4a-1c2d3e4f5a6b",
    "createdAt": "2026-10-29T18:48:27.611Z"
  }
}
```

**Retry the exact same request** and you get the same transaction back with no second debit:

```
HTTP/1.1 200 OK
Idempotent-Replayed: true
{"code":200,"message":"Transfer successful (idempotent replay)","data":{"id":"6ae394fba9f614cda2d17228", …}}
```

### 5. Balances, history and rates

```bash
curl localhost:3000/api/v1/users/6ae394faa9f614cda2d171fe
```

```json
{
  "code": 200,
  "message": "User retrieved successfully",
  "data": {
    "id": "6ae394faa9f614cda2d171fe",
    "email": "ada@example.com",
    "wallets": [
      { "id": "6ae394faa9f614cda2d17200", "currency": "cNGN", "balance": "185000.000000", "usdValue": "137.42", … },
      { "id": "6ae394faa9f614cda2d17206", "currency": "USDx", "balance": "11.142169", "usdValue": "11.14", … },
      …
    ],
    "totalUsd": "148.56",
    "createdAt": "2026-10-29T18:48:26.609Z"
  }
}
```

```bash
curl 'localhost:3000/api/v1/users/6ae394faa9f614cda2d171fe/transactions?type=TRANSFER&currency=cGHS&page=1&limit=20'
```

```json
{
  "code": 200,
  "message": "Transactions retrieved successfully",
  "data": [ { "id": "6ae394fba9f614cda2d17228", "type": "TRANSFER", … } ],
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
    { "from": "cNGN", "to": "cGHS", "rate": "0.00864626137031",  "source": "LIVE", "refreshedAt": "2026-10-29T18:45:15.278Z", "stale": false },
    { "from": "cNGN", "to": "USDx", "rate": "0.000742811320143", "source": "LIVE", "refreshedAt": "2026-10-29T18:45:15.278Z", "stale": false },
    …
  ]
}
```

---

## Data model

```
users                                  wallets                                 fx_rates
──────────────────────────────         ──────────────────────────────         ─────────────────────────
_id        ObjectId                    _id        ObjectId                     currency     Stablecoin (unique)
email?     string (unique*)      1───5 userId     ObjectId ┐ unique            unitsPerUsd  Decimal128
phone?     string (unique*, E.164)     currency   Stablecoin┘ (userId,currency) source       LIVE
createdAt                              balance    Decimal128                   refreshedAt  Date
* partial unique index                 createdAt

transactions (immutable)
──────────────────────────────────────────────────────────────────
_id                  ObjectId
type                 DEPOSIT | SWAP | TRANSFER
initiatorWalletId    ObjectId   ┐ unique: idempotency scope per wallet
idempotencyKey       string     ┘
requestHash          sha256 of the normalised request
senderUserId         ObjectId | null      senderWalletId     ObjectId | null
receiverUserId       ObjectId             receiverWalletId   ObjectId
sourceCurrency       Stablecoin           sourceAmount       Decimal128
destinationCurrency  Stablecoin           destinationAmount  Decimal128
rate                 Decimal128 (exact rate applied)
rateSource           LIVE | FALLBACK | null      rateRefreshedAt  Date | null
createdAt            Date

indexes: {sender|receiver}{Wallet|User}Id + createdAt, _id   (history, already sorted)
```

**Identity is separate from money.** A `user` is just identity (email and/or phone). Every user has exactly **one wallet per coin**, created in the same transaction as the user, with a unique `(userId, currency)` index. This keeps balances simple (one `Decimal128` per document). It also gives each coin its own document, so a cNGN swap and a EURx transfer by the same user never contend. And it leaves room for KYC, limits or freezes per user or per wallet later.

**One shape for all three transaction types.** Each record names the user *and* the wallet on both sides, plus how much of what left, how much of what arrived, the rate, and the time:

| type     | sender                  | receiver                    | source → destination        |
| -------- | ----------------------- | --------------------------- | --------------------------- |
| DEPOSIT  | `null`                  | wallet                      | same coin, rate `1`         |
| SWAP     | user's wallet (coin A)  | same user's wallet (coin B) | coin A → coin B             |
| TRANSFER | user's wallet           | another user's wallet       | sender coin → recipient coin |

So user history is `senderUserId = X OR receiverUserId = X`, and wallet history is the same on the wallet ids. Each is served by compound indexes already sorted by `createdAt`. The currency filter matches either side, so a cNGN → cGHS transfer appears under both `currency=cNGN` and `currency=cGHS`.

---

## Engineering decisions

### Money precision

- **No floats anywhere.** Requests take amounts as strings validated by a strict pattern: positive, no exponent, at most 6 decimals per coin, and capped at 10¹². JSON numbers are rejected, because `0.1 + 0.2` must never touch an amount.
- **Storage is `Decimal128`** and **arithmetic is `decimal.js`** (40-digit precision, isolated through a `Money` constructor in `core/money.ts`). Balance changes are `$inc` on Decimal128, so even the database does exact decimal arithmetic.
- **Every coin has 6 decimals** (the precision of real cNGN). Amounts that are more precise than that are rejected with `400`, not silently truncated.
- **Rates carry 12 significant digits**, and conversions **truncate** (round down) to the destination coin's smallest unit. The platform never creates value from rounding. A conversion that would yield 0 units is rejected.
- **Every conversion can be audited.** The *exact* rate used is the one stored, so `destinationAmount = truncate(sourceAmount × rate)` can be recomputed from the transaction record alone.

**Why not store integer minor units (cents)?** That pattern works well, but it isn't simpler here:
- With 6 decimals, the "cents" are millionths. JS numbers lose integer precision above about 9×10¹⁵ units, which is only about 9 billion cNGN, so it would need `BigInt` end to end (driver settings, custom JSON serialisation).
- FX conversion multiplies by a fractional rate, so a decimal library and rounding rules are needed anyway.
- Decimal128 `$inc` is already exact, and it removes a whole class of bugs where an amount is scaled twice or not at all.

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
  { _id: wallet._id, balance: { $gte: amount } },   // check…
  { $inc: { balance: -amount } },                   // …and decrement, atomically
)
```

- The balance check and the decrement are a **single atomic server-side operation**. There is no "read the balance, then write it" race, so a balance can't go negative under any interleaving.
- The debit, the credit and the transaction record **commit together or not at all**. A user and their five wallets are created the same way.
- **One document per wallet** means contention is limited to the wallet actually being debited. Activity in a user's other coins never conflicts with it.
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
├── user/                      # identity; creates one wallet per coin atomically
├── wallet/                    # single-currency wallets, atomic credit/debit, valuation
├── transaction/               # deposits, swaps, transfers, history, idempotent executor
└── fx/                        # rate provider, cache, fallback, quotes
test/                          # e2e suites + in-memory replica-set harness
scripts/generate-openapi.ts    # yarn docs:generate → docs/openapi.json (no DB needed)
```

---

## Assumptions

- **No authentication**, per the brief. Anyone who knows an id can act on it. In production every route would sit behind auth, and wallet ownership would be checked against the caller.
- **"The same email or number cannot create two wallets"** is enforced at the user level. A contact maps to exactly one user, and a user has exactly one wallet per coin.
- **Wallets are opened for every coin at signup.** This keeps balances and history uniform. Opening them lazily on first use would be an easy change.
- **Deposits are simulated.** They credit immediately, with no external payment rail and no pending state.
- **Stablecoins track their fiat 1:1**, so the coin rates *are* the fiat FX rates from the provider. All coins use 6 decimals.
- **No fees or spread.** Conversions use the mid-market rate. A fee or spread would be one extra field in `movement()`.
- **Transfers are addressed by wallet id** and must go to another user. Moving value between your own wallets is a swap.
- **Rates are indicative.** A swap uses the rate current at execution time. There is no quote-lock.

## Known limitations and next steps

What I deliberately left out to keep the scope tight and correct, and what I'd do next:

1. **Double-entry ledger.** Today the transaction record plus atomic balance updates are consistent, but balances are the source of truth. Next I'd add immutable debit and credit ledger entries per movement, derive or reconcile balances from them, and run a nightly invariant check (sum of entries = balances).
2. **Quote-lock for FX.** `POST /fx/quotes` would return a quote id valid for about 30 s, and swaps and transfers would accept it, so users execute at the price they were shown. The rate is then recorded against the quote.
3. **Multi-provider FX with sanity checks.** Query a second provider, compare the two, and reject a refresh that moves more than X% from the last good value (protection against bad data). Optionally block conversions when rates are `stale`, as a configurable risk control.
4. **Horizontal scaling.** Each instance currently refreshes FX on its own, which is harmless but wasteful. At scale I'd move the refresh to a single scheduled worker (BullMQ repeatable job) and share rates through Redis or the existing `fx_rates` collection with change streams.
5. **Idempotency key retention.** Keys currently live as long as their transaction. I'd add a separate TTL'd key store (for example, 24 h) if keys should be reusable after expiry.
6. **Auth, rate limiting and limits.** API keys or JWT, `@nestjs/throttler`, per-user and per-wallet daily limits, KYC tiers on the user.
7. **Recipient lookup.** Resolve a recipient by email or phone plus a coin (for example, "send cGHS to +233…") once auth exists to prevent enumeration.
8. **Cursor pagination** for very long histories, using `(createdAt, _id)` keyset pagination instead of offsets.
9. **Observability.** Structured JSON logs with request ids, Prometheus metrics (FX staleness, transaction-retry counts), and an outbox for transaction events (webhooks).
