# Prova automatica su Windows: installa in silenzio, controlla server e app (con screenshot), disinstalla e controlla la pulizia.
# Gira in CI (workflow "Prova Windows") o su un PC di prova: pwsh win/tests/smoke.ps1 -Setup <Jobdossiers-Setup.exe> [-Out <cartella>]
# Scrive una chiave finta e una configurazione di Claude Desktop di prova: non usarla sul PC dove tieni la chiave vera.
param([Parameter(Mandatory)][string]$Setup, [string]$Out = 'smoke')
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$fail = 0
function Check($ok, $msg) { if ($ok) { "OK   $msg" } else { "FAIL $msg"; $script:fail++ } }
function Shot($name) {
    try {
        Add-Type -AssemblyName System.Windows.Forms, System.Drawing
        $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
        $bmp.Save((Join-Path (Resolve-Path $Out) "$name.png")); $g.Dispose(); $bmp.Dispose()
    } catch { "Nota: screenshot $name non riuscito ($($_.Exception.Message))" }
}

$dir = Join-Path $env:LOCALAPPDATA 'Jobdossiers'
$app = Join-Path $dir 'Jobdossiers.exe'
$exe = Join-Path $dir 'jobdossiers-mcp.exe'
$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Jobdossiers.lnk'
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$uninst = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Jobdossiers'
$keyFile = Join-Path $env:APPDATA 'jobdossiers-mcp\key.dpapi'
$claudeCfg = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'

# 1. Installazione silenziosa
$p = Start-Process $Setup -ArgumentList '/S' -Wait -PassThru
Check ($p.ExitCode -eq 0) "installer: codice di uscita 0"
foreach ($f in 'Jobdossiers.exe', 'jobdossiers-mcp.exe', 'Disinstalla.exe', 'LEGGIMI.txt') { Check (Test-Path (Join-Path $dir $f)) "installato $f" }
Check (Test-Path $lnk) "collegamento nel menu Start"
Check (Test-Path (Join-Path $dir 'estensione\manifest.json')) "estensione copiata in estensione\"
Check ("$((Get-ItemProperty $run -ErrorAction SilentlyContinue).Jobdossiers)" -like '*Jobdossiers.exe*') "avvio all'accesso attivo"
Check ((Get-ItemProperty $uninst -ErrorAction SilentlyContinue).DisplayName -eq 'Jobdossiers') "voce in App installate"

# 2. Server incluso, senza chiave
$v = & $exe --version
Check ($LASTEXITCODE -eq 0 -and "$v" -match '^\d+\.\d+\.\d+') "server: --version ($v)"
$tools = ('{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | & $exe | ConvertFrom-Json).result.tools
Check ($tools.Count -eq 13) "server: $($tools.Count) tool (attesi 13)"
$chk = (& $exe --check 2>&1 | Out-String)
Check ($LASTEXITCODE -eq 1 -and $chk -match 'Chiave non trovata') "server senza chiave: errore chiaro, nessun crash"

# 2b. Estensione per Chrome ed Edge: host registrato per entrambi, e il server risponde nel protocollo del browser (lunghezza + JSON, stdout binario)
$hostJson = Join-Path $dir 'ch.jobdossiers.mcp.json'
$hostKeys = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\ch.jobdossiers.mcp', 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\ch.jobdossiers.mcp'
foreach ($k in $hostKeys) { Check ((Get-ItemProperty $k -ErrorAction SilentlyContinue).'(default)' -eq $hostJson) "estensione: host registrato in $($k.Split('\')[2])" }
$hm = Get-Content $hostJson -Raw | ConvertFrom-Json
Check ($hm.path -eq $exe -and $hm.type -eq 'stdio' -and $hm.allowed_origins.Count -ge 1) "estensione: manifest dell'host punta al server"
$psi = New-Object System.Diagnostics.ProcessStartInfo $exe
$psi.Arguments = "$($hm.allowed_origins[0]) --parent-window=0"
$psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true
$np = [System.Diagnostics.Process]::Start($psi)
$body = [Text.Encoding]::UTF8.GetBytes('{"id":7,"action":"status"}')
$np.StandardInput.BaseStream.Write([BitConverter]::GetBytes([uint32]$body.Length), 0, 4)
$np.StandardInput.BaseStream.Write($body, 0, $body.Length); $np.StandardInput.Close()
$ms = New-Object IO.MemoryStream; $np.StandardOutput.BaseStream.CopyTo($ms); $np.WaitForExit()
$raw = $ms.ToArray()
$len = if ($raw.Length -ge 4) { [BitConverter]::ToUInt32($raw, 0) } else { -1 }
$resp = if ($len -eq $raw.Length - 4) { [Text.Encoding]::UTF8.GetString($raw, 4, $len) | ConvertFrom-Json } else { $null }
Check ($null -ne $resp -and $resp.id -eq 7 -and $resp.ok -eq $false -and $resp.message -match 'Chiave non trovata') "estensione: risposta nel protocollo del browser ($($raw.Length) byte)"

# 3. App: splash, finestra delle impostazioni (--settings), istanza unica. Dati di prova per la disinstallazione:
#    una configurazione di Claude Desktop con un altro server e la voce jobdossiers, e una chiave finta.
New-Item -ItemType Directory -Force (Split-Path $claudeCfg), (Split-Path $keyFile) | Out-Null
Set-Content $claudeCfg ('{"globalShortcut":"Ctrl+K","mcpServers":{"altro":{"command":"C:\\altro.exe","args":[]},"jobdossiers":{"command":' + ($exe | ConvertTo-Json) + ',"args":[]}}}')
Set-Content $keyFile 'chiave-finta-di-prova'
$proc = Start-Process $app -ArgumentList '--settings' -PassThru
Start-Sleep 2; Shot '1-avvio-splash'
Start-Sleep 6; Shot '2-impostazioni'
$proc.Refresh()
Check (-not $proc.HasExited) "app in esecuzione dopo 8 secondi"
Check ($proc.MainWindowTitle -eq "Impostazioni Jobdossiers $v") "finestra delle impostazioni aperta, con la versione ($($proc.MainWindowTitle))"
$second = Start-Process $app -PassThru; Start-Sleep 3
Check ($second.HasExited) "seconda istanza: esce subito"
Check (@(Get-Process Jobdossiers -ErrorAction SilentlyContinue).Count -eq 1) "una sola istanza in esecuzione"
Stop-Process -Id $proc.Id -Force; Start-Sleep 1

# 4. Disinstallazione silenziosa: file, collegamento, registro, voce nei client; la chiave resta (la domanda vale "no" in silenzio)
Start-Process (Join-Path $dir 'Disinstalla.exe') -ArgumentList '/S' -Wait
for ($i = 0; $i -lt 60 -and (Test-Path $app); $i++) { Start-Sleep 1 }
Check (-not (Test-Path $app) -and -not (Test-Path $exe)) "disinstallazione: app e server tolti"
Check (-not (Test-Path $lnk)) "disinstallazione: collegamento tolto"
Check (-not (Get-ItemProperty $run -ErrorAction SilentlyContinue).Jobdossiers) "disinstallazione: avvio all'accesso tolto"
Check (-not (Test-Path $uninst)) "disinstallazione: voce in App installate tolta"
$c = Get-Content $claudeCfg -Raw | ConvertFrom-Json
Check ($null -eq $c.mcpServers.jobdossiers -and $null -ne $c.mcpServers.altro -and $c.globalShortcut -eq 'Ctrl+K') "disinstallazione: voce jobdossiers tolta da Claude Desktop, il resto conservato"
Check (Test-Path "$claudeCfg.jobdossiers.bak") "disinstallazione: copia .jobdossiers.bak della configurazione"
Check (Test-Path $keyFile) "disinstallazione silenziosa: la chiave resta"
foreach ($k in $hostKeys) { Check (-not (Test-Path $k)) "disinstallazione: host dell'estensione tolto da $($k.Split('\')[2])" }
Check (-not (Test-Path $hostJson)) "disinstallazione: manifest dell'host tolto"
Check (-not (Test-Path (Join-Path $dir 'estensione'))) "disinstallazione: cartella dell'estensione tolta"

if ($fail) { "`n$fail controlli falliti"; exit 1 } else { "`nProva su Windows: tutto ok"; exit 0 }     # exit esplicito: altrimenti il passo eredita il codice del --check senza chiave
