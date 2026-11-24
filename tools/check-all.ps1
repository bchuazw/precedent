# Runs the debug check for each demo work item and prints a compact verdict table.
param([string[]]$Keys = @('MOBL-58','MOBL-59','MOBL-60','MOBL-61','MOBL-62','MOBL-63','MOBL-64','MOBL-65','MOBL-66','MOBL-50'))
foreach ($k in $Keys) {
  $j = & "$PSScriptRoot\probe.ps1" "op=check&issue=$k" | ConvertFrom-Json
  if ($j.error) { "$k ERROR $($j.error.Substring(0, [Math]::Min(200, $j.error.Length)))"; continue }
  "$k  $($j.work.summary)"
  "      => $($j.headline)"
  foreach ($f in $j.findings) { "         [$($f.relation)/$($f.confidence)] $($f.decision.key) - $($f.reason)" }
}
