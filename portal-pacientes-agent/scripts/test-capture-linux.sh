#!/usr/bin/env bash
# Execute existing synthetic remote UI tests in isolated, disposable containers.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${BENCH_IMAGE:-portal-fps-benchmark:local}"
out="${1:?Usage: bash test-capture-linux.sh NEW_OUTPUT_DIRECTORY}"
if [[ -e "$out" ]]; then echo 'Output path already exists; choose a new directory.' >&2; exit 1; fi
docker image inspect "$image" >/dev/null
mkdir -p -- "$out"
for mode in legacy shm_damage; do
  echo "Running synthetic remote tests: $mode" >&2
  docker run --rm --init --network none --read-only --user 1000:1000 --cap-drop ALL \
    --security-opt no-new-privileges --security-opt "seccomp=$root/portal-pacientes-agent/docker/seccomp_profile.json" \
    --shm-size 1g --tmpfs /tmp:rw,size=1g,mode=1777 --tmpfs /home/pwuser:rw,size=128m,uid=1000,gid=1000,mode=0700 \
    --tmpfs /var/lib/portal:rw,size=1g,uid=1000,gid=1000,mode=0700 \
    -e HOME=/home/pwuser -e XDG_CONFIG_HOME=/home/pwuser/.config -e XDG_CACHE_HOME=/home/pwuser/.cache \
    -e "REMOTE_CAPTURE_MODE=$mode" -e TEST_REMOTE_DESKTOP=true \
    --entrypoint xvfb-run "$image" -a '--server-args=-screen 0 1280x1000x24 -nolisten tcp' \
    node --import tsx --test --test-concurrency=1 test/e2e/remote-desktop.test.ts test/e2e/remote-immersive.test.ts \
    > "$out/$mode.log" 2>&1 || { echo "Failed: see $out/$mode.log" >&2; exit 1; }
done
echo "Results: $out" >&2
