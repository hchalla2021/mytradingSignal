#!/usr/bin/env powershell
<#
.SYNOPSIS
🔥 EMERGENCY MARKET FEED RECONNECT (Windows)
Fixes: "Reconnecting to market feed..." stuck on PRE_OPEN status
Forces immediate WebSocket reconnection and data refresh

.EXAMPLE
.\reconnect_market_feed.ps1
.\reconnect_market_feed.ps1 -BackendUrl "http://192.168.1.100:8000"
#>

param(
    [string]$BackendUrl = "http://localhost:8000"
)

# Clear screen
Clear-Host

Write-Host "`n" -ForegroundColor Yellow
Write-Host "=" * 80 -ForegroundColor Yellow
Write-Host "🔥 FORCING MARKET FEED RECONNECTION" -ForegroundColor Yellow
Write-Host "=" * 80 -ForegroundColor Yellow
Write-Host "Backend URL: $BackendUrl" -ForegroundColor Cyan
Write-Host "Time: $(Get-Date -Format 'HH:mm:ss')`n" -ForegroundColor Cyan

try {
    # Check connection health first
    Write-Host "📊 Checking current connection health..." -ForegroundColor Yellow
    
    try {
        $healthResponse = Invoke-RestMethod -Uri "$BackendUrl/api/diagnostics/connection-health" `
            -Method Get -TimeoutSec 10 -ErrorAction Stop
        
        Write-Host "`n📊 Current Status:" -ForegroundColor Cyan
        Write-Host "   WebSocket Connected: $($healthResponse.websocket.is_connected)" -ForegroundColor Gray
        Write-Host "   Market Status: $($healthResponse.market.status)" -ForegroundColor Gray
        Write-Host "   Watchdog State: $($healthResponse.watchdog.state)" -ForegroundColor Gray
        Write-Host "   Last Tick Age: $($healthResponse.watchdog.last_tick_seconds_ago)s" -ForegroundColor Gray
        Write-Host "   Recommendation: $($healthResponse.recommendation)`n" -ForegroundColor Gray
    }
    catch {
        Write-Host "⚠️  Could not get health status: $($_.Exception.Message)`n" -ForegroundColor Yellow
    }
    
    # Trigger force reconnect
    Write-Host "🔄 Triggering force reconnect endpoint..." -ForegroundColor Yellow
    
    $reconnectResponse = Invoke-RestMethod -Uri "$BackendUrl/api/diagnostics/force-reconnect" `
        -Method Post -TimeoutSec 30 -ContentType "application/json" -ErrorAction Stop
    
    Write-Host "`n✅ FORCE RECONNECT SUCCESSFUL`n" -ForegroundColor Green
    
    Write-Host "Actions performed:" -ForegroundColor Cyan
    foreach ($action in $reconnectResponse.actions) {
        Write-Host "   $action" -ForegroundColor Gray
    }
    
    Write-Host "`nNext Step: $($reconnectResponse.next_step)`n" -ForegroundColor Cyan
    
    Write-Host "Market Feed Status:" -ForegroundColor Cyan
    $marketStatus = $reconnectResponse.market_status
    Write-Host "   Is Connected: $($marketStatus.is_connected)" -ForegroundColor Gray
    Write-Host "   Using REST Fallback: $($marketStatus.using_rest_fallback)" -ForegroundColor Gray
    Write-Host "   Has WebSocket: $($marketStatus.has_kws)" -ForegroundColor Gray
    Write-Host "   Is Running: $($marketStatus.running)" -ForegroundColor Gray
    
    Write-Host "`n" -ForegroundColor Yellow
    Write-Host "=" * 80 -ForegroundColor Yellow
    Write-Host "🎉 Reconnection Complete! Check dashboard in 5 seconds." -ForegroundColor Green
    Write-Host "=" * 80 -ForegroundColor Yellow
    Write-Host "`n" -ForegroundColor Yellow
}
catch [System.Net.Http.HttpRequestException] {
    Write-Host "`n❌ FAILED TO CONNECT TO BACKEND" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Backend URL: $BackendUrl`n" -ForegroundColor Red
    Write-Host "💡 SOLUTIONS:" -ForegroundColor Yellow
    Write-Host "   1. Make sure backend is running:" -ForegroundColor Gray
    Write-Host "      cd backend" -ForegroundColor Gray
    Write-Host "      python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000" -ForegroundColor Gray
    Write-Host "   2. Check if backend is on different host/port" -ForegroundColor Gray
    Write-Host "`n" -ForegroundColor Yellow
    exit 1
}
catch {
    Write-Host "`n❌ Error: $($_.Exception.Message)`n" -ForegroundColor Red
    Write-Host $_.Exception.StackTrace -ForegroundColor Red
    exit 1
}
