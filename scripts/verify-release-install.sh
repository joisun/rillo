#!/usr/bin/env bash

set -eu

[ "$#" -eq 2 ] || { printf 'Usage: verify-release-install.sh <release-directory> <version>\n' >&2; exit 1; }
release_directory="$(cd "$1" && pwd)"
expected_version="${2#v}"
case "$(uname -s)" in
  Linux) service_asset=rillo-linux.tar.gz ;;
  Darwin) service_asset=rillo-macos.tar.gz ;;
  *) printf 'Unsupported verification platform\n' >&2; exit 1 ;;
esac

smoke_root="$(mktemp -d "${TMPDIR:-/tmp}/rillo-release-smoke.XXXXXX")"
smoke_home="$smoke_root/home"
runtime_pid=''
cleanup() {
  if [ -n "$runtime_pid" ]; then
    kill "$runtime_pid" 2>/dev/null || true
    for _shutdown_attempt in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$runtime_pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL "$runtime_pid" 2>/dev/null || true
    wait "$runtime_pid" 2>/dev/null || true
  fi
  rm -rf "$smoke_root"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mkdir -p "$smoke_home/.config/rillo"

tar -tzf "$release_directory/$service_asset" > "$smoke_root/entries" 2> "$smoke_root/tar-errors"
[ ! -s "$smoke_root/tar-errors" ] || { cat "$smoke_root/tar-errors" >&2; exit 1; }
awk -F/ '{ for (i = 1; i <= NF; i++) if ($i ~ /^\._/ || $i == ".DS_Store") exit 1 }' "$smoke_root/entries"

smoke_port="$(node --input-type=module -e 'import {createServer} from "node:net"; const server=createServer(); server.listen(0,"127.0.0.1",()=>{console.log(server.address().port);server.close()})')"
node - "$smoke_home/.config/rillo/config.json" "$smoke_port" <<'NODE'
const {writeFileSync}=require('node:fs')
writeFileSync(process.argv[2], JSON.stringify({output_dir:'.',server_host:'127.0.0.1',server_port:Number(process.argv[3])})+'\n')
NODE
cp "$smoke_home/.config/rillo/config.json" "$smoke_root/config-before.json"
env HOME="$smoke_home" RILLO_RELEASE_BASE_URL="file://$release_directory" \
  bash "$release_directory/install.sh" --version "v$expected_version" --no-start
cmp "$smoke_root/config-before.json" "$smoke_home/.config/rillo/config.json"

runtime_root="$smoke_home/.local/share/rillo/current"
node - "$runtime_root/package.json" "$expected_version" <<'NODE'
const {readFileSync}=require('node:fs')
const manifest=JSON.parse(readFileSync(process.argv[2],'utf8'))
if(manifest.version!==process.argv[3])throw new Error('Installed package version mismatch')
NODE
if find "$smoke_home/.local/share/rillo/releases" \( -name '._*' -o -name '.DS_Store' \) -print | read -r _metadata; then
  printf 'Installed runtime contains macOS metadata\n' >&2
  exit 1
fi

env -i HOME="$smoke_home" PATH="$PATH" CODEX_HOME="$smoke_home/.codex" TMPDIR="$smoke_root" \
  node "$runtime_root/server/daemon.mjs" > "$smoke_root/stdout" 2> "$smoke_root/stderr" &
runtime_pid=$!
ready=0
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --noproxy '*' -fsS --max-time 1 "http://127.0.0.1:$smoke_port/health/ready" > /dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$runtime_pid" 2>/dev/null; then break; fi
  sleep 1
done
[ "$ready" -eq 1 ] || { cat "$smoke_root/stderr" >&2; exit 1; }
node --input-type=module - "$smoke_port" "$expected_version" <<'NODE'
const base=`http://127.0.0.1:${process.argv[2]}`
const meta=await fetch(base+'/api/v1/meta',{signal:AbortSignal.timeout(3000)}).then(r=>r.json())
if(meta.service_version!==process.argv[3])throw new Error(`Unexpected service_version: ${meta.service_version}`)
const page=await fetch(base+'/',{signal:AbortSignal.timeout(3000)})
if(page.status!==200)throw new Error('Dashboard is not available')
await page.arrayBuffer()
const controller=new AbortController()
const timeout=setTimeout(()=>controller.abort(),3000)
try{
  const events=await fetch(base+'/api/v1/events',{signal:controller.signal})
  if(!events.ok||!events.headers.get('content-type')?.includes('text/event-stream'))throw new Error('SSE is not available')
  const reader=events.body.getReader()
  await reader.read()
  await reader.cancel()
}finally{clearTimeout(timeout)}
console.log(`Release install verified: ${meta.service_version}, Dashboard and SSE ready`)
NODE
