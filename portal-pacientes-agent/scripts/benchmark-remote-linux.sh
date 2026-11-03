#!/usr/bin/env bash
# Synthetic, offline Docker benchmark. Never uses a Compose project or patient volumes.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${BENCH_IMAGE:-portal-fps-benchmark:local}"
seconds="${BENCH_SECONDS:-20}"
warmup="${BENCH_WARMUP_SECONDS:-5}"
out="${1:?Usage: bash benchmark-remote-linux.sh NEW_OUTPUT_DIRECTORY}"
if [[ -e "$out" ]]; then echo 'Output path already exists; choose a new directory.' >&2; exit 1; fi
docker image inspect "$image" >/dev/null
mkdir -p -- "$out"
for profile in mobile desktop; do
  for round in 1 2 3; do
    case "$round" in
      1) variants=(legacy shm shm_damage) ;;
      2) variants=(shm_damage legacy shm) ;;
      3) variants=(shm shm_damage legacy) ;;
    esac
    for variant in "${variants[@]}"; do
      echo "Running $profile $variant round $round" >&2
      docker run --rm --init --network none --read-only --user 1000:1000 --cap-drop ALL \
        --security-opt no-new-privileges --security-opt "seccomp=$root/portal-pacientes-agent/docker/seccomp_profile.json" \
        --shm-size 1g --tmpfs /tmp:rw,size=1g,mode=1777 --tmpfs /home/pwuser:rw,size=128m,uid=1000,gid=1000,mode=0700 \
        -v "$root/portal-pacientes-agent/scripts/benchmark-remote-fps.mjs:/app/portal-pacientes-agent/scripts/benchmark-remote-fps.mjs:ro" \
        -v "$root/portal-pacientes-agent/src/browser/display-profile.ts:/app/portal-pacientes-agent/src/browser/display-profile.ts:ro" \
        -v "$root/portal-pacientes-agent/src/server/capture-mode.ts:/app/portal-pacientes-agent/src/server/capture-mode.ts:ro" \
        -e HOME=/home/pwuser -e XDG_CONFIG_HOME=/home/pwuser/.config -e XDG_CACHE_HOME=/home/pwuser/.cache \
        -e "BENCH_SECONDS=$seconds" -e "BENCH_WARMUP_SECONDS=$warmup" -e "BENCH_PROFILE=$profile" -e "BENCH_VARIANT=$variant" \
        --entrypoint xvfb-run "$image" -a '--server-args=-screen 0 1280x1000x24 -nolisten tcp' \
        node --import tsx scripts/benchmark-remote-fps.mjs > "$out/${profile}-${variant}-${round}.json"
    done
  done
done
echo "Results: $out" >&2
