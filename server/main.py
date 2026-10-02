from fastapi import FastAPI
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
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
