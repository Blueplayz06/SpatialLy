# Spatially

## Project Overview
Spatially is an intelligent event operations and spatial crowd monitoring platform connecting attendees, volunteer staff, and event organizers. It combines passive BLE-based proximity awareness, QR ticketing, and comprehensive real-time operational workflows.

The system consists of three primary surfaces:
1. **Attendee Mobile** (`apps/attendee_mobile`): Flutter mobile app for attendees (ticket discovery, QR admission pass, live event sessions, spatial maps, passport/gamification, ephemeral Connect networking, and passive BLE broadcasting).
2. **Volunteer Mobile** (`apps/volunteer_mobile`): Flutter mobile app for event staff (QR ticket check-in, passive BLE observation scanning, real-time communications, incident management, attendee assistance, lost & found, team/shift operations, proactive event awareness feed, and operational health telemetry).
3. **Organizer Web Platform** (`client/` and `server/`): Web dashboard for event organizers to configure events, oversee zones, manage volunteers/staff, and monitor real-time crowd dynamics and operational health.

## Repository Structure
```
majorProject/
├── apps/
│   ├── attendee_mobile/          # Attendee Flutter app (Android)
│   ├── volunteer_mobile/         # Volunteer Staff Flutter app (Android)
│   └── flutter_ble_peripheral_patched/ # Local patched BLE peripheral plugin
├── client/                       # Organizer Dashboard Web App (React + Vite)
├── server/                       # Organizer Web Backend API (Python / FastAPI)
├── supabase/
│   └── migrations/               # PostgreSQL DDL migrations, RLS policies & RPCs
├── Organizer Handoff Mds/        # Curated handoff documentation for Organizer Web
└── README.md                     # Repository entrypoint
```

## Documentation & Handoff
Detailed architectural, database, and operational system guides for Organizer Web development are located in:
- **`Organizer Handoff Mds/`**:
  - `ORGANIZER_HANDOFF.md`: Full architectural context, surface responsibilities, and system capabilities.
  - `DATABASE_AND_RPC_REFERENCE.md`: Complete guide to tables, relationships, RPCs, and Realtime channels.
  - `OPERATIONAL_SYSTEMS.md`: Guide to existing mobile operational subsystems (Crowd, Incidents, Comms, Shifts, Health).
  - `CURRENT_PROJECT_STATE.md`: Snapshot of implemented features, test baselines, and current roadmap.
  - `REPOSITORY_HANDOFF_PREPARATION_REPORT.md`: Pre-commit repository audit and handoff verification.

> Note: Private internal developer logs and historical phase audits are maintained in a local private directory (`Required Mds/`) which is excluded from version control.

## Architecture & Technology Stack
- **Mobile Apps**: Flutter (Dart) targeting Android (foreground BLE scanner and peripheral services).
- **Organizer Web**: React (Vite) frontend and Python FastAPI backend service.
- **Backend & Database**: Supabase (PostgreSQL, Supabase Auth, Row Level Security, Realtime CDC).
- **Proximity & Telemetry**: Native Android BLE advertising and scanning with rotating ephemeral IDs for attendee privacy.

## Quick Start

### 0. Quick Start on Windows (One-Click Launcher)
Double-click `start.bat` or run:
```bat
start.bat
```
This interactive launcher checks prerequisites (Node.js, Python `.venv`, `.env` configuration) and opens:
- **Organizer Web Frontend** at `http://localhost:5173`
- **FastAPI Backend Service** at `http://localhost:8000` (Swagger docs at `/docs`)

You can also pass direct flags:
```bat
start.bat web        # Launches both Frontend and Backend
start.bat client     # Frontend only
start.bat server     # Backend API only
start.bat sim        # Run crowd simulation harness
start.bat stop       # Kill running dev servers on ports 8000 and 5173
```
To stop all active services anytime, double-click `stop.bat` or run `start.bat stop`.

### 1. Mobile Apps (Flutter)
```bash
# Attendee App
cd apps/attendee_mobile
flutter pub get
flutter run

# Volunteer App
cd apps/volunteer_mobile
flutter pub get
flutter run
```
*Note: Mobile apps require `lib/config/supabase_config.dart` containing project URL and anon key.*

### 2. Organizer Web Frontend
```bash
cd client
npm install
npm run dev
```

### 3. Organizer Web Backend
```bash
cd server
python -m venv venv
# Windows: venv\Scripts\activate | Unix: source venv/bin/activate
pip install -r requirements.txt
python main.py
```

### 4. Database Migrations
Database migrations are maintained in `supabase/migrations/` and applied to the shared Supabase project.

## Team & Responsibilities
- **Mobile Apps & Core Event Operations**: Aryan (`apps/attendee_mobile`, `apps/volunteer_mobile`, `supabase/migrations/`)
- **Organizer Web Dashboard & API**: Organizer Team (`client/`, `server/`)
