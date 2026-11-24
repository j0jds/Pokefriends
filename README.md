# Pokefriends

A round-robin Pokémon league tracker with an admin panel, a standings table, a "finish line" race and playable Pokémon Showdown battle replays. Zero dependencies: just Node.js and its built-in SQLite.

## Features

- **Standings** – calculated on the fly from match results. Ranking order: points, then wins, then name. Shows played / wins / draws / losses and the last 5 results.
- **Matches** – per-round list with a round filter. The admin records the result and the points each trainer scored in that match.
- **Finish line** – tracks which trainers have finished, ordered by finishing time, with 🥇🥈🥉 medals for the top three.
- **Battle replays** – attach a Pokémon Showdown replay (`.html`) to a match; any visitor can press **▶ Play** to watch it.
- **Admin panel** – single admin password; full CRUD for trainers, matches and finish status.
- **Auto refresh** – the page updates itself every 30 seconds.

## Requirements

- Node.js **22.5 or newer** (uses the built-in `node:sqlite` module)
- No `npm install` needed

## Getting started

```bash
cp config/config.exemplo.env config/config.env
# edit config/config.env and set ADMIN_SENHA
npm start
```

Open <http://localhost:3000>, click **Admin** and sign in with the password you configured.

The server refuses to start if `ADMIN_SENHA` is not defined.

## Configuration

Settings are read from `config/config.env` (format `KEY='value'`). Real environment variables take precedence over the file.

| Variable      | Required | Default          | Description                          |
| ------------- | -------- | ---------------- | ------------------------------------ |
| `ADMIN_SENHA` | yes      | –                | Admin password                       |
| `PORT`        | no       | `3000`           | HTTP port                            |
| `DB_ARQUIVO`  | no       | `data/dados.db`  | Path to the SQLite database file     |

`config/config.env` and `data/dados.db` are git-ignored. Only `config/config.exemplo.env` should be committed.

## Project structure

```
Pokefriends/
├── README.md
├── package.json
├── .gitignore
├── config/
│   ├── config.env            # real settings (git-ignored)
│   └── config.exemplo.env    # settings template
├── data/
│   └── dados.db              # SQLite database, created on first run (git-ignored)
├── docs/
│   └── LEIAME.txt            # detailed guide (Portuguese)
├── src/
│   └── server.js             # HTTP server, REST API and database
└── public/
    ├── index.html
    └── assets/
        ├── css/style.css
        ├── js/app.js          # all front-end logic
        ├── images/fundo.jpg   # background image
        └── icons/             # favicon.svg / favicon.png
```

## Data model

SQLite, three tables:

| Table     | Columns                                                      | Notes                                                                 |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `jogador` | `id`, `nome`                                                 | Trainer. Name is unique, case-insensitive.                            |
| `luta`    | `id`, `rodada`, `j1`, `j2`, `resultado`, `pts1`, `pts2`, `replay` | Match. `resultado` is `j1`, `j2`, `empate` or empty (pending).   |
| `final`   | `jogador`, `status`, `data`                                  | Finish status: `andamento` or `finished`, plus the finishing time.   |

Deleting a trainer cascades to their matches and finish record. Older databases are migrated automatically on startup. The database uses `journal_mode = DELETE`, so everything lives in the single `dados.db` file.

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

Admin sessions are tokens kept in server memory and expire after 12 hours or on restart.

## Replays

In the admin panel, open **Matches → Edit** (or **New match**), choose the `.html` file downloaded from Pokémon Showdown and save. Only the battle log is stored. Viewers need an internet connection, since sprites and animations are loaded from `play.pokemonshowdown.com`.

## Deployment

Because it uses SQLite on disk, it needs a Node host (VPS, Render, Railway, Fly.io, …); static hosts like GitHub Pages or Netlify will not work.

- Start command: `npm start`
- Set `ADMIN_SENHA` (and optionally `PORT`) as environment variables instead of shipping `config.env`.
- Mount a persistent disk and point `DB_ARQUIVO` to it, otherwise data is lost on every deploy.
- Backup = copy `dados.db`.

## Security notes

- Never commit `config/config.env` or put the password in the source code or documentation.
- If a password was ever committed, it stays in the git history; change it.