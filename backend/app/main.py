from fastapi import FastAPI

from app.routers import events, sessions

app = FastAPI(title="GuardrunAgent Backend")

app.include_router(events.router)
app.include_router(sessions.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
