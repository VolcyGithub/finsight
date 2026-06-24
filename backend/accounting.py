"""Double-entry accounting: Chart of Accounts, Journals, Customers/Vendors, Invoices (Stripe), Reports."""
import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException, Depends, Request
from pydantic import BaseModel, Field

from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout, CheckoutSessionRequest,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Account type -> normal balance side
NORMAL_DEBIT = {"asset", "expense"}

DEFAULT_ACCOUNTS = [
    ("1000", "Cash & Bank", "asset"),
    ("1100", "Accounts Receivable", "asset"),
    ("1200", "Inventory", "asset"),
    ("2000", "Accounts Payable", "liability"),
    ("2100", "Sales Tax Payable", "liability"),
    ("3000", "Owner's Equity", "equity"),
    ("3900", "Retained Earnings", "equity"),
    ("4000", "Sales Income", "income"),
    ("4100", "Service Income", "income"),
    ("5000", "Cost of Goods Sold", "expense"),
    ("6000", "Rent Expense", "expense"),
    ("6100", "Payroll Expense", "expense"),
    ("6200", "Marketing Expense", "expense"),
    ("6300", "Software & Subscriptions", "expense"),
    ("6400", "Utilities", "expense"),
    ("6500", "Office Supplies", "expense"),
    ("6900", "Other Expenses", "expense"),
]


# ----------------------------- Pydantic models -----------------------------
class AccountInput(BaseModel):
    code: str
    name: str
    type: str  # asset|liability|equity|income|expense


class JournalLineInput(BaseModel):
    account_id: str
    debit: float = 0.0
    credit: float = 0.0


class JournalEntryInput(BaseModel):
    date: str
    memo: str = ""
    lines: List[JournalLineInput]


class ContactInput(BaseModel):
    type: str  # customer|vendor
    name: str
    email: str = ""
    phone: str = ""
    address: str = ""


class InvoiceLineInput(BaseModel):
    description: str
    quantity: float = 1.0
    unit_price: float = 0.0


class InvoiceInput(BaseModel):
    customer_id: str
    issue_date: str
    due_date: str
    line_items: List[InvoiceLineInput]
    tax_rate: float = 0.0
    notes: str = ""
    status: str = "sent"  # draft|sent


class CheckoutInput(BaseModel):
    origin_url: str


def register_accounting_routes(api, db, get_current_user):

    # ---------- Chart of Accounts ----------
    async def ensure_accounts(uid: str):
        existing = await db.accounts.count_documents({"user_id": uid})
        if existing == 0:
            docs = [{
                "id": str(uuid.uuid4()), "user_id": uid, "code": c, "name": n,
                "type": t, "system": True, "created_at": now_iso(),
            } for (c, n, t) in DEFAULT_ACCOUNTS]
            await db.accounts.insert_many(docs)

    async def account_by_code(uid: str, code: str):
        return await db.accounts.find_one({"user_id": uid, "code": code})

    @api.get("/accounts")
    async def list_accounts(user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        await ensure_accounts(uid)
        docs = await db.accounts.find({"user_id": uid}, {"_id": 0}).sort("code", 1).to_list(500)
        return {"accounts": docs}

    @api.post("/accounts")
    async def create_account(body: AccountInput, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        await ensure_accounts(uid)
        if body.type not in {"asset", "liability", "equity", "income", "expense"}:
            raise HTTPException(status_code=400, detail="Invalid account type")
        if await db.accounts.find_one({"user_id": uid, "code": body.code}):
            raise HTTPException(status_code=400, detail="Account code already exists")
        doc = {"id": str(uuid.uuid4()), "user_id": uid, "code": body.code, "name": body.name,
               "type": body.type, "system": False, "created_at": now_iso()}
        await db.accounts.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.delete("/accounts/{account_id}")
    async def delete_account(account_id: str, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        acc = await db.accounts.find_one({"id": account_id, "user_id": uid})
        if not acc:
            raise HTTPException(status_code=404, detail="Account not found")
        if acc.get("system"):
            raise HTTPException(status_code=400, detail="Cannot delete a system account")
        used = await db.journal_entries.find_one({"user_id": uid, "lines.account_id": account_id})
        if used:
            raise HTTPException(status_code=400, detail="Account has journal entries and cannot be deleted")
        await db.accounts.delete_one({"id": account_id, "user_id": uid})
        return {"ok": True}

    # ---------- Journal entries ----------
    async def post_journal(uid: str, date: str, memo: str, lines: List[dict], source: str, reference_id: str = ""):
        total_debit = round(sum(l["debit"] for l in lines), 2)
        total_credit = round(sum(l["credit"] for l in lines), 2)
        if total_debit <= 0 or abs(total_debit - total_credit) > 0.01:
            raise HTTPException(status_code=400, detail=f"Journal not balanced (debit {total_debit} vs credit {total_credit})")
        enriched = []
        for l in lines:
            acc = await db.accounts.find_one({"id": l["account_id"], "user_id": uid})
            if not acc:
                raise HTTPException(status_code=400, detail="Invalid account in journal line")
            enriched.append({
                "account_id": l["account_id"], "account_code": acc["code"],
                "account_name": acc["name"], "account_type": acc["type"],
                "debit": round(l["debit"], 2), "credit": round(l["credit"], 2),
            })
        doc = {"id": str(uuid.uuid4()), "user_id": uid, "date": date, "memo": memo,
               "lines": enriched, "total": total_debit, "source": source,
               "reference_id": reference_id, "created_at": now_iso()}
        await db.journal_entries.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.get("/journal")
    async def list_journal(user: dict = Depends(get_current_user), limit: int = 200):
        uid = str(user["_id"])
        docs = await db.journal_entries.find({"user_id": uid}, {"_id": 0}).sort("date", -1).to_list(limit)
        return {"entries": docs}

    @api.post("/journal")
    async def create_journal(body: JournalEntryInput, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        await ensure_accounts(uid)
        lines = [{"account_id": l.account_id, "debit": l.debit, "credit": l.credit} for l in body.lines]
        return await post_journal(uid, body.date, body.memo, lines, "manual")

    # ---------- Contacts (customers / vendors) ----------
    @api.get("/contacts")
    async def list_contacts(user: dict = Depends(get_current_user), type: Optional[str] = None):
        uid = str(user["_id"])
        q = {"user_id": uid}
        if type:
            q["type"] = type
        docs = await db.contacts.find(q, {"_id": 0}).sort("name", 1).to_list(500)
        return {"contacts": docs}

    @api.post("/contacts")
    async def create_contact(body: ContactInput, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        if body.type not in {"customer", "vendor"}:
            raise HTTPException(status_code=400, detail="type must be customer or vendor")
        doc = {"id": str(uuid.uuid4()), "user_id": uid, **body.model_dump(), "created_at": now_iso()}
        await db.contacts.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.delete("/contacts/{contact_id}")
    async def delete_contact(contact_id: str, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        await db.contacts.delete_one({"id": contact_id, "user_id": uid})
        return {"ok": True}

    # ---------- Invoices ----------
    async def next_invoice_number(uid: str) -> str:
        count = await db.invoices.count_documents({"user_id": uid})
        return f"INV-{count + 1:04d}"

    def compute_invoice_totals(line_items, tax_rate):
        subtotal = round(sum(li["quantity"] * li["unit_price"] for li in line_items), 2)
        tax_amount = round(subtotal * (tax_rate or 0) / 100.0, 2)
        return subtotal, tax_amount, round(subtotal + tax_amount, 2)

    @api.get("/invoices")
    async def list_invoices(user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        docs = await db.invoices.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(500)
        return {"invoices": docs}

    @api.get("/invoices/{invoice_id}")
    async def get_invoice(invoice_id: str, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        doc = await db.invoices.find_one({"id": invoice_id, "user_id": uid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Invoice not found")
        return doc

    @api.post("/invoices")
    async def create_invoice(body: InvoiceInput, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        await ensure_accounts(uid)
        customer = await db.contacts.find_one({"id": body.customer_id, "user_id": uid})
        if not customer:
            raise HTTPException(status_code=400, detail="Customer not found")
        line_items = []
        for li in body.line_items:
            line_items.append({"description": li.description, "quantity": li.quantity,
                               "unit_price": li.unit_price, "amount": round(li.quantity * li.unit_price, 2)})
        subtotal, tax_amount, total = compute_invoice_totals(line_items, body.tax_rate)
        if total <= 0:
            raise HTTPException(status_code=400, detail="Invoice total must be greater than zero")

        number = await next_invoice_number(uid)
        invoice = {
            "id": str(uuid.uuid4()), "user_id": uid, "number": number,
            "customer_id": body.customer_id, "customer_name": customer["name"],
            "customer_email": customer.get("email", ""),
            "issue_date": body.issue_date, "due_date": body.due_date,
            "line_items": line_items, "subtotal": subtotal, "tax_rate": body.tax_rate,
            "tax_amount": tax_amount, "total": total, "notes": body.notes,
            "status": "draft" if body.status == "draft" else "sent",
            "journal_entry_id": None, "paid_at": None, "stripe_session_id": None,
            "created_at": now_iso(),
        }

        if invoice["status"] == "sent":
            ar = await account_by_code(uid, "1100")
            inc = await account_by_code(uid, "4000")
            tax_acc = await account_by_code(uid, "2100")
            lines = [{"account_id": ar["id"], "debit": total, "credit": 0.0},
                     {"account_id": inc["id"], "debit": 0.0, "credit": subtotal}]
            if tax_amount > 0:
                lines.append({"account_id": tax_acc["id"], "debit": 0.0, "credit": tax_amount})
            je = await post_journal(uid, body.issue_date, f"Invoice {number} — {customer['name']}", lines, "invoice", invoice["id"])
            invoice["journal_entry_id"] = je["id"]

        await db.invoices.insert_one(invoice)
        invoice.pop("_id", None)
        return invoice

    async def mark_invoice_paid(uid: str, invoice: dict, method: str = "manual"):
        if invoice.get("status") == "paid":
            return
        cash = await account_by_code(uid, "1000")
        ar = await account_by_code(uid, "1100")
        total = invoice["total"]
        lines = [{"account_id": cash["id"], "debit": total, "credit": 0.0},
                 {"account_id": ar["id"], "debit": 0.0, "credit": total}]
        je = await post_journal(uid, now_iso()[:10], f"Payment for {invoice['number']} ({method})", lines, "payment", invoice["id"])
        await db.invoices.update_one(
            {"id": invoice["id"], "user_id": uid},
            {"$set": {"status": "paid", "paid_at": now_iso(), "payment_method": method, "payment_journal_id": je["id"]}},
        )

    @api.post("/invoices/{invoice_id}/mark-paid")
    async def manual_mark_paid(invoice_id: str, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        invoice = await db.invoices.find_one({"id": invoice_id, "user_id": uid})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        if invoice["status"] == "draft":
            raise HTTPException(status_code=400, detail="Send the invoice before marking it paid")
        await mark_invoice_paid(uid, invoice, "manual")
        return {"ok": True}

    @api.post("/invoices/{invoice_id}/send")
    async def send_invoice(invoice_id: str, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        invoice = await db.invoices.find_one({"id": invoice_id, "user_id": uid})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        if invoice["status"] != "draft":
            return {"ok": True}
        ar = await account_by_code(uid, "1100")
        inc = await account_by_code(uid, "4000")
        tax_acc = await account_by_code(uid, "2100")
        lines = [{"account_id": ar["id"], "debit": invoice["total"], "credit": 0.0},
                 {"account_id": inc["id"], "debit": 0.0, "credit": invoice["subtotal"]}]
        if invoice["tax_amount"] > 0:
            lines.append({"account_id": tax_acc["id"], "debit": 0.0, "credit": invoice["tax_amount"]})
        je = await post_journal(uid, invoice["issue_date"], f"Invoice {invoice['number']} — {invoice['customer_name']}", lines, "invoice", invoice["id"])
        await db.invoices.update_one({"id": invoice_id, "user_id": uid},
                                     {"$set": {"status": "sent", "journal_entry_id": je["id"]}})
        return {"ok": True}

    # ---------- Stripe payment for invoice ----------
    def stripe_client(request: Request) -> StripeCheckout:
        host_url = str(request.base_url)
        webhook_url = f"{host_url}api/webhook/stripe"
        return StripeCheckout(api_key=os.environ["STRIPE_API_KEY"], webhook_url=webhook_url)

    @api.post("/invoices/{invoice_id}/checkout")
    async def invoice_checkout(invoice_id: str, body: CheckoutInput, request: Request, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        invoice = await db.invoices.find_one({"id": invoice_id, "user_id": uid})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        if invoice["status"] == "paid":
            raise HTTPException(status_code=400, detail="Invoice is already paid")
        amount = float(invoice["total"])  # server-side amount, never from frontend
        origin = body.origin_url.rstrip("/")
        success_url = f"{origin}/invoices?session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = f"{origin}/invoices"
        checkout = stripe_client(request)
        req = CheckoutSessionRequest(
            amount=amount, currency="usd", success_url=success_url, cancel_url=cancel_url,
            metadata={"invoice_id": invoice_id, "user_id": uid, "invoice_number": invoice["number"]},
        )
        session = await checkout.create_checkout_session(req)
        await db.payment_transactions.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid, "invoice_id": invoice_id,
            "session_id": session.session_id, "amount": amount, "currency": "usd",
            "payment_status": "initiated", "status": "initiated",
            "metadata": {"invoice_number": invoice["number"]}, "created_at": now_iso(),
        })
        await db.invoices.update_one({"id": invoice_id, "user_id": uid}, {"$set": {"stripe_session_id": session.session_id}})
        return {"url": session.url, "session_id": session.session_id}

    @api.get("/payments/status/{session_id}")
    async def payment_status(session_id: str, request: Request, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        txn = await db.payment_transactions.find_one({"session_id": session_id, "user_id": uid})
        if not txn:
            raise HTTPException(status_code=404, detail="Payment session not found")
        checkout = stripe_client(request)
        status = await checkout.get_checkout_status(session_id)
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": status.payment_status, "status": status.status, "updated_at": now_iso()}},
        )
        if status.payment_status == "paid" and txn.get("payment_status") != "paid":
            invoice = await db.invoices.find_one({"id": txn["invoice_id"], "user_id": uid})
            if invoice:
                await mark_invoice_paid(uid, invoice, "stripe")
        return {"payment_status": status.payment_status, "status": status.status,
                "amount_total": status.amount_total, "currency": status.currency}

    @api.post("/webhook/stripe")
    async def stripe_webhook(request: Request):
        body = await request.body()
        sig = request.headers.get("Stripe-Signature")
        checkout = stripe_client(request)
        try:
            event = await checkout.handle_webhook(body, sig)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid webhook")
        if event.payment_status == "paid" and event.session_id:
            txn = await db.payment_transactions.find_one({"session_id": event.session_id})
            if txn and txn.get("payment_status") != "paid":
                await db.payment_transactions.update_one(
                    {"session_id": event.session_id},
                    {"$set": {"payment_status": "paid", "status": "complete", "updated_at": now_iso()}},
                )
                invoice = await db.invoices.find_one({"id": txn["invoice_id"], "user_id": txn["user_id"]})
                if invoice:
                    await mark_invoice_paid(txn["user_id"], invoice, "stripe")
        return {"received": True}

    # ---------- Reports ----------
    async def compute_balances(uid: str):
        entries = await db.journal_entries.find({"user_id": uid}).to_list(20000)
        accounts = await db.accounts.find({"user_id": uid}).to_list(500)
        bal = {a["id"]: {"code": a["code"], "name": a["name"], "type": a["type"], "debit": 0.0, "credit": 0.0}
               for a in accounts}
        for e in entries:
            for l in e["lines"]:
                aid = l["account_id"]
                if aid not in bal:
                    bal[aid] = {"code": l.get("account_code", "?"), "name": l.get("account_name", "?"),
                                "type": l.get("account_type", "asset"), "debit": 0.0, "credit": 0.0}
                bal[aid]["debit"] += l["debit"]
                bal[aid]["credit"] += l["credit"]
        for v in bal.values():
            v["debit"] = round(v["debit"], 2)
            v["credit"] = round(v["credit"], 2)
            if v["type"] in NORMAL_DEBIT:
                v["balance"] = round(v["debit"] - v["credit"], 2)
            else:
                v["balance"] = round(v["credit"] - v["debit"], 2)
        return bal

    @api.get("/reports/trial-balance")
    async def trial_balance(user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        await ensure_accounts(uid)
        bal = await compute_balances(uid)
        rows = sorted(bal.values(), key=lambda x: x["code"])
        total_debit = round(sum(r["debit"] for r in rows), 2)
        total_credit = round(sum(r["credit"] for r in rows), 2)
        return {"rows": rows, "total_debit": total_debit, "total_credit": total_credit}

    @api.get("/reports/profit-loss")
    async def profit_loss(user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        await ensure_accounts(uid)
        bal = await compute_balances(uid)
        income = [v for v in bal.values() if v["type"] == "income" and (v["debit"] or v["credit"])]
        expense = [v for v in bal.values() if v["type"] == "expense" and (v["debit"] or v["credit"])]
        total_income = round(sum(v["balance"] for v in income), 2)
        total_expense = round(sum(v["balance"] for v in expense), 2)
        return {
            "income": sorted(income, key=lambda x: x["code"]),
            "expense": sorted(expense, key=lambda x: x["code"]),
            "total_income": total_income, "total_expense": total_expense,
            "net_income": round(total_income - total_expense, 2),
        }

    @api.get("/reports/balance-sheet")
    async def balance_sheet(user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        await ensure_accounts(uid)
        bal = await compute_balances(uid)
        assets = [v for v in bal.values() if v["type"] == "asset" and v["balance"]]
        liabilities = [v for v in bal.values() if v["type"] == "liability" and v["balance"]]
        equity = [v for v in bal.values() if v["type"] == "equity" and v["balance"]]
        total_income = round(sum(v["balance"] for v in bal.values() if v["type"] == "income"), 2)
        total_expense = round(sum(v["balance"] for v in bal.values() if v["type"] == "expense"), 2)
        net_income = round(total_income - total_expense, 2)
        total_assets = round(sum(v["balance"] for v in assets), 2)
        total_liabilities = round(sum(v["balance"] for v in liabilities), 2)
        total_equity = round(sum(v["balance"] for v in equity) + net_income, 2)
        return {
            "assets": sorted(assets, key=lambda x: x["code"]),
            "liabilities": sorted(liabilities, key=lambda x: x["code"]),
            "equity": sorted(equity, key=lambda x: x["code"]),
            "net_income": net_income,
            "total_assets": total_assets,
            "total_liabilities": total_liabilities,
            "total_equity": total_equity,
            "balanced": abs(total_assets - (total_liabilities + total_equity)) < 0.01,
        }
