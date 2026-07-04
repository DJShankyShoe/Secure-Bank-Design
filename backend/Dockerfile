# SecureBank backend — production image (gunicorn).
# Deployed with HOST networking (Option A): the container shares the host network,
# so the app reaches host-OS PostgreSQL at 127.0.0.1:5432 and gunicorn binds
# 127.0.0.1:8000 (reachable only by the host's nginx, not the public internet).
#
# Secrets are NOT baked in — pass the .env at runtime (--env-file / env_file).
# Build context is backend/.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

# Runtime deps (approved app deps) + gunicorn as the production WSGI server
# (gunicorn is deployment infra, kept out of requirements.txt / the dep scan).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir "gunicorn==23.0.0"

# Application package (includes app/templates for the Jinja2 email templates).
COPY app ./app

# Run as an unprivileged user.
RUN useradd --system --no-create-home --uid 10001 appuser
USER appuser

# Liveness: hit /healthz with X-Forwarded-Proto so force_https doesn't redirect it.
# Tunables (override at `docker run` with -e): port, bind address, worker count.
# With host networking, each container should get a distinct APP_PORT so several
# can run side by side; the teammate's nginx upstreams 127.0.0.1:<APP_PORT>.
ENV APP_PORT=8000 \
    BIND_HOST=127.0.0.1 \
    WORKERS=3

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import os,urllib.request as u; p=os.environ.get('APP_PORT','8000'); u.urlopen(u.Request('http://127.0.0.1:'+p+'/healthz', headers={'X-Forwarded-Proto':'https'}), timeout=4)"]

EXPOSE 8000

# App-factory entrypoint. Shell form so $APP_PORT/$WORKERS expand; exec so gunicorn
# is PID 1's child and receives signals. Bind localhost by default (only the host's
# nginx reaches it); set BIND_HOST=0.0.0.0 only if your proxy is off-host (+ firewall).
CMD ["sh", "-c", "exec gunicorn 'app:create_app()' --bind \"${BIND_HOST}:${APP_PORT}\" --workers \"${WORKERS}\" --timeout 60 --access-logfile - --error-logfile -"]
