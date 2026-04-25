param(
    [string]$QueueDir = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($QueueDir)) {
    throw "QueueDir is required."
}

$QueueDir = [System.IO.Path]::GetFullPath($QueueDir)
[System.IO.Directory]::CreateDirectory($QueueDir) | Out-Null

$WorkerFile = Join-Path $QueueDir "worker.pid"
$HeartbeatFile = Join-Path $QueueDir "worker.heartbeat"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

[System.IO.File]::WriteAllText($WorkerFile, "$PID", $utf8NoBom)

$ocrScript = Join-Path $PSScriptRoot "ocr-images.ps1"

function Update-Heartbeat {
    $stamp = [DateTimeOffset]::UtcNow.ToString("o")
    [System.IO.File]::WriteAllText($HeartbeatFile, $stamp, $utf8NoBom)
}

function Process-RequestFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RequestPath
    )

    $workingPath = [System.IO.Path]::ChangeExtension($RequestPath, ".working.json")
    try {
        Move-Item -LiteralPath $RequestPath -Destination $workingPath -ErrorAction Stop
    } catch {
        return
    }

    try {
        $request = Get-Content -LiteralPath $workingPath -Raw | ConvertFrom-Json
        $requestId = [string]$request.id
        $responsePath = Join-Path $QueueDir ($requestId + ".response.json")
        $responseTempPath = Join-Path $QueueDir ($requestId + ".response.tmp.json")
        $errorPath = Join-Path $QueueDir ($requestId + ".error.txt")
        $pathsFile = Join-Path $QueueDir ($requestId + ".paths.json")

        [System.IO.File]::WriteAllText($pathsFile, (($request.paths | ConvertTo-Json -Compress)), $utf8NoBom)
        Remove-Item -LiteralPath $responsePath, $responseTempPath -Force -ErrorAction SilentlyContinue
        & $ocrScript -Language ([string]$request.language) -OutputPath $responseTempPath -PathsFile $pathsFile
        Move-Item -LiteralPath $responseTempPath -Destination $responsePath -Force
        Remove-Item -LiteralPath $errorPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $pathsFile -Force -ErrorAction SilentlyContinue
    } catch {
        $message = $_ | Out-String
        $requestId = if ($request -and $request.id) { [string]$request.id } else { [System.IO.Path]::GetFileNameWithoutExtension($RequestPath) }
        $errorPath = Join-Path $QueueDir ($requestId + ".error.txt")
        [System.IO.File]::WriteAllText($errorPath, $message, $utf8NoBom)
    } finally {
        Remove-Item -LiteralPath $responseTempPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $workingPath -Force -ErrorAction SilentlyContinue
        Update-Heartbeat
    }
}

try {
    while ($true) {
        Update-Heartbeat
        $requestFiles = Get-ChildItem -LiteralPath $QueueDir -Filter "*.request.json" -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc, Name
        foreach ($requestFile in $requestFiles) {
            Process-RequestFile -RequestPath $requestFile.FullName
        }
        Start-Sleep -Milliseconds 200
    }
} finally {
    Remove-Item -LiteralPath $WorkerFile -Force -ErrorAction SilentlyContinue
}
