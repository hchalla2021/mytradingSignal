# Setup Automated Token Refresh for Windows Task Scheduler
# Run this script as Administrator

param(
    [string]$ProjectPath = $PSScriptRoot
)

Write-Host "🔧 Setting up automated Zerodha token refresh for Windows..." -ForegroundColor Cyan
Write-Host "📁 Project directory: $ProjectPath" -ForegroundColor Gray

# Create logs directory
$LogsDir = Join-Path $ProjectPath "logs"
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

# Create PowerShell refresh script
$RefreshScript = Join-Path $ProjectPath "refresh_token_task.ps1"
$RefreshScriptContent = @'
# Automated Token Refresh Script for Windows Task Scheduler
# Runs daily at 7:45 AM IST

$ErrorActionPreference = "Continue"
$ProjectPath = Split-Path -Parent $MyInvocation.MyCommand.Path

# Change to project directory
Set-Location $ProjectPath

# Log file
$LogFile = Join-Path $ProjectPath "logs\token_refresh.log"

# Function to write log
function Write-Log {
    param($Message)
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $LogMessage = "[$Timestamp] $Message"
    Write-Host $LogMessage
    Add-Content -Path $LogFile -Value $LogMessage
}

Write-Log "========================================"
Write-Log "Token Refresh Started"
Write-Log "========================================"

# Activate virtual environment if exists
$VenvPath = Join-Path $ProjectPath ".venv\Scripts\Activate.ps1"
if (Test-Path $VenvPath) {
    Write-Log "Activating virtual environment..."
    & $VenvPath
} else {
    Write-Log "Warning: Virtual environment not found at $VenvPath"
}

# Run token refresh
Write-Log "Running auto_token_refresh.py..."
$PythonScript = Join-Path $ProjectPath "auto_token_refresh.py"
if (Test-Path $PythonScript) {
    python $PythonScript 2>&1 | ForEach-Object { Write-Log $_ }
} else {
    Write-Log "Error: $PythonScript not found"
    exit 1
}

# Restart Docker container if running
try {
    $Container = docker ps --format "{{.Names}}" | Select-String "trading-backend"
    if ($Container) {
        Write-Log "Restarting Docker container: $Container"
        docker restart $Container 2>&1 | ForEach-Object { Write-Log $_ }
    } else {
        Write-Log "No Docker container found (this is OK if not using Docker)"
    }
} catch {
    Write-Log "Docker not available (this is OK if not using Docker)"
}

Write-Log "Token refresh completed"
Write-Log ""
'@

Set-Content -Path $RefreshScript -Value $RefreshScriptContent
Write-Host "✅ Created refresh script: $RefreshScript" -ForegroundColor Green

# Create Windows Task Scheduler task
$TaskName = "ZerodhaTokenRefresh"
$TaskDescription = "Daily Zerodha token refresh at 7:45 AM IST"

# Convert 7:45 AM IST to local time (IST = UTC+5:30)
# 7:45 AM IST = 2:15 AM UTC
# Adjust based on your local timezone
$TriggerTime = "02:15"  # UTC time (adjust if your server is in different timezone)

Write-Host "📅 Creating Windows Task Scheduler task..." -ForegroundColor Cyan
Write-Host "   Task Name: $TaskName" -ForegroundColor Gray
Write-Host "   Trigger: Daily at $TriggerTime (UTC)" -ForegroundColor Gray

# Delete existing task if it exists
$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($ExistingTask) {
    Write-Host "⚠️  Existing task found. Removing..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Create new task
$Action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RefreshScript`""
$Trigger = New-ScheduledTaskTrigger -Daily -At $TriggerTime
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description $TaskDescription | Out-Null

Write-Host "✅ Task created successfully!" -ForegroundColor Green

# Verify
Write-Host ""
Write-Host "🔍 Task details:" -ForegroundColor Cyan
Get-ScheduledTask -TaskName $TaskName | Format-List TaskName, State, Description

Write-Host ""
Write-Host "📝 To test the task manually:" -ForegroundColor Yellow
Write-Host "   Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White

Write-Host ""
Write-Host "📝 To view logs:" -ForegroundColor Yellow
Write-Host "   Get-Content '$LogFile' -Tail 50 -Wait" -ForegroundColor White

Write-Host ""
Write-Host "🎉 Setup complete! Token will refresh daily at 7:45 AM IST" -ForegroundColor Green
