FROM node:lts

WORKDIR /app

COPY . .

EXPOSE 3000

RUN npm install -g npm@11.2.0 && npm install axios

CMD ["node", "index.js"]
