# NutriScope backend

A working Node.js/Express backend implementing the Food & Nutrition Management
System described in the project design chat: a food database, a nutrient
guide, a meal manager, a dashboard, reports, an admin surface, and an AI
Nutrient Assistant.

**Status: MVP.** There's no database or user accounts yet — meals are
computed statelessly from whatever the client sends in each request. This is
enough to run the whole feature set and pair it with a frontend, but before
real users log in and expect their data to persist, see "What to add next"
below.

## 1. Run it locally

```bash
npm install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY and ADMIN_KEY
npm start
```

The server starts on `http://localhost:3000` (or `$PORT`).

## 2. Deploy it

Netlify (where your frontend is) hosts static sites and short-lived
serverless functions — it does **not** run a long-lived Express server or
stream responses the way `/api/chat` needs to. Deploy this backend somewhere
that runs a persistent Node process instead, for example:

- **Render** (free tier available): New → Web Service → connect this repo →
  build command `npm install`, start command `npm start` → add
  `ANTHROPIC_API_KEY` and `ADMIN_KEY` as environment variables.
- **Railway**: New Project → Deploy from GitHub → it auto-detects Node → add
  the same environment variables.
- **Fly.io / a VPS**: works too, just needs Node 18+ and the same env vars.

Once deployed, point your frontend at the real URL, e.g.
`https://your-backend.onrender.com/api/chat`, instead of a relative
`/api/chat` path (relative paths only work if frontend and backend share an
origin).

## 3. API reference

All endpoints return JSON except `/api/chat`, which streams plain text.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/foods?query=` | Search/list foods |
| GET | `/api/foods/:id` | Full nutrient detail for one food |
| GET | `/api/nutrients?category=` | List nutrient guide entries |
| GET | `/api/nutrients/:id` | Full detail + food sources for one nutrient |
| POST | `/api/meals/compute` | `{ entries: [{foodId, servings}] }` → nutrient totals for that meal |
| POST | `/api/dashboard` | `{ meals: [{entries}] }` → today's totals + coverage status per nutrient |
| POST | `/api/reports` | `{ days: [{date, meals}] }` → averages, most-frequent foods, under-covered nutrients |
| POST | `/api/chat` | `{ messages, context? }` → streamed AI answer (same contract as the original spec, plus an optional `context` object) |
| POST | `/api/admin/foods` | Add/update a food (requires `x-admin-key` header) |
| DELETE | `/api/admin/foods/:id` | Remove a food (requires `x-admin-key`) |
| POST | `/api/admin/nutrients` | Add/update a nutrient (requires `x-admin-key`) |
| GET | `/api/health` | Liveness check |

### Dashboard/report status logic

Coverage status (`good` / `moderate` / `low` / `high`) is calculated against
generic, non-personalized reference amounts (see `GENERIC_DAILY_REFERENCE` in
`server.js`), the same way the design chat described: nutrients people should
get *enough* of are scored low→good, while sodium and added sugar (nutrients
to *watch*) are scored the other way — low intake is "good," high is flagged.
These are rough educational reference points, not individualized targets.

### AI Nutrient Assistant

`/api/chat` proxies to the real Anthropic API using your own
`ANTHROPIC_API_KEY`, with a system prompt that keeps it scoped to nutrition
education (no medical advice, no diagnoses) and aware of NutriScope's tracked
nutrient list. Pass an optional `context` object with whatever the user is
currently looking at — a food, a nutrient, today's dashboard totals — and the
assistant will use it, e.g.:

```json
{
  "messages": [{ "role": "user", "content": "What can I add to boost this?" }],
  "context": { "page": "food", "foodId": "roti" }
}
```

## 4. What to add next

This MVP intentionally leaves out things that need real infrastructure
decisions rather than a quick default:

- **A real database** (Postgres/MongoDB) instead of the JSON files in
  `data/`, so admin edits and user data survive restarts and scale past one
  instance.
- **User accounts and auth**, so `/api/dashboard` and `/api/reports` read a
  logged-in user's actual saved meals instead of requiring the client to
  resend everything each time.
- **A profile-aware reference table** (age/sex/activity level) instead of
  the single generic reference used for the demo coverage indicators.
- **Recipes**, connecting a recipe's ingredient list to this same food/nutrient
  engine — the `computeTotals()` function in `server.js` already does the
  hard part; a recipe is just a fixed set of `{foodId, servings}` entries.
- **Real admin auth** in place of the single shared `ADMIN_KEY`.
