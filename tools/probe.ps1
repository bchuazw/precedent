# Calls the temporary debug web trigger. Usage: & tools\probe.ps1 "op=meta"
param([string]$Query = "op=meta")
$url = (Get-Content "C:\Users\bchua\.codegeist\probe-url" -Raw).Trim()
(Invoke-WebRequest -Uri "$url`?$Query" -UseBasicParsing -TimeoutSec 120).Content
