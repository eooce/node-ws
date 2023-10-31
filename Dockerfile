FROM node:alpine

WORKDIR /app

COPY . .

EXPOSE 3000

RUN apk update && apk add --no-cache openssl curl &&\
    chmod +x index.js &&\
    npm install

CMD ["node", "index.js"]
