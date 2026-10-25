#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 VM (run as root):
#   ssh root@HOST 'bash -s' < deploy/setup-server.sh
# Installs Docker + Compose from Ubuntu's own packages, adds 2 GB swap for image builds,
# and opens only SSH, HTTP and HTTPS. Safe to re-run.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 ufw rsync >/dev/null
systemctl enable --now docker

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

mkdir -p /opt/railplanner

docker --version
docker compose version
swapon --show
ufw status | head -8
