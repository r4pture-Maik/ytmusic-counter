# PowerShell runner for Node.js native unit tests
$ErrorActionPreference = "Stop"

Write-Host "Running YTMusic Counter test suite on Node.js..." -ForegroundColor Cyan

# Locate node binary
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    # Check NVM for Windows path
    $nvmNode = "$env:LOCALAPPDATA\nvm\v24.1.0\node.exe"
    if (Test-Path $nvmNode) {
        $nodeBin = $nvmNode
    } else {
        # Search AppData\Local\nvm for any installed node
        $nvmDir = "$env:LOCALAPPDATA\nvm"
        $foundNode = Get-ChildItem -Path $nvmDir -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($foundNode) {
            $nodeBin = $foundNode.FullName
        } else {
            Write-Error "Node.js executable could not be found. Please ensure Node.js is installed."
            exit 1
        }
    }
} else {
    $nodeBin = $nodeCmd.Source
}

Write-Host "Using Node binary: $nodeBin" -ForegroundColor Gray
& $nodeBin --test tests/*.test.js

if ($LASTEXITCODE -eq 0) {
    Write-Host "All tests passed successfully!" -ForegroundColor Green
} else {
    Write-Host "Some tests failed." -ForegroundColor Red
    exit $LASTEXITCODE
}
