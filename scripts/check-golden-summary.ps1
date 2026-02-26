$ErrorActionPreference = 'Stop'

$expected = 'PASS=846 FAIL=0 NO_REPLY=0 SKIPPED=13'

$output = & npm run certify -- --suite --rate 5 --timeout 1200 --settle-set 300 --settle-mode 900 2>&1
$exitCode = $LASTEXITCODE

$output | ForEach-Object { Write-Output $_ }

if ($exitCode -ne 0) {
  Write-Error "Suite command failed with exit code $exitCode."
  exit 1
}

$text = ($output | Out-String)
if ($text.Contains($expected)) {
  Write-Output "Golden summary check passed: $expected"
  exit 0
}

$completedLine = ($output | Where-Object { $_ -match 'Completed .*PASS=.*FAIL=.*NO_REPLY=.*SKIPPED=' } | Select-Object -Last 1)
if ($completedLine) {
  Write-Error "Golden summary mismatch. Expected '$expected'. Found: $completedLine"
} else {
  Write-Error "Golden summary mismatch. Expected '$expected' but no completion summary line was found."
}
exit 1
