# MyDailyTradingSignals - Production Deployment Guide

**Last Updated**: April 28, 2026  
**Version**: 1.0.0  
**Status**: Ready for Production ✅

---

## 🚀 Quick Start

### Prerequisites

- **Backend**: Python 3.10+, Redis, Docker
- **Frontend**: Node.js 18+, npm/yarn
- **Infrastructure**: Ubuntu 20.04 LTS or better
- **Zerodha Account**: Active Kite API credentials

### 1. Environment Setup

```bash
# Clone repository
git clone https://github.com/yourusername/mytradingsignals.git
cd mytradingsignals

# Create directories
mkdir -p backend/logs backend/data frontend/logs

# Backend setup
cd backend
cp ../.env.backend.production.template .env.production
# Edit .env.production with your credentials
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Frontend setup
cd ../frontend
cp ../.env.production.template .env.production.local
# Edit .env.production.local with your API URLs
npm install
npm run build
```

---

## 🐳 Docker Deployment

### Build Images

```bash
# Backend
docker build -t mytradingsignals:backend-latest -f backend/Dockerfile.prod .

# Frontend
docker build -t mytradingsignals:frontend-latest -f frontend/Dockerfile.prod .
```

### Run with Docker Compose

```bash
# Create docker-compose.prod.yml
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f backend
docker-compose -f docker-compose.prod.yml logs -f frontend
```

### Docker Compose Template

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: mytradingsignals-redis
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    restart: unless-stopped

  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile.prod
    container_name: mytradingsignals-backend
    ports:
      - "127.0.0.1:8000:8000"
    environment:
      - ENVIRONMENT=production
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./backend/logs:/app/logs
      - ./backend/data:/app/data
    depends_on:
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health/ready"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.prod
    container_name: mytradingsignals-frontend
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - backend
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    container_name: mytradingsignals-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    depends_on:
      - backend
      - frontend
    restart: unless-stopped

volumes:
  redis_data:
```

---

## 🔐 SSL/TLS with Let's Encrypt

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Auto-renewal
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### Nginx Configuration

```nginx
# nginx.conf
upstream backend {
    server backend:8000;
}

upstream frontend {
    server frontend:3000;
}

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # API routes
    location /api/ {
        proxy_pass http://backend/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # WebSocket
    location /ws/ {
        proxy_pass http://backend/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
    
    # Frontend
    location / {
        proxy_pass http://frontend/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 🔍 Monitoring & Logging

### Log Aggregation with ELK Stack

```yaml
# docker-compose.prod.yml - Add ELK services

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.0.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    ports:
      - "9200:9200"
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data

  kibana:
    image: docker.elastic.co/kibana/kibana:8.0.0
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch

  logstash:
    image: docker.elastic.co/logstash/logstash:8.0.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    depends_on:
      - elasticsearch
```

### Monitoring with Prometheus + Grafana

```yaml
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    depends_on:
      - prometheus
```

---

## 🧪 Testing Before Deployment

### Backend Tests

```bash
cd backend

# Run unit tests
pytest -v

# Type checking
mypy . --strict

# Linting
flake8 .
black --check .

# Security scan
bandit -r .

# Load testing
locust -f tests/load_test.py --host=http://localhost:8000
```

### Frontend Tests

```bash
cd frontend

# Linting
npm run lint

# Type checking
npx tsc --noEmit

# Build verification
npm run build

# Lighthouse audit
npm install -g lighthouse
lighthouse https://localhost:3000 --view
```

### Health Checks

```bash
# Backend health
curl https://yourdomain.com/api/health/status

# WebSocket connectivity
wscat -c wss://yourdomain.com/ws/market

# Frontend health
curl https://yourdomain.com/
```

---

## 📊 Performance Optimization

### Backend Performance Tuning

```python
# main.py - Async settings
app.config.update(
    WORKERS=4,  # CPU cores
    WORKER_CLASS="uvicorn.workers.UvicornWorker",
    WORKER_CONNECTIONS=1000,
    KEEPALIVE=65,
    TIMEOUT=120,
)
```

### Frontend Performance

```bash
# Analyze bundle size
npm install -D webpack-bundle-analyzer
npm run analyze

# Optimize images
npx imagemin frontend/public/images --out-dir=frontend/public/images-optimized

# Generate sitemap for SEO
npm install -D next-sitemap
```

---

## 🔄 Zero-Downtime Deployment

### Blue-Green Deployment

```bash
#!/bin/bash
# deploy.sh

# Build new version
docker build -t mytradingsignals:backend-v2 -f backend/Dockerfile.prod .
docker build -t mytradingsignals:frontend-v2 -f frontend/Dockerfile.prod .

# Run new version on separate ports
docker run -d -p 8001:8000 --name backend-v2 mytradingsignals:backend-v2
docker run -d -p 3001:3000 --name frontend-v2 mytradingsignals:frontend-v2

# Health checks
while ! curl -f http://localhost:8001/health/ready; do sleep 1; done
while ! curl -f http://localhost:3001; do sleep 1; done

# Switch Nginx traffic
nginx -s reload

# Keep old version running for rollback
# docker stop backend && docker rename backend backend-v1
# docker stop frontend && docker rename frontend frontend-v1

# Only after verification: docker rm backend-v1 frontend-v1
```

---

## 🚨 Incident Response

### Quick Rollback

```bash
# If deployment fails
docker stop backend frontend
docker rename backend-v1 backend
docker rename frontend-v1 frontend
docker start backend frontend
nginx -s reload
```

### Emergency Restart

```bash
# Restart services
docker-compose -f docker-compose.prod.yml restart backend
docker-compose -f docker-compose.prod.yml restart frontend

# Check logs
docker-compose logs -f backend --tail=100
docker-compose logs -f frontend --tail=100
```

---

## 📋 Deployment Checklist

- [ ] **Pre-Deployment**
  - [ ] All tests passing locally
  - [ ] Environment variables configured
  - [ ] SSL certificates valid
  - [ ] Database backups created
  - [ ] Monitoring configured
  - [ ] Runbooks documented
  - [ ] Team notified

- [ ] **Deployment**
  - [ ] Docker images built
  - [ ] Health checks passing
  - [ ] Database migrations run
  - [ ] Cache warmed up
  - [ ] WebSocket connections tested
  - [ ] API endpoints responsive
  - [ ] Frontend pages loading

- [ ] **Post-Deployment**
  - [ ] Error monitoring active
  - [ ] Performance metrics healthy
  - [ ] User activity monitoring
  - [ ] No spike in error rates
  - [ ] No spike in latency
  - [ ] Team standing by for 1 hour
  - [ ] Deployment documented

---

## 🛠️ Maintenance Tasks

### Daily

- Monitor error rates and latency
- Check disk space usage
- Verify backups completed

### Weekly

- Update security patches
- Review performance metrics
- Check log file sizes
- Verify SSL certificate expiry

### Monthly

- Full backup verification
- Disaster recovery drill
- Security audit
- Dependency updates

---

## 📞 Support & Escalation

**On-Call Rotation**: 
- Database Issues: @db-team
- Frontend Issues: @frontend-team
- Backend Issues: @backend-team
- Infrastructure: @devops-team

**Escalation Path**:
1. Service team (15 min)
2. Tech lead (30 min)
3. Platform team (60 min)
4. VP Engineering (120 min)

---

## 📚 Additional Resources

- [FastAPI Deployment](https://fastapi.tiangolo.com/deployment/concepts/)
- [Next.js Production](https://nextjs.org/docs/going-to-production)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Security Hardening](https://github.com/OWASP/DevGuide/wiki/Deployment)

---

## ✅ Deployment Complete

When this checklist is complete and all tests pass:

```bash
git tag -a v1.0.0-prod -m "Production release v1.0.0"
git push origin v1.0.0-prod
```

🎉 **Your application is live in production!**

