$ErrorActionPreference = "Stop"
$deploy = Join-Path $PSScriptRoot "..\deploy-to-do.ps1"
$tokens = $null
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($deploy, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }

function tar {
    $test = $global:AqteDeploymentTest
    if ($args[0] -eq "-tzf") {
        $test.ListCalls++
        $global:LASTEXITCODE = 0
        return $test.Entries
    }
    $test.PackCalls++
    $test.PackArgs = @($args)
    $test.Archive = $args[1]
    Set-Content -LiteralPath $test.Archive -Value "archive"
    $global:LASTEXITCODE = $test.PackExit
}

function scp {
    $test = $global:AqteDeploymentTest
    $test.UploadCalls++
    $test.UploadArgs = @($args)
    $test.UploadedExisting = Test-Path -LiteralPath $args[0]
    $global:LASTEXITCODE = $test.UploadExit
}

function ssh {
    $global:AqteDeploymentTest.RemoteCalls++
    $global:AqteDeploymentTest.RemoteArgs = @($args)
    $global:AqteDeploymentTest.RemoteScript = @($input) -join "`n"
    $global:LASTEXITCODE = $global:AqteDeploymentTest.RemoteExit
}

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$sourceEntries = @("./", "./backend/main.py", "./frontend/package.json", "./scripts/check-production-env.sh")
try {
    foreach ($case in @(
        @{ Name = "packaging failure"; Pack = 2; Entries = $sourceEntries; Upload = 0; Remote = 0; Error = "Packaging failed"; Uploads = 0; Calls = 0 },
        @{ Name = "server-only file guard"; Pack = 0; Entries = ($sourceEntries + "./backend/.env"); Upload = 0; Remote = 0; Error = "server-only files (./backend/.env)"; Uploads = 0; Calls = 0 },
        @{ Name = "token file guard"; Pack = 0; Entries = ($sourceEntries + "./backend/access_token.txt"); Upload = 0; Remote = 0; Error = "server-only files"; Uploads = 0; Calls = 0 },
        @{ Name = "upload failure"; Pack = 0; Entries = $sourceEntries; Upload = 23; Remote = 0; Error = "File upload failed"; Uploads = 1; Calls = 0 },
        @{ Name = "remote failure"; Pack = 0; Entries = $sourceEntries; Upload = 0; Remote = 42; Error = "Remote deployment failed"; Uploads = 1; Calls = 1 },
        @{ Name = "successful dispatch"; Pack = 0; Entries = $sourceEntries; Upload = 0; Remote = 0; Error = $null; Uploads = 1; Calls = 1 }
    )) {
        $global:AqteDeploymentTest = @{
            PackExit = $case.Pack; Entries = $case.Entries; UploadExit = $case.Upload; RemoteExit = $case.Remote
            PackCalls = 0; ListCalls = 0; UploadCalls = 0; RemoteCalls = 0; RemoteScript = ""; Archive = $null
        }
        $test = $global:AqteDeploymentTest
        $originalLocation = (Get-Location).Path
        $failure = $null
        try { & $deploy -DropletIP "192.0.2.10" 6>$null } catch { $failure = $_.Exception.Message }
        if ($case.Error) {
            if ($failure -notlike "*$($case.Error)*") { throw "Wrong failure for $($case.Name): $failure" }
        } elseif ($failure) { throw $failure }
        if ($test.PackCalls -ne 1 -or $test.UploadCalls -ne $case.Uploads -or $test.RemoteCalls -ne $case.Calls) {
            throw "Unexpected command count for $($case.Name)"
        }
        if (-not $test.Archive -or (Test-Path -LiteralPath $test.Archive) -or (Get-Location).Path -ne $originalLocation) {
            throw "Local archive must be removed and the caller's directory kept for $($case.Name)"
        }
        $pack = $test.PackArgs
        $chdir = [array]::IndexOf($pack, "-C")
        if ($pack[0] -ne "-czf" -or $chdir -lt 0 -or [IO.Path]::GetFullPath($pack[$chdir + 1]) -ne $root -or $pack[-1] -ne ".") {
            throw "Package must contain the repository root"
        }
        foreach ($exclude in @(".git", "node_modules", ".venv", ".env", ".env.*", "backend/access_token.txt", "backend/data")) {
            if ($pack -notcontains "--exclude=$exclude") { throw "Package must exclude $exclude" }
        }
        if ($case.Uploads) {
            if ($test.UploadArgs[0] -ne $test.Archive -or -not $test.UploadedExisting -or
                $test.UploadArgs[1] -ne "root@192.0.2.10:/tmp/mydailytradingsignals-deploy.tgz") {
                throw "Upload must send only the checked archive"
            }
        }
        if ($case.Calls) {
            $remote = $test.RemoteScript
            $check = $remote.IndexOf("bash scripts/check-production-env.sh backend/.env")
            $start = $remote.IndexOf("up -d --build")
            if ($test.RemoteArgs[1] -ne "tr -d '\r' | bash -se" -or
                $remote -notmatch 'set -eu' -or $remote -notmatch '\$HOME/MyDailyTradingSignals' -or
                $remote -notmatch 'trap ''rm -f "\$archive"'' EXIT' -or
                $remote -notmatch 'tar -xzf "\$archive" --no-same-owner' -or
                $remote -notmatch 'touch backend/access_token.txt' -or
                $check -lt 0 -or $start -lt $check -or
                $remote -notmatch 'fi\s+# Check Compose independently[^\n]*\nsource scripts/ensure-docker-compose.sh' -or
                $remote -notmatch '\$\{COMPOSE\[@\]\}' -or
                $remote -notmatch 'config --quiet' -or $remote -match '\r') {
                throw "Remote Bash commands lost extraction, server settings check, Compose check or fail-fast behavior"
            }
        }
        Write-Output "PASS: $($case.Name)"
    }
    Write-Output "6 deployment wrapper tests passed; no network commands executed."
} finally {
    Remove-Variable -Name AqteDeploymentTest -Scope Global
}
