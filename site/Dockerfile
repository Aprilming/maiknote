# syntax=docker/dockerfile:1

# MaikNote 官网是纯静态站（无需 npm build），这里只做「拷贝 + Nginx 托管」。
FROM nginx:1.27-alpine

# 只拷真正需要发布的文件，避免把 Dockerfile / README 一起塞进 web 根目录
COPY index.html /usr/share/nginx/html/
COPY assets     /usr/share/nginx/html/assets

# 端口模板：平台注入 PORT 时监听该端口，未注入时默认 80
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template

ENV PORT=80
EXPOSE 80

# 容器自带 wget（busybox），拿 /healthz 探活
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 || exit 1

STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
