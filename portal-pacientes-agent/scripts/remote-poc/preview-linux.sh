#!/usr/bin/env bash
# Optional human review, HTTPS/Basic auth and host LOOPBACK only. No ngrok changes.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
variant="${1:-kasm_h264}"
case "$variant" in kasm_h264|kasm_image) ;; *) echo 'Use kasm_h264 or kasm_image' >&2; exit 1;; esac
container="portal-stream-preview-$(date +%s)"
engine="$(docker version --format '{{.Server.Version}}')"
if [[ ! "$engine" =~ ^([0-9]+)\. ]] || (( BASH_REMATCH[1] < 28 )); then
  echo 'Preview requires Docker Engine 28+ for the localhost publishing boundary.' >&2; exit 1
fi
docker run -d --init --name "$container" --read-only --user 1000:1000 --cap-drop ALL \
  --security-opt no-new-privileges --security-opt "seccomp=$root/portal-pacientes-agent/docker/seccomp_profile.json" \
  --shm-size 1g --tmpfs /tmp:rw,size=1g,mode=1777 --tmpfs /home/pwuser:rw,size=128m,uid=1000,gid=1000,mode=0700 \
  -p 127.0.0.1:8899:8444 \
  -e HOME=/home/pwuser -e XDG_CONFIG_HOME=/home/pwuser/.config -e XDG_CACHE_HOME=/home/pwuser/.cache \
  -e "POC_VARIANT=$variant" -e POC_PREVIEW=1 -e "POC_PROFILE=${POC_PROFILE:-desktop}" -e POC_SECONDS=5 \
  --entrypoint sh "${POC_IMAGE:-portal-stream-poc:1.5.2}" \
  -c 'exec 3>&1; exec 1>&2; exec node --import tsx scripts/remote-poc/run.mjs' > /dev/null
echo "Preview container: $container" >&2
for ((attempt=0;attempt<60;attempt++)); do
  if docker exec "$container" test -f /tmp/remote-poc/preview-access.json 2>/dev/null; then
    mode=image; if [[ "$variant" == kasm_h264 ]]; then mode=-1027; fi
    echo "URL: https://localhost:8899/?resize=scale&enable_webrtc=false&kasmvnc_mode_preference=$mode&framerate_streaming_mode=60&video_stream_quality=34" >&2
    echo 'Ephemeral synthetic credentials:' >&2
    docker exec "$container" cat /tmp/remote-poc/preview-access.json
    echo >&2
    echo "Export public certificate: docker cp $container:/tmp/remote-poc/cert.pem ./poc-cert.pem" >&2
    echo "Stop this preview: docker stop $container" >&2
    echo "Remove this stopped preview container: docker rm $container" >&2
    exit 0
  fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)" != true ]]; then
    echo "Preview failed. See docker logs $container; remove only this container with docker rm $container." >&2; exit 1
  fi
  sleep 1
done
echo "Preview not ready. Inspect docker logs $container; stop with docker stop $container." >&2
exit 1
