FROM node:24-bookworm-slim AS console
WORKDIR /src
COPY apps/console/package*.json ./apps/console/
RUN cd apps/console && npm ci
COPY apps/console apps/console
COPY packages/sdk-javascript packages/sdk-javascript
RUN cd apps/console && HORUS_EXPORT=1 npm run build

FROM python:3.13-slim-bookworm
WORKDIR /app
COPY apps/collector /app/collector
COPY --from=console /src/apps/console/out /app/collector/horus_workspace/static
COPY THIRD_PARTY_NOTICES.txt /app/collector/horus_workspace/static/third-party-notices.txt
RUN pip install --no-cache-dir /app/collector && mkdir /data && chown 65534:65534 /data
ENV DATABASE_PATH=/data/history.db
USER 65534:65534
EXPOSE 3100
CMD ["python", "-m", "uvicorn", "horus_workspace.main:app", "--host", "0.0.0.0", "--port", "3100"]
