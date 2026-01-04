# Gows - VLESS/Trojan/Shadowsocks proxy

这是一个用 Go 实现的 serverless 代理服务器，支持 VLESS-WS、Trojan-WS 和 Shadowsocks-WS 协议。

## 功能特性

- ✅ **VLESS-WS** 协议支持
- ✅ **Trojan-WS** 协议支持  
- ✅ **Shadowsocks-WS** 协议支持（使用 v2ray-plugin）
- ✅ 自定义 DNS 解析（Google DNS-over-HTTPS）
- ✅ 测速网站域名屏蔽
- ✅ 订阅链接生成
- ✅ ISP 信息检测
- ✅ 哪吒监控集成（支持 v0 和 v1）
- ✅ 自动访问保活（可选）

## 配置说明

在 `.env` 文件中配置以下环境变量：

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `UUID` | 用户 ID（用于认证） | `5efabea4-f6d4-91fd-b8f0-17e004c89c60` |
| `DOMAIN` | 域名（留空则自动获取公网 IP） | 空 |
| `PORT` | 服务端口 | `3000` |
| `WSPATH` | WebSocket 路径 | UUID 前 8 位 |
| `SUB_PATH` | 订阅路径 | `sub` |
| `NAME` | 节点名称 | 空 |
| `AUTO_ACCESS` | 自动访问保活 | `false` |
| `NEZHA_SERVER` | 哪吒监控服务器 | 空 |
| `NEZHA_PORT` | 哪吒监控端口 | 空 |
| `NEZHA_KEY` | 哪吒监控密钥 | 空 |

## 安装方法

### 1：源代码构建运行

- Go 1.24 或更高版本

### 安装步骤

1. 克隆或下载项目

2. 安装依赖：
```bash
go mod tidy
```

3. 配置环境变量：
```bash
cp .env.example .env
# 编辑 .env 文件，设置你的 UUID 和其他配置
```

4. 编译运行：
```bash
go build -o gows
./gows
```
或源代码运行

### 启动服务

```bash
go run main.go
```

### 2：下载二进制运行

* [点击跳转到二进制下载界面](https://github.com/eooce/node-ws/releases/tag/gows-latest)

* 下载二进制运行

### 获取订阅链接
服务将在配置的端口（默认 3000）上启动。

访问 `http://your-domain:port/sub` 获取 Base64 编码的订阅链接。

订阅包含三个协议的配置：
- VLESS-WS
- Trojan-WS
- Shadowsocks-WS (with v2ray-plugin)

### 客户端配置

#### V2rayN / V2rayNG

1. 导入订阅链接：`http://your-domain:port/sub`
2. 更新订阅
3. 选择节点连接

## 哪吒监控配置

本项目支持哪吒监控（Nezha）v0 和 v1 版本。

### 哪吒（v1版本）

v1 版本使用配置文件，不需要设置 `NEZHA_PORT`：

```bash
export NEZHA_SERVER=nz.example.com:8008
export NEZHA_KEY=your_client_secret
```

### 哪吒（ v0版本）

v0 版本使用命令行参数：

```bash
export NEZHA_SERVER=nz.example.com
export NEZHA_PORT=5555
export NEZHA_KEY=your_secret_key
```

**TLS 端口**: 如果 `NEZHA_PORT` 是以下端口之一，会自动启用 TLS：
- 443, 8443, 2096, 2087, 2083, 2053

### 架构支持

程序会自动检测系统架构并下载对应的 agent：
- **AMD64**: 适用于 x86_64 系统
- **ARM64**: 适用于 ARM64/aarch64 系统

### 禁用哪吒监控

如果不需要哪吒监控，只需不设置 `NEZHA_SERVER` 和 `NEZHA_KEY` 环境变量即可。

## 域名屏蔽

以下测速网站域名会被自动屏蔽：
- speedtest.net
- fast.com
- speedtest.cn
- speed.cloudflare.com
- speedof.me
- testmy.net
- bandwidth.place
- speed.io
- librespeed.org
- speedcheck.org

## 项目结构

```
go-proxy/
├── main.go              # 主程序入口
├── handlers/            # 协议处理器
│   ├── ws.go            # WebSocket 处理
│   ├── vls.go           # VLESS 协议
│   ├── tro.go           # Trojan 协议
│   └── ss.go            # Shadowsocks 协议
├── utils/               # 工具函数
│   ├── dns.go           # DNS 解析
│   ├── blocking.go      # 域名屏蔽
│   ├── isp.go           # ISP 检测
│   ├── ip.go            # IP 检测
│   ├── subscription.go  # 订阅生成
│   └── keepalive.go     # 保活功能
├── monitor/             # 监控（可选）
├── go.mod               # Go 模块定义
├── index.html           # 前端静态伪装页
└── .env.example         # 环境变量示例

```

## 许可证


GPL 3.0 License
