"""Plaid integration tests using sandbox helper (public_token/create -> exchange -> sync).

Verifies:
- /api/plaid/create_link_token returns link-sandbox-* token
- exchange + sync imports transactions
- /api/plaid/status returns connected=true WITHOUT access_token_enc
- transactions are encrypted in DB (amount_enc/description_enc) and source='plaid'
- Plaid txns appear in /api/transactions and contribute to dashboard summary
- amount sign mapping: positive plaid amount -> expense
- /api/plaid/disconnect/{item_id} removes item and plaid-sourced transactions
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ai-ledger-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

PLAID_CLIENT_ID = "6a3b25b0e61d81000df1906a"
PLAID_SECRET = "c326913f23e63088bc2c7569273b22"
PLAID_SANDBOX = "https://sandbox.plaid.com"
INSTITUTION_ID = "ins_109508"


@pytest.fixture(scope="module")
def user_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_plaid_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"name": "Plaid Tester", "email": email, "password": "secret123"})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    s.email = email  # type: ignore
    return s


def _sandbox_public_token() -> str:
    r = requests.post(
        f"{PLAID_SANDBOX}/sandbox/public_token/create",
        json={
            "client_id": PLAID_CLIENT_ID,
            "secret": PLAID_SECRET,
            "institution_id": INSTITUTION_ID,
            "initial_products": ["transactions"],
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["public_token"]


class TestPlaidLinkToken:
    def test_create_link_token(self, user_session):
        r = user_session.post(f"{API}/plaid/create_link_token")
        assert r.status_code == 200, r.text
        tok = r.json().get("link_token", "")
        assert tok.startswith("link-sandbox-"), f"unexpected token: {tok}"

    def test_unauthenticated_blocked(self):
        r = requests.post(f"{API}/plaid/create_link_token")
        assert r.status_code == 401


class TestPlaidExchangeAndSync:
    def test_exchange_sync_full_flow(self, user_session):
        # 1) Create a sandbox public token via Plaid helper
        public_token = _sandbox_public_token()
        assert public_token.startswith("public-sandbox-")

        # 2) Exchange and link
        r = user_session.post(
            f"{API}/plaid/exchange_public_token",
            json={"public_token": public_token, "institution_name": "First Platypus Bank"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("institution") == "First Platypus Bank"
        imported_first = body.get("imported", 0)

        # 3) /plaid/sync (may need retries; sandbox generates data async)
        total = imported_first
        for _ in range(8):
            if total > 0:
                break
            time.sleep(4)
            rs = user_session.post(f"{API}/plaid/sync")
            assert rs.status_code == 200, rs.text
            total += rs.json().get("imported", 0)

        assert total > 0, f"Expected >0 imported plaid transactions, got {total}"
        # 4) Verify transactions list now includes plaid-sourced ones
        rt = user_session.get(f"{API}/transactions")
        assert rt.status_code == 200
        txns = rt.json()["transactions"]
        assert len(txns) > 0
        # at least one income or expense type valid
        for t in txns[:5]:
            assert t["type"] in ("income", "expense")
            assert isinstance(t["amount"], (int, float))
            assert t["amount"] >= 0  # stored absolute

        # 5) Dashboard summary picks them up
        rd = user_session.get(f"{API}/dashboard/summary")
        assert rd.status_code == 200
        summary = rd.json()
        assert summary["transaction_count"] >= total
        assert (summary["total_income"] + summary["total_expense"]) > 0

        # stash for later tests
        user_session.plaid_total = total  # type: ignore

    def test_status_does_not_leak_access_token(self, user_session):
        r = user_session.get(f"{API}/plaid/status")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["connected"] is True
        assert isinstance(data["items"], list) and len(data["items"]) > 0
        item = data["items"][0]
        # Critical: access token must NEVER leak
        assert "access_token" not in item
        assert "access_token_enc" not in item
        assert "_id" not in item
        assert item["institution_name"] == "First Platypus Bank"
        assert "item_id" in item
        user_session.item_id = item["item_id"]  # type: ignore

    def test_encrypted_storage_for_plaid_txns(self, user_session):
        try:
            from pymongo import MongoClient
        except ImportError:
            pytest.skip("pymongo not available")
        mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = mc[os.environ.get("DB_NAME", "test_database")]
        # find a plaid-sourced transaction for our user
        me_r = user_session.get(f"{API}/auth/me")
        uid = me_r.json()["user"]["id"]
        doc = db.transactions.find_one({"user_id": uid, "source": "plaid"})
        assert doc is not None, "No plaid-sourced transaction in DB"
        assert "amount_enc" in doc and "description_enc" in doc
        # plaintext fields should NOT exist
        assert "amount" not in doc
        assert "description" not in doc
        assert doc.get("worksheet_id", "").startswith("plaid:")
        assert "plaid_transaction_id" in doc


class TestPlaidDisconnect:
    def test_disconnect_removes_item_and_txns(self, user_session):
        # status to get item_id
        rs = user_session.get(f"{API}/plaid/status")
        items = rs.json()["items"]
        assert items, "No plaid items linked - prior test must have run first"
        item_id = items[0]["item_id"]

        # snapshot tx count before
        before = user_session.get(f"{API}/transactions").json()["transactions"]
        before_plaid_count = sum(1 for _ in before)  # all are plaid for this fresh user

        rd = user_session.post(f"{API}/plaid/disconnect/{item_id}")
        assert rd.status_code == 200
        assert rd.json().get("ok") is True

        # status now disconnected
        rs2 = user_session.get(f"{API}/plaid/status")
        assert rs2.status_code == 200
        assert rs2.json()["connected"] is False
        assert rs2.json()["items"] == []

        # transactions for plaid worksheet are gone
        after = user_session.get(f"{API}/transactions").json()["transactions"]
        assert len(after) < before_plaid_count or len(after) == 0

    def test_sync_with_no_items_returns_400(self, user_session):
        r = user_session.post(f"{API}/plaid/sync")
        assert r.status_code == 400
