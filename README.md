# Pokefriends

A round-robin Pokémon league tracker with an admin panel, a standings table, a "finish line" race and playable Pokémon Showdown battle replays. Built with Flask and Python's built-in SQLite.

## Features

- **Standings** – calculated on the fly from match results. Ranking order: points, then wins, then name. Shows played / wins / draws / losses and the last 5 results.
- **Matches** – per-round list with a round filter. The admin records the result and the points each trainer scored in that match.
- **Finish line** – tracks which trainers have finished, ordered by finishing time, with 🥇🥈🥉 medals for the top three.
- **Battle replays** – attach a Pokémon Showdown replay (`.html`) to a match; any visitor can press **▶ Play** to watch it.
- **Admin panel** – single admin password; full CRUD for trainers, matches and finish status.
- **Auto refresh** – the page updates itself every 30 seconds.

## Requirements

- Python **3.9 or newer**
- Flask (the only dependency): `pip install -r requirements.txt`

## Getting started

```bash
python -m venv .venv && source .venv/bin/activate    # optional (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
cp config/config.exemplo.env config/config.env       # then edit it and set ADMIN_SENHA
python run.py
```

Open <http://localhost:3000>, click **Admin** and sign in with the password you configured.

The server refuses to start if `ADMIN_SENHA` is not defined. `run.py` is the development server and only listens on `127.0.0.1`; use `HOST=0.0.0.0 python run.py` to reach it from your local network. For production use `wsgi.py` (see [Deployment](#deployment)).

## Configuration

Settings are read from `config/config.env` (format `KEY='value'`). Real environment variables take precedence over the file.

| Variable      | Required | Default          | Description                          |
| ------------- | -------- | ---------------- | ------------------------------------ |
| `ADMIN_SENHA` | yes      | –                | Admin password                       |
| `PORT`        | no       | `3000`           | HTTP port                            |
| `DB_ARQUIVO`  | no       | `data/dados.db`  | SQLite database file (a relative path is resolved from the project folder) |
| `HOST`        | no       | `127.0.0.1`      | Address `run.py` listens on (environment variable only) |

`config/config.env` and `data/*.db*` are git-ignored. Only `config/config.exemplo.env` should be committed.

## Project structure

```
Pokefriends/
├── README.md
├── requirements.txt          # Flask
├── wsgi.py                   # production entry point (PythonAnywhere, gunicorn...)
├── run.py                    # local entry point: python run.py
├── .gitignore
├── config/
│   ├── config.env            # real settings (git-ignored)
│   └── config.exemplo.env    # settings template
├── data/
│   └── dados.db              # SQLite database, created on first run (git-ignored)
├── league/                   # the Flask application
│   ├── __init__.py           # criar_app(): app factory
│   ├── config.py             # config.env / environment variables
│   ├── banco.py              # schema, SQL queries, SQLite connection
│   ├── auth.py               # admin login and sessions
│   ├── regras.py             # errors, validation and CRUD rules
│   ├── replay.py             # replay page builder
│   └── rotas.py              # /api/*, /replay/<id> and static files
└── public/                   # front-end (unchanged since v2)
    ├── index.html
    └── assets/
        ├── css/style.css
        ├── js/app.js          # all front-end logic
        ├── images/fundo.jpg   # background image
        └── icons/             # favicon.svg / favicon.png
```

## Data model

SQLite, four tables:

| Table     | Columns                                                      | Notes                                                                 |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `jogador` | `id`, `nome`                                                 | Trainer. Name is unique, case-insensitive.                            |
| `luta`    | `id`, `rodada`, `j1`, `j2`, `resultado`, `pts1`, `pts2`, `replay` | Match. `resultado` is `j1`, `j2`, `empate` or empty (pending).   |
| `final`   | `jogador`, `status`, `data`                                  | Finish status: `andamento` or `finished`, plus the finishing time.   |
| `sessao`  | `token`, `expira`                                            | Active admin logins (12 h). Stores only a signature of the token.     |

Deleting a trainer cascades to their matches and finish record. Older databases are migrated automatically on startup. Existing v2 databases work as-is (the `sessao` table is added on startup). The database uses `journal_mode = DELETE`, so everything lives in the single `dados.db` file.

## Standings rules

- Points are the sum of `pts1` / `pts2` of every match where points were entered, even if the result is still pending.
- Played / W / D / L only count matches that have a result.
- If points are entered and the result is left pending, the form infers it (higher score wins, equal means a draw).
- There is no standings table in the database; it is computed on every request.

## API

| Method                 | Route                      | Access | Description                                  |
| ---------------------- | -------------------------- | ------ | -------------------------------------------- |
| `GET`                  | `/api/dados`               | public | Standings, trainers, matches and finish data |
| `POST`                 | `/api/login`               | public | `{ senha }` → `{ token }`                    |
| `POST`                 | `/api/logout`              | admin  | Invalidate the session token                 |
| `POST` `PUT` `DELETE`  | `/api/jogador[/:id]`       | admin  | Manage trainers                              |
| `POST` `PUT` `DELETE`  | `/api/luta[/:id]`          | admin  | Manage matches                               |
| `PUT`                  | `/api/final/:jogadorId`    | admin  | Set a trainer's finish status                |
| `GET`                  | `/replay/:id`              | public | HTML page that plays a match's replay        |

Admin sessions are tokens stored in the database (as an HMAC signature): they last 12 hours, survive restarts, work across several worker processes, and are all invalidated when `ADMIN_SENHA` changes.

## Replays

In the admin panel, open **Matches → Edit** (or **New match**), choose the `.html` file downloaded from Pokémon Showdown and save. Only the battle log is stored. Viewers need an internet connection, since sprites and animations are loaded from `play.pokemonshowdown.com`.

## Deployment

Because it uses SQLite on disk, it needs a Python host (PythonAnywhere, a VPS, Render, Railway, Fly.io, …); static hosts like GitHub Pages or Netlify will not work.

- Set `ADMIN_SENHA` (and optionally `DB_ARQUIVO`) as environment variables instead of shipping `config.env`.
- On hosts that wipe the disk on every deploy, mount a persistent disk and point `DB_ARQUIVO` to it, otherwise data is lost.
- Backup = copy `dados.db`.

## What changed in 3.0 (Node.js → Flask)

Only the server was rewritten; `public/`, the API routes/JSON and the database are the same. Highlights: Python/Flask instead of Node (`src/server.js` and `package.json` removed), admin sessions stored in the database instead of memory, atomic match edits (fixes a bug where an invalid replay left the match half-updated), and a corrected `.gitignore`. The old code is still in git: `git show v2.0.0:src/server.js`.