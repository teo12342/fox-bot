FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY src ./src
RUN mkdir /data && chown node:node /data
USER node
ENV STATE_FILE=/data/identities.json
EXPOSE 8787
CMD ["node","src/server.mjs"]
