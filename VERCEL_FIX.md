# Vercel Deployment Guide for https://www.mydailytradesignals.com

## ✅ What's Already Done:
1. ✅ Domain deployed to Vercel: `https://www.mydailytradesignals.com`
2. ✅ Backend CORS updated to allow your domain
3. ✅ Vercel configuration file created
4. ✅ Mobile browser authentication configured

---

## 🚀 Fix Your Vercel Deployment:

### Step 1: Set Environment Variable in Vercel

Go to: https://vercel.com/your-project/settings/environment-variables

**Add this variable:**
```
Name: NEXT_PUBLIC_API_URL
Value: http://192.168.1.13:8000  (for testing with local backend)
```

**OR for production backend:**
```
Name: NEXT_PUBLIC_API_URL
Value: https://your-backend.onrender.com  (when you deploy backend)
```

Environment: Production, Preview, Development (check all)

---

### Step 2: Redeploy

After setting the environment variable:
1. Go to Vercel Dashboard
2. Click "Redeploy" on your latest deployment
3. Or push a new commit to trigger deployment

---

## 📱 For Mobile Testing (iPhone/Android):

### Current Setup:
- ✅ Mobile stays in same browser (no app switching)
- ✅ Safari/Chrome authentication flow
- ✅ Callback returns to same browser

### URLs:
- **Production:** `https://www.mydailytradesignals.com`
- **Local Testing:** `http://192.168.1.13:3001`

---

## 🔧 Backend Deployment (Render):

### When ready to deploy backend:

1. **Create Render Web Service**
   - Connect your GitHub repo
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `cd backend && python app.py`

2. **Set Environment Variables in Render:**
   ```
   ZERODHA_API_KEY=your_api_key
   ZERODHA_API_SECRET=your_api_secret
   REDIRECT_URL=https://www.mydailytradesignals.com/auth/callback
   PORT=8000
   HOST=0.0.0.0
   ```

3. **Update Vercel Environment Variable:**
   ```
   NEXT_PUBLIC_API_URL=https://your-app.onrender.com
   ```

4. **Update Zerodha Redirect URL:**
   - Go to Zerodha API Dashboard
   - Add: `https://www.mydailytradesignals.com/auth/callback`

---

## 🎯 Current Issue Fix:

The issue is likely: **Missing NEXT_PUBLIC_API_URL in Vercel**

### Quick Fix:
1. Go to Vercel Dashboard > Settings > Environment Variables
2. Add: `NEXT_PUBLIC_API_URL` = `http://192.168.1.13:8000` (temporary)
3. Click "Redeploy"
4. Test: `https://www.mydailytradesignals.com`

---

## 📊 Testing Flow:

### On Computer:
```
http://localhost:3001 → Works ✅
```

### On iPhone (Local Network):
```
http://192.168.1.13:3001 → Works ✅
Click Zerodha → Safari login → Callback → Done ✅
```

### On Production:
```
https://www.mydailytradesignals.com → Should work after fix ✅
Click Zerodha → Browser login → Callback → Done ✅
```

---

## 🔍 Debug Steps:

If still getting errors:

1. **Check Browser Console:**
   - Open `https://www.mydailytradesignals.com`
   - Press F12
   - Check Console tab for errors

2. **Check Network Tab:**
   - F12 > Network tab
   - Click "Login with Zerodha"
   - See what URL it's trying to reach

3. **Verify Environment Variable:**
   - Vercel Dashboard > Deployments > Latest
   - Click "..." > View Function Logs
   - Check if `NEXT_PUBLIC_API_URL` is set

---

## 💡 Quick Test:

Open browser console on your site:
```javascript
console.log(process.env.NEXT_PUBLIC_API_URL)
```

If it shows `undefined`, the environment variable isn't set in Vercel.

---

## ✅ Final Checklist:

- [ ] Environment variable `NEXT_PUBLIC_API_URL` added in Vercel
- [ ] Vercel redeployed after adding variable
- [ ] Backend CORS includes `mydailytradesignals.com` ✅ (Already done)
- [ ] Test login flow on production site
- [ ] Mobile browser authentication working

---

**Set the environment variable in Vercel and redeploy - that should fix it! 🎉**
