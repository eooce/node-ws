FROM node:lts

WORKDIR /app

COPY . .

EXPOSE 3000

RUN npm install -r package.json

CMD ["node", "index.js"]
