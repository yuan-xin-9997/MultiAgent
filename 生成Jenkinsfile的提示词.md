# Jenkins Prompt

本文档用来指示将本项目配置到Jenkins中。

## 环境信息

Jenkins运行的Linux服务器信息：

IP=192.168.0.111  
User=yuanxin  
Password=yuanxin

Jenkins地址信息：

[http://192.168.0.111:8080/login](http://192.168.0.111:8080/login?from=%2F)

或https://jenkins.yuan-xin.top/（如果上面这个地址访问不了，尝试这个）

用户名：admin

密码：admin

## 需求

创建Jenkinsfile，存放在本项目的JenkinsConfig 目录下，Jenkinsfile应该以下关键部分：

1. 将当前运行的服务停止
2. 从本项目的Github拉取提交，更新到部署路径
3. 启动服务

连接到Jenkins创建一个流水线任务：

1. 触发器：每 30 分钟检查Github上本项目是否有提交，如果有提交，触发Jenkinsfile中定义的停服、更新、启动服务的步骤
2. 流水线脚本定义为“Pipeline script from SCM"，脚本路径是本项目在Github中的JenkinsConfig/Jenkinsfile
3. 配置的远程仓库地址要用SSH形式，不要用HTTPS形式
4. Credentials用已有的，如果没有的话请自行配置

注意：

1. 本项目在Linux服务器部署路径是/opt/
