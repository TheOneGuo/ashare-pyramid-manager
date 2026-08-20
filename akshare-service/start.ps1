# 启动 akshare 微服务（开发期）
# 用法：在 akshare-service 目录下执行  .\start.ps1
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$venv = Join-Path $root ".venv"
if (-not (Test-Path (Join-Path $venv "Scripts/python.exe"))) {
  Write-Host "未找到 .venv，请先创建并安装依赖：" -ForegroundColor Yellow
  Write-Host "  python -m venv .venv"
  Write-Host "  .\.venv\Scripts\python.exe -m pip install akshare fastapi uvicorn"
  exit 1
}
Write-Host "启动 akshare-service on http://127.0.0.1:8800 ..."
Start-Process -WindowStyle Hidden -FilePath (Join-Path $venv "Scripts/python.exe") -ArgumentList "main.py" -WorkingDirectory $root
Start-Sleep -Seconds 4
try {
  $c = Get-NetTCPConnection -LocalPort 8800 -ErrorAction SilentlyContinue
  if ($c) { Write-Host "已启动 PID=$($c.OwningProcess -join ',')" -ForegroundColor Green }
  else { Write-Host "端口 8800 未监听，请检查日志" -ForegroundColor Red }
} catch {
  Write-Host "无法确认状态：$_" -ForegroundColor Red
}
