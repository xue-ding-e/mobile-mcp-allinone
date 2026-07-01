# mobile CLI PowerShell 垫片(参数含 & 也安全;别用 .cmd 传含 & 的参数)
$env:PYTHONIOENCODING = 'utf-8'
& node "$PSScriptRoot\lib\cli.js" @args
exit $LASTEXITCODE
