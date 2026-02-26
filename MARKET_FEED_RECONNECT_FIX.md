╔═══════════════════════════════════════════════════════════════════════════╗
║         MARKET FEED STUCK ON PRE_OPEN - EMERGENCY FIX GUIDE              ║
╚═══════════════════════════════════════════════════════════════════════════╝

YOUR ISSUE: 
   "Reconnecting to market feed..."
   Market status stuck on "PRE_OPEN" (shows 9:00 AM start)
   Not updating to current time

═══════════════════════════════════════════════════════════════════════════════

🎯 INSTANT FIX (2 seconds)
──────────────────────────

   Choose your OS:

   🪟 WINDOWS (PowerShell):
   └─ cd backend
   └─ .\reconnect_market_feed.ps1

   🐧 LINUX / MAC (Bash):
   └─ cd backend
   └─ python reconnect_market_feed.py

   This command:
   ✅ Closes stale WebSocket connection
   ✅ Clears cached market data
   ✅ Reconnects to Zerodha
   ✅ Fetches fresh market data
   ✅ Resets market status

   Expected output:
   ✅ FORCE RECONNECT SUCCESSFUL
   🎉 Reconnection Complete! Check dashboard in 5 seconds.

   Then:
   ➡️  Go back to dashboard
   ➡️  Refresh browser (Ctrl+R / Cmd+R)
   ➡️  Wait 10 seconds for WebSocket to reconnect
   ➡️  Market status should now be LIVE with current prices!

═══════════════════════════════════════════════════════════════════════════════

❌ SCRIPT FAILED? TRY THIS:
──────────────────────────

   Error: "Connection refused" / "Could not connect to backend"
   
   1. Check if backend is running:
      $ curl http://localhost:8000/health
      
      Should see: {"status":"ok"}
      
      If NOT: Start backend
      $ cd backend
      $ python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
      
      Wait 10 seconds, then run reconnect_market_feed.py again


   Error: HTTP timeout / Connection closed
   
   2. Force reconnect with HTTP endpoint directly:
      $ curl -X POST http://localhost:8000/api/diagnostics/force-reconnect
      
      Should see JSON response with status: success


   Still stuck after 30 seconds?
   
   3. Check what's wrong:
      $ cd backend
      $ python diagnose_system.py
      
      This shows exact error with Zerodha connection

═══════════════════════════════════════════════════════════════════════════════

🔍 CHECK YOUR FIX (Verify it worked)
────────────────────────────────────

   While market is OPEN (9:15 AM - 3:30 PM IST weekdays):
   
   Option 1: Check API endpoint
   ────────────────────────────
   $ curl http://localhost:8000/api/diagnostics/connection-health
   
   You should see:
   {
     "websocket": {
       "is_connected": true,  ✅
       ...
     },
     "market": {
       "status": "LIVE"  ✅
     },
     "watchdog": {
       "is_healthy": true  ✅
     }
   }
   
   
   Option 2: Check dashboard
   ──────────────────────────
   Browser → MyDailyTradingSignals dashboard → Check:
   
   ✅ Market status shows "LIVE" (not PRE_OPEN)
   ✅ Prices are updating (not ₹0.00)
   ✅ WebSocket indicator shows connected (not "Reconnecting...")
   ✅ OI Momentum shows signals (if after 9:25 AM)
   

═══════════════════════════════════════════════════════════════════════════════

📊 UNDERSTANDING YOUR ISSUE (Technical Details)
───────────────────────────────────────────────

   What was happening:
   
   9:00 AM ─→ market_feed connects
   ├─ PRE_OPEN phase starts
   ├─ WebSocket receives first tick
   ├─ Cache updates with status: "PRE_OPEN"
   │
   9:15 AM ─→ Status should change to "LIVE"
   ├─ ❌ BUG: WebSocket silently dies (no ticks received)
   ├─ ❌ Heartbeat keeps sending status: "PRE_OPEN" (stale)
   ├─ ❌ UI shows "Reconnecting..." (WebSocket layer)
   ├─ ❌ Market status stays frozen at 9:00 AM start time
   │
   5:30 PM ─→ Hours later, still stuck!
   └─ User sees: "PRE_OPEN" at 5:30 PM (completely wrong!)


   Root causes:
   1. WebSocket connection dies silently (no error handling)
   2. Market status cached based on last received data
   3. No automatic reconnection with status refresh
   4. Heartbeat doesn't ensure fresh status every message


   How the fix works:
   
   reconnect_market_feed.py ─→ POST /force-reconnect
   ├─ Closes stale WebSocket ✅
   ├─ Clears ALL cached market data ✅
   ├─ Resets watchdog state ✅
   ├─ Calls _attempt_reconnect() ✅
   ├─ Fetches fresh market data ✅
   └─ Forces status recalculation ✅
   
   Result: Fresh connection with correct status!

═══════════════════════════════════════════════════════════════════════════════

⚡ QUICK COMMAND REFERENCE
──────────────────────────

# Force reconnect (1-liner):
cd backend && (python reconnect_market_feed.py || pwsh -File reconnect_market_feed.ps1)

# Check health status:
curl http://localhost:8000/api/diagnostics/connection-health

# Check market data in cache:
curl http://localhost:8000/api/diagnostics/market-data-status

# Full system diagnosis:
cd backend && python diagnose_system.py

# Watch live data flow:
cd backend && python watch_oi_momentum.py

═══════════════════════════════════════════════════════════════════════════════

🎯 IF FIX NOT WORKING
────────────────────

Before troubleshooting, confirm:
1. Is it 9:15 AM - 3:30 PM IST, Monday-Friday? (market hours)
   ❌ Outside market hours? → Data will be ₹0.00 NORMAL
   ✅ During market hours? → Go to step 2

2. Is backend running?
   $ curl http://localhost:8000/health
   Should return: {"status":"ok"}

3. Is Zerodha token valid?
   $ cd backend && python quick_token_fix.py

4. Is Redis running?
   $ redis-cli ping
   Should return: PONG

If all ✅ but still stuck:

   Advanced diagnostics:
   $ cd backend && python diagnose_system.py
   
   Read the output section: "7️⃣ DIAGNOSIS & RECOMMENDATIONS"
   This will tell you EXACTLY what's broken


═══════════════════════════════════════════════════════════════════════════════

📖 FOR MORE HELP
────────────────

See also:
• docs/FIX_ZERO_PRICE_NO_SIGNAL.md (detailed zero price fix)
• docs/OI_MOMENTUM_DEBUGGING_GUIDE.md (complete technical guide)
• backend/diagnose_system.py (run full system check)

═══════════════════════════════════════════════════════════════════════════════

That's it! You should be fixed now.

If something went wrong:
1. Re-read "If Fix Not Working" section above
2. Run: python backend/diagnose_system.py
3. Search the error message in docs/

Good luck! 🚀
