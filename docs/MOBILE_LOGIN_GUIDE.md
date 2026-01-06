# 📱 Mobile Login Guide - Kite App Users

## Issue: You Have Kite App Installed

When you click "Login" on mobile and have the Kite Zerodha app installed, your phone might:
- Open the Kite app instead of staying in browser
- Complete login in the app
- Not redirect back to the browser properly

---

## ✅ Solution: Manual Refresh Method

### **Step-by-Step:**

1. **Click "Login" button** in your trading app
   - A confirmation dialog will appear

2. **Tap "OK"** to proceed
   - You'll be redirected to Zerodha

3. **Login in Kite app** (if it opens)
   - Complete your login with PIN/biometric

4. **Return to browser tab**
   - Switch back to your browser manually
   - Your trading app should still be open

5. **Refresh the page**
   - Pull down to refresh (mobile browser)
   - Or tap the refresh button
   - Wait 5 seconds

6. **Done!** ✅
   - You should now see live data

---

## 🔄 Alternative: Browser-Only Login

If the Kite app keeps interfering:

### **Method 1: Use Incognito/Private Mode**
```
1. Open your browser's incognito/private mode
2. Go to your trading app URL
3. Click Login
4. Login will stay in browser (Kite app won't interfere)
5. After login, you can use the regular browser
```

### **Method 2: Disable Kite App Deep Links (Android)**
```
1. Settings → Apps → Kite by Zerodha
2. Open by default → Clear defaults
3. Now browser will ask each time instead of auto-opening app
```

### **Method 3: Desktop Site Mode**
```
1. In your mobile browser: Menu → Desktop Site ✓
2. Click Login
3. Stay in browser for login
4. Switch back to mobile view after login
```

---

## 🐛 Troubleshooting

### Issue: "Login Required" still showing after login

**Solution:**
```
1. Wait 5-10 seconds (backend is reconnecting)
2. Manually refresh the page
3. Check if you see green "Connected" status
```

### Issue: Kite app opens but doesn't redirect back

**Solution:**
```
1. After logging in the Kite app, minimize it
2. Switch back to your browser tab
3. Manually refresh the page
4. If still not working, try incognito mode
```

### Issue: Page keeps showing "Login Required"

**Solution:**
```
1. Clear browser cache/cookies
2. Close all tabs
3. Re-open your trading app
4. Try login again
5. If fails, use Desktop Site mode (see Method 3 above)
```

---

## 💡 Pro Tips

1. **Use Chrome/Safari**: Better than in-app browsers
2. **Bookmark the app**: For quick access
3. **Enable notifications**: To know when login is needed
4. **Desktop Site mode**: Best compatibility on mobile

---

## 🎯 Best Practice

### **For Daily Use:**

1. **Morning (before 9:15 AM):**
   - Open app on mobile
   - If login needed, use **Method 3 (Desktop Site)**
   - Complete login
   - Switch back to mobile view
   - Enjoy live data all day!

2. **During Trading Hours:**
   - Just use the app normally
   - Login is only needed once per day

3. **After Market Closes:**
   - App shows last session data
   - No login needed until next day

---

## 🚀 Future Enhancement

We're working on:
- Native mobile app (no browser issues)
- Better deep link handling
- Automatic redirect even with Kite app
- PWA (Progressive Web App) for better mobile experience

---

## 📞 Still Having Issues?

1. **Check backend is running:**
   ```
   curl https://yourdomain.com/api/system/health
   ```

2. **Try desktop version:**
   - Open on laptop/desktop
   - Login there first
   - Then try mobile

3. **Contact support:**
   - Share screenshot of error
   - Mention browser name
   - Mention if Kite app is installed

---

## Summary

**Quick Fix:**
```
1. Click Login → OK
2. Login in Kite app (if opens)
3. Switch back to browser
4. Refresh page manually
5. Wait 5 seconds
6. See live data! ✅
```

**Best Method:**
```
Use Desktop Site mode in browser settings
→ Login stays in browser
→ No Kite app interference
→ Smooth experience
```

Happy Trading! 📈
