# Task 3 — Docker Compose secrets, `.env`, and Git history sanitization

## 1. Context

`docker-compose.yml` is tracked in Git. Any **literal** passwords or tokens in that file become part of the repository and every fork or backup containing the repo. InfluxDB’s initial setup requires an admin password and token; those must come from secrets supplied at **runtime**, not from hardcoded YAML values.

## 2. Objective

- Replace hardcoded InfluxDB init credentials in `docker-compose.yml` with environment-variable substitution.  
- Document expected variables via a committed `.env.example` while keeping real values only in `.env`, which Git must ignore.  
- Ensure `.env.example` can be committed (exception to broad `.env.*` ignore rules).  
- Rewrite Git history so old commits **no longer contain** the previous literals, then verify.

## 3. Implementation

### 3.1 Docker Compose

In the `influxdb` service `environment` block:

- `DOCKER_INFLUXDB_INIT_PASSWORD` was set to `${INFLUXDB_INIT_PASSWORD}` (replacing a fixed password such as `adminpass123`).  
- `DOCKER_INFLUXDB_INIT_ADMIN_TOKEN` was set to `${INFLUXDB_TOKEN}` (replacing a fixed token string).

Docker Compose reads values from the **project environment** and from a root-level `.env` file by default, so substituting `${…}` resolves at `docker compose up` time.

### 3.2 Root `.env` and `.env.example`

- **`.env`** (repository root): created with **real** values for local development. **Not committed**—ignored under the `*.env` rule (and related entries) in root `.gitignore`.  
- **`.env.example`**: committed template with **placeholder** values and short comments instructing developers to copy to `.env` and fill in real secrets.

### 3.3 `.gitignore` exception for `.env.example`

The root `.gitignore` includes patterns such as `*.env` and `.env.*`, which would normally ignore `.env.example`. An explicit negation was added:

- `!.env.example`

This line must appear **after** the patterns that would ignore the file, so Git tracks `.env.example` while still ignoring `.env` and other environment files.

### 3.4 Git history rewrite (orphan branch)

To remove literals that already existed in past commits:

1. `git checkout --orphan clean-main` — new branch with **no parent** (no inherited history).  
2. `git add -A` — stage the full working tree; **confirmed** sensitive files such as `.env` and `application-secrets.properties` stayed **out** of the index thanks to `.gitignore`.  
3. `git commit -m "init: clean project state — no secrets in history"` — single root commit with the sanitized tree.  
4. `git push origin clean-main:m_version --force` — replaced remote branch `m_version` with the new history (coordinate with team because this rewrites remote history).  
5. Locally: `git fetch origin` and `git reset --hard origin/m_version` — align the local checkout with the rewritten branch.

**Important:** collaborators and CI must **reset or reclone** after a force-push; forks and clones may retain old blobs until refreshed.

### 3.5 Verification performed

- `git log --oneline`: **exactly one** commit on the rewritten branch tip.  
- Search (e.g. `git log -p` plus `grep` for historical secret substrings): **no hits** for those literals in `application.properties` history on the sanitized branch.

## 4. Files and locations

| Artifact | Role |
|---------|------|
| `docker-compose.yml` | InfluxDB init vars use `${INFLUXDB_INIT_PASSWORD}`, `${INFLUXDB_TOKEN}` |
| `.env` | Local real values (gitignored) |
| `.env.example` | Placeholders only (committed) |
| `.gitignore` | Ignores `.env`; un-ignores `!.env.example` |

## 5. Operational instructions

1. Copy `.env.example` to `.env` at the repository root.  
2. Set `INFLUXDB_TOKEN` and `INFLUXDB_INIT_PASSWORD` (and any other variables your stack needs) in `.env`.  
3. Run Compose from the project root so variable substitution applies: e.g. `docker compose up -d`.  
4. Never commit `.env`; review `git status` before every push.

## 6. Verification checklist

- [ ] `docker-compose.yml` contains **no** literal InfluxDB password or admin token.  
- [ ] `.env` exists locally and is **not** tracked.  
- [ ] `.env.example` is tracked and contains only placeholders.  
- [ ] `git check-ignore -v .env` reports ignore rules; `.env.example` remains untracked or tracked as intended.  
- [ ] After rewrite: one-commit history on `m_version` and **no** secret substrings when searching rewritten history.

## 7. Security and limitations

- **History rewrite does not erase** copies on other machines, GitHub caching, forks, or old backups—assume leakage until keys are rotated.  
- Rotate **InfluxDB** tokens and **any** credential ever present in old commits or screenshots (e.g. documentation images).  
- Branch protection warnings on force-push indicate policy exceptions; tightening rules and auditing who can force-push reduces recurrence.
