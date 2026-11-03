param(
  [ValidateSet('baseline','damage','shm','both','wait10')][string]$Variant = 'baseline',
  [ValidateSet('mobile','desktop')][string]$Profile = 'mobile',
  [ValidateRange(5,120)][int]$Seconds = 12,
  [string]$Image = 'portal-immersive-regression:local'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
docker run --rm --init --network none --read-only --user 1000:1000 --cap-drop ALL `
  --security-opt no-new-privileges --security-opt "seccomp=$repo/portal-pacientes-agent/docker/seccomp_profile.json" `
  --shm-size 1g --tmpfs /tmp:rw,mode=1777 --tmpfs /home/pwuser:rw,uid=1000,gid=1000 `
  -v "${repo}/portal-pacientes-agent/scripts/benchmark-remote-fps.mjs:/app/portal-pacientes-agent/scripts/benchmark-remote-fps.mjs:ro" `
  -v "${repo}/portal-pacientes-agent/src/browser/display-profile.ts:/app/portal-pacientes-agent/src/browser/display-profile.ts:ro" `
  -v "${repo}/portal-pacientes-agent/src/server/capture-mode.ts:/app/portal-pacientes-agent/src/server/capture-mode.ts:ro" `
  -e HOME=/home/pwuser -e XDG_CONFIG_HOME=/home/pwuser/.config -e XDG_CACHE_HOME=/home/pwuser/.cache `
  -e "BENCH_SECONDS=$Seconds" -e "BENCH_PROFILE=$Profile" -e "BENCH_VARIANT=$Variant" `
  --entrypoint xvfb-run $Image -a '--server-args=-screen 0 1280x1000x24 -nolisten tcp' `
  node --import tsx scripts/benchmark-remote-fps.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
