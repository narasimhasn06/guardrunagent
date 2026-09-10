from fastapi import FastAPI

from app.routers import cost_summary, events, guardrail_check, rules, sessions

app = FastAPI(title="GuardrunAgent Backend")

app.include_router(events.router)
app.include_router(guardrail_check.router)
app.include_router(rules.router)
app.include_router(sessions.router)
app.include_router(cost_summary.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
