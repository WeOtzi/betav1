# ============================================
# WE ÖTZI - Production Dockerfile
# Optimized for Easypanel deployment
# ============================================

# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies (including dev for potential build steps)
RUN npm ci --only=production

# Production stage
FROM node:20-slim AS production

# Set production environment
ENV NODE_ENV=production

# Create non-root user for security
RUN groupadd -r weotzi && useradd -r -g weotzi weotzi

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY package*.json ./
COPY server.js ./
COPY public ./public

# Create logs directory
RUN mkdir -p logs/server_clients && chown -R weotzi:weotzi /app

# Switch to non-root user
USER weotzi

# Expose the application port
EXPOSE 4545

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4545/api/client-info', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "server.js"]
