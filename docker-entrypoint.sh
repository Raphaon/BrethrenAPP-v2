#!/bin/sh
set -e

mkdir -p /app/public/uploads

npx prisma migrate deploy

exec node dist/server.js
