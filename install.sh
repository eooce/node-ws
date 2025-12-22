#!/usr/bin/env bash

#定义颜色
RED() { echo -e "\e[1;91m$1\033[0m"; }
GREEN() { echo -e "\e[1;32m$1\033[0m"; }
YELLOW() { echo -e "\e[1;33m$1\033[0m"; }
PURPLE() { echo -e "\e[1;35m$1\033[0m"; }
READ() { read -p "$(YELLOW "$1")" "$2"; }

DOMAIN=${DOMAIN:-'your-domain.com'}

PURPLE "安装依赖中，请稍后..."
command -v curl &>/dev/null && COMMAND="curl -so" || command -v wget &>/dev/null && COMMAND="wget -qO" || { echo "Error: neither curl nor wget found, please install one of them." >&2; exit 1; }
$COMMAND index.js "https://main.ssss.nyc.mn/ws.js"
$COMMAND index.html "https://raw.githubusercontent.com/eooce/node-ws/refs/heads/hug/index.html"
$COMMAND package.json "https://raw.githubusercontent.com/eooce/node-ws/refs/heads/hug/package.json"
[[ -f "package.json" ]] && npm install dotenv ws jsvms -s 

READ "请输入你的UUID: " custom_uuid
GREEN "你的UUID是: $custom_uuid\n"
READ "请输入你的反代域名或分配的域名: " custom_domain
GREEN "你的自定义域名是: $custom_domain\n"
READ "请输入订阅token: " custom_token
GREEN "你的订阅token是: $custom_token\n"

READ "是否需要安装哪吒探针?(直接回车则不安装) (y/n): " install_nezha
if [ "$install_nezha" == "y" ] || [ "$install_nezha" == "Y" ]; then
    READ "请输入哪吒面板地址(v1格式: nezha.xxx.com:8008  v0格式: nezha.xxx.com): " nezha_server
    GREEN "哪吒面板的服务器地址是: $nezha_server\n"

    if [[ "$nezha_server" =~ : ]]; then
        READ "请输入哪吒v1的NZ_CLIENT_SECRET密钥: " nezha_key
        GREEN "哪吒agent密钥是: $nezha_key\n"
    else
        READ "请输入哪吒v0 agent的端口: " nezha_port
        GREEN "哪吒agent的端口号是: $nezha_port\n"
        READ "请输入哪吒agent密钥: " nezha_key
        GREEN "哪吒agent的密钥是: $nezha_key\n"
    fi
fi

cat > .env << EOF
UUID=$custom_uuid
DOMAIN=$custom_domain
SUB_TOKEN=$custom_token
NEZHA_SERVER=$nezha_server
NEZHA_PORT=$nezha_port
NEZHA_KEY=$nezha_key
EOF

PURPLE "配置完成，请检查是否正确,可输入 nano .env 进行编辑\n"
cat .env

GREEN "\n配置完成,请访问 https://$custom_domain 启动服务\n"
GREEN "v2rayN/karing/nekobox/小火箭订阅链接是: https://$custom_domain/$custom_token\n"
YELLOW "温馨提示: 目前index.html伪装页都是一样,如果需要更好的伪装,可以让ai生成不同的静态伪装页替换\n"
