#!/usr/bin/env bash
# Ship the committed code to the VM and rebuild/restart the stack.
#   deploy/deploy.sh                 # uses DEPLOY_HOST or root@45.77.76.26
#   DEPLOY_HOST=root@1.2.3.4 deploy/deploy.sh
# Only committed files are shipped (git archive HEAD). The server keeps its own .env
# (first deploy: scp .env HOST:/opt/railplanner/app/.env, then set CORS_ORIGINS / SITE_ADDRESS).
set -euo pipefail
HOST="${DEPLOY_HOST:-root@45.77.76.26}"
cd "$(git rev-parse --show-toplevel)"

echo "shipping $(git rev-parse --short HEAD) to $HOST"
git archive --format=tar HEAD | ssh "$HOST" '
  set -e
  rm -rf /opt/railplanner/src.new && mkdir -p /opt/railplanner/src.new /opt/railplanner/app
  tar -x -C /opt/railplanner/src.new
  rsync -a --delete --exclude .env /opt/railplanner/src.new/ /opt/railplanner/app/
  rm -rf /opt/railplanner/src.new'

ssh "$HOST" 'cd /opt/railplanner/app
  files="-f docker-compose.yml"
  # a domain in SITE_ADDRESS (anything but :80) turns on the HTTPS override
  grep -qE "^SITE_ADDRESS=[^:]" .env && files="$files -f docker-compose.https.yml"
  docker compose $files up -d --build --remove-orphans && docker image prune -f >/dev/null && docker compose $files ps'
echo "health: $(curl -s "http://${HOST#*@}/api/health")"
