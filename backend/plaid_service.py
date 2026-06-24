"""Plaid bank linking + transaction sync into the encrypted transactions store."""
import os
import uuid
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

from security import encrypt_value


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def register_plaid_routes(api, db, get_current_user):
    @api.post("/plaid/create_link_token")
    async def create_link_token(user: dict = Depends(get_current_user)):
        client = _plaid_client()
        try:
            req = LinkTokenCreateRequest(
                products=[Products("transactions")],
                client_name="FinSight",
                country_codes=[CountryCode("US")],
                language="en",
                user=LinkTokenCreateRequestUser(client_user_id=str(user["_id"])),
            )
            resp = client.link_token_create(req)
            return {"link_token": resp["link_token"]}
        except plaid.ApiException as e:
            raise HTTPException(status_code=400, detail=f"Plaid error: {e.body}")

    @api.post("/plaid/exchange_public_token")
    async def exchange_public_token(body: ExchangeInput, user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        client = _plaid_client()
        try:
            resp = client.item_public_token_exchange(
                ItemPublicTokenExchangeRequest(public_token=body.public_token)
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
        synced = await _sync_item(db, uid, item_id)
        return {"message": "Bank linked", "institution": body.institution_name, "imported": synced}

    async def _sync_item(db, uid: str, item_id: str) -> int:
        from security import decrypt_value
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
                resp = client.transactions_sync(req)
                added.extend(resp["added"])
                removed.extend(resp["removed"])
                has_more = resp["has_more"]
                cursor = resp["next_cursor"]
        except plaid.ApiException as e:
            raise HTTPException(status_code=400, detail=f"Plaid sync error: {e.body}")

        count = 0
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
                    "source": "plaid", "created_at": now_iso(),
                }},
                upsert=True,
            )
            count += 1
        for r in removed:
            await db.transactions.delete_one({"user_id": uid, "plaid_transaction_id": r["transaction_id"]})

        await db.plaid_items.update_one(
            {"user_id": uid, "item_id": item_id},
            {"$set": {"cursor": cursor, "last_synced": now_iso()}},
        )
        return count

    @api.post("/plaid/sync")
    async def sync_all(user: dict = Depends(get_current_user)):
        uid = str(user["_id"])
        items = await db.plaid_items.find({"user_id": uid}).to_list(50)
        if not items:
            raise HTTPException(status_code=400, detail="No bank account connected.")
        total = 0
        for it in items:
            total += await _sync_item(db, uid, it["item_id"])
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
