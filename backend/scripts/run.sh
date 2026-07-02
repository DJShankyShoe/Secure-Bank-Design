#!/usr/bin/env bash
#
# SecureBank backend — build/run the Flask container(s) (Option A: host networking).
#
# The app is stateless (all state in PostgreSQL), so you can run 1..N containers.
# With host networking each one needs a distinct port; this script assigns
# sequential ports starting at BASE_PORT. Your reverse proxy (nginx, owned by your
# teammate) then load-balances 127.0.0.1:<BASE_PORT> .. <BASE_PORT+N-1>.
#
# PostgreSQL stays bound to localhost (host networking → containers reach it at
# 127.0.0.1:5432); no Postgres listen_addresses / pg_hba changes needed.
#
# Prereq: `setup_production.sh` has been run (backend/.env + the DB exist).
#
# Usage:
#   ./backend/scripts/run.sh up [N]     build image + run N containers (default N=1)
#   ./backend/scripts/run.sh down       stop + remove all backend containers
#   ./backend/scripts/run.sh status     list backend containers + their ports
#   ./backend/scripts/run.sh logs [i]   follow logs of container i (default 1)
#   ./backend/scripts/run.sh cleanup    run `flask cleanup` inside container 1
#
# Env: BASE_PORT (default 8000), WORKERS (gunicorn workers per container, default 3).
# Note: if your user isn't in the `docker` group, run this with sudo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BACKEND_DIR"

IMAGE="securebank-backend"
NAME_PREFIX="securebank"
BASE_PORT="${BASE_PORT:-8000}"
WORKERS="${WORKERS:-3}"

command -v docker >/dev/null || { echo "ERROR: docker not found." >&2; exit 1; }

_names() { docker ps -a --filter "name=^/${NAME_PREFIX}-[0-9]" --format '{{.Names}}' | sort; }

case "${1:-up}" in
  up|start)
    n="${2:-1}"
    [ -f .env ] || { echo "ERROR: backend/.env not found — run scripts/setup_production.sh first." >&2; exit 1; }
    case "$n" in (''|*[!0-9]*) echo "ERROR: N must be a positive integer." >&2; exit 1;; esac

    echo "Building image '${IMAGE}'..."
    docker build -t "$IMAGE" .

    # Remove any existing instances so ports are free and we start clean.
    existing="$(_names || true)"
    [ -n "$existing" ] && echo "$existing" | xargs -r docker rm -f >/dev/null

    echo "Starting ${n} container(s)..."
    for i in $(seq 1 "$n"); do
      port=$((BASE_PORT + i - 1))
      docker run -d \
        --name "${NAME_PREFIX}-${i}" \
        --network host \
        --env-file .env \
        -e APP_PORT="$port" \
        -e WORKERS="$WORKERS" \
        --restart unless-stopped \
        "$IMAGE" >/dev/null
      echo "  ${NAME_PREFIX}-${i}  ->  127.0.0.1:${port}"
    done

    echo
    echo "Up. Tell your nginx teammate to load-balance this upstream:"
    for i in $(seq 1 "$n"); do echo "  server 127.0.0.1:$((BASE_PORT + i - 1));"; done
    ;;

  down|stop)
    existing="$(_names || true)"
    if [ -n "$existing" ]; then echo "$existing" | xargs -r docker rm -f; else echo "no backend containers running"; fi
    ;;

  status|ps)
    docker ps --filter "name=^/${NAME_PREFIX}-[0-9]" \
      --format 'table {{.Names}}\t{{.Status}}\t{{.Command}}'
    ;;

  logs)
    docker logs -f "${NAME_PREFIX}-${2:-1}"
    ;;

  cleanup)
    docker exec -T "${NAME_PREFIX}-1" flask --app app cleanup
    ;;

  *)
    echo "Usage: $0 {up [N]|down|status|logs [i]|cleanup}" >&2
    exit 1
    ;;
esac
