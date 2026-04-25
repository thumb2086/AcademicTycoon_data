param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Paths,

    [string]$Language = "zh-Hant-TW",

    [string]$OutputPath = "",

    [string]$PathsFile = ""
)

$ErrorActionPreference = "Stop"

if (-not [string]::IsNullOrWhiteSpace($PathsFile)) {
    $pathsFromFile = Get-Content -LiteralPath $PathsFile -Raw | ConvertFrom-Json
    $Paths = @($pathsFromFile | ForEach-Object { [string]$_ })
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]

function Await-Result {
    param(
        [Parameter(Mandatory = $true)]
        $Operation,

        [Parameter(Mandatory = $true)]
        [Type]$ResultType
    )

    $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
        Select-Object -First 1

    $task = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
}

$ocrLanguage = New-Object Windows.Globalization.Language $Language
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($ocrLanguage)
if ($null -eq $engine) {
    throw "OCR language '$Language' is not available."
}

$results = foreach ($path in $Paths) {
    $resolved = (Resolve-Path -LiteralPath $path).Path
    $file = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolved)) ([Windows.Storage.StorageFile])
    $stream = Await-Result ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $ocr = Await-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    [PSCustomObject]@{
        path = $resolved
        width = $bitmap.PixelWidth
        height = $bitmap.PixelHeight
        text = $ocr.Text
        lines = @(
            foreach ($line in $ocr.Lines) {
                [PSCustomObject]@{
                    text = $line.Text
                    x = $line.BoundingRect.X
                    y = $line.BoundingRect.Y
                    width = $line.BoundingRect.Width
                    height = $line.BoundingRect.Height
                    words = @(
                        foreach ($word in $line.Words) {
                            [PSCustomObject]@{
                                text = $word.Text
                                x = $word.BoundingRect.X
                                y = $word.BoundingRect.Y
                                width = $word.BoundingRect.Width
                                height = $word.BoundingRect.Height
                            }
                        }
                    )
                }
            }
        )
    }
}

$json = $results | ConvertTo-Json -Depth 8 -Compress
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $json
} else {
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    $parent = Split-Path -Parent $OutputPath
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    }
    [System.IO.File]::WriteAllText($OutputPath, $json, $utf8NoBom)
}
