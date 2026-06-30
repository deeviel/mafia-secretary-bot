#!/bin/bash
set -e

echo "Starting build process..."
npm run build
echo "Build completed."

echo "Restarting application using PM2 with high priority..."
nice -n -10 npx pm2 restart ecosystem.config.cjs || nice -n -10 npx pm2 start ecosystem.config.cjs
echo "Deployment successful."
