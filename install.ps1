# dsh-task-timer 安装脚本（零依赖，双击或右键"使用 PowerShell 运行"）
# 作用：把本插件 link 进 profile 的 bundle 列表；装完需重启 DeepSeek Harness。
# 查找 dsh CLI 的顺序：-DshCli 参数 → $env:DSH_CLI → PATH 上的 dsh。
param(
    [string]$DshCli = $env:DSH_CLI,
    [string]$Profile = "desktop"
)
$ErrorActionPreference = "Stop"

$pluginDir = $PSScriptRoot

if (-not $DshCli) {
    $onPath = Get-Command dsh -ErrorAction SilentlyContinue
    if ($onPath) { $DshCli = $onPath.Source }
}

if (-not $DshCli -or -not (Test-Path $DshCli)) {
    Write-Host "[dsh-task-timer] 找不到 dsh CLI。" -ForegroundColor Red
    Write-Host "  请把 DSH 安装目录下的 resources\runtime\cli\bin\dsh.cmd 全路径传给脚本，例如：" -ForegroundColor Yellow
    Write-Host "  .\install.ps1 -DshCli `"<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd`"" -ForegroundColor DarkGray
    Write-Host "  或先设置环境变量 DSH_CLI。" -ForegroundColor DarkGray
    exit 1
}

Write-Host "[dsh-task-timer] CLI：$DshCli" -ForegroundColor DarkGray
Write-Host "[dsh-task-timer] 安装：$pluginDir → profile '$Profile'" -ForegroundColor Cyan
& $DshCli plugin --profile $Profile add "link:$pluginDir"

if ($LASTEXITCODE -ne 0) {
    Write-Host "[dsh-task-timer] 安装失败（exit $LASTEXITCODE），请查看上面的输出。" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "[dsh-task-timer] 安装完成。" -ForegroundColor Green
Write-Host "请重启 DeepSeek Harness 让新 bundle 生效，之后对话底部仪表盘会多出「工作时长」pill。" -ForegroundColor Yellow
