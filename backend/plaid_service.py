"""Plaid bank linking + transaction sync into the encrypted transactions store."""
import os
import uuid
import asyncio
from datetime import datetime, timezone

from fastapi import HTTPException, Depends
from pydantic import BaseModel

import plaid
from plaid.api import plaid_api
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.transactions_sync_request import TransactionsSyncRequest

from security import encrypt_value, decrypt_value
from ai_service import categorize_transactions


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _webhook_url() -> str:
    base = os.environ.get("FRONTEND_URL", "").rstrip("/")
    return f"{base}/api/plaid/webhook" if base else None



_ENV_HOST = {
    "sandbox": plaid.Environment.Sandbox,
    "production": plaid.Environment.Production,
}


def _plaid_client() -> plaid_api.PlaidApi:
    host = _ENV_HOST.get(os.environ.get("PLAID_ENV", "sandbox"), plaid.Environment.Sandbox)
    config = plaid.Configuration(
        host=host,
        api_key={"clientId": os.environ["PLAID_CLIENT_ID"], "secret": os.environ["PLAID_SECRET"]},
    )
    return plaid_api.PlaidApi(plaid.ApiClient(config))


class ExchangeInput(BaseModel):
    public_token: str
    institution_name: str = "Bank"


def _map_transaction(t) -> dict:
    """Plaid: positive amount = money out (expense); negative = money in (income)."""
    amount = float(t.amount)
    ttype = "expense" if amount > 0 else "income"
    category = "Uncategorized"
    pfc = getattr(t, "personal_finance_category", None)
    if pfc and getattr(pfc, "primary", None):
        category = str(pfc.primary).replace("_", " ").title()
    elif getattr(t, "category", None):
        category = str(t.category[0])
    desc = getattr(t, "merchant_name", None) or getattr(t, "name", None) or "Bank transaction"
    return {
        "date": str(t.date),
        "type": ttype,
        "category": category[:80],
        "amount": round(abs(amount), 2),
        "description": str(desc)[:200],
        "plaid_transaction_id": t.transaction_id,
    }


async def sync_item(db, uid: str, item_id: str) -> int:
    item = await db.plaid_items.find_one({"user_id": uid, "item_id": item_id})
    if not item:
        return 0
    client = _plaid_client()
    access_token = decrypt_value(item["access_token_enc"])
    cursor = item.get("cursor", "") or ""
    added, removed = [], []
    has_more = True
    try:
        while has_more:
            req = TransactionsSyncRequest(access_token=access_token, cursor=cursor)
            resp = await asyncio.to_thread(client.transactions_sync, req)
            added.extend(resp["added"])
            removed.extend(resp["removed"])
            has_more = resp["has_more"]
            cursor = resp["next_cursor"]
    except plaid.ApiException as e:
        raise HTTPException(status_code=400, detail=f"Plaid sync error: {e.body}")

    count = 0
    new_items = []
    for t in added:
        row = _map_transaction(t)
        await db.transactions.update_one(
            {"user_id": uid, "plaid_transaction_id": row["plaid_transaction_id"]},
            {"$set": {
                "id": str(uuid.uuid4()), "user_id": uid,
                "worksheet_id": f"plaid:{item_id}",
                "date": row["date"], "type": row["type"], "category": row["category"],
                "amount_enc": encrypt_value(row["amount"]),
                "description_enc": encrypt_value(row["description"]),
                "plaid_transaction_id": row["plaid_transaction_id"],
                "source": "plaid", "reconciled": False, "created_at": now_iso(),
            }},
            upsert=True,
        )
        new_items.append({"id": row["plaid_transaction_id"], "description": row["description"],
                          "amount": row["amount"], "type": row["type"], "category": row["category"]})
        count += 1
    for r in removed:
        await db.transactions.delete_one({"user_id": uid, "plaid_transaction_id": r["transaction_id"]})

    await db.plaid_items.update_one(
        {"user_id": uid, "item_id": item_id},
        {"$set": {"cursor": cursor, "last_synced": now_iso()}},
    )
    if new_items:
        asyncio.create_task(_categorize_and_flag(db, uid, new_items[:40]))
    return count


async def _categorize_and_flag(db, uid: str, items: list):
    try:
        results = await categorize_transactions(items)
    except Exception:
        return
    for r in results:
        ptid = r.get("id")
        if not ptid:
            continue
        category = (r.get("category") or "").strip()
        update = {}
        if category:
            update["category"] = category[:80]
            update["ai_categorized"] = True
        if update:
            await db.transactions.update_one(
                {"user_id": uid, "plaid_transaction_id": ptid}, {"$set": update}
            )
        if r.get("anomaly"):
            src = next((i for i in items if i["id"] == ptid), {})
            await db.alerts.insert_one({
                "id": str(uuid.uuid4()), "user_id": uid,
                "title": f"Unusual transaction: {src.get('description','')[:60]}",
                "detail": r.get("reason", "Flagged by AI during auto-categorization."),
                "severity": "medium", "read": False, "created_at": now_iso(),
            })



def register_plaid_routes(api, db, get_current_user):
    @api.post("/plaid/create_link_token")
    async def create_link_token(user: dict = Depends(get_current_user)):
        client = _plaid_client()
        try:
            kwargs = dict(
                products=[Products("transactions")],
                client_name="FinSight",
                country_codes=[CountryCode("US")],
                language="en",
                user=LinkTokenCreateRequestUser(client_user_id=str(user["_id"])),
            )
            wh = _webhook_url()
            if wh:
                kwargs["webhook"] = wh
            req = LinkTokenCreateRequest(**kwargs)
            resp = await asyncio.to_thread(client.link_token_create, req)
            return {"link_token": resp["link_token"]}
        except plaid.ApiException as e:
            raise HTTPException(status_code=400, detail=f"Plaid error: {e.body}")

    @api.post("/plaid/exchange_public_token")
    async def exchange_public_token(body: ExchangeInput, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        client = _plaid_client()
        try:
            resp = await asyncio.to_thread(
                client.item_public_token_exchange,
                ItemPublicTokenExchangeRequest(public_token=body.public_token),
            )
        except plaid.ApiException as e:
            raise HTTPException(status_code=400, detail=f"Plaid error: {e.body}")

        item_id = resp["item_id"]
        await db.plaid_items.update_one(
            {"user_id": uid, "item_id": item_id},
            {"$set": {
                "user_id": uid, "item_id": item_id,
                "access_token_enc": encrypt_value(resp["access_token"]),
                "institution_name": body.institution_name,
                "cursor": "", "created_at": now_iso(),
            }},
            upsert=True,
        )
        synced = await sync_item(db, uid, item_id)
        return {"message": "Bank linked", "institution": body.institution_name, "imported": synced}

    @api.post("/plaid/webhook")
    async def plaid_webhook(payload: dict):
        """Plaid calls this on TRANSACTIONS updates (e.g. SYNC_UPDATES_AVAILABLE)."""
        webhook_type = payload.get("webhook_type")
        webhook_code = payload.get("webhook_code")
        item_id = payload.get("item_id")
        await db.plaid_webhook_log.insert_one({
            "webhook_type": webhook_type, "webhook_code": webhook_code,
            "item_id": item_id, "received_at": now_iso(),
        })
        if webhook_type == "TRANSACTIONS" and item_id and webhook_code in {
            "SYNC_UPDATES_AVAILABLE", "INITIAL_UPDATE", "HISTORICAL_UPDATE", "DEFAULT_UPDATE",
        }:
            item = await db.plaid_items.find_one({"item_id": item_id})
            if item:
                try:
                    await sync_item(db, item["user_id"], item_id)
                except Exception:
                    pass
        return {"acknowledged": True}

    @api.post("/plaid/sync")
    async def sync_all(user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        items = await db.plaid_items.find({"user_id": uid}).to_list(50)
        if not items:
            raise HTTPException(status_code=400, detail="No bank account connected.")
        total = 0
        for it in items:
            total += await sync_item(db, uid, it["item_id"])
        return {"imported": total}

    @api.get("/plaid/status")
    async def plaid_status(user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        items = await db.plaid_items.find(
            {"user_id": uid}, {"_id": 0, "access_token_enc": 0, "cursor": 0}
        ).to_list(50)
        return {"connected": len(items) > 0, "items": items}

    @api.post("/plaid/disconnect/{item_id}")
    async def disconnect(item_id: str, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        await db.plaid_items.delete_one({"user_id": uid, "item_id": item_id})
        await db.transactions.delete_many({"user_id": uid, "worksheet_id": f"plaid:{item_id}"})
        return {"ok": True}


async def _autosync_loop(db, interval_seconds: int):
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            items = await db.plaid_items.find({}).to_list(1000)
            for it in items:
                try:
                    await sync_item(db, it["user_id"], it["item_id"])
                except Exception:
                    continue
        except Exception:
            continue


def start_plaid_autosync(db, interval_seconds: int = 1800):
    """Background fallback sync (every 30 min) in addition to webhooks."""
    asyncio.create_task(_autosync_loop(db, interval_seconds))

