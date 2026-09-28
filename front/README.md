# Spam Scanner UI (dev)

Minimal Angular control panel for the Nest server API.

## Run

With the API on `http://localhost:3000`:

```bash
npm start --workspace=front
```

Open `http://localhost:4200`. Admin JWT is stored in **localStorage**; mailbox JWT in **sessionStorage** (new tab → admin only until you open a mailbox again).

On a mailbox page, **Sender lists** loads whitelist/blacklist into textareas (one address per line). **Save** calls `PUT .../lists/:kind`; **Import file** calls `POST .../import` (`.txt` lines or JSON array); **Export** downloads from `GET .../export`.

API docs (OpenAPI UI): `http://localhost:3000/api/docs`

## Config

`src/environments/environment.ts` — `apiBaseUrl` (default `http://localhost:3000`).
