# Runbook — production on the dedicated Debian server

Operating procedures for the running system. The design behind them is `docs/tech-pack.md` §11; the sequence that gets there is `docs/PLAN.md` slice 5. Every command below is run from the deployment directory on the server unless it says otherwise.

## 0. Before the first deploy

Nothing here has been run against the owner's server: it has not been measured yet (plan prerequisite P6). Collect these first and record them in this file, because the memory budget decides whether the stack fits.

```bash
free -h
nproc
grep -c avx /proc/cpuinfo
df -h /
docker ps --format '{{.Names}}\t{{.Ports}}'
docker network ls | grep -w web
dig +short <app host>
```

The stack asks for about 1.7 GiB of limits: web 512M, worker 384M, database 512M, backup 64M, plus Traefik 256M and its socket proxy 64M if the server has no proxy yet. A host with no AVX flag runs everything here, since nothing in the stack has an AVX-only hot path, unlike MongoDB on the sibling Nolan box.

The DNS record and the Traefik router move together. A router with no record spends Let's Encrypt rate limit on challenges that cannot succeed; a record with no router answers a bare 404 or fails the handshake once the old certificate lapses. Check the zone with `dig`, never the documentation.

## 1. First deploy

1. Clone the repository into the deployment directory the owner chose.
2. `cp deploy/env.prod.example .env`, fill every key. `scripts/deploy.sh` refuses to run while one is missing, and compose refuses a required variable that is empty, so a forgotten password stops the deploy instead of producing an empty password.
3. If the server has no proxy: create the shared network and start the proxy stack.

```bash
docker network create web
ACME_EMAIL=<address> docker compose -f deploy/traefik/docker-compose.yml up -d
```

4. `bash scripts/deploy.sh`. It pulls, validates the compose file, builds, runs the migration container once, then starts the stack and waits for health.
5. Verify from outside the server, not from the server itself.

```bash
curl -fsS https://<app host>/readyz
```

`status: ready` with `model: down` is the expected answer until the Ollama box is reachable. A `model` component that is down never makes the app unready.

## 2. Database roles

The application connects as `lfsci_service`, which is neither superuser nor BYPASSRLS and switches into the DML-only `lfsci_app` for every tenant transaction. Cross-tenant sweeps connect as `lfsci_maintenance`. Migrations connect as the database owner, which is why the migrate service overrides the two URLs.

The role passwords are set by `docker/db/init/10-application-roles.sh`, and PostgreSQL runs init scripts **only on an empty data directory**. On a database that already exists, set them by hand once:

```bash
docker compose -f docker-compose.prod.yml exec db \
  psql -U lfsci -d lfsci -c "ALTER ROLE lfsci_service LOGIN PASSWORD '<app password>'" \
                         -c "ALTER ROLE lfsci_maintenance LOGIN PASSWORD '<maintenance password>'"
```

## 3. Updating

`bash scripts/deploy.sh` again. Migrations are forward-only and checksum-tracked: a file that changed after being applied is refused rather than replayed.

## 4. Rollback

```bash
git checkout <previous tag or commit>
bash scripts/deploy.sh
```

Code rolls back, the schema does not. A release that has to be undone at the schema level needs a new forward migration written for that purpose. This is why a migration that reinterprets stored values picks a default reproducing today's behaviour instead of rewriting old rows.

## 5. Backup and restore

The backup container dumps the database every hour and once a night, verifies each dump by listing it, uploads it to the backup bucket under `hourly/` or `nightly/`, and prunes what is older than the retention window. Nothing is kept on the server's disk. A dump nobody has restored is not a backup, so the drill belongs in the go-live checklist and after any change to the schema tooling.

```bash
cd <deployment directory>
compose="docker compose -f docker-compose.prod.yml"

# what exists, newest last. The quotes are single on purpose: the variables
# belong to the container, not to the shell you are typing in.
$compose exec backup sh -c 'aws --endpoint-url "$STORAGE_ENDPOINT" --region "$STORAGE_REGION" s3 ls "s3://$BACKUP_BUCKET/nightly/"'

# bring one back and restore it into a scratch database, never over the live one
$compose exec backup sh -c 'aws --endpoint-url "$STORAGE_ENDPOINT" --region "$STORAGE_REGION" s3 cp "s3://$BACKUP_BUCKET/nightly/<dump name>" /tmp/check.dump'
$compose exec backup sh -c 'psql -d postgres -c "CREATE DATABASE lfsci_restore_check"'
$compose exec backup sh -c 'pg_restore -d lfsci_restore_check /tmp/check.dump'
$compose exec backup sh -c 'psql -d lfsci_restore_check -c "SELECT count(*) FROM lease"'
$compose exec backup sh -c 'psql -d postgres -c "DROP DATABASE lfsci_restore_check"; rm -f /tmp/check.dump'
```

The backup container is the one that already holds the database connection variables and the object-storage credentials, which is why the drill runs from there. Measure the dump's freshness before trusting it, and record how long the restore took: that number is the recovery time the owner is actually buying.

## 6. Secret rotation

Every secret lives in `.env` on the server and nowhere else. Rotating one means editing `.env` and redeploying. Two need more than that:

- `ENCRYPTION_KEY` decrypts the stored bank identifiers. Rotating it without re-encrypting makes them unreadable; write the re-encryption step before touching it.
- The Odoo API key is attached to the bot user in Odoo. Revoke the old key there after the new one is deployed, never before.

## 7. When something is down

- **The model is unreachable.** `/readyz` reports `model: down`, the home banner says the model is unavailable, extraction jobs finish without an extraction rather than failing, and the assistant answers that the service is unavailable. Nothing is lost: the documents stay queued for a later pass.
- **Odoo is unreachable.** The circuit breaker opens on transport failures only, so a folder Odoo refuses never opens it. Commands stay in the outbox with their cursor un-advanced and dispatch resumes on its own. A response that was lost is reconciled by operation reference, never retried blindly.
- **The queue is stuck.** Look for a lease that outlived its worker: the dispatcher claims with a lease and the reconciler reads what a crash left behind. Restarting the worker releases locks and reaps orphans on boot.
- **Searching for one request.** Every request carries an identifier from the proxy through the jobs and into error payloads. The operations screen searches by it, and it is the fastest path from a user's complaint to the exchange that failed.

## 8. Logs

```bash
docker compose -f docker-compose.prod.yml logs -f --tail 200 web
docker compose -f docker-compose.prod.yml logs -f --tail 200 worker
```

Logs are JSON in production and redact secrets and long digit runs before they are written.
