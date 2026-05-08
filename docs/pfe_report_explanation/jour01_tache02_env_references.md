# Task 2 — Environment variable references in `application.properties`

## 1. Context

Spring placeholders such as `${VAR}` allow configuration to be injected from the environment, JVM system properties, or `application-*.properties`. Hardcoding default **secret** values inside `application.properties` (e.g. long JWT strings or passwords) exposes them in Git and in every clone of the repository.

## 2. Objective

- Remove **literal secret fallbacks** from `application.properties`.  
- Bind sensitive settings **only** through environment-style references:  
  `${DB_PASSWORD}`, `${JWT_SECRET}`, `${INFLUXDB_TOKEN}`, `${MAIL_PASSWORD}`, `${MAIL_USERNAME}`.  
- Ensure **no secret literals** remain in `application.properties` for those keys.

## 3. Implementation

1. **Database**  
   - `spring.datasource.password=${DB_PASSWORD}`

2. **JWT**  
   - `app.jwt.secret=${JWT_SECRET}`

3. **Mail**  
   - `spring.mail.username=${MAIL_USERNAME}`  
   - `spring.mail.password=${MAIL_PASSWORD}`

4. **InfluxDB (application side)**  
   - `influxdb.token=${INFLUXDB_TOKEN}`

Non-secret settings may still use defaults for developer convenience (for example `spring.mail.host`, `spring.mail.port`, or optional S3 placeholders with empty or non-secret defaults). Those are **outside the scope of Task 2**, which targets **credentials and tokens** listed above.

## 4. Interaction with Task 1

`application-secrets.properties` (optional, gitignored) can supply the same property keys Spring would otherwise read from the environment. Combined with Task 1’s `spring.config.import=optional:classpath:application-secrets.properties`, local development can rely on the file while CI/production uses environment variables.

## 5. Files and locations

| Artifact | Path |
|----------|------|
| Primary configuration | `backend/src/main/resources/application.properties` |
| Optional local overrides | `backend/src/main/resources/application-secrets.properties` (ignored by Git; see Task 1) |

## 6. Operational instructions

Set the following in the environment—or in `application-secrets.properties`—before running the backend in any environment where the defaults must not apply:

| Variable | Role |
|---------|------|
| `DB_PASSWORD` | MySQL password for configured datasource |
| `JWT_SECRET` | Signing secret for JWT |
| `INFLUXDB_TOKEN` | InfluxDB API token used by the backend |
| `MAIL_USERNAME` | SMTP username |
| `MAIL_PASSWORD` | SMTP password |

## 7. Verification

- Inspect `backend/src/main/resources/application.properties` and confirm the five keys above reference **only** `${…}` placeholders with **no embedded secret literals** in the fallback position.  
- Grep for known former literals (historical leaked strings) across the tracked tree and Git history **after** a history cleanup (see Task 3) should return nothing.

## 8. Security and maintenance

Changing code to use `${VAR}` alone does not rotate credentials that were previously exposed in Git; **rotation** remains mandatory alongside code changes.
