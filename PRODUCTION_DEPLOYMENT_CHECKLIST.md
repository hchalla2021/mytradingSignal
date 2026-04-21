# Production Deployment Checklist
## mydailytradesignals.com

---

## 🔴 CRITICAL: Auth Issue Root Causes

### Problem 1: `NEXT_PUBLIC_*` vars cannot be runtime-injected in Docker
**Cause:** Next.js bakes `NEXT_PUBLIC_*` variables into the JavaScript bundle at **build time**.
The `environment:` block in docker-compose.prod.yml has NO effect on these vars after build.

**Fix:** Before running `docker build`, ensure `frontend/.env.local` has:
```
NEXT_PUBLIC_API_URL=https://mydailytradesignals.com
NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com/ws/market
```
✅ Already correctly set in frontend/.env.local

### Problem 2: `.env` files are gitignored — must be manually placed on server
**Cause:** `backend/.env` and `frontend/.env.local` are in `.gitignore`.
After `git pull` on the server, these files will be missing.

**Fix:** After `git pull`, upload the files to the server:
```bash
scp backend/.env root@<server-ip>:~/mytradingSignal/backend/.env
scp frontend/.env.local root@<server-ip>:~/mytradingSignal/frontend/.env.local
```

### Problem 3: Nginx must be configured for auth callback to work
**Cause:** `REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback` — Zerodha redirects
to this URL. Without Nginx routing `/api` → backend (port 8000), the callback 404s.

**Fix:** Nginx config below MUST be in place before auth will work.

---

## Step-by-Step Deploy on DigitalOcean

### 1. SSH into server
```bash
ssh root@<your-droplet-ip>
```

### 2. Upload secret files (from your Windows machine)
```powershell
# Run on Windows (PowerShell)
scp "d:\Trainings\GitHub projects\GitClonedProject\mytradingSignal\backend\.env" root@<ip>:~/mytradingSignal/backend/.env
scp "d:\Trainings\GitHub projects\GitClonedProject\mytradingSignal\frontend\.env.local" root@<ip>:~/mytradingSignal/frontend/.env.local
```

### 3. Deploy (on server)
```bash
cd ~/mytradingSignal
git pull origin main
bash deploy_digitalocean.sh
```

### 4. Verify Nginx is configured correctly
Nginx must route:
- `https://mydailytradesignals.com/` → `http://localhost:3000` (Next.js frontend)
- `https://mydailytradesignals.com/api` → `http://localhost:8000` (FastAPI backend)
- `https://mydailytradesignals.com/ws` → `http://localhost:8000` (WebSocket)

**Install/update Nginx config:**
```nginx
# /etc/nginx/sites-available/trading
server {
    listen 443 ssl;
    server_name mydailytradesignals.com;

    # SSL (managed by certbot - will be auto-added)
    # ssl_certificate ...
    # ssl_certificate_key ...

    # Frontend (Next.js)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API (CRITICAL for auth callback)
    location /api {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:8000/health;
    }

    # WebSocket (CRITICAL for live data)
    location /ws {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name mydailytradesignals.com;
    return 301 https://$host$request_uri;
}
```

```bash
# Apply config
nginx -t
systemctl reload nginx
```

### 5. Get SSL certificate (if not already done)
```bash
certbot --nginx -d mydailytradesignals.com
```

---

## Daily Authentication Routine (Weekdays)

Zerodha tokens expire daily at 4:00 PM IST. Refresh every morning:

1. Visit `https://mydailytradesignals.com` at **8:00–8:45 AM IST**
2. Click the **LOGIN** button
3. Complete Zerodha authentication in the popup
4. The popup closes, page reloads → you're authenticated

The backend automatically:
- Saves the new token to `backend/.env`
- Clears settings cache (no restart needed)
- Reconnects Zerodha WebSocket
- Starts market feed at 8:50 AM

---

## Verification Checklist

### Backend
- [ ] `curl https://mydailytradesignals.com/health` → `{"status": "ok"}`
- [ ] `curl https://mydailytradesignals.com/api/auth/validate` → `{"valid": false, ...}` (before login)
- [ ] After login: `curl https://mydailytradesignals.com/api/auth/validate` → `{"valid": true, ...}`

### Frontend
- [ ] `https://mydailytradesignals.com` loads without errors
- [ ] Login button opens Zerodha popup
- [ ] After Zerodha auth, popup closes and dashboard shows authenticated state
- [ ] Live data appears at 9:15 AM

### Docker Container Status
```bash
docker-compose -f docker-compose.prod.yml ps
# All 3 services should be "Up"
```

### Logs (if issues)
```bash
# Backend logs
docker-compose -f docker-compose.prod.yml logs -f backend

# Frontend logs
docker-compose -f docker-compose.prod.yml logs -f frontend

# Nginx logs
tail -f /var/log/nginx/error.log
```

---

## Known Working Configuration Summary

| Setting | Value |
|---------|-------|
| `REDIRECT_URL` | `https://mydailytradesignals.com/api/auth/callback` |
| `FRONTEND_URL` | `https://mydailytradesignals.com` |
| `CORS_ORIGINS` | `https://mydailytradesignals.com,http://localhost:3000,http://127.0.0.1:3000` |
| `NEXT_PUBLIC_API_URL` | `https://mydailytradesignals.com` |
| `NEXT_PUBLIC_WS_URL` | `wss://mydailytradesignals.com/ws/market` |
| Backend port | 8000 (internal, proxied by Nginx) |
| Frontend port | 3000 (internal, proxied by Nginx) |
| Redis | `redis://redis:6379` (Docker) or `redis://localhost:6379` (systemd) |
