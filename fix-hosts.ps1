# Fix the stale Steam++ / Watt Toolkit hosts block that blackholes GitHub.
#
# WHY: Watt Toolkit ("hosts mode") wrote 127.0.0.1 entries for github.com and
# ~64 other domains. That only works while Watt Toolkit's local proxy is
# running. With the tool closed, nothing listens on 127.0.0.1:443, so every
# GitHub request fails instantly. Verified: connecting to GitHub's REAL IPs
# works (HTTP 200 in ~200ms), so only name resolution is broken.
#
# WHAT THIS DOES: backs up hosts, then removes the "# Steam++ Start" ..
# "# Steam++ End" block, then flushes DNS. Nothing else is touched.
#
# RUN AS ADMINISTRATOR:
#   Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','E:\My Website\fix-hosts.ps1'

$ErrorActionPreference = 'Stop'
$hosts = "$env:SystemRoot\System32\drivers\etc\hosts"

# 1) Require elevation.
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'ERROR: run this script as Administrator.' -ForegroundColor Red
  exit 1
}

# 2) Read and locate the block.
$lines = Get-Content -LiteralPath $hosts
$start = -1; $end = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\s*#\s*Steam\+\+\s*Start') { $start = $i }
  if ($lines[$i] -match '^\s*#\s*Steam\+\+\s*End')   { $end   = $i }
}

if ($start -lt 0 -or $end -lt 0 -or $end -le $start) {
  Write-Host 'No Steam++ block found. Checking current GitHub resolution...'
} else {
  Write-Host ("Found Steam++ block: lines {0}-{1} ({2} lines)" -f ($start + 1), ($end + 1), ($end - $start + 1))
  $block = $lines[$start..$end]
  $gh = $block | Where-Object { $_ -match 'github' }
  Write-Host ("  github-related entries inside: {0}" -f $gh.Count)

  # 3) Back up, then rewrite without the block.
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = "$hosts.bak-$stamp"
  Copy-Item -LiteralPath $hosts -Destination $backup -Force
  Write-Host "Backup written: $backup"

  $kept = @()
  if ($start -gt 0) { $kept += $lines[0..($start - 1)] }
  if ($end -lt $lines.Count - 1) { $kept += $lines[($end + 1)..($lines.Count - 1)] }
  Set-Content -LiteralPath $hosts -Value $kept -Encoding ASCII
  Write-Host ("Hosts rewritten: {0} -> {1} lines" -f $lines.Count, $kept.Count)
}

# 4) Flush DNS and verify.
ipconfig /flushdns | Out-Null
Start-Sleep -Milliseconds 500

Write-Host ''
Write-Host 'Resolution now:'
$ips = @()
try { $ips = (Resolve-DnsName github.com -Type A -ErrorAction Stop |
              Where-Object { $_.IPAddress }).IPAddress } catch {}
if ($ips) {
  foreach ($ip in $ips) { Write-Host ("  github.com -> {0}" -f $ip) }
  if ($ips -contains '127.0.0.1') {
    Write-Host '  STILL BLACKHOLED - another tool is rewriting hosts.' -ForegroundColor Yellow
    Write-Host '  Close Watt Toolkit / Steam++ completely, then re-run.' -ForegroundColor Yellow
  } else {
    Write-Host '  OK - GitHub now resolves to a real address.' -ForegroundColor Green
  }
} else {
  Write-Host '  could not resolve github.com' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Next: verify with   curl -I https://github.com'
Write-Host 'To undo: copy the .bak-* file back over hosts.'
