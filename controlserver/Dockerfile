FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY index.js ./

# Install dependencies
RUN npm install

# Copy source code
COPY resources/ ./src/

# Expose the port your server runs on (adjust if needed)
EXPOSE 3000

# Start the server
CMD ["node", "src/server.js"]
