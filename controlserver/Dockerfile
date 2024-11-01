FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY server.js ./
COPY package.json ./

# Install dependencies
RUN npm install

# Expose the port your server runs on (adjust if needed)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
