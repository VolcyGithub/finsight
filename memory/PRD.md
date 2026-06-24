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

## Implemented (2026-06-23)
- JWT auth (login/register/logout/me) + admin seeding + brute-force lockout.
- CSV/Excel upload with flexible column detection -> encrypted transactions.
- **Google Drive OAuth import** (read-only): connect/disconnect, list spreadsheets, import Sheets/xlsx/csv. Tokens stored Fernet-encrypted.
- Sample data generator (6 months, includes injected anomaly).
- Dashboard: KPIs + cash flow area chart, expense pie, monthly net bar.
- Transactions: list, type filter, add (dialog), delete.
- AI Insights: Gemini 3.1 Pro generates insights, suggestions, anomaly alerts.
- Alerts center (dismiss/read). Settings (profile, privacy, clear-data).
- Verified: 17/17 backend tests + frontend e2e at 100%. Drive endpoints verified server-side (full OAuth round-trip needs live Google auth by user).

## Backlog / Remaining
- P1: Per-user throttle on /api/ai/analyze; async job + polling for long analyses.
- P1: Secure cookie flag driven by env for production HTTPS.
- P1: Google Sheets export currently imports first tab only; support multi-tab selection.
- P2: Budgets & forecasting; recurring transaction detection; export reports (PDF).
- P2: Multi-currency; team/multi-user accounts.

## Next Tasks
1. Cash-flow forecasting + recurring-expense detection.
2. Production hardening (secure cookies via env, AI rate limit).
