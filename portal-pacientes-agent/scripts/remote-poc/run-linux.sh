#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
image="${POC_IMAGE:-portal-stream-poc:1.5.2}"
suite="${2:-smoke}"
out="${1:?Usage: bash run-linux.sh NEW_OUTPUT_DIRECTORY [smoke|compare|effects|functional|codecs]}"
case "$suite" in
  smoke) rounds=1; profiles=(desktop); variants=(source_xvfb source_kasm novnc_damage kasm_image kasm_h264) ;;
  compare) rounds=3; profiles=(desktop mobile); variants=(source_xvfb source_kasm novnc_legacy novnc_damage kasm_image kasm_h264) ;;
  effects) rounds=3; profiles=(desktop mobile); variants=(novnc_damage kasm_image kasm_h264) ;;
  functional) rounds=1; profiles=(desktop mobile); variants=(novnc_legacy novnc_damage kasm_image kasm_h264) ;;
  codecs) rounds=1; profiles=(desktop); variants=(kasm_image kasm_h264 kasm_h265 kasm_av1) ;;
  *) echo 'Unknown suite' >&2; exit 1 ;;
esac
if [[ -e "$out" ]]; then echo 'Choose a new output directory.' >&2; exit 1; fi
if [[ "$(id -u)" != 1000 ]]; then echo 'Run as UID 1000 so the restricted container can write new synthetic artifacts.' >&2; exit 1; fi
docker image inspect "$image" >/dev/null
mkdir -m 700 -- "$out"
out="$(cd "$out" && pwd)"
docker image inspect --format '{{.Id}} {{.Architecture}} {{.Os}}' "$image" > "$out/image.txt"
uname -sr > "$out/kernel.txt"
lscpu > "$out/cpu.txt"
if [[ "$suite" == smoke ]]; then
  if ! docker run --rm --init --network none --read-only --user 1000:1000 --cap-drop ALL \
    --security-opt no-new-privileges --security-opt "seccomp=$root/portal-pacientes-agent/docker/seccomp_profile.json" \
    --shm-size 1g --tmpfs /tmp:rw,size=1g,mode=1777 --tmpfs /home/pwuser:rw,size=128m,uid=1000,gid=1000,mode=0700 \
    -e HOME=/home/pwuser -e XDG_CONFIG_HOME=/home/pwuser/.config -e XDG_CACHE_HOME=/home/pwuser/.cache \
    --entrypoint node "$image" --test scripts/remote-poc/metrics.test.mjs scripts/remote-poc/scene.test.mjs scripts/remote-poc/summarize.test.mjs \
    > "$out/unit-tests.log" 2>&1; then
    echo "PoC unit/browser test failed: $out/unit-tests.log" >&2; exit 1
  fi
fi
failed=0
for profile in "${profiles[@]}"; do
  for ((round=1;round<=rounds;round++)); do
    # Rotate execution order to reduce drift bias. Never run cases concurrently.
    for ((index=0;index<${#variants[@]};index++)); do
      variant="${variants[$(( (index + round - 1) % ${#variants[@]} ))]}"
      cases=(direct-native)
      if [[ "$suite" == effects ]]; then
        cases=(direct-native direct-half)
        if [[ "$variant" == novnc* ]]; then cases+=(portal_proxy-native); fi
      fi
      for experiment in "${cases[@]}"; do
        transport="${experiment%-*}"; scale="${experiment##*-}"
        label="$profile-$variant-$experiment-$round"
        mkdir -m 700 -- "$out/$label"
        echo "Running $label (synthetic only)" >&2
        functional=0; if [[ "$suite" == functional ]]; then functional=1; fi
        if docker run --rm --init --network none --read-only --user 1000:1000 --cap-drop ALL \
          --security-opt no-new-privileges --security-opt "seccomp=$root/portal-pacientes-agent/docker/seccomp_profile.json" \
          --shm-size 1g --tmpfs /tmp:rw,size=1g,mode=1777 --tmpfs /home/pwuser:rw,size=128m,uid=1000,gid=1000,mode=0700 \
          --mount "type=bind,src=$out/$label,dst=/out" \
          -e HOME=/home/pwuser -e XDG_CONFIG_HOME=/home/pwuser/.config -e XDG_CACHE_HOME=/home/pwuser/.cache \
          -e "POC_VARIANT=$variant" -e "POC_PROFILE=$profile" -e "POC_PATH=$transport" -e "POC_SCALE=$scale" \
          -e "POC_SECONDS=${POC_SECONDS:-20}" -e "POC_WARMUP=${POC_WARMUP:-5}" \
          -e "POC_FUNCTIONAL=$functional" -e "POC_TRACE=${POC_TRACE:-0}" -e "POC_RECORD_VIDEO=${POC_RECORD_VIDEO:-0}" \
          --entrypoint sh "$image" -c 'exec 3>&1; exec 1>&2; exec node --import tsx scripts/remote-poc/run.mjs' \
          > "$out/$label/metrics.json" 2> "$out/$label/diagnostics.log"; then
          if ! python3 -m json.tool "$out/$label/metrics.json" > /dev/null; then
            echo "Invalid JSON: $label" >&2; failed=1
          fi
        else echo "FAILED: $label; see diagnostics.log. Continuing other cases." >&2; failed=1; fi
      done
    done
  done
done
echo "Output: $out; failures: $failed" >&2
exit "$failed"
