FROM node:18-alpine

WORKDIR /app/frontend

COPY package*.json ./
COPY yarn.lock ./

RUN yarn install

COPY . /app/frontend

RUN yarn build

EXPOSE 3000

CMD ["yarn", "start"] 
