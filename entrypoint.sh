#!/bin/sh
echo "[entrypoint] WEBSHARE_PROXY_USER: ${WEBSHARE_PROXY_USER:-NOT_SET}"
echo "[entrypoint] WEBSHARE_PROXY_PASS: ${WEBSHARE_PROXY_PASS:-NOT_SET}"
echo "[entrypoint] All WEBSHARE vars:"
env | grep WEBSHARE || echo "  (none)"
exec npm start
