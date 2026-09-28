#!/usr/bin/env bash
# 把当前检出部署到 ali-agents 服务器（https://project.nocobase.cn/main）。说明见 docs/deploy.md。
#
#   pnpm deploy:server              # 构建、上传、打镜像、替换应用容器
#   NP_DEPLOY_SKIP_BUILD=1 pnpm deploy:server   # 复用已有的 linux-x64 dist/
#
# 只动应用容器；数据库容器、config.yml、app.env、storage 都在服务器上，不随部署改变。
set -euo pipefail

HOST="${NP_DEPLOY_HOST:-ali-agents-ts}"
# 应用只监听服务器的 Tailscale 地址：Caddy 从这里反代公网域名，国内机器（dev）直接连这里。
BIND="${NP_DEPLOY_BIND:-100.89.167.29:13001}"
cd "$(dirname "$0")/.."

TAG="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain -- . ':!output' ':!test-results')" ]; then
  TAG="${TAG}-dirty"
  echo "warning: working tree has uncommitted changes; deploying as ${TAG}" >&2
fi

if [ "${NP_DEPLOY_SKIP_BUILD:-0}" != 1 ]; then
  APP_BASE_PATH=/main pnpm build --target linux-x64 --node-version 24
fi
node -e '
const t = require("./dist/package.json").nocobase?.buildTarget ?? {};
if (t.platform !== "linux" || t.arch !== "x64" || t.nodeMajor !== 24) {
  console.error(`dist/ is built for ${JSON.stringify(t)}; run without NP_DEPLOY_SKIP_BUILD`);
  process.exit(1);
}'

echo "==> upload dist ($TAG)"
rsync -a --delete --exclude .env dist Dockerfile Dockerfile.dockerignore config.example.yml "$HOST:nocoproject/build/"

echo "==> build image and replace container"
ssh "$HOST" TAG="$TAG" BIND="$BIND" bash -s <<'REMOTE'
set -euo pipefail
cd ~/nocoproject/build
docker build -q --build-arg DIST=prebuilt --build-arg APP_BASE_PATH=/main -t "nocoproject:$TAG" -t nocoproject:latest . >/dev/null
cd ~/nocoproject
docker rm -f nocoproject-app >/dev/null 2>&1 || true
sleep 3 # rootless Docker 释放端口需要一点时间
# rootless Docker 下容器 root 就是宿主机的 agents 用户，才能读写挂载进来的 config.yml 与 storage。
docker run -d --name nocoproject-app --user 0:0 --network nocoproject --restart unless-stopped \
  --env-file app.env -p "$BIND:13000" \
  -v ~/nocoproject/config.yml:/app/config.yml:ro -v ~/nocoproject/storage:/app/storage \
  "nocoproject:$TAG" >/dev/null
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://$BIND/main/api/healthz"; then
    echo "healthy: nocoproject:$TAG"
    # 保留最近 3 个版本的镜像，便于回滚。
    docker images nocoproject --format '{{.Tag}}' | grep -v latest | tail -n +4 | xargs -r -I{} docker rmi -f "nocoproject:{}" >/dev/null
    exit 0
  fi
  sleep 3
done
echo "app did not become healthy; last logs:" >&2
docker logs --tail 40 nocoproject-app >&2
exit 1
REMOTE
