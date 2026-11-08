FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user
RUN addgroup --system appuser && adduser --system --ingroup appuser appuser
RUN addgroup --gid 2000 zerodha-share && adduser appuser zerodha-share
# Named volumes copy these image directories' ownership when first created.
RUN mkdir -p /app/data/aqte /app/data/order_flow /app/data/expiryedge /run/zerodha
RUN chown -R appuser:appuser /app && chown appuser:zerodha-share /run/zerodha && chmod 2770 /run/zerodha
USER appuser

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
