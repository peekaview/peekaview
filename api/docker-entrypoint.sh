#!/bin/sh

# Replace server name with environment variable
export SERVER_NAME=${API_DOMAIN}:80
export TURN_SHARED_SECRET=${TURN_SHARED_SECRET}
export JWT_SECRET=${JWT_SECRET}
export FIREBASE_API_KEY=${FIREBASE_API_KEY}
export FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN}
export FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
export FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET}
export FIREBASE_MESSAGING_SENDER_ID=${FIREBASE_MESSAGING_SENDER_ID}
export FIREBASE_APP_ID=${FIREBASE_APP_ID}

# Create serviceAccountKey.json from environment variables
cat > /storage/serviceAccountKey.json << EOF
{
    "apiKey": "${FIREBASE_API_KEY}",
    "authDomain": "${FIREBASE_AUTH_DOMAIN}",
    "projectId": "${FIREBASE_PROJECT_ID}",
    "storageBucket": "${FIREBASE_STORAGE_BUCKET}",
    "messagingSenderId": "${FIREBASE_MESSAGING_SENDER_ID}",
    "appId": "${FIREBASE_APP_ID}"
}
EOF


# Start FrankenPHP
exec frankenphp run --config /etc/caddy/Caddyfile 