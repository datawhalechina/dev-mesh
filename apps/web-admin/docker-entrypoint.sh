#!/bin/sh
set -e

DEFAULT_URL="http://localhost:8721"
API_URL="${API_BASE_URL:-$DEFAULT_URL}"

if [ "$API_URL" != "$DEFAULT_URL" ]; then
  echo "Configuring API base URL: $API_URL"
  find /usr/share/nginx/html -type f -name "*.js" -exec sed -i "s|$DEFAULT_URL|$API_URL|g" {} +
fi

exec nginx -g "daemon off;"
