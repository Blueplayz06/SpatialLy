# Spatially — Complete Setup & Run Guide

> Monorepo containing two Flutter Android apps + one local patched plugin for BLE peripheral mode on Android 14+.

Last verified: 2026-08-24 against commit `ede24d3`.

---

## Table of Contents

1. [What This Project Is](#1-what-this-project-is)
2. [Repository Layout](#2-repository-layout)
3. [Prerequisites](#3-prerequisites)
4. [Clone the Repository](#4-clone-the-repository)
5. [Supabase Backend Setup](#5-supabase-backend-setup)
6. [Create the Supabase Config File](#6-create-the-supabase-config-file)
7. [Install Dependencies](#7-install-dependencies)
8. [Run the Apps](#8-run-the-apps)
9. [Build Release APKs](#9-build-release-apks)
10. [How the Local Patched Plugin Works](#10-how-the-local-patched-plugin-works)
11. [Permissions & OS Behaviour to Know About](#11-permissions--os-behaviour-to-know-about)
12. [Troubleshooting](#12-troubleshooting)
13. [Useful Commands Cheat-Sheet](#13-useful-commands-cheat-sheet)

---

## 1. What This Project Is

| App | Path | Role | Key Packages |
|-----|------|------|-------------|
| **attendee_mobile** | `apps/attendee_mobile/` | BLE **advertiser** (peripheral). Broadcasts a fixed Spatially service UUID `f47ac10b-58cc-4372-a567-0e02b2c3d479` via a native `BleAdvertisingService` foreground service so advertising survives screen lock. | `flutter_ble_peripheral` (local override), `permission_handler`, `flutter_foreground_task`, `battery_plus` |
| **volunteer_mobile** | `apps/volunteer_mobile/` | BLE **scanner** + Supabase telemetry. Scans for all nearby BLE devices, classifies Spatially devices by service UUID, shows live/active/cumulative counts, and writes `observations` + `volunteer_counts` to Supabase. Auth via Supabase email/password. | `flutter_blue_plus`, `supabase_flutter`, `permission_handler`, `flutter_foreground_task`, `battery_plus` |
| **flutter_ble_peripheral_patched** | `apps/flutter_ble_peripheral_patched/` | Local fork of [`flutter_ble_peripheral` 2.1.1](https://github.com/juliansteenbakker/flutter_ble_peripheral) with Android 14 (`FOREGROUND_SERVICE_CONNECTED_DEVICE`) fixes and a `BleAdvertisingService` native layer. Consumed via `dependency_overrides` path. | — |

Flow: `attendee_mobile` advertises → `volunteer_mobile` scans → observations streamed to Supabase (`observations` + `volunteer_counts` tables).

> **Android only.** Both apps target Android (see `android/app/src/main/AndroidManifest.xml:1` for each app). iOS/macOS/Windows plugin stubs exist in the patched plugin but are not wired for this prototype.

---

## 2. Repository Layout

```
spatially/
├── .gitignore                          # ignores .env + lib/config/supabase_config.dart + .gradle
├── SETUP.md                            # this file
└── apps/
    ├── attendee_mobile/                # Flutter advertiser app
    │   ├── lib/
    │   │   ├── main.dart               # BatteryCheckScreen → AdvertiserScreen, native BleAdvertisingService channel
    │   │   └── battery_check_screen.dart
    │   ├── android/                    # compileSdk 37, minSdk via flutter.minSdkVersion, JDK 17
    │   ├── pubspec.yaml                # sdk ^3.12.2, dependency_overrides → ../flutter_ble_peripheral_patched
    │   └── pubspec.lock
    ├── volunteer_mobile/               # Flutter scanner + Supabase app
    │   ├── lib/
    │   │   ├── main.dart               # Supabase init → AuthGate (StreamBuilder on auth state)
    │   │   ├── config/
    │   │   │   └── supabase_config.dart  # ← YOU CREATE THIS (gitignored)
    │   │   ├── models/ble_observation.dart
    │   │   ├── screens/
    │   │   │   ├── login_screen.dart
    │   │   │   ├── battery_check_screen.dart
    │   │   │   ├── zone_selection_screen.dart   # Entrance / Main Stage / Food Court / Exit
    │   │   │   └── scan_screen.dart
    │   │   └── services/
    │   │       ├── ble_scanner_service.dart  # flutter_blue_plus, dedup 10s, expiry 45s, sticky UUID classification
    │   │       ├── telemetry_service.dart    # Supabase writes (observations + volunteer_counts)
    │   │       └── session_state.dart        # singleton: volunteerId, zone, batteryChecked
    │   ├── supabase/
    │   │   ├── schema.sql                    # base observations table
    │   │   ├── schema_v2_volunteer_zone.sql  # adds volunteer_id + zone columns
    │   │   └── schema_v3_volunteer_counts.sql # volunteer_counts table
    │   ├── android/
    │   ├── pubspec.yaml                # sdk ^3.12.2, pointycastle: 3.9.1 override (Windows CFE workaround)
    │   └── pubspec.lock
    └── flutter_ble_peripheral_patched/ # local plugin fork (version 2.1.1)
        ├── lib/
        ├── android/                    # BleAdvertisingService.kt, FlutterBlePeripheralPlugin.kt, etc.
        ├── darwin/ / windows/
        └── pubspec.yaml
```

---

## 3. Prerequisites

| Requirement | Version / Notes | How to check |
|-------------|-----------------|--------------|
| **Flutter SDK** | `^3.12.2` (both apps declare `environment.sdk: ^3.12.2` in `pubspec.yaml:21`). Use the same major line. | `flutter --version` |
| **Dart SDK** | Bundled with Flutter; `^3.12.2` | `dart --version` |
| **JDK** | **17** — both `android/app/build.gradle.kts:13-14` set `VERSION_17` and `JvmTarget.JVM_17`. JDK 21 will fail. | `java -version` |
| **Android Studio** + **Android SDK** | `compileSdk = 37` (`android/app/build.gradle.kts:9`), `targetSdk` via `flutter.targetSdkVersion`. Install SDK Platform 37 + Build-Tools + Platform-Tools. | Android Studio > SDK Manager |
| **Gradle** | `9.1.0` via wrapper (`android/gradle/wrapper/gradle-wrapper.properties:5`). No manual install needed — wrapper downloads it. | — |
| **Kotlin** | Managed by Flutter Gradle plugin | — |
| **Supabase account** | Free tier is enough. Needed only for `volunteer_mobile`. | https://supabase.com |
| **Physical Android devices** | **2 devices required** for end-to-end testing (one advertiser, one scanner). BLE peripheral mode is **not supported on the Android emulator** — `BLUETOOTH_ADVERTISE` will silently fail. Devices should run **Android 8+** (API 26+), ideally Android 12+ to exercise the `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` runtime-permission flow. The patched plugin specifically fixes Android 14. | `adb devices` |
| **USB debugging** | Enable Developer Options → USB debugging on each device. | — |
| **Git** | Any recent version | `git --version` |

> **Windows note:** a Dart compiler (CFE) crash on Windows with `pointycastle 4.0.0` is already worked around in `apps/volunteer_mobile/pubspec.yaml:48-53` via `dependency_overrides: pointycastle: 3.9.1`. Do not remove this override on Windows.

> **Flutter not on PATH?** If `flutter --version` fails after installing Flutter, add `<FLUTTER_INSTALL>/bin` to your system `PATH` and restart the terminal. On Windows the installer is at https://docs.flutter.dev/get-started/install/windows.

---

## 4. Clone the Repository

```powershell
git clone <YOUR_REPO_URL> spatially
cd spatially
```

If you already have the folder (e.g. `C:\Users\Blaise Rodrigues\Desktop\spatially`), just open it:

```powershell
cd "C:\Users\Blaise Rodrigues\Desktop\spatially"
```

Verify the workspace:

```powershell
dir apps
# should show: attendee_mobile  volunteer_mobile  flutter_ble_peripheral_patched
```

---

## 5. Supabase Backend Setup

`volunteer_mobile` writes to Supabase. `attendee_mobile` does not use Supabase today (its `lib/config/supabase_config.dart` is gitignored for future use but not imported — you can skip it).

### 5.1 Create a Supabase project

1. Go to https://supabase.com → **New project**.
2. Choose a project name (e.g. `spatially`), set a database password, pick a region close to you.
3. Wait for provisioning (~1–2 min).

### 5.2 Run the SQL migrations (in order)

In Supabase Dashboard → **SQL Editor** → **New query**, run each file in order:

**1 — Base table** (`apps/volunteer_mobile/supabase/schema.sql:1`):

```sql
CREATE TABLE observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    ephemeral_id TEXT NOT NULL,
    rssi INTEGER NOT NULL,
    scanned_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_spatially_device BOOLEAN NOT NULL DEFAULT false
);
-- Note: Row Level Security (RLS) is intentionally not enabled for prototype development.
```

**2 — Volunteer + zone columns** (`apps/volunteer_mobile/supabase/schema_v2_volunteer_zone.sql:1`):

```sql
ALTER TABLE observations ADD COLUMN volunteer_id UUID REFERENCES auth.users(id);
ALTER TABLE observations ADD COLUMN zone TEXT;
```

**3 — Live counts table** (`apps/volunteer_mobile/supabase/schema_v3_volunteer_counts.sql:1`):

```sql
CREATE TABLE volunteer_counts (
    volunteer_id UUID PRIMARY KEY REFERENCES auth.users(id),
    zone TEXT,
    active_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
```

> Run **Verify**: Dashboard → **Table Editor** should list `observations` (with `ephemeral_id`, `rssi`, `scanned_at`, `is_spatially_device`, `volunteer_id`, `zone`) and `volunteer_counts`.

### 5.3 Enable Email/Password auth and create a volunteer user

1. Dashboard → **Authentication** → **Providers** → ensure **Email** is enabled (it is by default). Disable **Confirm email** for prototype ease: **Authentication** → **Providers** → **Email** → turn off *Confirm email*.
2. Dashboard → **Authentication** → **Users** → **Add user** → **Create new user** → enter `volunteer@test.com` / a password (e.g. `test1234`) → **Create user**. This is the account you will use on the volunteer device.
3. Alternatively, keep **Confirm email** on and use the **Invite** flow — but the simplest for local testing is auto-confirm.

### 5.4 Copy your Supabase credentials

Dashboard → **Project Settings** → **API** (or **Connect** → **App Frameworks**):

- **Project URL** — e.g. `https://abcdefgh.supabase.co`
- **anon public key** — long JWT under *Project API keys* → `anon` `public`

You need both in the next step. The `service_role` key is **not** needed (and must never be bundled in the app).

---

## 6. Create the Supabase Config File

This file is **gitignored** (`/.gitignore:6` and `/.gitignore:10`) and does not exist after clone. You must create it, otherwise `volunteer_mobile` will fail to compile (`telemetry_service.dart:3` imports it).

Create `apps/volunteer_mobile/lib/config/supabase_config.dart`:

```dart
// apps/volunteer_mobile/lib/config/supabase_config.dart
// This file is gitignored — never commit real keys.

const String supabaseUrl = 'https://YOUR_PROJECT_REF.supabase.co';
const String supabaseAnonKey = 'YOUR_ANON_PUBLIC_KEY_JWT';
```

Replace the two strings with the values from §5.4. The file must export exactly those two `const String` names — `lib/services/telemetry_service.dart:3` and `lib/main.dart` depend on them via:

```dart
import '../config/supabase_config.dart';
// expects: supabaseUrl, supabaseAnonKey
// used in: await Supabase.initialize(url: supabaseUrl, anonKey: supabaseAnonKey)
```

**Template to copy-paste:**

```powershell
# PowerShell — create the directory + file
New-Item -ItemType Directory -Force -Path "apps\volunteer_mobile\lib\config" | Out-Null
@"
const String supabaseUrl = 'https://YOUR_PROJECT_REF.supabase.co';
const String supabaseAnonKey = 'YOUR_ANON_PUBLIC_KEY_JWT';
"@ | Set-Content -LiteralPath "apps\volunteer_mobile\lib\config\supabase_config.dart" -Encoding UTF8
```

Then open the file and paste your real URL/key.

> `attendee_mobile` does not import Supabase today. If you see a gitignored `apps/attendee_mobile/lib/config/supabase_config.dart` placeholder warning, you can ignore it or create an identical file there for future parity — it is not required to build or run `attendee_mobile`.

---

## 7. Install Dependencies

Run `flutter pub get` **inside each app** (the patched plugin is fetched via the local path override, no separate publish step).

**Option A — one by one:**

```powershell
cd "apps\volunteer_mobile"
flutter pub get

cd "..\attendee_mobile"
flutter pub get

cd "..\flutter_ble_peripheral_patched"
flutter pub get
```

**Option B — from repo root:**

```powershell
flutter pub get --directory=apps\volunteer_mobile
flutter pub get --directory=apps\attendee_mobile
flutter pub get --directory=apps\flutter_ble_peripheral_patched
```

Expected: `Got dependencies!` for each. If you see a `pointycastle` resolution warning on Windows, it should resolve to `3.9.1` (the override in `volunteer_mobile/pubspec.yaml:48-53`).

**Sanity check:**

```powershell
flutter analyze --no-pub
# from inside apps/volunteer_mobile or apps/attendee_mobile
```

Fix any `supabase_config.dart not found` error by revisiting §6.

---

## 8. Run the Apps

### 8.1 Connect devices

```powershell
adb devices
# should list 2 devices, e.g.:
# 14a3c9f1    device
# emulator-5554 device   <- do NOT use emulator for BLE peripheral tests
```

Enable Bluetooth on both devices.

### 8.2 Run volunteer_mobile (scanner) first

This is the device that needs Supabase + login.

```powershell
cd apps\volunteer_mobile
flutter run
# or explicitly:
flutter run -d <DEVICE_ID>   # get ID from `flutter devices`
```

**First-launch flow on device:**

1. **Battery check** (`lib/screens/battery_check_screen.dart:22`) — if battery < 50%, a warning is shown with *Continue Anyway*. On emulator/unsupported platform it auto-proceeds.
2. **Login** (`lib/screens/login_screen.dart:27`) — enter the Supabase user from §5.3 (e.g. `volunteer@test.com`). Auth is via `Supabase.instance.client.auth.signInWithPassword`.
3. **Zone selection** (`lib/screens/zone_selection_screen.dart:19`) — pick one of `Entrance`, `Main Stage`, `Food Court`, `Exit` → *Confirm* → navigates to `ScanScreen`.
4. **Scan** (`lib/screens/scan_screen.dart:65`) — tap **Start Scan**. The app:
   - checks Bluetooth is on (`BleScannerService.isBluetoothOn` via `FlutterBluePlus.adapterState`)
   - requests `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `LOCATION_WHEN_IN_USE`, `POST_NOTIFICATIONS`
   - requests to ignore battery optimization (`FlutterForegroundTask.requestIgnoreBatteryOptimization`)
   - starts `FlutterBluePlus.startScan()` + a foreground service (`spatially_ble_scan` channel) so scanning survives backgrounding
   - dedup window 10 s, presence timeout 45 s, Android cache-busting scan restart every 30 s, `volunteer_counts` upsert every 20 s

Leave this device scanning.

### 8.3 Run attendee_mobile (advertiser) on the second device

Open a **second terminal** (so both `flutter run` sessions stay attached):

```powershell
cd apps\attendee_mobile
flutter run -d <SECOND_DEVICE_ID>
```

**First-launch flow:**

1. **Battery check** (`lib/battery_check_screen.dart:22`) — same 50% gate.
2. **Advertiser screen** (`lib/main.dart:29`) — tap **Start Advertising**. The app:
   - checks `PeripheralState.poweredOff` via `FlutterBlePeripheral.onPeripheralStateChanged`
   - requests `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `POST_NOTIFICATIONS`
   - invokes the native `BleAdvertisingService` via `MethodChannel('dev.steenbakker.flutter_ble_peripheral/ble_service')` with service UUID `f47ac10b-58cc-4372-a567-0e02b2c3d479` + foreground notification channel `spatially_ble_advertise`

You should see the volunteer device's **Spatially devices detected → Active right now** increment within a few seconds, and new rows appear in Supabase **Table Editor → observations** (`is_spatially_device = true`) and **volunteer_counts**.

### 8.4 Stopping

- **Stop Scan / Stop Advertising** via the in-app buttons before killing the app — this stops the foreground service and cancels timers/subscriptions cleanly.
- Detach with `q` in the `flutter run` terminal, or `flutter detach`.

---

## 9. Build Release APKs

Both apps use `signingConfig = debug` for release builds (`android/app/build.gradle.kts:32`) so `flutter build apk --release` works without a keystore (for local testing only).

```powershell
# Volunteer
cd apps\volunteer_mobile
flutter build apk --release
# output: build\app\outputs\flutter-apk\app-release.apk

# Attendee
cd ..\attendee_mobile
flutter build apk --release
```

Install on device:

```powershell
adb -s <DEVICE_ID> install -r build\app\outputs\flutter-apk\app-release.apk
```

For a real Play Store release, replace the debug signing config with a proper keystore in `android/app/build.gradle.kts:28-34` and `android/key.properties`.

---

## 10. How the Local Patched Plugin Works

`attendee_mobile/pubspec.yaml:37,96-98` declares:

```yaml
dependencies:
  flutter_ble_peripheral: 2.1.1

dependency_overrides:
  flutter_ble_peripheral:
    path: ../flutter_ble_peripheral_patched
```

So even though `pubspec.yaml` says `2.1.1`, the actual code comes from `apps/flutter_ble_peripheral_patched/` (also version `2.1.1` in its own `pubspec.yaml:4`). This is how the repo carries the Android 14 fix without forking on pub.dev.

Key native changes in the patched plugin:

- `android/src/main/kotlin/dev/steenbakker/flutter_ble_peripheral/BleAdvertisingService.kt` — foreground service that owns the `BluetoothLeAdvertiser`, survives screen lock.
- `android/src/main/kotlin/dev/steenbakker/flutter_ble_peripheral/FlutterBlePeripheralPlugin.kt` — exposes `startBleAdvertisingService` / `stopBleAdvertisingService` over the `ble_service` MethodChannel.
- `android/src/main/AndroidManifest.xml` (in the plugin) + app manifests — `FOREGROUND_SERVICE_CONNECTED_DEVICE` permission and `foregroundServiceType="connectedDevice"` on Android 14+.

If you run `flutter pub get` and see `flutter_ble_peripheral 2.1.1 from path`, it is working.

> Do **not** run `flutter pub upgrade` without checking — it may try to bump `flutter_ble_peripheral` away from the path override.

---

## 11. Permissions & OS Behaviour to Know About

Declared in `apps/attendee_mobile/android/app/src/main/AndroidManifest.xml:1` and `apps/volunteer_mobile/android/app/src/main/AndroidManifest.xml:1`:

| Permission | Attendee | Volunteer | Notes |
|------------|----------|-----------|-------|
| `BLUETOOTH_ADVERTISE` | ✓ | — | Android 12+ advertiser role |
| `BLUETOOTH_SCAN` (`neverForLocation`) | — | ✓ | Scanner role |
| `BLUETOOTH_CONNECT` | ✓ | ✓ | Required on Android 12+ for both roles |
| `BLUETOOTH` / `BLUETOOTH_ADMIN` (`maxSdkVersion 30`) | ✓ | ✓ | Legacy fallback for Android < 12 |
| `ACCESS_FINE_LOCATION` | — | ✓ | Required for scan results on Android < 12; also when `neverForLocation` not set |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_CONNECTED_DEVICE` | ✓ | ✓ | Keeps BLE alive in background on Android 14+ |
| `POST_NOTIFICATIONS` | ✓ | ✓ | Foreground service notification |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | ✓ | ✓ | Prompt to exempt from Doze |

Runtime behaviour:

- **Battery optimization** — both apps call `FlutterForegroundTask.requestIgnoreBatteryOptimization()` on first scan/advertise. If the user denies, scanning/advertising will be killed shortly after the screen locks.
- **Bluetooth off** — volunteer shows *Please turn on Bluetooth to scan*; attendee shows *Please turn on Bluetooth to advertise* via `FlutterBluePlus.adapterState` / `PeripheralState.poweredOff` listeners.
- **Foreground notification** — Android shows an ongoing notification *Spatially — Scanning/Advertising active* while the foreground service runs. Swiping it away does not stop the service; only the in-app Stop button does.

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Target of URI doesn't exist: 'package:supabase_flutter/...'` or `supabase_config.dart not found` | `supabase_config.dart` missing (§6) or `flutter pub get` not run | Create `apps/volunteer_mobile/lib/config/supabase_config.dart` with `supabaseUrl`/`supabaseAnonKey`, then `flutter pub get` |
| `flutter: command not found` / `dart: command not found` | Flutter not on PATH | Add `<flutter>/bin` to system PATH, restart terminal, verify `flutter doctor` |
| `Unsupported Java version` / Gradle sync fails | JDK mismatch — project requires **JDK 17** (`build.gradle.kts:13`) | Install JDK 17 (e.g. Temurin 17), set `JAVA_HOME` to it, `java -version` should show 17 |
| `pointycastle` / `oaep.dart` / `RangeError` / `STATUS_ACCESS_VIOLATION` on Windows | Dart CFE bug with `pointycastle 4.0.0` on Dart 3.12.2 Windows | Already fixed via `dependency_overrides: pointycastle: 3.9.1` in `volunteer_mobile/pubspec.yaml:53`. Run `flutter pub get` again; do not remove the override |
| `InferenceVisitorImpl.visitIfStatement` / `ThisExpression → PropertyGet → IndexGet` CFE crash | Chained `Supabase.instance.client.from(...).insert(...)` on Windows | Code already breaks the chain into intermediate variables (`telemetry_service.dart:42-46`, `login_screen.dart:46-48`, etc.). If you add new Supabase calls, follow the same pattern: assign `Supabase.instance`, then `client`, then `table`, then `await table.insert(row)` |
| BLE advertising never starts, no error | Running on emulator (no peripheral mode) or `BLUETOOTH_ADVERTISE` denied | Use a **physical device**; grant Nearby devices / Bluetooth permission when prompted |
| Volunteer sees 0 Spatially devices even though attendee is advertising | Devices too far, Bluetooth off, or wrong UUID | Confirm attendee shows *Status: Advertising...*; keep devices < 10 m apart; check `logcat` for `BleAdvertisingService` lines: `adb logcat | Select-String -Pattern "BleAdvertising|Spatially"` |
| Supabase writes fail silently | Wrong URL/key, RLS blocking, or offline | Check `adb logcat` for `TelemetryService:` prints; verify credentials in `supabase_config.dart`; in Supabase dashboard confirm RLS is **off** (prototype) and tables exist per §5.2 |
| `FOREGROUND_SERVICE_CONNECTED_DEVICE` permission error on Android 13- | Normal on older OS — permission is ignored below API 34 | No action needed |
| `flutter analyze` shows `avoid_print` lints | Expected — project uses `print` for debug telemetry | Ignored by design; `analysis_options.yaml:33` has `avoid_print` commented out |
| `app-release.apk` won't install: `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Previous debug APK with same `applicationId` but different signature | `adb uninstall com.example.volunteer_mobile` (or `com.example.attendee_mobile`) then reinstall |

**Collecting logs:**

```powershell
# Flutter logs for the attached device
flutter logs

# Native Android logs filtered to this project
adb logcat | Select-String -Pattern "DEBUG|TelemetryService|BleAdvertising|FlutterBlePeripheral|ERROR"

# Full logcat to file
adb logcat -d > logcat.txt
```

---

## 13. Useful Commands Cheat-Sheet

```powershell
# Environment
flutter doctor -v
flutter --version; dart --version; java -version
adb devices
flutter devices

# Dependencies (run inside each app folder)
flutter pub get
flutter pub outdated
flutter analyze

# Run
flutter run                          # picks first device
flutter run -d <DEVICE_ID>          # pick a specific device
flutter logs                         # stream device logs
# hot reload: r   hot restart: R   quit: q   (inside flutter run)

# Build
flutter build apk --release
flutter build apk --debug

# Supabase — re-run a migration in SQL Editor if you need to reset:
# DROP TABLE volunteer_counts; DROP TABLE observations;  -- then re-run §5.2

# Git
git status
git log --oneline -10

# Clean (when Gradle or pub gets confused)
flutter clean; flutter pub get
cd android; .\gradlew clean; cd ..
```

---

## Quick-Start (TL;DR)

```powershell
# 1 — clone
git clone <URL> spatially; cd spatially

# 2 — create Supabase project, run 3 SQL files (§5.2), create auth user (§5.3)

# 3 — create config file with your Supabase URL + anon key
New-Item -ItemType Directory -Force -Path "apps\volunteer_mobile\lib\config" | Out-Null
# then edit apps\volunteer_mobile\lib\config\supabase_config.dart

# 4 — install deps
flutter pub get --directory=apps\volunteer_mobile
flutter pub get --directory=apps\attendee_mobile

# 5 — run (two terminals, two physical devices)
cd apps\volunteer_mobile; flutter run    # login → pick zone → Start Scan
cd apps\attendee_mobile; flutter run    # Start Advertising
```

Need help? Open an issue at https://github.com/anomalyco/opencode or check `PROJECT_LOG.md` (gitignored) for local dev notes.
