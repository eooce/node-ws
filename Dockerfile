FROM node:lts

WORKDIR /app

COPY . .

EXPOSE 3000

RUN npm install axios --save-dev && npm install -r package.json

CMD ["node", "index.js"]
