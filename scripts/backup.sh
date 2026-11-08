#!/usr/bin/env bash
# Nightly database backup: pg_dump streamed into restic, then old snapshots pruned.
# Run on the server from cron, e.g. `30 3 * * * /srv/vulu/scripts/backup.sh >> /var/log/vulu-backup.log 2>&1`.
# Needs restic >= 0.17 on the host, RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE in the environment
# (or in /srv/vulu/.backup.env, read below). See the README for setup and restore.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .backup.env ]; then set -a; . ./.backup.env; set +a; fi

# --stdin-from-command fails the backup when pg_dump fails, instead of saving a partial dump
restic backup --tag vulu --stdin-filename vulu.dump --stdin-from-command -- \
	docker compose exec -T postgres pg_dump -U vulu -d vulu --format=custom
restic forget --tag vulu --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
