# Build stage
FROM node:20-alpine as build

WORKDIR /app
COPY package*.json ./
RUN npm install

# Copy source files
COPY resources/ ./src/
COPY public/ ./public/

RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built static files to nginx
COPY --from=build /app/build /usr/share/nginx/html

# Optional: Copy custom nginx config if needed
# COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
