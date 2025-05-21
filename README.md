# Node-ws说明   [web-hosting部署指南](https://github.com/eooce/node-ws/blob/main/web-hosting.md)
用于node环境的玩具和容器，基于node三方ws库，集成哪吒探针服务，可自行添加环境变量
* PaaS 平台设置的环境变量
  | 变量名        | 是否必须 | 默认值 | 备注 |
  | ------------ | ------ | ------ | ------ |
  | UUID         | 否 |de04add9-5c68-6bab-950c-08cd5320df33| 开启了哪吒v1,请修改UUID|
  | PORT         | 否 |  3000  |  监听端口                    |
  | NEZHA_SERVER | 否 |        |哪吒v1填写形式：nz.abc.com:8008   哪吒v0填写形式：nz.abc.com|
  | NEZHA_PORT   | 否 |        | 哪吒v1没有此变量，v0的agent端口| 
  | NEZHA_KEY    | 否 |        | 哪吒v1的NZ_CLIENT_SECRET或v0的agent端口 |
  | NAME         | 否 |        | 节点名称前缀，例如：Glitch |
  | DOMAIN       | 是 |        | 项目分配的域名或已反代的域名，不包括https://前缀  |
  | SUB_PATH     | 否 |  sub   | 订阅路径   |
  | AUTO_ACCESS  | 否 |  false | 是否开启自动访问保活,false为关闭,true为开启,需同时填写DOMAIN变量 |

* 域名/sub查看节点信息，也是订阅地址，包含 https:// 或 http:// 前缀，非标端口，域名:端口/sub

    
* 温馨提示：READAME.md为说明文件，请不要上传。
* js混肴地址：https://obfuscator.io


## 开源协议说明（基于GPL）

本项目遵循 GNU 通用公共许可证（GNU General Public License, 简称 GPL）发布，并附加以下说明：

1. 你可以自由地使用、复制、修改和分发本项目的源代码，前提是你必须保留原作者的信息及本协议内容；
2. 修改后的版本也必须以相同协议开源；
3. **未经原作者明确授权，不得将本项目或其任何部分用于商业用途。**

商业用途包括但不限于：
- 将本项目嵌入到出售的软件、系统或服务中；
- 通过本项目直接或间接获利（例如通过广告、SaaS服务等）；
- 在公司或组织内部作为商业工具使用。

如需获得商业授权，请联系原作者：[admin@eooce.com]

版权所有 ©2025 `eooce`
