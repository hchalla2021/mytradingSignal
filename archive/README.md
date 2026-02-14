# 📦 Archive Folder

This folder contains **old deployment and diagnostic scripts** that have been archived to keep the project root clean.

## 📁 What's Here

### Old Deployment Scripts
- `deploy_auto_market.ps1/.sh` - Previous auto market deployment
- `deploy_connection_fix.ps1` - WebSocket connection fix deployment  
- `deploy_mobile_fix.ps1/.sh` - Mobile responsiveness fix deployment
- `deploy_production_final.ps1` - Old production deployment
- `deploy_production_websocket.ps1/.sh` - WebSocket-specific deployment
- `deploy.ps1` - Original deployment script

### Old Verification Scripts
- `check_deployment.ps1/.sh` - Previous deployment check
- `check_production_advanced_api.ps1` - Advanced API check
- `check_production_readiness.ps1/.sh` - Old production readiness check
- `production_readiness_check.ps1` - PowerShell script that had syntax errors
- `verify-production-readiness.ps1/.sh` - Previous verification script
- `pre_deployment_check.ps1` - Old pre-deployment validation

### Old Diagnostic Scripts
- `diagnose_signals.ps1` - Signal debugging
- `fix_0_signals.ps1/.sh` - Zero signals fix
- `quick_production_fix.sh` - Quick fixes

### Old Backend Scripts
- `auto_start_backend.ps1` - Previous backend startup
- `auto_start_system.ps1` - Previous system startup
- `cleanup_production.ps1` - Production cleanup
- `fix_production_now.ps1` - Emergency production fix
- `quick_token_fix.py` - Manual token fix
- `start_backend.ps1` - Old backend start script
- `update_production.ps1` - Production update script

### Test Files
- `test_trend_analysis.js` - Trend analysis test

---

## ⚠️ Important

These scripts are **archived for reference only**. They are **not needed** for current production deployment.

### Use Current Scripts Instead:

| Old (Archived) | New (Root) |
|----------------|------------|
| `check_production_readiness.ps1` | `check_production.ps1` |
| `deploy_production_final.ps1` | `deploy_digitalocean.sh` |
| `production_readiness_check.ps1` | `check_production.ps1` |
| `start_backend.ps1` | `start.ps1` |

---

## 🗑️ Can I Delete This Folder?

**Short Answer:** Yes, if you want to.

**These files are kept:**
- For historical reference
- In case you need to review old deployment approaches
- For debugging if something breaks

**Safe to delete because:**
- All current functionality is in new, clean scripts
- Production system uses new scripts only
- Old scripts are not referenced anymore

---

## 📚 Current Documentation

See root folder for current documentation:
- `README.md` - Main documentation
- `DEPLOYMENT_SUMMARY.md` - Deployment guide
- `PRODUCTION_READINESS_REPORT.md` - Audit report
- `docs/` folder - Complete guides

---

**Archived:** February 2026  
**Reason:** Project cleanup - consolidate to essential scripts only
