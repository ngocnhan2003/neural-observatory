param(
  [int]$Port = 4319
)

$baseUrl = "http://127.0.0.1:$Port"
$sessionId = "manual-test-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"

function Send-ObservatoryEvent {
  param([hashtable]$Event)
  $json = $Event | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Method Post -Uri "$baseUrl/events" -ContentType "application/json" -Body $json | Out-Null
}

Send-ObservatoryEvent @{
  provider = "openai"
  sessionId = $sessionId
  type = "session.started"
  data = @{ phase = "waking" }
}

Send-ObservatoryEvent @{
  provider = "openai"
  sessionId = $sessionId
  type = "prompt.submitted"
  data = @{ phase = "input"; inputTokens = 1800 }
}

1..24 | ForEach-Object {
  Send-ObservatoryEvent @{
    provider = "openai"
    sessionId = $sessionId
    type = "token.activity"
    data = @{ phase = "output"; tokenDelta = (Get-Random -Minimum 2 -Maximum 8) }
  }

  if ($_ -eq 8) {
    Send-ObservatoryEvent @{
      provider = "openai"
      sessionId = $sessionId
      type = "tool.started"
      data = @{ phase = "tool"; toolName = "PowerShell" }
    }
  }

  if ($_ -eq 13) {
    Send-ObservatoryEvent @{
      provider = "openai"
      sessionId = $sessionId
      type = "tool.completed"
      data = @{ phase = "integration"; toolName = "PowerShell"; latencyMs = 920 }
    }
  }

  Start-Sleep -Milliseconds 140
}

Send-ObservatoryEvent @{
  provider = "openai"
  sessionId = $sessionId
  type = "usage.updated"
  data = @{ phase = "output"; inputTokens = 1800; outputTokens = 420; totalTokens = 2220; contextPercent = 17 }
}

Send-ObservatoryEvent @{
  provider = "openai"
  sessionId = $sessionId
  type = "response.completed"
  data = @{ phase = "cooldown"; latencyMs = 3420 }
}

Write-Host "Sent test session $sessionId to $baseUrl" -ForegroundColor Green
