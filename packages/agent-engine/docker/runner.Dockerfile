# Sandbox image for the tests of the allowlisted repositories (agent-pipeline, requirement 6).
# Built from a context that holds only the repository's package.json and package-lock.json
# (see scripts/runner-build.ts), so the dependencies are installed here and the tests need no network.
FROM node:22-slim

WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# The engine mounts the worktree read-only at /src and a tmpfs at /work, then copies /src into /work.
USER node
WORKDIR /work
