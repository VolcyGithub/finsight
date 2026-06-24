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
