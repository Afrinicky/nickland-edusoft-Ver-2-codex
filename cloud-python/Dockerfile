# Nickland Edusoft Cloud — production image.
#
# ONE deployment is the whole product: the parents' and teachers' app, the
# parent portal API, the staff API, and the online school's own office
# application, all on one origin. That matters beyond tidiness — the app finds
# its API by asking its own origin what it is (mobile/src/origin.js), so an
# image that carries the app has nothing to configure and nothing to get
# wrong, and a school's address (ave-maria-school.edusoft.gh) is a complete
# product rather than an API endpoint.
#
# It used to carry the API alone, while `app/webapp.py` said the Dockerfile
# filled `webapp/` — it never did, the directory is gitignored, and every
# deployment answered `/` with the placeholder page. Now the app is built here.
#
# The build context is the REPOSITORY ROOT, not cloud-python/, because the app
# being built lives in mobile/:
#
#   docker build -f cloud-python/Dockerfile -t edusoft-cloud .
#
# The Render blueprint says the same thing with dockerContext.

# ── The app ────────────────────────────────────────────────────────────────
FROM node:22-slim AS webapp

WORKDIR /build
COPY mobile/package.json mobile/package-lock.json ./mobile/
RUN npm ci --no-audit --no-fund --prefix mobile

COPY mobile ./mobile
COPY scripts/build-web.mjs ./scripts/build-web.mjs

# --only-build: produce mobile/dist-web and do not try to copy it into server
# directories that are not in this stage. No EXPO_PUBLIC_PORTAL_URL is baked
# in, deliberately — the API is this same origin, and an address compiled into
# the bundle is an address that can be wrong.
RUN node scripts/build-web.mjs --only-build

# ── The service ────────────────────────────────────────────────────────────
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

# Install deps first for better layer caching.
COPY cloud-python/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App code.
COPY cloud-python/app ./app
COPY cloud-python/public ./public
COPY cloud-python/scripts ./scripts

# The platform's own tables, applied on first boot.
COPY cloud-python/schema.sql ./schema.sql

# A SCHOOL's tables, and the designations, classes, grading bands and settings
# every school opens with — read by app/school/db.py when a school is enrolled.
# Left out of the image once, which cost nothing until the first school was
# enrolled on a real deployment and enrolment answered "The school's database
# could not be created: no such file or directory".
COPY cloud-python/schema ./schema

# The built app, where app/webapp.py looks for it.
COPY --from=webapp /build/mobile/dist-web ./webapp

# Run as a non-root user.
RUN useradd -m appuser
USER appuser

EXPOSE 8080

# Honor the platform-provided $PORT (Render/Fly/Cloud Run set it).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers ${WEB_CONCURRENCY:-2}"]
