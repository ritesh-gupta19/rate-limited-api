FROM node:18-alpine

ENV NODE_ENV=production

WORKDIR /app
RUN chown node:node /app

USER node

COPY --chown=node:node package*.json ./
RUN npm ci --only=production

COPY --chown=node:node . .

EXPOSE 3000

CMD ["node", "src/server.js"]