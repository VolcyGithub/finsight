"""End-to-end tests for the QuickBooks-style accounting backend:
Chart of Accounts, Contacts, Journal, Invoices (+Stripe checkout) and Reports."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ai-ledger-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@finsight.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def admin():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return s


@pytest.fixture(scope="session")
def fresh_user():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_acc_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"name": "Acc User", "email": email, "password": "secret123"})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return s


# ---------------- Chart of accounts ----------------
class TestAccounts:
    def test_default_accounts_seeded(self, fresh_user):
        r = fresh_user.get(f"{API}/accounts")
        assert r.status_code == 200
        accs = r.json()["accounts"]
        codes = {a["code"] for a in accs}
        # 17 defaults expected
        assert len(accs) >= 17
        for code in ("1000", "1100", "2100", "3000", "4000", "5000", "6000"):
            assert code in codes
        # systems flag
        sys_acc = next(a for a in accs if a["code"] == "1000")
        assert sys_acc["system"] is True

    def test_create_and_delete_custom_account(self, fresh_user):
        payload = {"code": f"7{uuid.uuid4().hex[:3]}", "name": "TEST_Custom", "type": "expense"}
        r = fresh_user.post(f"{API}/accounts", json=payload)
        assert r.status_code == 200, r.text
        new = r.json()
        assert new["code"] == payload["code"]
        assert new["system"] is False
        # Delete works
        r2 = fresh_user.delete(f"{API}/accounts/{new['id']}")
        assert r2.status_code == 200

    def test_cannot_delete_system_account(self, fresh_user):
        accs = fresh_user.get(f"{API}/accounts").json()["accounts"]
        cash = next(a for a in accs if a["code"] == "1000")
        r = fresh_user.delete(f"{API}/accounts/{cash['id']}")
        assert r.status_code == 400


# ---------------- Contacts ----------------
class TestContacts:
    def test_create_customer_and_vendor_and_filter(self, fresh_user):
        c = fresh_user.post(f"{API}/contacts", json={"type": "customer", "name": "TEST_Cust", "email": "c@x.com"})
        assert c.status_code == 200
        cust_id = c.json()["id"]
        v = fresh_user.post(f"{API}/contacts", json={"type": "vendor", "name": "TEST_Vend"})
        assert v.status_code == 200

        lst = fresh_user.get(f"{API}/contacts", params={"type": "customer"}).json()["contacts"]
        types = {x["type"] for x in lst}
        assert types == {"customer"}
        assert any(x["id"] == cust_id for x in lst)

        # delete
        d = fresh_user.delete(f"{API}/contacts/{cust_id}")
        assert d.status_code == 200

    def test_invalid_contact_type(self, fresh_user):
        r = fresh_user.post(f"{API}/contacts", json={"type": "other", "name": "X"})
        assert r.status_code == 400


# ---------------- Journal ----------------
class TestJournal:
    def test_balanced_journal_posts(self, fresh_user):
        accs = fresh_user.get(f"{API}/accounts").json()["accounts"]
        cash = next(a for a in accs if a["code"] == "1000")
        equity = next(a for a in accs if a["code"] == "3000")
        body = {"date": "2026-01-05", "memo": "TEST_owner_invest", "lines": [
            {"account_id": cash["id"], "debit": 500.0, "credit": 0.0},
            {"account_id": equity["id"], "debit": 0.0, "credit": 500.0},
        ]}
        r = fresh_user.post(f"{API}/journal", json=body)
        assert r.status_code == 200, r.text
        je = r.json()
        assert je["total"] == 500.0
        assert len(je["lines"]) == 2

    def test_unbalanced_journal_rejected(self, fresh_user):
        accs = fresh_user.get(f"{API}/accounts").json()["accounts"]
        cash = next(a for a in accs if a["code"] == "1000")
        equity = next(a for a in accs if a["code"] == "3000")
        body = {"date": "2026-01-05", "memo": "TEST_unbalanced", "lines": [
            {"account_id": cash["id"], "debit": 100.0, "credit": 0.0},
            {"account_id": equity["id"], "debit": 0.0, "credit": 50.0},
        ]}
        r = fresh_user.post(f"{API}/journal", json=body)
        assert r.status_code == 400


# ---------------- Invoices + Reports + Stripe ----------------
class TestInvoicesAndReports:
    @pytest.fixture(scope="class")
    def invoice_ctx(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        email = f"TEST_inv_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{API}/auth/register", json={"name": "Inv User", "email": email, "password": "secret123"})
        assert r.status_code == 200, r.text
        s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
        # ensure accounts seeded
        s.get(f"{API}/accounts")
        # create customer
        c = s.post(f"{API}/contacts", json={"type": "customer", "name": "TEST_Acme", "email": "acme@x.com"})
        return {"s": s, "customer_id": c.json()["id"]}

    def test_create_sent_invoice_posts_journal(self, invoice_ctx):
        s = invoice_ctx["s"]
        body = {
            "customer_id": invoice_ctx["customer_id"],
            "issue_date": "2026-01-10", "due_date": "2026-02-10",
            "line_items": [{"description": "Consulting", "quantity": 10, "unit_price": 150}],
            "tax_rate": 10.0, "status": "sent",
        }
        r = s.post(f"{API}/invoices", json=body)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["subtotal"] == 1500.0
        assert inv["tax_amount"] == 150.0
        assert inv["total"] == 1650.0
        assert inv["status"] == "sent"
        assert inv["journal_entry_id"]
        assert inv["number"].startswith("INV-")
        invoice_ctx["invoice_id"] = inv["id"]
        invoice_ctx["invoice_total"] = inv["total"]

        # Verify journal posted: AR debit 1650, Income 1500, Tax 150
        jrn = s.get(f"{API}/journal").json()["entries"]
        je = next(e for e in jrn if e["id"] == inv["journal_entry_id"])
        codes = {l["account_code"]: l for l in je["lines"]}
        assert codes["1100"]["debit"] == 1650.0
        assert codes["4000"]["credit"] == 1500.0
        assert codes["2100"]["credit"] == 150.0

    def test_reports_after_invoice(self, invoice_ctx):
        s = invoice_ctx["s"]
        pl = s.get(f"{API}/reports/profit-loss").json()
        assert pl["total_income"] == 1500.0
        assert pl["net_income"] == 1500.0

        bs = s.get(f"{API}/reports/balance-sheet").json()
        assert bs["balanced"] is True
        # assets 1650, liabilities 150, equity (incl net income) 1500
        assert bs["total_assets"] == 1650.0
        assert bs["total_liabilities"] == 150.0
        assert bs["net_income"] == 1500.0

        tb = s.get(f"{API}/reports/trial-balance").json()
        assert tb["total_debit"] == tb["total_credit"]
        assert tb["total_debit"] == 1650.0

    def test_stripe_checkout_returns_url(self, invoice_ctx):
        s = invoice_ctx["s"]
        inv_id = invoice_ctx["invoice_id"]
        r = s.post(f"{API}/invoices/{inv_id}/checkout", json={"origin_url": "https://example.com"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["url"].startswith("https://checkout.stripe.com/")
        assert data["session_id"].startswith("cs_test_")
        invoice_ctx["session_id"] = data["session_id"]

    def test_payment_status_endpoint(self, invoice_ctx):
        s = invoice_ctx["s"]
        sid = invoice_ctx["session_id"]
        r = s.get(f"{API}/payments/status/{sid}")
        assert r.status_code == 200
        body = r.json()
        # Not paid yet — still pending/unpaid
        assert body["payment_status"] in ("unpaid", "no_payment_required", "paid")

    def test_mark_paid_posts_payment_journal(self, invoice_ctx):
        s = invoice_ctx["s"]
        # Create a second invoice and mark it paid (don't disturb the stripe checkout one)
        c2 = s.post(f"{API}/contacts", json={"type": "customer", "name": "TEST_PayCust"}).json()
        body = {
            "customer_id": c2["id"],
            "issue_date": "2026-01-12", "due_date": "2026-02-12",
            "line_items": [{"description": "Widget", "quantity": 1, "unit_price": 200}],
            "tax_rate": 0.0, "status": "sent",
        }
        inv = s.post(f"{API}/invoices", json=body).json()
        r = s.post(f"{API}/invoices/{inv['id']}/mark-paid")
        assert r.status_code == 200, r.text

        # verify status = paid
        got = s.get(f"{API}/invoices/{inv['id']}").json()
        assert got["status"] == "paid"
        assert got.get("payment_journal_id")

        # verify payment journal: Cash 1000 debit, AR 1100 credit
        jrn = s.get(f"{API}/journal").json()["entries"]
        je = next(e for e in jrn if e["id"] == got["payment_journal_id"])
        codes = {l["account_code"]: l for l in je["lines"]}
        assert codes["1000"]["debit"] == 200.0
        assert codes["1100"]["credit"] == 200.0
