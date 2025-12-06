# 🔐 Security Guidelines

## ⚠️ CRITICAL - Never Commit Secrets!

### Files That Should NEVER Be Committed:
- ❌ `backend/.env` (contains API keys, tokens, passwords)
- ❌ `frontend/.env.local` (contains configuration)
- ❌ Any files with `.pem`, `.key` extensions

### ✅ What IS Safe to Commit:
- ✅ `backend/.env.example` (template with placeholders)
- ✅ `.gitignore` (ensures secrets are excluded)
- ✅ Source code (`.py`, `.tsx`, `.js` files)

## 🛡️ Security Checklist

### Before Deployment:
- [ ] All secrets moved to hosting platform environment variables
- [ ] `.env` file is in `.gitignore`
- [ ] No hardcoded API keys in source code
- [ ] Used `.env.example` as template
- [ ] Regenerated any exposed API keys/tokens
- [ ] CORS configured properly in production
- [ ] Rate limiting enabled

### Environment Variables Setup:

#### Render.com (Backend):
```
ZERODHA_API_KEY=xxx
ZERODHA_API_SECRET=xxx
ZERODHA_ACCESS_TOKEN=xxx (refresh daily)
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+14155238886
ALERT_PHONE_NUMBER=+91xxxxxxxxxx
OPENAI_API_KEY=sk-proj-xxx
REDIRECT_URL=https://your-app.netlify.app/auth/callback
PORT=8000
```

#### Netlify (Frontend):
```
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
```

## 🚨 If You Accidentally Exposed Secrets:

### Immediate Actions:
1. **Zerodha**: Generate new API key/secret at https://kite.zerodha.com/developer/apps
2. **Twilio**: Reset Auth Token at https://console.twilio.com/
3. **OpenAI**: Revoke and create new key at https://platform.openai.com/api-keys
4. **Git**: Remove from history:
   ```bash
   git filter-branch --force --index-filter \
   "git rm --cached --ignore-unmatch backend/.env" \
   --prune-empty --tag-name-filter cat -- --all
   ```

## 🔒 Best Practices:

1. **Never commit** `.env` files
2. **Use** environment variables on hosting platforms
3. **Rotate** API keys regularly
4. **Limit** API key permissions (read-only where possible)
5. **Monitor** API usage for suspicious activity
6. **Enable** 2FA on all accounts (Zerodha, Twilio, OpenAI)

## 📱 Zerodha Access Token:
- ⏰ Expires daily - need to re-login
- 🔄 Can't be refreshed automatically (manual login required)
- 🔐 Never share with anyone

## 🌐 Production CORS:
Update `app.py` CORS origins to your actual domains:
```python
allow_origins=[
    "https://your-app.netlify.app",
    "https://your-custom-domain.com"
]
```

## ✅ Deployment Security Checklist:
- [ ] Environment variables set on hosting platform
- [ ] `.env` file NOT committed to Git
- [ ] CORS restricted to your domains only
- [ ] HTTPS enabled (automatic on Netlify/Render)
- [ ] API keys have minimum required permissions
- [ ] Rate limiting configured
- [ ] Error messages don't expose sensitive info
- [ ] Dependencies up to date (no known vulnerabilities)
