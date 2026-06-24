"""Resend email sending with optional PDF attachment."""
import os
import base64
import asyncio
import resend


async def send_invoice_email(to_email: str, subject: str, html: str, pdf_bytes: bytes, filename: str):
    resend.api_key = os.environ["RESEND_API_KEY"]
    params = {
        "from": os.environ.get("SENDER_EMAIL", "onboarding@resend.dev"),
        "to": [to_email],
        "subject": subject,
        "html": html,
        "attachments": [{
            "filename": filename,
            "content": base64.b64encode(pdf_bytes).decode("utf-8"),
        }],
    }
    return await asyncio.to_thread(resend.Emails.send, params)
