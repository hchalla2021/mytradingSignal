FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (ci = reproducible, faster)
RUN npm ci

# Copy application code
COPY . .

# Build the application for production
RUN npm run build

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

# Copy only production artifacts
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/next.config.js ./

# Create non-root user
RUN addgroup --system appuser && adduser --system --ingroup appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3000

# Run production server
CMD ["npm", "start"]
