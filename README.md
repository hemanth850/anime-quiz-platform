# Anime Quiz Platform

Timed quizzes by genre/studio/era, multiplayer rooms, rankings, and an admin question bank.

## Current Status
Phase 3 foundation is now implemented:
- Real-time multiplayer rooms with Socket.IO
- Timed question rounds + score calculation
- Quiz filtering by genre, studio, and era (DB-backed)
- Global rankings endpoint (persisted from finished matches)
- JWT auth (register/login/refresh/me)
- Role-based admin authorization for question bank
- PostgreSQL + Prisma data models for users/questions/matches/tokens
- Ranked mode with season-based MMR updates
- Ranked leaderboard endpoint
- Spectator support in live rooms

## Architecture
- `apps/api`: Express REST API + Socket.IO server
- `apps/web`: React + Vite frontend

## Run Locally
1. Install dependencies:
```bash
npm install
```
2. Configure API env:
```bash
cp apps/api/.env.example apps/api/.env
```
3. Run Prisma migrations (requires running PostgreSQL):
```bash
npm run prisma:migrate --workspace apps/api
```
4. Start backend + frontend:
```bash
npm run dev
```
5. Open frontend:
- `http://localhost:5173`
- UI tabs:
  - `Auth`
  - `Multiplayer`
  - `Rankings`

Default API URL is `http://localhost:4000`.

## Auth and Admin Access
- Register/login APIs issue `accessToken` + `refreshToken`.
- Admin actions require a bearer access token with role `ADMIN`.
- A compatibility fallback header is still accepted: `x-admin-token` (if `ADMIN_TOKEN` is set).
- Seeded admin can be configured with:
  - `SEED_ADMIN_EMAIL`
  - `SEED_ADMIN_USERNAME`
  - `SEED_ADMIN_PASSWORD`

## Implemented API (Phase 1)
- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me` (auth)
- `GET /api/profile/me` (auth)
- `GET /api/profile/me/matches` (auth)
- `GET /api/questions`
- `POST /api/questions` (admin)
- `PUT /api/questions/:id` (admin)
- `DELETE /api/questions/:id` (admin)
- `GET /api/rankings`
- `GET /api/seasons/current`
- `GET /api/leaderboards/ranked`
- `POST /api/quizzes/single`

## E2E Test
Run API end-to-end test for auth + room lifecycle + rankings:
```bash
npm run test:e2e
```

Socket events:
- `room:create`
- `room:join`
- `room:start`
- `room:answer`
- `room:spectate`
- `room:state` (server emit)
- `room:ended` (server emit)

## Delivery Roadmap
### Phase 1 (Completed)
- Monorepo scaffold
- Multiplayer gameplay loop
- Admin CRUD foundation
- Rankings and base UI

### Phase 2 (Completed)
- Auth (JWT + refresh), role-based admin
- Persistent DB (PostgreSQL + Prisma)
- Match history and player profile endpoints
- Better anti-cheat validations and reconnect recovery
- Question import/export and richer tagging (next)

### Phase 3 (In Progress)
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
This build is intentionally lean for fast iteration. It is complete enough for local end-to-end testing and incremental feature expansion in later phases.
