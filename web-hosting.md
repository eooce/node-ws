## Web Hosting 部署指南（适用于所有带nodejs App功能DirectAdmin面板）

## 部署流程

**1：登录DirectAdmin面板，设置域名，如果已经设置为自己的子域名可以忽略这一步,点击`Account Manager`——`Domain Step`——`RENAME DOMAIN`——选择旧域名，输入一个新的子域名SAVE保存，参考如图：**
![image](https://github.com/user-attachments/assets/823bbe4a-5343-4322-9c1b-a1f80c97f9ed)

![image](https://github.com/user-attachments/assets/e400548f-225f-4716-8973-35ee8aa68986)


**2：设置好域名后，查看域名需要解析到的IP，点击DNS Management查看，打开cloudflared，找到上一步添加的子域名所属的主域名添加A记录，并打开小黄云**
![image](https://github.com/user-attachments/assets/be3a1c29-50b2-41f7-af76-07c170cafc7d)

![image](https://github.com/user-attachments/assets/4862226b-a053-458c-a842-7da80da14a66)


**3：解析完之后回到面板，找到File Manager进入，打开 `domains/你的域名/public_html` 目录，鼠标右键选择Upload Files 上传此项目里的`index.js`和`package.json`**
![image](https://github.com/user-attachments/assets/fdeaa875-739d-42e9-b6fc-e50005446a1f)


**4：设置index.js权限为777，并修改index.js里的必要环境变量，DOMAIN为必填，AUTO_ACCESS可设置为true开启自动保活，其他哪吒等参数可选**
![image](https://github.com/user-attachments/assets/5b2cd552-9dc4-4537-a899-967472d83ef2)

![image](https://github.com/user-attachments/assets/4096918b-46e2-4745-b525-55e5c12d6773)


**5：复制地址栏的路径（不要带第一个斜杠）格式：`domains/你的域名/public_html` 再点击左上角的图标回到面板首页**

**6：找到Setup Nodejs APP，点击进去，接着点击 CREATE APPLICATION,选择`推荐的nodejs版本`以及`Production`
Application root为上一步复制的路径，Application URL留空，Application startup file为 `index.js` 点击右上角的CREATE**
![image](https://github.com/user-attachments/assets/6df13972-a213-4bd5-a055-821fcd34e340)


**7：创建完后如下图成功所示后，点击RUN NPM install 按钮 等待30秒**
![image](https://github.com/user-attachments/assets/c094064e-6433-49a8-bd15-43c060d6752e)

![image](https://github.com/user-attachments/assets/623d3888-e96c-498d-ac9a-84cacca4fea0)


**8：返回创建Nodejs App首页，点击重启，然后即可访问 域名/${SUB_PATH} 获取节点, 如果没有修改${SUB_PATH}变量，则默认订阅连接为 https://域名/sub**
![image](https://github.com/user-attachments/assets/3aac69a1-3ec3-4909-872f-fd4e1032012e)

