from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")
import io
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import pandas as pd
from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends, UploadFile, File
from fastapi.responses import RedirectResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from bson import ObjectId

from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from security import (
    encrypt_value,
    decrypt_value,
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from ai_service import generate_financial_analysis

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("finsight")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="FinSight API")
api = APIRouter(prefix="/api")

MAX_FAILED = 5
LOCKOUT_MIN = 15


# ----------------------------- Models -----------------------------
class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class TransactionInput(BaseModel):
    date: str
    description: str
    category: str = "Uncategorized"
    type: str = "expense"  # income | expense
    amount: float


class DriveImportInput(BaseModel):
    file_id: str
    name: str
    mimeType: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------------- Auth helpers -----------------------------
def public_user(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "name": user.get("name", ""),
        "email": user.get("email", ""),
        "role": user.get("role", "user"),
        "created_at": user.get("created_at"),
    }


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=False,
                        samesite="lax", max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=False,
                        samesite="lax", max_age=604800, path="/")


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ----------------------------- Auth endpoints -----------------------------
@api.post("/auth/register")
async def register(body: RegisterInput, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    doc = {
        "name": body.name,
        "email": email,
        "password_hash": hash_password(body.password),
        "role": "user",
        "created_at": now_iso(),
    }
    res = await db.users.insert_one(doc)
    uid = str(res.inserted_id)
    access, refresh = create_access_token(uid, email), create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    doc["_id"] = res.inserted_id
    return {"user": public_user(doc), "access_token": access}


@api.post("/auth/login")
async def login(body: LoginInput, request: Request, response: Response):
    email = body.email.lower()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= MAX_FAILED:
        locked_until = attempt.get("locked_until")
        if locked_until and datetime.fromisoformat(locked_until) > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1},
             "$set": {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MIN)).isoformat()}},
            upsert=True,
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")

    await db.login_attempts.delete_one({"identifier": identifier})
    uid = str(user["_id"])
    access, refresh = create_access_token(uid, email), create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    return {"user": public_user(user), "access_token": access}


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": public_user(user)}


# ----------------------------- Parsing helpers -----------------------------
def _find_col(cols, keywords):
    for c in cols:
        lc = str(c).lower().strip()
        for k in keywords:
            if k in lc:
                return c
    return None


def parse_dataframe(df: pd.DataFrame) -> List[dict]:
    df.columns = [str(c).strip() for c in df.columns]
    cols = list(df.columns)
    date_col = _find_col(cols, ["date", "day", "posted"])
    desc_col = _find_col(cols, ["desc", "narration", "detail", "memo", "name", "payee", "particular"])
    cat_col = _find_col(cols, ["category", "class", "account", "type"])
    amt_col = _find_col(cols, ["amount", "value", "total", "sum"])
    debit_col = _find_col(cols, ["debit", "withdraw", "expense", "paid out"])
    credit_col = _find_col(cols, ["credit", "deposit", "income", "received"])
    type_col = _find_col(cols, ["transaction type", "txn type", "dr/cr", "flow"])

    rows = []
    for _, r in df.iterrows():
        try:
            amount = None
            ttype = "expense"
            if amt_col is not None and pd.notna(r.get(amt_col)):
                raw = str(r[amt_col]).replace(",", "").replace("$", "").replace("€", "").strip()
                raw = raw.replace("(", "-").replace(")", "")
                amount = float(raw)
                ttype = "income" if amount >= 0 else "expense"
                amount = abs(amount)
            elif debit_col is not None or credit_col is not None:
                deb = r.get(debit_col) if debit_col else None
                cre = r.get(credit_col) if credit_col else None
                if cre is not None and pd.notna(cre) and str(cre).strip() not in ("", "0"):
                    amount = abs(float(str(cre).replace(",", "").replace("$", "").strip()))
                    ttype = "income"
                elif deb is not None and pd.notna(deb) and str(deb).strip() not in ("", "0"):
                    amount = abs(float(str(deb).replace(",", "").replace("$", "").strip()))
                    ttype = "expense"
            if amount is None:
                continue

            if type_col is not None and pd.notna(r.get(type_col)):
                tv = str(r[type_col]).lower()
                if any(k in tv for k in ["income", "credit", "deposit", "cr", "in"]):
                    ttype = "income"
                elif any(k in tv for k in ["expense", "debit", "withdraw", "dr", "out"]):
                    ttype = "expense"

            date_val = now_iso()
            if date_col is not None and pd.notna(r.get(date_col)):
                try:
                    date_val = pd.to_datetime(r[date_col], errors="coerce")
                    date_val = date_val.isoformat() if pd.notna(date_val) else now_iso()
                except Exception:
                    date_val = now_iso()

            desc = str(r[desc_col]) if desc_col is not None and pd.notna(r.get(desc_col)) else "Transaction"
            category = str(r[cat_col]) if cat_col is not None and pd.notna(r.get(cat_col)) else "Uncategorized"
            if cat_col == type_col:
                category = "Uncategorized"

            rows.append({
                "date": date_val,
                "description": desc[:200],
                "category": category[:80],
                "type": ttype,
                "amount": round(amount, 2),
            })
        except Exception:
            continue
    return rows


async def store_transactions(user_id: str, worksheet_id: str, rows: List[dict]):
    docs = []
    for row in rows:
        docs.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "worksheet_id": worksheet_id,
            "date": row["date"],
            "type": row["type"],
            "category": row["category"],
            "amount_enc": encrypt_value(row["amount"]),
            "description_enc": encrypt_value(row["description"]),
            "created_at": now_iso(),
        })
    if docs:
        await db.transactions.insert_many(docs)
    return len(docs)


def decrypt_txn(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "date": doc["date"],
        "type": doc["type"],
        "category": doc["category"],
        "amount": float(decrypt_value(doc["amount_enc"]) or 0),
        "description": decrypt_value(doc["description_enc"]),
    }


# ----------------------------- Upload / transactions -----------------------------
@api.post("/upload")
async def upload_worksheet(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    content = await file.read()
    name = (file.filename or "upload").lower()
    try:
        if name.endswith(".csv") or name.endswith(".txt"):
            df = pd.read_csv(io.BytesIO(content))
        elif name.endswith(".xlsx") or name.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise HTTPException(status_code=400, detail="Unsupported file. Upload CSV or Excel.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")

    rows = parse_dataframe(df)
    if not rows:
        raise HTTPException(status_code=400, detail="No valid transactions found. Ensure the sheet has date, description and amount columns.")

    worksheet_id = str(uuid.uuid4())
    ws_doc = {
        "id": worksheet_id,
        "user_id": uid,
        "filename": file.filename,
        "source": "upload",
        "row_count": len(rows),
        "created_at": now_iso(),
    }
    await db.worksheets.insert_one(ws_doc)
    count = await store_transactions(uid, worksheet_id, rows)
    return {"worksheet_id": worksheet_id, "imported": count, "filename": file.filename}


@api.post("/transactions")
async def add_transaction(body: TransactionInput, user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "worksheet_id": "manual",
        "date": body.date,
        "type": body.type,
        "category": body.category,
        "amount_enc": encrypt_value(body.amount),
        "description_enc": encrypt_value(body.description),
        "created_at": now_iso(),
    }
    await db.transactions.insert_one(doc)
    return {"ok": True, "transaction": decrypt_txn(doc)}


@api.get("/transactions")
async def list_transactions(user: dict = Depends(get_current_user),
                            type: Optional[str] = None, category: Optional[str] = None,
                            limit: int = 500):
    uid = str(user["_id"])
    query = {"user_id": uid}
    if type:
        query["type"] = type
    if category:
        query["category"] = category
    docs = await db.transactions.find(query).sort("date", -1).to_list(limit)
    return {"transactions": [decrypt_txn(d) for d in docs]}


@api.delete("/transactions/{txn_id}")
async def delete_transaction(txn_id: str, user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    res = await db.transactions.delete_one({"id": txn_id, "user_id": uid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"ok": True}


@api.get("/worksheets")
async def list_worksheets(user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    docs = await db.worksheets.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"worksheets": docs}


# ----------------------------- Dashboard summary -----------------------------
def build_summary(txns: List[dict]) -> dict:
    income = sum(t["amount"] for t in txns if t["type"] == "income")
    expense = sum(t["amount"] for t in txns if t["type"] == "expense")
    by_month = {}
    by_category = {}
    for t in txns:
        month = (t["date"] or "")[:7]
        m = by_month.setdefault(month, {"month": month, "income": 0.0, "expense": 0.0})
        m[t["type"]] = round(m.get(t["type"], 0.0) + t["amount"], 2)
        if t["type"] == "expense":
            by_category[t["category"]] = round(by_category.get(t["category"], 0.0) + t["amount"], 2)

    monthly = sorted(by_month.values(), key=lambda x: x["month"])
    for m in monthly:
        m["net"] = round(m.get("income", 0) - m.get("expense", 0), 2)
    categories = sorted(
        [{"category": k, "amount": v} for k, v in by_category.items()],
        key=lambda x: x["amount"], reverse=True,
    )
    return {
        "total_income": round(income, 2),
        "total_expense": round(expense, 2),
        "net_profit": round(income - expense, 2),
        "transaction_count": len(txns),
        "monthly": monthly,
        "categories": categories,
    }


@api.get("/dashboard/summary")
async def dashboard_summary(user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    docs = await db.transactions.find({"user_id": uid}).to_list(5000)
    txns = [decrypt_txn(d) for d in docs]
    return build_summary(txns)


# ----------------------------- AI Insights -----------------------------
@api.post("/ai/analyze")
async def ai_analyze(user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    docs = await db.transactions.find({"user_id": uid}).to_list(5000)
    txns = [decrypt_txn(d) for d in docs]
    if not txns:
        raise HTTPException(status_code=400, detail="No data to analyze. Upload a worksheet or add transactions first.")

    summary = build_summary(txns)
    summary["user_id"] = uid
    top_txns = sorted(txns, key=lambda t: t["amount"], reverse=True)[:15]
    summary["largest_transactions"] = [
        {"date": t["date"][:10], "description": t["description"], "category": t["category"],
         "type": t["type"], "amount": t["amount"]} for t in top_txns
    ]
    result = await generate_financial_analysis(summary)

    record = {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "insights": result.get("insights", []),
        "suggestions": result.get("suggestions", []),
        "alerts": result.get("alerts", []),
        "created_at": now_iso(),
    }
    await db.ai_reports.insert_one({**record, "_keep": True})

    for a in record["alerts"]:
        await db.alerts.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "title": a.get("title", "Alert"),
            "detail": a.get("detail", ""),
            "severity": a.get("severity", "medium"),
            "read": False,
            "created_at": now_iso(),
        })
    return record


@api.get("/ai/latest")
async def ai_latest(user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    doc = await db.ai_reports.find_one({"user_id": uid}, {"_id": 0, "_keep": 0}, sort=[("created_at", -1)])
    return {"report": doc}


@api.get("/alerts")
async def list_alerts(user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    docs = await db.alerts.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"alerts": docs}


@api.post("/alerts/{alert_id}/read")
async def mark_alert_read(alert_id: str, user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    await db.alerts.update_one({"id": alert_id, "user_id": uid}, {"$set": {"read": True}})
    return {"ok": True}


# ----------------------------- Sample data -----------------------------
@api.post("/sample-data")
async def load_sample_data(user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    import random
    categories_exp = ["Payroll", "Rent", "Marketing", "Software", "Utilities", "Travel", "Supplies", "Insurance"]
    categories_inc = ["Product Sales", "Consulting", "Subscriptions", "Services"]
    rows = []
    base = datetime.now(timezone.utc) - timedelta(days=180)
    for i in range(180):
        day = base + timedelta(days=i)
        # income
        if random.random() < 0.5:
            rows.append({"date": day.isoformat(), "description": f"Invoice #{1000+i}",
                         "category": random.choice(categories_inc), "type": "income",
                         "amount": round(random.uniform(800, 6000), 2)})
        # expenses
        for _ in range(random.randint(1, 3)):
            cat = random.choice(categories_exp)
            amt = random.uniform(50, 1200)
            if cat == "Payroll":
                amt = random.uniform(3000, 9000)
            rows.append({"date": day.isoformat(), "description": f"{cat} payment",
                         "category": cat, "type": "expense", "amount": round(amt, 2)})
    # inject an anomaly
    rows.append({"date": datetime.now(timezone.utc).isoformat(), "description": "Unusual large vendor payment",
                 "category": "Software", "type": "expense", "amount": 24500.00})

    worksheet_id = str(uuid.uuid4())
    await db.worksheets.insert_one({"id": worksheet_id, "user_id": uid, "filename": "sample_data.csv",
                                    "source": "sample", "row_count": len(rows), "created_at": now_iso()})
    count = await store_transactions(uid, worksheet_id, rows)
    return {"imported": count}


@api.delete("/data/clear")
async def clear_data(user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    await db.transactions.delete_many({"user_id": uid})
    await db.worksheets.delete_many({"user_id": uid})
    await db.alerts.delete_many({"user_id": uid})
    await db.ai_reports.delete_many({"user_id": uid})
    return {"ok": True}


@api.get("/")
async def root():
    return {"message": "FinSight API", "status": "ok"}


# ----------------------------- Google Drive -----------------------------
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
DRIVE_MIME_QUERY = (
    "(mimeType='application/vnd.google-apps.spreadsheet' "
    "or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' "
    "or mimeType='application/vnd.ms-excel' "
    "or mimeType='text/csv') and trashed=false"
)


def _drive_client_config():
    return {
        "web": {
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [os.environ["GOOGLE_DRIVE_REDIRECT_URI"]],
        }
    }


async def _get_drive_service(user_id: str):
    doc = await db.drive_credentials.find_one({"user_id": user_id})
    if not doc:
        raise HTTPException(status_code=400, detail="Google Drive not connected. Connect your Drive first.")
    creds = Credentials(
        token=decrypt_value(doc["access_token"]),
        refresh_token=decrypt_value(doc.get("refresh_token", "")) or None,
        token_uri=doc["token_uri"],
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        scopes=doc.get("scopes"),
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(GoogleRequest())
        await db.drive_credentials.update_one(
            {"user_id": user_id},
            {"$set": {"access_token": encrypt_value(creds.token),
                      "expiry": creds.expiry.isoformat() if creds.expiry else None,
                      "updated_at": now_iso()}},
        )
    return build("drive", "v3", credentials=creds)


@api.get("/drive/connect")
async def drive_connect(user: dict = Depends(get_current_user)):
    redirect_uri = os.environ["GOOGLE_DRIVE_REDIRECT_URI"]
    flow = Flow.from_client_config(_drive_client_config(), scopes=DRIVE_SCOPES, redirect_uri=redirect_uri)
    auth_url, _ = flow.authorization_url(
        access_type="offline", include_granted_scopes="true", prompt="consent", state=str(user["_id"])
    )
    return {"authorization_url": auth_url}


@api.get("/oauth/drive/callback")
async def drive_callback(code: str, state: str):
    redirect_uri = os.environ["GOOGLE_DRIVE_REDIRECT_URI"]
    frontend = os.environ.get("FRONTEND_URL", "")
    try:
        flow = Flow.from_client_config(_drive_client_config(), scopes=None, redirect_uri=redirect_uri)
        flow.fetch_token(code=code)
        creds = flow.credentials
        await db.drive_credentials.update_one(
            {"user_id": state},
            {"$set": {
                "user_id": state,
                "access_token": encrypt_value(creds.token),
                "refresh_token": encrypt_value(creds.refresh_token or ""),
                "token_uri": creds.token_uri,
                "scopes": creds.scopes,
                "expiry": creds.expiry.isoformat() if creds.expiry else None,
                "updated_at": now_iso(),
            }},
            upsert=True,
        )
        return RedirectResponse(url=f"{frontend}/upload?drive_connected=true")
    except Exception as e:
        logger.error(f"Drive OAuth callback failed: {e}")
        return RedirectResponse(url=f"{frontend}/upload?drive_error=1")


@api.get("/drive/status")
async def drive_status(user: dict = Depends(get_current_user)):
    doc = await db.drive_credentials.find_one({"user_id": str(user["_id"])})
    return {"connected": bool(doc)}


@api.get("/drive/files")
async def drive_files(user: dict = Depends(get_current_user)):
    service = await _get_drive_service(str(user["_id"]))
    try:
        results = service.files().list(
            q=DRIVE_MIME_QUERY, pageSize=50,
            fields="files(id,name,mimeType,modifiedTime)", orderBy="modifiedTime desc",
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not list Drive files: {e}")
    return {"files": results.get("files", [])}


@api.post("/drive/import")
async def drive_import(body: DriveImportInput, user: dict = Depends(get_current_user)):
    uid = str(user["_id"])
    service = await _get_drive_service(uid)
    buf = io.BytesIO()
    is_csv = False
    try:
        if body.mimeType == "application/vnd.google-apps.spreadsheet":
            request = service.files().export_media(fileId=body.file_id, mimeType="text/csv")
            is_csv = True
        else:
            request = service.files().get_media(fileId=body.file_id)
            is_csv = body.mimeType in ("text/csv", "application/vnd.ms-excel") or body.name.lower().endswith(".csv")
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not download from Drive: {e}")

    buf.seek(0)
    try:
        df = pd.read_csv(buf) if is_csv else pd.read_excel(buf)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")

    rows = parse_dataframe(df)
    if not rows:
        raise HTTPException(status_code=400, detail="No valid transactions found. Ensure the sheet has date, description and amount columns.")

    worksheet_id = str(uuid.uuid4())
    await db.worksheets.insert_one({
        "id": worksheet_id, "user_id": uid, "filename": body.name,
        "source": "google_drive", "row_count": len(rows), "created_at": now_iso(),
    })
    count = await store_transactions(uid, worksheet_id, rows)
    return {"imported": count, "filename": body.name}


@api.post("/drive/disconnect")
async def drive_disconnect(user: dict = Depends(get_current_user)):
    await db.drive_credentials.delete_one({"user_id": str(user["_id"])})
    return {"ok": True}


from accounting import register_accounting_routes
register_accounting_routes(api, db, get_current_user)

from plaid_service import register_plaid_routes, start_plaid_autosync
register_plaid_routes(api, db, get_current_user)


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000"), "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.transactions.create_index("user_id")
    await db.login_attempts.create_index("identifier")
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@finsight.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "name": "Admin", "email": admin_email,
            "password_hash": hash_password(admin_password),
            "role": "admin", "created_at": now_iso(),
        })
        logger.info("Seeded admin user")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email},
                                  {"$set": {"password_hash": hash_password(admin_password)}})
    start_plaid_autosync(db, interval_seconds=1800)


@app.on_event("shutdown")
async def shutdown():
    client.close()
