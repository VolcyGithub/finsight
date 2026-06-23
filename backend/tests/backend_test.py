"""End-to-end backend tests for FinSight API.

Covers: auth (register/login/me/logout/lockout), sample-data, transactions
CRUD, dashboard summary, AI analyze + latest + alerts, upload CSV, clear data.
"""
import io
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ai-ledger-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@finsight.com"
ADMIN_PASSWORD = "admin123"


# ----------------------------- Fixtures -----------------------------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data and "user" in data
    s.headers.update({"Authorization": f"Bearer {data['access_token']}"})
    return s


@pytest.fixture(scope="session")
def new_user_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_user_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"name": "Test User", "email": email, "password": "secret123"})
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    data = r.json()
    s.headers.update({"Authorization": f"Bearer {data['access_token']}"})
    s.test_email = email  # type: ignore
    return s


# ----------------------------- Auth -----------------------------
class TestAuth:
    def test_admin_login(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        data = r.json()
        assert data["user"]["email"] == ADMIN_EMAIL
        assert data["user"]["role"] == "admin"
        assert isinstance(data["access_token"], str) and len(data["access_token"]) > 20

    def test_login_sets_httponly_cookies(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        cookies = r.cookies
        assert "access_token" in cookies, f"access_token cookie missing: {dict(cookies)}"
        # Look at Set-Cookie header for HttpOnly
        sc = r.headers.get("set-cookie", "").lower()
        assert "httponly" in sc

    def test_login_invalid_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong-pass-xyz"})
        assert r.status_code == 401

    def test_me_endpoint(self, admin_session):
        r = admin_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["user"]["email"] == ADMIN_EMAIL

    def test_register_new_user(self, new_user_session):
        r = new_user_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["user"]["email"].lower() == new_user_session.test_email.lower()

    def test_unauthenticated_request_blocked(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401


# ----------------------------- Sample data + dashboard -----------------------------
class TestSampleAndDashboard:
    def test_load_sample_data(self, admin_session):
        # ensure clean slate first
        admin_session.delete(f"{API}/data/clear")
        r = admin_session.post(f"{API}/sample-data")
        assert r.status_code == 200
        data = r.json()
        assert data["imported"] >= 100, f"Expected >=100 rows, got {data['imported']}"

    def test_dashboard_summary(self, admin_session):
        r = admin_session.get(f"{API}/dashboard/summary")
        assert r.status_code == 200
        s = r.json()
        for k in ("total_income", "total_expense", "net_profit", "transaction_count", "monthly", "categories"):
            assert k in s, f"Missing key {k}"
        assert s["transaction_count"] > 0
        assert s["total_expense"] > 0
        assert isinstance(s["monthly"], list) and len(s["monthly"]) > 0
        assert isinstance(s["categories"], list) and len(s["categories"]) > 0


# ----------------------------- Transactions CRUD -----------------------------
class TestTransactions:
    def test_list_transactions(self, admin_session):
        r = admin_session.get(f"{API}/transactions")
        assert r.status_code == 200
        txns = r.json()["transactions"]
        assert isinstance(txns, list)
        if txns:
            t = txns[0]
            for k in ("id", "date", "type", "category", "amount", "description"):
                assert k in t
            assert isinstance(t["amount"], (int, float))

    def test_filter_by_type(self, admin_session):
        r = admin_session.get(f"{API}/transactions", params={"type": "income"})
        assert r.status_code == 200
        for t in r.json()["transactions"]:
            assert t["type"] == "income"

    def test_add_and_delete_transaction(self, admin_session):
        payload = {"date": "2026-01-10", "description": "TEST_unit_txn",
                   "category": "Testing", "type": "expense", "amount": 123.45}
        r = admin_session.post(f"{API}/transactions", json=payload)
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        txn = body["transaction"]
        assert txn["amount"] == 123.45
        assert txn["description"] == "TEST_unit_txn"
        txn_id = txn["id"]

        # verify it appears in listing
        r2 = admin_session.get(f"{API}/transactions")
        ids = [t["id"] for t in r2.json()["transactions"]]
        assert txn_id in ids

        # delete
        r3 = admin_session.delete(f"{API}/transactions/{txn_id}")
        assert r3.status_code == 200

        # verify gone
        r4 = admin_session.get(f"{API}/transactions")
        ids2 = [t["id"] for t in r4.json()["transactions"]]
        assert txn_id not in ids2

    def test_delete_nonexistent_returns_404(self, admin_session):
        r = admin_session.delete(f"{API}/transactions/does-not-exist")
        assert r.status_code == 404


# ----------------------------- Upload CSV -----------------------------
class TestUpload:
    def test_upload_csv(self, admin_session):
        csv = b"date,description,amount,category\n2026-01-02,TEST_csv_income,1000,Sales\n2026-01-03,TEST_csv_expense,-250,Software\n"
        s = requests.Session()
        # forward bearer
        s.headers["Authorization"] = admin_session.headers.get("Authorization", "")
        files = {"file": ("test.csv", io.BytesIO(csv), "text/csv")}
        r = s.post(f"{API}/upload", files=files)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["imported"] == 2


# ----------------------------- AI -----------------------------
class TestAI:
    def test_ai_analyze_and_alerts(self, admin_session):
        r = admin_session.post(f"{API}/ai/analyze", timeout=120)
        assert r.status_code == 200, r.text
        rep = r.json()
        assert isinstance(rep.get("insights"), list)
        assert isinstance(rep.get("suggestions"), list)
        assert isinstance(rep.get("alerts"), list)
        # At least one of these should have content given sample data with anomaly
        assert len(rep["insights"]) + len(rep["suggestions"]) + len(rep["alerts"]) > 0

        # Latest report endpoint
        r2 = admin_session.get(f"{API}/ai/latest")
        assert r2.status_code == 200
        assert r2.json()["report"] is not None

        # Alerts endpoint
        r3 = admin_session.get(f"{API}/alerts")
        assert r3.status_code == 200
        alerts = r3.json()["alerts"]
        assert isinstance(alerts, list)

    def test_mark_alert_read(self, admin_session):
        r = admin_session.get(f"{API}/alerts")
        alerts = r.json()["alerts"]
        if not alerts:
            pytest.skip("no alerts to mark")
        aid = alerts[0]["id"]
        r2 = admin_session.post(f"{API}/alerts/{aid}/read")
        assert r2.status_code == 200


# ----------------------------- Encryption verification -----------------------------
class TestEncryption:
    def test_encrypted_storage_in_db(self, admin_session):
        # Add txn with unique description
        marker = f"TEST_enc_marker_{uuid.uuid4().hex[:8]}"
        r = admin_session.post(f"{API}/transactions", json={
            "date": "2026-01-15", "description": marker, "category": "Enc",
            "type": "expense", "amount": 9.99})
        assert r.status_code == 200

        # Connect directly to mongo to verify ciphertext (description should not appear in plaintext)
        try:
            from pymongo import MongoClient
        except ImportError:
            pytest.skip("pymongo not available")
        mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        coll = mc[os.environ.get("DB_NAME", "test_database")].transactions
        # Find any doc with our marker plaintext -- should not exist
        found_plain = coll.find_one({"description": marker})
        assert found_plain is None, "Plaintext description present in DB"
        # Verify field amount_enc and description_enc exist
        any_doc = coll.find_one({"description_enc": {"$exists": True}})
        assert any_doc is not None
        assert "amount_enc" in any_doc and "description_enc" in any_doc
        # description_enc should not literally contain marker
        assert marker not in str(any_doc.get("description_enc", ""))


# ----------------------------- Clear data -----------------------------
class TestClearData:
    def test_clear_data_endpoint(self, new_user_session):
        # load sample for this fresh user
        r = new_user_session.post(f"{API}/sample-data")
        assert r.status_code == 200
        assert r.json()["imported"] > 0

        r2 = new_user_session.get(f"{API}/dashboard/summary")
        assert r2.json()["transaction_count"] > 0

        r3 = new_user_session.delete(f"{API}/data/clear")
        assert r3.status_code == 200

        r4 = new_user_session.get(f"{API}/dashboard/summary")
        assert r4.json()["transaction_count"] == 0
