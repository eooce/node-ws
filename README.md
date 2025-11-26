# Node-ws说明
serverless 实现的vmess和socks代理
* PaaS 平台设置的环境变量
  | 变量名        | 是否必须 | 默认值 | 备注 |
  | ------------ | ------ | ------ | ------ |
  | UUID         | 否 |00000000-0000-0000-0000-00000000000|
  | PROROCOL     | 是 |  vmess  |  可选socks               |
  | VMESS_PORT   | 是 |  8080  |  节点端口 |
  | TYPE         | 是 |ws| 传输协议：ws、tcp、http、xhttp |
  | WSPATH       | 否 | /ws     | 节点路径| 
    
