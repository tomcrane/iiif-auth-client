# syntax=docker/dockerfile:1
# iiif-auth-client as a container, for hosting a copy of the client alongside the server
# (e.g., on ECS / Fargate). The same files are published as-is to GitHub Pages.
FROM nginxinc/nginx-unprivileged:stable-alpine

# Serve the client at this path; must start and end with /
ENV CLIENT_BASE_PATH=/

COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --exclude=docker . /usr/share/nginx/html/

EXPOSE 8080
