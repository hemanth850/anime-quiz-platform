# Anime Quiz Platform

Timed quizzes by genre/studio/era, multiplayer rooms, rankings, and an admin question bank.

## Current Status
Phase 1 is implemented in this repository:
- Real-time multiplayer rooms with Socket.IO
- Timed question rounds + score calculation
- Quiz filtering by genre, studio, and era
- Global rankings endpoint and UI
- Admin panel to manage question bank (token protected)

## Architecture
- `apps/api`: Express REST API + Socket.IO server
- `apps/web`: React + Vite frontend

## Run Locally
1. Install dependencies:
```bash
npm install
```
2. Start backend + frontend:
```bash
npm run dev
```
3. Open frontend:
- `http://localhost:5173`

Default API URL is `http://localhost:4000`.

## Admin Access
- Header/token key: `x-admin-token`
- Default token: `dev-admin-token`
- Override with env var in API process: `ADMIN_TOKEN`

## Implemented API (Phase 1)
- `GET /health`
- `GET /api/questions`
- `POST /api/questions` (admin)
- `PUT /api/questions/:id` (admin)
- `DELETE /api/questions/:id` (admin)
- `GET /api/rankings`
- `POST /api/quizzes/single`

Socket events:
- `room:create`
- `room:join`
- `room:start`
- `room:answer`
- `room:state` (server emit)
- `room:ended` (server emit)

## Delivery Roadmap
### Phase 1 (Completed)
- Monorepo scaffold
- Multiplayer gameplay loop
- Admin CRUD foundation
- Rankings and base UI

### Phase 2
- Auth (JWT + refresh), role-based admin
- Persistent DB (PostgreSQL + Prisma)
- Question import/export, tags, difficulty tuning
- Match history and player profiles
- Better anti-cheat validations and reconnect recovery

### Phase 3
- Ranked seasons, ELO/MMR, leaderboards by mode
- Tournament brackets and spectator mode
- Observability (metrics/logging/traces)
- CI/CD, load testing, and autoscaling profile

## Planning Docs
- `docs/V1_ROADMAP.md`
- `docs/API_CONTRACT.md`
- `docs/MVP_SCOPE.md`
- `docs/IMPLEMENTATION_BACKLOG.md`
- `docs/SPRINT_01_PLAN.md`

## Notes
This Phase 1 build is intentionally lean for fast iteration. It is complete enough for local end-to-end testing and incremental feature expansion in later phases.
