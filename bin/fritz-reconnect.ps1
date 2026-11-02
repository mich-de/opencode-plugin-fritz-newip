<#
  Cambia IP pubblico facendo disconnetti/riconnetti sul FRITZ!Box via TR-064.
  Servono almeno 4 cicli perche' il provider assegni un IP nuovo.

  fritz-reconnect -Setup        salva utente/password (DPAPI, solo questo utente Windows)
  fritz-reconnect               almeno 4 cicli, poi continua finche' cambia la rete /16 (primi 2 numeri), max 30
  fritz-reconnect -Prefix 24    basta che cambino i primi 3 numeri
  fritz-reconnect -Status       mostra stato connessione e IP, non disconnette
  Alternativa a -Setup: variabili d'ambiente FRITZ_USER e FRITZ_PASSWORD.
#>
param(
  [int]$Min = 4,
  [int]$Max = 30,
  [ValidateSet(8, 16, 24)] [int]$Prefix = 16,
  [string]$Box = $(if ($env:FRITZ_BOX) { $env:FRITZ_BOX } else { '192.168.178.1' }),
  [switch]$Setup,
  [switch]$Status
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$credFile = Join-Path $PSScriptRoot '..\data\fritz\cred.xml'

if ($Setup) {
  New-Item -ItemType Directory -Force (Split-Path $credFile) | Out-Null
  Get-Credential -Message "Utente e password FRITZ!Box ($Box)" | Export-Clixml $credFile
  "Credenziali salvate in $credFile"
  exit 0
}

if ($env:FRITZ_USER -and $env:FRITZ_PASSWORD) {
  $cred = [pscredential]::new($env:FRITZ_USER, (ConvertTo-SecureString $env:FRITZ_PASSWORD -AsPlainText -Force))
} elseif (Test-Path $credFile) {
  $cred = Import-Clixml $credFile
} else {
  Write-Error "Credenziali mancanti: esegui 'fritz-reconnect -Setup' oppure imposta FRITZ_USER/FRITZ_PASSWORD."
}

function Invoke-Tr64([string]$svcType, [string]$path, [string]$action) {
  $body = "<?xml version='1.0' encoding='utf-8'?><s:Envelope xmlns:s='http://schemas.xmlsoap.org/soap/envelope/' s:encodingStyle='http://schemas.xmlsoap.org/soap/encoding/'><s:Body><u:$action xmlns:u='$svcType'/></s:Body></s:Envelope>"
  # pwsh 7 rifiuta credenziali su http: usa la porta HTTPS del TR-064 (certificato self-signed del box)
  $tls = @{}
  $url = "http://${Box}:49000$path"
  if ($PSVersionTable.PSVersion.Major -ge 7) { $tls.SkipCertificateCheck = $true; $url = "https://${Box}:49443$path" }
  $r = Invoke-WebRequest $url -Method Post -Body $body -Credential $cred -UseBasicParsing -TimeoutSec 15 @tls `
    -ContentType 'text/xml; charset=utf-8' -Headers @{ SOAPAction = "$svcType#$action" }
  [xml]$r.Content
}

function Get-Field([xml]$x, [string]$name) { $x.GetElementsByTagName($name) | Select-Object -First 1 -ExpandProperty '#text' }

# DSL puo' essere PPPoE o IP: usa il servizio che risulta connesso
$svc = $null
foreach ($s in @(
    @{ T = 'urn:dslforum-org:service:WANPPPConnection:1'; P = '/upnp/control/wanpppconn1' },
    @{ T = 'urn:dslforum-org:service:WANIPConnection:1';  P = '/upnp/control/wanipconnection1' })) {
  try {
    if ((Get-Field (Invoke-Tr64 $s.T $s.P 'GetStatusInfo') 'NewConnectionStatus') -eq 'Connected') { $svc = $s; break }
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 401) { Write-Error "Accesso negato dal FRITZ!Box (401): controlla utente/password e il permesso 'Impostazioni FRITZ!Box'." }
  }
}
if (-not $svc) { Write-Error 'Nessuna connessione WAN attiva trovata via TR-064.' }

function Get-WanStatus { Get-Field (Invoke-Tr64 $svc.T $svc.P 'GetStatusInfo') 'NewConnectionStatus' }
function Get-WanIp { Get-Field (Invoke-Tr64 $svc.T $svc.P 'GetExternalIPAddress') 'NewExternalIPAddress' }

function Wait-Status([scriptblock]$ok, [int]$timeoutSec) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
    try { if (& $ok (Get-WanStatus)) { return $true } } catch { }
    Start-Sleep -Seconds 2
  }
  $false
}

$startIp = Get-WanIp
if ($Status) { "Stato: $(Get-WanStatus)  IP: $startIp  ($($svc.T -replace '.*service:'))"; exit 0 }

function Get-Net([string]$a) { ($a -split '\.')[0..($Prefix / 8 - 1)] -join '.' }

"IP iniziale: $startIp"
$ip = $startIp
for ($i = 1; $i -le $Max; $i++) {
  try { Invoke-Tr64 $svc.T $svc.P 'ForceTermination' | Out-Null } catch { }  # risponde spesso con errore anche quando disconnette
  [void](Wait-Status { param($s) $s -ne 'Connected' } 30)
  try { Invoke-Tr64 $svc.T $svc.P 'RequestConnection' | Out-Null } catch { }
  if (-not (Wait-Status { param($s) $s -eq 'Connected' } 120)) { Write-Error "Ciclo ${i}: connessione non ripristinata entro 120 s." }
  $ip = Get-WanIp
  "Ciclo ${i}/${Min}+: IP $ip"
  if ($i -ge $Min -and (Get-Net $ip) -ne (Get-Net $startIp)) { break }
}

if ((Get-Net $ip) -ne (Get-Net $startIp)) { "Rete /$Prefix cambiata: $startIp -> $ip"; exit 0 }
Write-Error "Rete /$Prefix invariata ($(Get-Net $ip).*) dopo $Max cicli."
