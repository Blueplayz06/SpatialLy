from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from contextlib import asynccontextmanager
import bcrypt

load_dotenv()

from config import get_supabase, FRONTEND_URL
from routes import events, volunteers, dashboard, venue_map, logs, organizer



@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[STARTUP] Spatially API starting...")
    yield
    print("[SHUTDOWN] Spatially API shutting down...")


app = FastAPI(
    title="Spatially API",
    description="Backend API for Spatially — BLE-based crowd intelligence platform",
    version="1.0.0",
    lifespan=lifespan,
)

CORS_ORIGINS = [
    FRONTEND_URL,
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    traceback.print_exc()
    origin = request.headers.get("origin")
    headers = {}
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
        headers["Access-Control-Allow-Methods"] = "*"
        headers["Access-Control-Allow-Headers"] = "*"
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"},
        headers=headers,
    )

app.include_router(events.router)
app.include_router(events.venues_router)
app.include_router(volunteers.router)
app.include_router(dashboard.router)
app.include_router(venue_map.router)
app.include_router(logs.router)
app.include_router(organizer.router)


@app.get("/")
def health_check():
    return {"status": "ok", "service": "Spatially API", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

