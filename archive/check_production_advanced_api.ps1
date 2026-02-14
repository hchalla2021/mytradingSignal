# Production Advanced Analysis API Diagnostic Script
# Check if all advanced endpoints are working in production

$PRODUCTION_URL = "https://mydailytradesignals.com"
$symbols = @("NIFTY", "BANKNIFTY", "SENSEX")

Write-Host "`n🔍 PRODUCTION ADVANCED API DIAGNOSTIC" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════`n" -ForegroundColor Cyan

# Test endpoints
$endpoints = @(
    "/api/advanced/early-warning",
    "/api/advanced/candle-intent",
    "/api/advanced/zone-control",
    "/api/advanced/volume-pulse",
    "/api/advanced/trend-base"
)

foreach ($endpoint in $endpoints) {
    Write-Host "`n📡 Testing: $endpoint" -ForegroundColor Yellow
    Write-Host "───────────────────────────────────────" -ForegroundColor DarkGray
    
    foreach ($symbol in $symbols) {
        $url = "$PRODUCTION_URL$endpoint/$symbol"
        try {
            $response = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 15 -ErrorAction Stop
            $json = $response.Content | ConvertFrom-Json
            
            if ($response.StatusCode -eq 200) {
                Write-Host "  ✅ $symbol : " -NoNewline -ForegroundColor Green
                if ($json.error) {
                    Write-Host "ERROR - $($json.error)" -ForegroundColor Red
                } elseif ($json.status) {
                    Write-Host "$($json.status)" -ForegroundColor Yellow
                } else {
                    Write-Host "SUCCESS (Signal: $($json.signal))" -ForegroundColor Green
                }
            }
        } catch {
            $statusCode = $_.Exception.Response.StatusCode.value__
            $errorMsg = $_.Exception.Message
            
            if ($statusCode -eq 500) {
                Write-Host "  ❌ $symbol : SERVER ERROR (Token expired?)" -ForegroundColor Red
            } elseif ($statusCode -eq 404) {
                Write-Host "  ❌ $symbol : NOT FOUND (Endpoint missing?)" -ForegroundColor Red
            } elseif ($statusCode -eq 503) {
                Write-Host "  ❌ $symbol : SERVICE UNAVAILABLE (Backend down?)" -ForegroundColor Red
            } else {
                Write-Host "  ❌ $symbol : FAILED ($statusCode - $errorMsg)" -ForegroundColor Red
            }
        }
    }
}

# Check token status
Write-Host "`n`n🔑 Checking Token Status" -ForegroundColor Yellow
Write-Host "───────────────────────────────────────" -ForegroundColor DarkGray
try {
    $tokenResponse = Invoke-WebRequest -Uri "$PRODUCTION_URL/api/token-status" -Method GET -TimeoutSec 10
    $tokenJson = $tokenResponse.Content | ConvertFrom-Json
    
    if ($tokenJson.valid) {
        Write-Host "  ✅ Token: VALID" -ForegroundColor Green
        Write-Host "  📅 Expires: $($tokenJson.expires_at)" -ForegroundColor Cyan
    } else {
        Write-Host "  ❌ Token: INVALID/EXPIRED" -ForegroundColor Red
        Write-Host "  💡 Action: Login to Zerodha to generate new token" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ Cannot check token status" -ForegroundColor Red
}

# Check backend health
Write-Host "`n`n🏥 Backend Health Check" -ForegroundColor Yellow
Write-Host "───────────────────────────────────────" -ForegroundColor DarkGray
try {
    $healthResponse = Invoke-WebRequest -Uri "$PRODUCTION_URL/api/health" -Method GET -TimeoutSec 10
    $healthJson = $healthResponse.Content | ConvertFrom-Json
    
    Write-Host "  ✅ Status: $($healthJson.status)" -ForegroundColor Green
    if ($healthJson.kite_connected) {
        Write-Host "  ✅ Kite: CONNECTED" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Kite: DISCONNECTED (Token issue?)" -ForegroundColor Red
    }
} catch {
    Write-Host "  ❌ Backend health check failed" -ForegroundColor Red
}

Write-Host "`n`n═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "📋 SUMMARY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════`n" -ForegroundColor Cyan
Write-Host "If all endpoints show TOKEN/ERROR:" -ForegroundColor Yellow
Write-Host "  1. SSH into production: ssh root@<your-droplet-ip>" -ForegroundColor White
Write-Host "  2. Check logs: docker logs trading-backend --tail 50" -ForegroundColor White
Write-Host "  3. Generate token: cd /root/mytradingSignal && python backend/generate_token_manual.py" -ForegroundColor White
Write-Host "  4. Restart: docker-compose -f docker-compose.prod.yml restart backend`n" -ForegroundColor White
