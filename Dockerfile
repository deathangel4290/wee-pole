# BOARD//BOX server + app. No dependencies to install.
FROM node:22-alpine
WORKDIR /app
COPY index.html manifest.webmanifest sw.js ./
COPY css ./css
COPY js ./js
COPY icons ./icons
COPY server ./server
ENV PORT=8080 DATA_FILE=/data/boardbox.json NODE_ENV=production
# Mount a persistent volume here, or accounts and leaderboards reset on every redeploy.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
