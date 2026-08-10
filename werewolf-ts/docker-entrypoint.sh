#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting werewolf-ts..."
exec node dist/main.js
