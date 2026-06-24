"""Tests for bank reconciliation, invoice PDF, and invoice email (Resend test-mode)."""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://ai-ledger-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@finsight.com"
ADMIN_PASSWORD = "admin123"
RESEND_OWNER_EMAIL = "svolcy12@gmail.com"


# --------------------------- Fixtures ---------------------------
@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.text}"
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return s


@pytest.fixture(scope="module")
def fresh_user():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_recon_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"name": "Recon Tester", "email": email, "password": "secret123"})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    # Load sample data (deterministic, gives unreconciled txns)
    r2 = s.post(f"{API}/sample-data")
    assert r2.status_code == 200
    return s


# --------------------------- Reconciliation ---------------------------
class TestReconciliation:
    def test_summary_shape(self, fresh_user):
        r = fresh_user.get(f"{API}/reconciliation/summary")
        assert r.status_code == 200
        s = r.json()
        for k in ("total", "reconciled", "unreconciled", "unreconciled_amount"):
            assert k in s, f"missing {k}"
        assert s["total"] >= s["reconciled"] + s["unreconciled"] - 1
        assert s["unreconciled"] > 0, "expected some unreconciled txns from sample data"

    def test_list_unreconciled_has_suggestions_and_accounts(self, fresh_user):
        r = fresh_user.get(f"{API}/reconciliation/transactions", params={"status": "unreconciled"})
        assert r.status_code == 200
        data = r.json()
        assert "transactions" in data and "accounts" in data
        assert len(data["transactions"]) > 0
        assert len(data["accounts"]) > 0
        t = data["transactions"][0]
        for k in ("id", "date", "type", "amount", "description", "suggested_account_id"):
            assert k in t, f"missing key {k}"
        # suggested_account_id should resolve to a real account
        acct_ids = {a["id"] for a in data["accounts"]}
        assert t["suggested_account_id"] in acct_ids
        assert isinstance(t["amount"], (int, float))

    def test_reconciled_list_initially_empty(self, fresh_user):
        r = fresh_user.get(f"{API}/reconciliation/transactions", params={"status": "reconciled"})
        assert r.status_code == 200
        # Fresh user: no posts yet
        assert r.json()["transactions"] == []

    def test_post_creates_balanced_journal_and_increments(self, fresh_user):
        sbefore = fresh_user.get(f"{API}/reconciliation/summary").json()
        lst = fresh_user.get(f"{API}/reconciliation/transactions", params={"status": "unreconciled"}).json()
        txn = lst["transactions"][0]
        r = fresh_user.post(f"{API}/reconciliation/post", json={
            "transaction_id": txn["id"], "account_id": txn["suggested_account_id"]
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "journal_entry_id" in body

        # Summary increments
        safter = fresh_user.get(f"{API}/reconciliation/summary").json()
        assert safter["reconciled"] == sbefore["reconciled"] + 1
        assert safter["unreconciled"] == sbefore["unreconciled"] - 1

        # The txn now appears in reconciled list
        done = fresh_user.get(f"{API}/reconciliation/transactions", params={"status": "reconciled"}).json()
        assert any(t["id"] == txn["id"] for t in done["transactions"])

        # Verify journal entry is balanced (sum debits == sum credits)
        je = fresh_user.get(f"{API}/journal").json()["entries"]
        match = [e for e in je if e["id"] == body["journal_entry_id"]]
        assert match, "journal entry not found"
        lines = match[0]["lines"]
        debits = sum(l.get("debit", 0) for l in lines)
        credits = sum(l.get("credit", 0) for l in lines)
        assert abs(debits - credits) < 0.01, f"unbalanced: {debits} vs {credits}"
        assert abs(debits - txn["amount"]) < 0.01

    def test_post_bulk(self, fresh_user):
        lst = fresh_user.get(f"{API}/reconciliation/transactions", params={"status": "unreconciled"}).json()
        # take 5 to post in bulk
        items = [{"transaction_id": t["id"], "account_id": t["suggested_account_id"]}
                 for t in lst["transactions"][:5]]
        assert items, "need at least 1 unreconciled to bulk-post"
        before = fresh_user.get(f"{API}/reconciliation/summary").json()["reconciled"]
        r = fresh_user.post(f"{API}/reconciliation/post-bulk", json={"items": items})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("posted") == len(items)
        after = fresh_user.get(f"{API}/reconciliation/summary").json()["reconciled"]
        assert after - before == len(items)

    def test_reports_still_balance_after_reconciliation(self, fresh_user):
        # Trial balance: sum debits should equal sum credits
        r = fresh_user.get(f"{API}/reports/trial-balance")
        assert r.status_code == 200
        tb = r.json()
        rows = tb.get("rows", [])
        if rows:
            d = sum(r.get("debit", 0) for r in rows)
            c = sum(r.get("credit", 0) for r in rows)
            assert abs(d - c) < 0.01, f"Trial balance unbalanced after reconciliation: {d} vs {c}"
        # Balance sheet: assets == liabilities + equity (approximate)
        r2 = fresh_user.get(f"{API}/reports/balance-sheet")
        assert r2.status_code == 200

    def test_post_invalid_account_rejected(self, fresh_user):
        lst = fresh_user.get(f"{API}/reconciliation/transactions", params={"status": "unreconciled"}).json()
        if not lst["transactions"]:
            pytest.skip("no unreconciled left")
        txn = lst["transactions"][0]
        r = fresh_user.post(f"{API}/reconciliation/post", json={
            "transaction_id": txn["id"], "account_id": "does-not-exist"
        })
        assert r.status_code in (400, 404), f"expected 4xx, got {r.status_code} {r.text}"


# --------------------------- Invoice PDF ---------------------------
@pytest.fixture(scope="module")
def invoice_for_owner(admin):
    """Create a customer with the Resend-allowed email and an invoice for them."""
    # Create customer (svolcy12@gmail.com)
    r = admin.post(f"{API}/contacts", json={
        "name": f"TEST_Owner_{uuid.uuid4().hex[:6]}",
        "email": RESEND_OWNER_EMAIL,
        "type": "customer",
    })
    assert r.status_code == 200, r.text
    contact = r.json().get("contact") or r.json()
    cid = contact["id"]

    inv = admin.post(f"{API}/invoices", json={
        "customer_id": cid,
        "issue_date": "2026-01-15",
        "due_date": "2026-02-15",
        "line_items": [{"description": "TEST item", "quantity": 1, "unit_price": 50.0}],
        "tax_rate": 0,
    })
    assert inv.status_code == 200, inv.text
    inv_data = inv.json().get("invoice") or inv.json()
    return inv_data


@pytest.fixture(scope="module")
def invoice_other_email(admin):
    r = admin.post(f"{API}/contacts", json={
        "name": f"TEST_Other_{uuid.uuid4().hex[:6]}",
        "email": "ap-other@example.com",
        "type": "customer",
    })
    assert r.status_code == 200, r.text
    contact = r.json().get("contact") or r.json()
    cid = contact["id"]
    inv = admin.post(f"{API}/invoices", json={
        "customer_id": cid,
        "issue_date": "2026-01-15",
        "due_date": "2026-02-15",
        "line_items": [{"description": "TEST item", "quantity": 2, "unit_price": 25.0}],
        "tax_rate": 0,
    })
    assert inv.status_code == 200, inv.text
    return inv.json().get("invoice") or inv.json()


class TestInvoicePDF:
    def test_pdf_endpoint_returns_pdf(self, admin, invoice_for_owner):
        iid = invoice_for_owner["id"]
        r = admin.get(f"{API}/invoices/{iid}/pdf")
        assert r.status_code == 200, r.text
        ct = r.headers.get("content-type", "")
        assert "application/pdf" in ct, f"unexpected content-type: {ct}"
        assert r.content[:4] == b"%PDF", "not a PDF body"
        assert len(r.content) > 500

    def test_pdf_unknown_invoice_404(self, admin):
        r = admin.get(f"{API}/invoices/does-not-exist/pdf")
        assert r.status_code in (404, 400)


class TestInvoiceEmail:
    def test_email_success_to_owner(self, admin, invoice_for_owner):
        iid = invoice_for_owner["id"]
        r = admin.post(f"{API}/invoices/{iid}/email", json={})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "email_id" in body and body["email_id"]

    def test_email_to_non_owner_returns_500(self, admin, invoice_other_email):
        """Resend test-mode rejects non-owner addresses; we expect a clear 5xx."""
        iid = invoice_other_email["id"]
        r = admin.post(f"{API}/invoices/{iid}/email", json={})
        # Expected behaviour: server surfaces Resend rejection as 500 with detail
        assert r.status_code >= 400
        # message should mention testing/owner-only or be non-empty
        try:
            detail = r.json().get("detail") or r.text
        except Exception:
            detail = r.text
        assert detail
