# FinSight — Business Finances Management App

## Original Problem Statement
A business finances management app with integrated encrypted local-style storage for privacy; ability to upload worksheets (CSV/Excel) or connect to Google Drive; and AI to give insights, suggest improvements, and send alerts when something seems off in the data.

## User Choices
- Secure web app (React + FastAPI + MongoDB). PHP not available in environment.
- Encrypted server-side storage acceptable (true local desktop app = future premium tier).
- Data import: Both upload + Google Drive (upload shipped first; Drive deferred).
- AI: Gemini 3.1 Pro (gemini-3.1-pro-preview) via Emergent LLM key. Claude Sonnet 4.6 as alt.
- Auth: secure email/password (JWT).

## Architecture
- Backend: FastAPI (`/api` prefix), MongoDB (motor). Modules: `server.py` (routes), `security.py` (Fernet encryption + bcrypt + JWT), `ai_service.py` (Gemini).
- Privacy: transaction `amount` and `description` encrypted at rest with Fernet (AES); decrypted in app layer. Passwords bcrypt-hashed; JWT in httpOnly cookies + Bearer fallback.
- Frontend: React, Tailwind, shadcn/ui, recharts. Fonts: Manrope/IBM Plex Sans. Earthy light theme.

## User Personas
- SMB owner/operator who keeps books in spreadsheets and wants quick, private financial intelligence.

## Implemented (2026-06-24) — AI Transaction Classification (all sources)
- `POST /api/transactions/classify` (Gemini) classifies transactions in batches, updates category + `ai_categorized`, flags anomalies as alerts. Auto-runs in background on CSV/Excel upload, Google Drive import, and Plaid sync.
- Frontend Transactions page: "Classify with AI" button + AI badge on classified rows. Verified accurate (e.g. "AWS cloud hosting" → Software & Subscriptions, "Uber to client meeting" → Travel).

## Implemented (2026-06-24) — Reconciliation + AI Categorization + Invoice PDF/Email
- **Bank reconciliation**: `/api/reconciliation/*` — list unreconciled bank txns with AI/category-based suggested account, post to double-entry ledger (single + bulk), summary. Reports stay balanced. Frontend `/reconcile` page with per-row account select + "Post all suggested".
- **AI auto-categorization on sync**: new Plaid transactions are categorized by Gemini in a background task (sets category + ai_categorized, flags anomalies as alerts). Verified live (16 categorized, 3 alerts). Fixed asyncio task GC bug via strong references.
- **Invoice PDF + Email**: reportlab PDF (`/api/invoices/{id}/pdf`), Resend email with PDF attachment + Stripe pay link (`/api/invoices/{id}/email`). Frontend PDF/Email buttons per invoice.
- Verified: 11/11 new + 29/29 regression tests; live AI categorization + email confirmed.

## Implemented (2026-06-24) — Plaid Auto-Sync
- Link tokens now register a webhook URL (`/api/plaid/webhook`). On `SYNC_UPDATES_AVAILABLE` (and INITIAL/HISTORICAL/DEFAULT_UPDATE), the item is synced automatically — no manual "Sync now".
- Background fallback scheduler syncs all linked items every 30 min (`start_plaid_autosync`).
- Frontend shows per-bank "Synced {time}" and an auto-sync note. Verified: synthetic webhook triggers sync and updates last_synced.

## Implemented (2026-06-24) — Plaid Bank Connection
- **Connect bank via Plaid** (sandbox): Plaid Link on Import Data page → exchange token → auto-sync transaction history into the encrypted store, feeding dashboard + AI analysis (no manual entry).
- Endpoints: /api/plaid/create_link_token, /exchange_public_token, /sync, /status, /disconnect/{item_id}. Access tokens Fernet-encrypted; cursor-based incremental sync with dedupe; Plaid amount sign mapped to income/expense.
- Non-blocking Plaid SDK calls (asyncio.to_thread). Verified: 7/7 Plaid + 29/29 regression tests pass.

## Implemented (2026-06-24) — QuickBooks-style Accounting (Phase 1)
- **Double-entry engine**: balanced journal posting (debit==credit enforced), per-user **Chart of Accounts** (17 defaults auto-seeded) + custom accounts.
- **Customers & Vendors** records.
- **Invoicing**: create with line items + tax; auto-posts journal (Dr A/R, Cr Income, Cr Tax). Send / mark-paid (Dr Cash, Cr A/R).
- **Stripe payments** (test key sk_test_emergent): online invoice checkout, payment_transactions tracking, frontend polling, webhook, auto mark-paid on success. Amount enforced server-side.
- **Reports**: P&L, Balance Sheet (balances), Trial Balance — computed from the ledger.
- Frontend: Invoices, Customers & Vendors, Accounting (CoA + Journal), Reports pages + expanded sidebar.
- Verified: 12/12 new + 17/17 regression backend tests; frontend e2e 100% incl. live Stripe checkout URL.

## Implemented (2026-06-23)
- JWT auth + admin seeding + brute-force lockout.
- CSV/Excel upload (encrypted transactions) + Google Drive OAuth import (read-only).
- AI Insights (Gemini 3.1 Pro): insights/suggestions/anomaly alerts. Alerts center.
- Dashboard (KPIs + 3 charts), Transactions ledger, Settings.

## Backlog / Remaining
- P0: **Bank reconciliation** — match imported transactions to ledger/journal entries (next big piece the user requested).
- P1: Post imported CSV/Drive transactions into the double-entry ledger (bridge the two worlds).
- P1: Bills & Expenses (A/P) module; vendor bills with payment.
- P1: Save-as-draft invoices; invoice PDF + email send (Resend); recurring invoices.
- P1: Multi-user/business + roles (owner/accountant); per-period report date filters.
- P2: Multi-currency; tax reports; Stripe checkout session de-dup; longer payment poll backoff.

## Next Tasks
1. Bank reconciliation (match imports ↔ journal; post unmatched as journal entries).
2. Bills & Expenses (Accounts Payable) module.
