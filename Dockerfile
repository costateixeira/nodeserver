# ---------- build stage (Alpine) ----------
FROM node:20-alpine AS build

WORKDIR /app

# Build toolchain + headers (use a virtual package so we can see what's build deps)
RUN apk add --no-cache --virtual .build-deps \
      build-base python3 pkgconf git sqlite-dev binutils

# Make node-gyp use python3 and force source builds for native modules
ENV NODE_ENV=production \
    npm_config_python=python3 \
    npm_config_build_from_source=true

COPY package*.json ./

# Install only prod + optional omitted, then build native bindings
# --unsafe-perm avoids permission issues when running as root in Docker
RUN npm ci --omit=dev --omit=optional --unsafe-perm \
 && npm rebuild sqlite3 --build-from-source --unsafe-perm \
 && npm prune --omit=dev --omit=optional \
 && npm dedupe \
 && npm cache clean --force

# Bring in your sources (honors .dockerignore)
COPY . .

# Trim node_modules (BusyBox find: no -delete; use -exec rm)
RUN find node_modules -type d \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name examples \) -exec rm -rf {} + \
 && find node_modules -type f \( -name "*.md" -o -name "*.markdown" -o -name "*.map" -o -name "CHANGELOG*" -o -name "LICENSE*" -o -name "README*" \) -exec rm -f {} + || true \
 && find node_modules -type f -name "*.node" -exec strip --strip-unneeded {} + || true

# ---------- runtime stage (Alpine) ----------
FROM node:20-alpine

WORKDIR /app

# Runtime sqlite libs only (you usually don't need the sqlite CLI here)
RUN apk add --no-cache sqlite-libs

# Copy only what's needed at runtime
COPY --from=build /app ./

# COPY --from=build /app/package*.json ./
# COPY --from=build /app/node_modules ./node_modules
# COPY --from=build /app/server.js ./server.js
# COPY --from=build /app/common ./common
# COPY --from=build /app/packages ./packages
# COPY --from=build /app/registry ./registry
# COPY --from=build /app/shl ./shl
# COPY --from=build /app/vcl ./vcl
# COPY --from=build /app/xig ./xig


ARG VERSION=development
ENV APP_VERSION=$VERSION

EXPOSE 3000
CMD ["node", "server.js"]
