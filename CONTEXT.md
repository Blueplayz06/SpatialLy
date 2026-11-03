# Spatially Domain Context

Spatially is a real-time event intelligence and crowd coordination platform bridging event organizers, on-ground volunteers, and attendees.

## Language

### Operational Entities

**Event**:
An authorized gathering hosted across one or more physical venues, bounded by start and end timestamps.
_Avoid_: Show, function, party

**Event Zone**:
An operational partition within a venue with a calibrated operating capacity and safety threshold.
_Avoid_: Area, room, sector

**Operating Capacity**:
The calibrated maximum concurrent attendee threshold for a specific zone before safety alerts trigger.
_Avoid_: Room size, limit, maximum head

**Volunteer**:
A registered staff user assigned to an event to monitor crowd safety, assist attendees, and execute operational tasks.
_Avoid_: Helper, worker, agent

**Event Squad**:
A tactical grouping of volunteers assigned to an event function (e.g. Crowd Safety, Medical Response, Registration).
_Avoid_: Group, division, crew

**Active Shift**:
A real-time on-duty record linking a volunteer to an event, team, and designated zone.
_Avoid_: Schedule, work slot

### Real-Time Signals & Telemetry

**Volunteer Proximity Telemetry**:
Real-time headcount of attendees detected by on-ground volunteers via BLE scanning and turnstile observations.
_Avoid_: BLE ping, attendee tracker, device sniffer

**Coverage Request**:
A real-time relief ticket submitted by an on-duty volunteer needing temporary coverage for a break or emergency.
_Avoid_: Shift swap, leave notice

**Operational Incident**:
A prioritized event issue requiring staff acknowledgment, triage, and volunteer dispatch.
_Avoid_: Ticket, bug, complaint

**Overcrowding Alert**:
An automated critical incident and notification dispatched when a zone's attendee density exceeds safe thresholds.
_Avoid_: Spike alert, congestion flag, crowd spike
