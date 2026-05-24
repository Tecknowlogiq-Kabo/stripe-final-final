FROM node:20-alpine AS base
WORKDIR /app

FROM base AS development
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3003
CMD ["npm", "run", "start:dev"]

FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS production
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3003
CMD ["node", "dist/main.js"]
