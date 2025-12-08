# 🚀 QUICK REFERENCE - Trading Signals App

## START SERVERS

```powershell
# One command to rule them all
.\start-all.ps1
```

## ACCESS POINTS

| Platform | Frontend | Backend |
|----------|----------|---------|
| **Desktop** | http://localhost:3000 | http://localhost:8001 |
| **Mobile** | http://192.168.1.13:3000 | http://192.168.1.13:8001 |

## EMERGENCY FIX

```powershell
# Kill everything and restart
Get-Process python,node -ErrorAction SilentlyContinue | Stop-Process -Force
.\start-all.ps1
```

## STATUS CHECK

```powershell
# Backend running?
netstat -ano | Select-String ":8001"

# Frontend running?
netstat -ano | Select-String ":3000"

# Test backend
Invoke-WebRequest http://localhost:8001/health
```

## FILES TO EDIT

```
frontend/.env.local          ← API URL configuration
backend/config/settings.py   ← Backend settings
```

## THAT'S IT! 🎉
