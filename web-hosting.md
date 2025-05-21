## 点击查看`Web Hosting 部署指南`（适用于所有带nodejs App功能DirectAdmin面板）

## 部署流程

**1：登录DirectAdmin面板，设置域名，如果已经设置为自己的子域名可以忽略这一步,点击`Account Manager`——`Domain Step`——`RENAME DOMAIN`——选择旧域名，输入一个新的子域名SAVE保存，参考如图：**
![image](https://github.com/user-attachments/assets/01489234-9d9c-4f7e-bb74-13e628232b1e)
![image](https://github.com/user-attachments/assets/a665ec91-3ed3-4735-b6cd-16f1dbea9a4f)

**2：设置好域名后，查看域名需要解析到的IP，点击DNS Management查看，打开cloudflared，找到上一步添加的子域名所属的主域名添加A记录，并打开小黄云**
![image](https://github.com/user-attachments/assets/2ac30790-cdcf-4df9-8dbb-13f0a2eb6e17)
![image](https://github.com/user-attachments/assets/b70cfdfd-4280-4363-8d46-88ebe41e7b13)

**3：解析完之后回到面板，找到File Manager进入，打开 `domains/你的域名/public_html` 目录，鼠标右键选择Upload Files 上传此项目里的`index.js`和`package.json`**
![image](https://github.com/user-attachments/assets/1eb7692c-a208-4d42-b6bb-20048e8b9679)

**4：设置index.js权限为777，并修改index.js里的必要环境变量，DOMAIN为必填，AUTO_ACCESS可设置为true开启自动保活，其他哪吒等参数可选**
![image](https://github.com/user-attachments/assets/97a2b3b6-7288-48d0-88f4-7485f065a339)
![image](https://github.com/user-attachments/assets/1d565230-848e-430b-ad85-f9f007d4992f)

**5：复制地址栏的路径（不要带第一个斜杠）格式：`domains/你的域名/public_html` 再点击左上角的图标回到面板首页**

**6：找到Setup Nodejs APP，点击进去，接着点击 CREATE APPLICATION,选择`推荐的nodejs版本`以及`Production`
Application root为上一步复制的路径，Application URL留空，Application startup file为 `index.js` 点击右上角的CREATE**
![image](https://github.com/user-attachments/assets/6e491e76-fab0-499e-9d5e-d93b8451c3d9)

**7：创建完后如下图成功所示后，点击RUN NPM install 按钮 等待30秒**
![image](https://github.com/user-attachments/assets/48879804-6a98-4e27-87bf-e4c248b85649)
![image](https://github.com/user-attachments/assets/57f96ac8-ccad-43e5-bb01-ade95b35a47d)

**8：返回创建Nodejs App首页，点击重启，然后即可访问 域名/${SUB_PATH} 获取节点, 如果没有修改${SUB_PATH}变量，则默认订阅连接为 https://域名/sub**
![image](https://github.com/user-attachments/assets/758c990b-bb0b-4c21-bd6f-4a8a3333bb35)
