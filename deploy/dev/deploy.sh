#!/bin/sh
# Deploys ghcr.io/shuigami/vulu:dev in /srv/vulu-dev. Forced command of the GitHub Actions key
# (authorized_keys: restrict,command="/srv/vulu-dev/deploy.sh"): the only thing that key can run.
# The client's command, if any, is the commit the app must serve afterwards (40 hex characters).
set -eu
cd "$(dirname "$0")"

expected=${SSH_ORIGINAL_COMMAND:-}
case $expected in
	'') ;;
	*[!0-9a-f]*) echo "not a commit SHA: $expected" >&2; exit 2 ;;
esac

failed() {
	docker compose ps -a
	docker compose logs --tail 40 dev-migrate dev-worker dev-app
	exit 1
}

docker compose pull -q
docker compose up -d --remove-orphans || failed
docker image prune -f > /dev/null

# The app answers once it has started (127.0.0.1: localhost is ::1, node listens on IPv4)
for _ in $(seq 30); do
	version=$(docker compose exec -T dev-app wget -qO- http://127.0.0.1:3000/_app/version.json 2> /dev/null) && break
	sleep 2
done
echo "serving: ${version:-nothing}"
[ -n "${version:-}" ] || failed
case $version in *"$expected"*) ;; *) echo "expected $expected" >&2; failed ;; esac
