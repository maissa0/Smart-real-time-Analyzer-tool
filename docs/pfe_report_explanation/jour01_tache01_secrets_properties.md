# Task 1 — Local secrets file and Spring Boot classpath import

## 1. Context

The Spring Boot backend needs database, JWT, InfluxDB, and mail credentials. These values must not live in `application.properties` if that file is committed, because it would leak secrets into version control. A common pattern is to keep **optional, gitignored** overrides on the classpath and load them explicitly.

## 2. Objective

- Hold sensitive configuration in `application-secrets.properties` (local-only file).
- Ensure Spring Boot loads that file **without** failing if it is missing (`optional` import).
- Ensure the secrets file is **never committed** by enforcing ignore rules at repository and module level.

## 3. Implementation

1. **Created** `backend/src/main/resources/application-secrets.properties`  
   - Properties include (names only; values are set locally and not documented here):  
     `DB_PASSWORD`, `JWT_SECRET`, `INFLUXDB_TOKEN`, `MAIL_PASSWORD`, `MAIL_USERNAME`.

2. **Updated** `backend/src/main/resources/application.properties`  
   - Added **as the first line**:  
     `spring.config.import=optional:classpath:application-secrets.properties`  
   - The `optional:` prefix allows the application to start when the file does not exist (e.g. CI or a fresh clone), as long as equivalent values are supplied via environment variables or another mechanism.

3. **Git ignore rules**  
   - **Root** `.gitignore` (Environment & Secrets section): `application-secrets.properties` is listed so the file cannot be added from the repo root by mistake.  
   - **Backend** `.gitignore`: both `application-secrets.properties` and `src/main/resources/application-secrets.properties` are ignored so the concrete path under `backend/` is covered.

## 4. Files and locations

| Artifact | Path |
|----------|------|
| Secrets file (local, not in Git) | `backend/src/main/resources/application-secrets.properties` |
| Main configuration | `backend/src/main/resources/application.properties` (first line: `spring.config.import`) |
| Ignore rules | Repository root `.gitignore`, `backend/.gitignore` |

## 5. Operational instructions

1. Copy a template from team documentation or create `application-secrets.properties` next to `application.properties` with the required keys and real values **only on developer machines or secure deployment targets**.  
2. Never commit this file; if `git status` shows it as untracked, that is expected—do not `git add` it.  
3. In production, prefer **environment variables** or a **secret manager** rather than a file on disk when possible; the same property names can be bound without the classpath file.

## 6. Verification

- Confirm `application-secrets.properties` does **not** appear in `git status` when it exists (it should be ignored).  
- Start the backend with the file present and confirm DB, JWT, Influx, and mail features work.  
- Remove or rename the file temporarily and confirm startup still works if all required variables are set elsewhere (thanks to `optional:` import).

## 7. Security and maintenance

- Treat any previously committed values as **compromised**: rotate DB passwords, JWT signing secrets, Influx tokens, and mail credentials after a leak or history rewrite.  
- Keep `application.properties` free of literal secrets; overrides belong in ignored files or external secret stores.
