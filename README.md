# IdeaPilot

**Turn Your Ideas Into Action.** IdeaPilot is a server-rendered web app that turns a raw idea into a visual map, a structured analysis, a versioned roadmap and a set of trackable tasks. An optional AI copilot (Google Gemini) suggests changes, but nothing it produces is applied until you review and accept it.

Workflow: **Idea → Map → Plan → Execute**.

---

## Contents

1. [Features](#features)
2. [Tech stack](#tech-stack)
3. [Quick start](#quick-start)
4. [Environment variables](#environment-variables)
5. [Scripts](#scripts)
6. [Project structure](#project-structure)
7. [Architecture](#architecture)
8. [Security](#security)
9. [AI copilot](#ai-copilot)
10. [Languages](#languages)
11. [Testing](#testing)
12. [What has and has not been verified](#what-has-and-has-not-been-verified)
13. [Deployment notes](#deployment-notes)
14. [Troubleshooting](#troubleshooting)
15. [Walkthrough video](#walkthrough-video)

---

## Features

- **Landing page** with a live map preview, features, how it works, workflow, FAQ and footer.
- **Accounts**: register, log in, log out, profile settings and password change. Passwords are hashed with bcrypt, sessions are stored in MongoDB, and every form and state-changing request is CSRF protected.
- **Dashboard** with your projects, their stage and status, task progress, search and filters.
- **Create Idea** form: title, problem, audience, goals, constraints and so on. A starter map is created from what you enter.
- **Workspace** with five tabs:
  - **Map**: an interactive Cytoscape.js graph with 9 node types (idea, goal, assumption, risk, resource, decision, milestone, task, note) and 8 relationship types (supports, depends_on, blocks, influences, alternative_to, part_of, tests, related_to). You can add, edit, delete, connect, drag, filter, search, fit and zoom. Positions autosave, and the viewport and filters are remembered per project.
  - **Analysis**: problem, audience, value proposition, goals, assumptions, risks, resources, success metrics and open questions. Analysis items can be synced onto the map as nodes.
  - **Roadmap**: phases, milestones and tasks, with drag-and-drop reordering, saved plan versions and the impact-based replan.
  - **Tasks**: a list view and a Kanban view, priorities, due dates, dependencies (with cycle detection), links to map nodes and phases.
  - **History**: activity feed, decisions log, plan versions (view or restore any version) and AI proposals.
- **Dependency rules**: a task cannot depend on itself, cannot create a cycle, and cannot be marked completed while its dependencies are still open. These rules run on the server, so they hold no matter what the browser sends.
- **Plan versioning**: saving a version archives a snapshot of the plan and its tasks. Restoring a version creates a new version from that snapshot, so history is never overwritten.
- **Replanning**: when a node changes, IdeaPilot walks the graph to find the affected nodes, linked tasks, dependent tasks and milestones. It then proposes a new plan version for you to review.
- **AI copilot (optional)**: analyze the idea, expand the map, draft a roadmap, generate tasks or chat about the project. Every suggestion becomes a *proposal* that you approve or reject item by item.
- **Arabic and English**: a language button in the header switches the whole interface, including the map labels, error messages and dates. Arabic uses right-to-left layout (Bootstrap RTL) and the Cairo font. When the interface is in Arabic, the AI copilot answers in Arabic too. See [Languages](#languages).
- Responsive layout down to phone width.

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 20+ (tested on Node 22) |
| Server | Express 5, EJS 7 + express-ejs-layouts (MVC, server-rendered) |
| Database | MongoDB with Mongoose 9 |
| Sessions | express-session + connect-mongo |
| Validation | Zod 4 (for requests, the environment and AI output) |
| Security | helmet (strict CSP), bcrypt, session CSRF tokens, express-rate-limit |
| Frontend | HTML5, CSS3, vanilla JavaScript, Bootstrap 5, Lucide icons |
| Graph | Cytoscape.js |
| AI | Official Google Gen AI SDK (`@google/genai`) |
| Tests | Node's built-in test runner, Supertest, mongodb-memory-server |

There is no frontend framework (no React, Vue, Angular, Next or Nuxt) and no build step. Bootstrap, Cytoscape and Lucide are served directly from `node_modules` under `/vendor/...`.

## Quick start

### Requirements

- Node.js 20 or newer and npm
- MongoDB 6+ running locally, **or** a MongoDB Atlas connection string, **or** neither if you use `npm run dev:memory` to try the app.

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and set at least:

```ini
MONGODB_URI=mongodb://127.0.0.1:27017/ideapilot
SESSION_SECRET=<a random string of 32+ characters>
```

You can generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**MongoDB Atlas:** create a cluster and a database user, allow your IP under Network Access, then use the connection string:

```ini
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/ideapilot?retryWrites=true&w=majority
```

**AI (optional):** to turn on the copilot, set:

```ini
AI_PROVIDER=google
AI_API_KEY=<your Gemini API key from https://aistudio.google.com/apikey>
AI_MODEL=gemini-flash-latest
```

If `AI_API_KEY` is empty, the app works fully and the AI controls are hidden or disabled with an explanation.

### 3. Run

```bash
npm run dev      # development, restarts on change (nodemon)
npm start        # production-style start
```

Open http://localhost:5000 (or whatever `PORT` you set), register an account and create your first idea.

### Try it without MongoDB

```bash
npm run dev:memory
```

This starts a throwaway in-memory MongoDB and generates a session secret if none is set. **Data is lost when the process exits.** The first run downloads a MongoDB binary (see [Troubleshooting](#troubleshooting) if your network blocks that).

## Environment variables

The server validates the environment at startup (`config/env.js`) and refuses to start with a readable list of problems. That list names the variables but never prints their values.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development`, `production` or `test` |
| `PORT` | no | `5000` | HTTP port |
| `MONGODB_URI` | **yes** | | MongoDB connection string |
| `SESSION_SECRET` | **yes** | | At least 32 characters; signs the session cookie |
| `SESSION_NAME` | no | `ideapilot.sid` | Session cookie name |
| `APP_BASE_URL` | no | `http://localhost:5000` | Public URL; used as the allowed CORS origin |
| `AI_PROVIDER` | no | `google` | AI provider (only `google` is implemented) |
| `AI_API_KEY` | no | empty | Gemini API key; empty means AI is disabled |
| `AI_MODEL` | no | `gemini-flash-latest` | Gemini model name |
| `SESSION_MAX_AGE_HOURS` | no | `24` | Rolling session lifetime |
| `BCRYPT_ROUNDS` | no | `12` | bcrypt cost (4-15) |
| `TRUST_PROXY` | no | `false` | Set `true` behind a reverse proxy or load balancer (needed for secure cookies and correct client IPs) |
| `LOGIN_RATE_LIMIT` | no | `10` | Login, register and password attempts per 15 minutes per IP and email |
| `AI_RATE_LIMIT_PER_MINUTE` | no | `6` | AI requests per user per minute |
| `AI_DAILY_LIMIT` | no | `50` | AI requests per user per 24 hours |
| `AI_TIMEOUT_MS` | no | `45000` | Timeout for each AI request |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` or `silent` |

`.env` is in `.gitignore`. Never commit it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Runs `server.js` |
| `npm run dev` | Runs with nodemon (watches `.js`, `.ejs`, `.json`) |
| `npm run dev:memory` | Runs against an in-memory MongoDB |
| `npm test` | Runs the full test suite (`node --test`) |

## Project structure

```
ideapilot/
├── app.js                 # createApp(): middleware, security headers, routes, error handling
├── server.js              # env validation, DB connect, listen, graceful shutdown
├── config/                # env (Zod), database, session store, AI config
├── models/                # Mongoose models: User, Project, IdeaNode, IdeaEdge, Plan, Task,
│                          #   Decision, Activity, AIConversation, Proposal, constants
├── controllers/           # thin request handlers, one per area
├── routes/                # Express routers with auth, ownership and validation middleware
├── services/              # business logic: graph traversal, task dependencies, plan
│                          #   versioning, replanning, AI calls, proposal apply handlers
├── validators/            # Zod schemas for every request body and for AI output
├── middleware/            # auth, project ownership, CSRF, flash, rate limits, errors
├── utils/                 # logger (redacting), HTTP helpers, formatting
├── views/                 # EJS layouts, partials and pages
├── public/                # CSS, vanilla JS (map, workspace, tasks), images
├── scripts/dev-memory.js  # in-memory MongoDB runner
└── tests/                 # node:test + Supertest + mongodb-memory-server
```

## Architecture

**MVC, server-rendered.** Pages are rendered with EJS. A small amount of vanilla JavaScript adds interactivity: the Cytoscape map, the Kanban and roadmap drag-and-drop, inline title editing, and the copilot panel. Interactive actions call JSON endpoints with `fetch`. Everything else uses plain HTML forms with the post/redirect/get pattern and flash messages, so the core flows work without JavaScript.

**Thin controllers, fat services.** Controllers parse the request and render. The rules live in `services/`:

- `graphService`: node and edge CRUD, edge uniqueness, and `traverseImpact()`, the breadth-first walk used by replanning. Its `PROPAGATION` table decides which relationship types carry a change and in which direction. `related_to` goes only one hop, and `alternative_to` is reported as alternatives rather than impacts.
- `taskService`: `wouldCreateCycle()` (a DFS over dependencies), dependency validation, the completion guard, ordering and status decoration such as *blocked by*.
- `planService`: `createVersion()` archives the current plan with a snapshot of its tasks and creates the next version. `restoreVersion()` rebuilds a plan and its tasks from a snapshot as a *new* version.
- `replanService`: deterministic impact analysis. It runs the graph traversal, then linked tasks, then dependents, then affected milestones. The result is a replan proposal.
- `aiService` and `aiProviders`: provider abstraction, timeouts, quotas, output validation and audit records.
- `proposalService`: builds proposals from AI or replan output and applies only the items the user selected. Accepting is an atomic claim, so a double submit returns 409.
- `activityService`: writes the activity feed shown in History.

**Data passing to the browser.** Because the CSP forbids inline scripts, server data (for example the graph) is embedded as `<script type="application/json">` and safely escaped by `utils/http.safeJson`. Page scripts read it from there.

**Ownership.** Every `/projects/:projectId/...` route goes through `requireProjectOwner`, which loads the project with `{ _id, owner: currentUser }`. Child documents (nodes, edges, tasks, phases, plans, proposals) are always queried with the project id as well. A project you do not own returns **404**, so the app does not reveal that it exists.

## Security

- **Passwords** are hashed with bcrypt (cost 12 by default). Plaintext passwords are never stored or logged, and the password hash is excluded from queries by default.
- **Sessions** are server-side in MongoDB (connect-mongo). The cookie is `httpOnly` and `sameSite=lax`, and `secure` is on in production. The session id is regenerated on login and register, and the session is destroyed on logout. Nothing sensitive is written to `localStorage`; it only holds UI preferences such as map filters and viewport.
- **CSRF**: a synchronizer token per session. Forms send `_csrf`, and `fetch` sends the `X-CSRF-Token` header. Every non-GET request is checked.
- **Authorization runs on the server** for every route. Frontend checks only make the interface friendlier.
- **Input validation**: every request body goes through a strict Zod schema, and unknown keys are rejected. This also blocks operator injection such as `{"$ne": ...}`, and a test covers it. Ids are validated as ObjectIds before any query runs.
- **Headers**: helmet with a strict Content Security Policy (`script-src 'self'`, no inline scripts or styles injected from data). CORS is limited to `APP_BASE_URL`, and the request body size is limited to 200 KB.
- **Rate limits** apply to login, register and password change (per IP plus email) and to AI endpoints (per user, per minute). There is also a daily AI quota per user.
- **Secrets** stay in `.env` and are read only on the server. They never appear in templates or public assets. The logger redacts keys, passwords, tokens, cookies and secrets.
- **Errors** show friendly pages (404, 403, 500), and stack traces are never shown to users in production.

## AI copilot

The copilot is **optional and advisory**. Each action sends the project context to the configured model, validates the response against a Zod schema, and saves it as a **Proposal**. The proposal page lists every suggested item with a checkbox. Only the items you select are applied, and only when you click Accept. Reject discards it. Every attempt, successful or not, is recorded in `AIConversation` and appears in History.

| Action | Produces |
| --- | --- |
| Analyze idea | Suggested analysis fields (goals, risks, assumptions and so on) |
| Expand map | New nodes and relationships |
| Draft roadmap | Phases and milestones (applied as a new plan version) |
| Generate tasks | Tasks with priorities and dependencies (dependency rules still apply) |
| Chat | A conversational answer about the project, with no changes |

**Configuration.** Set `AI_PROVIDER=google`, `AI_API_KEY` and `AI_MODEL` (default `gemini-flash-latest`). The key is read on the server only. The browser asks `/projects/:id/ai/status`, which reports whether AI is enabled and the model name, never the key.

**Failure handling.** IdeaPilot never reports success when the provider failed. Each failure type has its own message:

- missing configuration
- invalid key (AUTH)
- rate limit or quota (from the provider or the app)
- timeout
- safety block
- response cut off at the token limit
- network error
- a response that does not match the schema (INVALID_OUTPUT)

The failure is shown to the user, logged without secrets, and recorded as a failed attempt.

**Adding a provider.** In `services/aiProviders.js`, write a factory that returns an object with `name` and an async `generate({ model, system, prompt, schema, maxOutputTokens, timeoutMs, signal })` method that resolves to `{ text, usage }` or throws. Add it to `FACTORIES` under its `AI_PROVIDER` name, next to `google`.

## Languages

The interface is available in English and Arabic.

- **Switching.** The language button in the header (and in the workspace bar) calls `GET /lang/:code?next=/current/page`. It stores the choice in the `ideapilot.lang` cookie (httpOnly, one year) and returns to the same page. Only local paths are accepted in `next`. Without a cookie, the browser's `Accept-Language` decides, then English.
- **How strings are translated.** English text is the key. `locales/ar.json` maps it to Arabic, and views call `__('English text', { vars })`. Keys with `{placeholders}` also match finished English sentences, so stored text such as activity entries and server error messages is shown in Arabic. The browser gets the same dictionary as JSON (`#i18n-strings`) and uses `IdeaPilot.__` in `public/js/main.js`.
- **Right to left.** Arabic pages load `bootstrap.rtl.min.css` and the Cairo font. The custom CSS uses logical properties (`margin-inline-start` and so on), and direction arrows are mirrored.
- **AI.** When the request is in Arabic, the copilot's system prompt asks for Arabic output.
- **Adding a string.** Wrap it in `__()` and add the English text with its translation to `locales/ar.json`. With `I18N_REPORT=1`, strings that had no translation are collected in the `missing` set exported by `utils/i18n.js`, which helps when checking pages from a script.
- **Adding a language.** Add `locales/<code>.json`, add the code to `SUPPORTED` in `utils/i18n.js`, and to `RTL` if it is written right to left.

## Testing

```bash
npm test
```

The suite uses Node's built-in test runner with Supertest against the real Express app and an in-memory MongoDB. No real AI calls are made; a fake provider is injected through `aiService.setProviderForTests`. The suite covers:

- **auth**: registration with bcrypt hashing, 422 validation errors, duplicate email, login, session stored in MongoDB with secure cookie flags, session id regeneration on login, logout, redirect or 401 for anonymous users, CSRF rejection, login rate limiting, settings and password change.
- **projects**: create (with initial plan, root node and activity), required fields, dashboard search and filters, form and inline JSON edits, cascading delete, other users get 404, malformed ids return 404, analysis save and sync from the map.
- **graph**: nodes, edges and positions persisted and reloaded, HTML escaping of embedded graph data, cascading node delete, invalid types and payloads rejected, no edges to another user's nodes.
- **tasks**: status changes and progress, the completion guard, overdue and waiting flags, form edits, self and circular dependencies (409), indirect cycle detection, cross-project dependencies rejected, dependency cleanup on delete, reorder and phase moves, list and Kanban views.
- **plans**: phase add, move and delete, version save and restore, impact traversal semantics, replan proposal accept and reject, double accept returning 409, History page.
- **ai**: disabled state, the key never reaching the browser, provider errors recorded with no proposal, timeouts, schema-invalid output discarded, auth and rate-limit error mapping, flash messages instead of fake success, daily quota, graph proposals applying only selected items, roadmap proposals as a new plan version with cycles removed, provider schema conversion.
- **app**: landing page and security headers, the language switch (cookie, `dir="rtl"`, `Accept-Language`, refusing off-site redirects), `/healthz` reporting the database state, 404 page, oversized and malformed JSON, operator injection in login, environment errors naming variables without values.

Last run: **63 tests, 63 passed, 0 failed**.

> **Restricted networks:** mongodb-memory-server downloads a MongoDB binary on first use. If `fastdl.mongodb.org` is blocked, install `mongod` another way and point the tests at it:
>
> ```bash
> MONGOMS_SYSTEM_BINARY=/path/to/mongod npm test
> ```

## What has and has not been verified

**Verified by running it:**

- The full test suite (63/63).
- Manual smoke tests with curl.
- Headless browser (Playwright/Chromium) end-to-end runs:
  - registering and creating a project
  - adding nodes, connecting them, dragging a node and checking the position survives a reload
  - phases, milestones and tasks
  - a dependency cycle rejected with 409
  - a Kanban drag
  - a replan that created v2, then restoring v1 as v3
  - the copilot panel rendering
  - no horizontal overflow at 390px phone width
  - no JavaScript console errors
  - the whole flow in Arabic (right to left), recorded as the walkthrough video, with no console errors and no horizontal overflow

**Not verified:**

- **Live Gemini, partly.** With a real key on 2026-10-15 (model `gemini-flash-latest`), **Expand map**, **Draft roadmap**, **Generate tasks** and **Chat** each returned a valid proposal or answer, and accepting the proposals applied them. **Analyze idea** was not confirmed: every attempt got 503 "high demand" from Google, which the app showed as "The AI model is busy right now". Two findings from live testing are fixed in the code:
  - `gemini-2.5-flash` is no longer offered to new keys, so the default model is now `gemini-flash-latest`.
  - Gemini rejected schemas with `minItems`/`maxItems` (400 INVALID_ARGUMENT). Those are now left out of the request, and over-long arrays are trimmed after the response arrives.

  Free-tier keys hit Google's per-minute quota after a few requests. The app reports this as a rate limit, and nothing is changed. On 2026-10-15 the free tier allowed only **20 requests per day** for `gemini-flash-latest`. Once that ran out, `gemini-flash-lite-latest` still worked with the same key, and the walkthrough video's copilot answer came from it. If you run out, set `AI_MODEL=gemini-flash-lite-latest`.
- **MongoDB Atlas** connection: only local and in-memory MongoDB were used. Atlas uses the same driver and connection string format.
- **Production behind HTTPS** (secure cookies with `TRUST_PROXY`): the configuration is in place but was not exercised.
- Browsers other than Chromium.

## Deployment notes

- Set `NODE_ENV=production`, a strong `SESSION_SECRET`, a production `MONGODB_URI` and the public `APP_BASE_URL`.
- Serve over HTTPS. Behind a proxy (Render, Railway, Heroku, nginx), set `TRUST_PROXY=true` so secure cookies and rate limiting work.
- Run with `npm start` under a process manager (systemd, pm2 or the platform's own). The server closes HTTP and MongoDB connections cleanly on SIGTERM.
- Indexes are created by Mongoose on startup. For large datasets, consider building them ahead of time.

### Deploying to Vercel

The repository includes `api/index.js` and `vercel.json`, so it can run on Vercel as one serverless function. Vercel does not run `server.js`; the function connects to MongoDB on the first request and reuses the connection while it stays warm.

1. Create a free **MongoDB Atlas** cluster. Vercel has no MongoDB of its own and `dev:memory` does not work there. Under Network Access, allow `0.0.0.0/0`, because Vercel's addresses change. Copy the connection string.
2. Push the project to a GitHub repository and import it in Vercel (Framework preset: **Other**, no build command needed).
3. In the Vercel project's Environment Variables, set:
   - `NODE_ENV=production`
   - `MONGODB_URI`: the Atlas connection string
   - `SESSION_SECRET`: at least 32 random characters
   - `APP_BASE_URL`: your Vercel address, for example `https://ideapilot.vercel.app`
   - `TRUST_PROXY=true` (Vercel sits behind a proxy; without it the secure session cookie is not set and login does not stick)
   - optional: `AI_PROVIDER=google`, `AI_API_KEY`, `AI_MODEL`
4. Deploy.

Limits to know about:

- Rate limits (login attempts, AI requests per minute) are counted in memory, so on Vercel each running instance counts separately. The daily AI quota is stored in MongoDB and is not affected.
- `vercel.json` allows AI requests up to 60 seconds, which fits the Hobby plan.
- The first request after a quiet period is slower while the function starts and connects to Atlas.

Tested locally: the Vercel handler was run in production mode against MongoDB with `X-Forwarded-Proto: https`. The landing page, static files, Arabic stylesheet and language switch worked, and the session cookie came back `HttpOnly; Secure; SameSite=Lax`. It has not been deployed to Vercel itself.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Invalid environment configuration` on start | Read the listed variables; most often `MONGODB_URI` is missing or `SESSION_SECRET` is shorter than 32 characters. |
| `Could not connect to MongoDB` | Make sure `mongod` is running or that your Atlas IP allowlist includes you. The server retries a few times before exiting. |
| Tests or `dev:memory` fail downloading MongoDB | Set `MONGOMS_SYSTEM_BINARY` to a local `mongod` binary. |
| "Your session expired, please try again" after submitting a form | The CSRF token or session expired; reload the page. |
| AI buttons are disabled | `AI_API_KEY` is empty, or the AI status endpoint reports a configuration problem. |
| AI says "rate limit" | Wait a minute (per-minute limit) or until the 24-hour window frees up (`AI_DAILY_LIMIT`). Google's free tier also has a small per-model daily limit; switching to `AI_MODEL=gemini-flash-lite-latest` uses a separate quota. |
| Logged in but cookies are not kept in production | Use HTTPS and set `TRUST_PROXY=true` behind a proxy (always on Vercel). |
| Vercel shows "IdeaPilot could not start" | Open the function logs: a missing variable is named there, or Atlas refused the connection (check the Network Access allowlist). |

## Walkthrough video

`ideapilot-walkthrough-ar.mp4` (about 3 minutes 20 seconds, Arabic captions) shows the whole flow with an Arabic example, a small home bakery: switching the site to Arabic, registering, creating the idea, building the map, the analysis, the roadmap, tasks and Kanban, replanning after an assumption turned out wrong, history, and a real answer from the AI copilot. It was recorded with Playwright against this code.
