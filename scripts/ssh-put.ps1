param(
    [Parameter(Mandatory=$true)][string]$Local,
    [Parameter(Mandatory=$true)][string]$Remote
)
$ErrorActionPreference = 'Stop'

# 统一 askpass 垫片（Windows OpenSSH 无法用含中文的 askpass 路径）
. 'D:\MyProjects\W.FNOS维护\ssh-askpass.ps1'
$null = Set-DshSshAskpass
$env:GIT_SSH_COMMAND = $null

if (-not (Test-Path -LiteralPath $Local)) { throw "本地文件不存在: $Local" }

# 用 .NET 读字节转 base64（不经过 bash / MSYS，彻底绕开 win_bash 的 /tmp 路径地狱）
$b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($Local))

# base64 经 stdin 喂给远端 base64 -d；末行输出远端字节数供调用方校验
# -i：忽略 pwsh 管道带进来的 \r 等非法字符（否则 GNU base64 报 invalid input）
$remoteCmd = "base64 -di > '$Remote' && wc -c < '$Remote'"
$b64 | ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null `
    -o ConnectTimeout=20 -o ServerAliveInterval=30 `
    panyunmeng@panyunmeng.cn $remoteCmd

exit $LASTEXITCODE
