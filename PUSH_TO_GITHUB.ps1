$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot
$remote = 'https://github.com/Sunday-SpWorldTech/world-net-hosting.git'

if (-not (Test-Path '.git')) {
    git init
}

git branch -M main

$origin = git remote 2>$null | Where-Object { $_ -eq 'origin' }
if ($origin) {
    git remote set-url origin $remote
} else {
    git remote add origin $remote
}

git fetch origin main

# Attach the local working tree to the existing GitHub history without
# deleting or overwriting the files currently in this folder.
git reset --mixed origin/main

git add .

$changes = git status --porcelain
if ($changes) {
    git commit -m 'Fix World Net Hosting Vercel deployment and Paystack integration'
} else {
    Write-Host 'No local changes to commit.'
}

git push -u origin main
