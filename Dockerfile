# 使用 golang:1.24 作为构建镜像
FROM golang:1.24 AS builder
WORKDIR /app
COPY . .
RUN go mod download && \
    go mod tidy

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-extldflags -static" -o app main.go

# 第二阶段：使用alpine作为基础镜像
FROM alpine:3.22
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /tmp
COPY --from=builder /app/app .
COPY --from=builder /app/index.html .
RUN chmod +x /tmp/app
EXPOSE 3000

CMD ["./app"]