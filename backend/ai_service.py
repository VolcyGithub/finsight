import os
import json
from emergentintegrations.llm.chat import LlmChat, UserMessage

MODEL_PROVIDER = "gemini"
MODEL_NAME = "gemini-3.1-pro-preview"

SYSTEM_PROMPT = (
    "You are a senior financial analyst AI for a small/medium business finance app. "
    "You receive a structured summary of a company's bookkeeping data. "
    "Return concrete, business-specific analysis. Be precise with numbers and reference "
    "actual categories/months from the data. Respond ONLY with valid minified JSON, no markdown."
)

OUTPUT_SCHEMA = """
Respond with JSON of this exact shape:
{
  "insights": [{"title": "string", "detail": "string", "metric": "string"}],
  "suggestions": [{"title": "string", "detail": "string", "impact": "high|medium|low"}],
  "alerts": [{"title": "string", "detail": "string", "severity": "high|medium|low"}]
}
Provide 3-5 insights, 3-5 suggestions, and 0-5 alerts. Alerts should flag anomalies such as
unusual spikes in spending, negative cash flow, large single transactions, or concentration risk.
"""


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1] if "```" in text else text
        if text.startswith("json"):
            text = text[4:]
        text = text.strip().strip("`").strip()
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    return json.loads(text)


async def generate_financial_analysis(summary: dict) -> dict:
    api_key = os.environ["EMERGENT_LLM_KEY"]
    chat = LlmChat(
        api_key=api_key,
        session_id=f"finsight-{summary.get('user_id', 'anon')}",
        system_message=SYSTEM_PROMPT,
    ).with_model(MODEL_PROVIDER, MODEL_NAME)

    prompt = (
        "Analyze this business financial summary and produce insights, suggestions and alerts.\n\n"
        f"FINANCIAL DATA:\n{json.dumps(summary, default=str)}\n\n{OUTPUT_SCHEMA}"
    )
    response = await chat.send_message(UserMessage(text=prompt))
    raw = response if isinstance(response, str) else str(response)
    try:
        data = _extract_json(raw)
    except Exception:
        data = {"insights": [], "suggestions": [], "alerts": [], "_raw": raw[:2000]}
    data.setdefault("insights", [])
    data.setdefault("suggestions", [])
    data.setdefault("alerts", [])
    return data
