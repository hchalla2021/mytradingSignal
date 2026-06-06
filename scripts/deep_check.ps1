param(
    [string]$ProjectRoot = "D:\Trainings\GitHub projects\GitClonedProject\mytradingSignal",
    [int]$UvicornSmokeSeconds = 20
)

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "`n=== $Message ==="
}

function Remove-IfExists {
    param([string]$Path)
    if (Test-Path $Path) {
        Remove-Item $Path -Force
    }
}

function Run-Command {
    param(
        [string]$WorkingDir,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$StdOutPath,
        [string]$StdErrPath,
        [int]$TimeoutSeconds = 0,
        [switch]$StopAfterTimeout
    )

    $proc = Start-Process -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDir `
        -RedirectStandardOutput $StdOutPath `
        -RedirectStandardError $StdErrPath `
        -PassThru

    if ($TimeoutSeconds -gt 0) {
        try {
            Wait-Process -Id $proc.Id -Timeout $TimeoutSeconds -ErrorAction Stop
        } catch {
            if ($StopAfterTimeout) {
                Stop-Process -Id $proc.Id -Force
            }
        }
        $proc.Refresh()
        if ($proc.HasExited) {
            return $proc.ExitCode
        }
        return -999
    }

    $proc.WaitForExit()
    return $proc.ExitCode
}

Set-Location $ProjectRoot

$logDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$lintOut = Join-Path $logDir "deepcheck_${stamp}_lint.out.log"
$lintErr = Join-Path $logDir "deepcheck_${stamp}_lint.err.log"
$buildOut = Join-Path $logDir "deepcheck_${stamp}_build.out.log"
$buildErr = Join-Path $logDir "deepcheck_${stamp}_build.err.log"
$importOut = Join-Path $logDir "deepcheck_${stamp}_import.out.log"
$importErr = Join-Path $logDir "deepcheck_${stamp}_import.err.log"
$uvOut = Join-Path $logDir "deepcheck_${stamp}_uvicorn.out.log"
$uvErr = Join-Path $logDir "deepcheck_${stamp}_uvicorn.err.log"

@($lintOut, $lintErr, $buildOut, $buildErr, $importOut, $importErr, $uvOut, $uvErr) | ForEach-Object {
    Remove-IfExists -Path $_
}

Write-Step "STEP 1: Frontend package scripts"
$pkgPath = Join-Path $ProjectRoot "frontend\package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$pkg.scripts | ConvertTo-Json -Depth 10

Write-Step "STEP 2A: Frontend lint"
Push-Location (Join-Path $ProjectRoot "frontend")
& npm.cmd run lint 1> $lintOut 2> $lintErr
$lintExit = $LASTEXITCODE
Pop-Location
Write-Host "LINT_EXIT=$lintExit"

Write-Step "STEP 2B: Frontend build"
Push-Location (Join-Path $ProjectRoot "frontend")
& npm.cmd run build 1> $buildOut 2> $buildErr
$buildExit = $LASTEXITCODE
Pop-Location
Write-Host "BUILD_EXIT=$buildExit"

Write-Step "STEP 3: Backend import"
Push-Location (Join-Path $ProjectRoot "backend")
& python -c "import main; print('IMPORT_OK', hasattr(main,'app'))" 1> $importOut 2> $importErr
$importExit = $LASTEXITCODE
Pop-Location
Write-Host "IMPORT_EXIT=$importExit"
Get-Content $importOut -Tail 20

Write-Step "STEP 4: Uvicorn smoke run"
$uvExit = Run-Command -WorkingDir (Join-Path $ProjectRoot "backend") -FilePath "python" -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000", "--reload") -StdOutPath $uvOut -StdErrPath $uvErr -TimeoutSeconds $UvicornSmokeSeconds -StopAfterTimeout
Write-Host "UVICORN_EXIT=$uvExit (timeout stop reports -999, expected for smoke run)"

Write-Step "STEP 5: Summary"
$allGood = $true
if ($lintExit -ne 0) { $allGood = $false; Write-Host "FAIL: frontend lint" }
if ($buildExit -ne 0) { $allGood = $false; Write-Host "FAIL: frontend build" }
if ($importExit -ne 0) { $allGood = $false; Write-Host "FAIL: backend import" }

# Uvicorn smoke is considered healthy if it started and produced startup banner before timeout stop.
$uvOutText = if (Test-Path $uvOut) { Get-Content $uvOut -Raw } else { "" }
$uvHealthy = $uvOutText -match "Uvicorn running on" -and $uvOutText -match "Application startup complete"
if (-not $uvHealthy) {
    $allGood = $false
    Write-Host "FAIL: uvicorn smoke startup"
}

if ($allGood) {
    Write-Host "PASS: Deep check complete"
} else {
    Write-Host "FAIL: Deep check found issues"
}

Write-Host "Logs:"
Write-Host "  $lintOut"
Write-Host "  $lintErr"
Write-Host "  $buildOut"
Write-Host "  $buildErr"
Write-Host "  $importOut"
Write-Host "  $importErr"
Write-Host "  $uvOut"
Write-Host "  $uvErr"

# Print auth-token related runtime warnings if present, without failing lint/build/import checks.
if ($uvOutText -match 'Incorrect `api_key` or `access_token`') {
    Write-Host "WARN: Zerodha token invalid/expired. Run backend/get_token.py or quick_token_fix.py."
}
