# Build stage
FROM node:20-alpine as build

WORKDIR /app

# Add ARG for build-time environment variable
ARG API_DOMAIN
ENV API_URL=https://${API_DOMAIN}

# Copy source files
COPY src/ ./src/
COPY *.json ./
COPY webpack.config.js ./

RUN npm install


RUN npm run prod

# Production stage
FROM nginx:alpine

# Copy built static files to nginx
COPY --from=build /app/build /usr/share/nginx/html

# Optional: Copy custom nginx config if needed
# COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
