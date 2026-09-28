# ADR-0005：任务附件用文件插件 + Drive，鉴权由 NocoProject 守卫补上

- 状态：已接受（2026-09-28，NP-78）
- 关联：`docs/phase1/protocol-iteration-4.md` §8

## 背景

任务需要附件的上传与查看。本阶段存本地磁盘，下一阶段迁到 OSS。应用已注册 `@nocobase/app-plugin-file`（上传、元数据、内容地址）和 Drive（`server/config/drive.ts`：`local` fs 盘、`s3` 盘），并预装了上传 / 预览组件（`client/extensions/nocobase-file-component-ui/`）。插件生成的路由按设计是公开的，没有认证和行级权限。

## 决定

1. 不自己写上传与存储：`npFiles` 按插件的固定列建表，上传与内容读取用 `defineFileRepositoryApiRoutes` 生成的路由（`server/routes/np-files.ts`），只开放 `uploadOne`。
2. 鉴权在插件路由之前、只挂在它拥有的路径上：所有路由贡献按顺序挂在同一个 router 上，所以先挂的守卫贡献会先执行（上传：与浏览器 API 同一守卫；内容：会话 + `AttachmentService.canRead`，看不到一律 404）。不用 `use('*')`。
3. 业务关系（挂到任务、列表、移除、清理孤儿）在 `server/modules/attachment/`，走 NocoProject 自己的 `/np/issues/:id/attachments` 接口和 `shared/authz.ts` 规则。插件的 `deleteOne` 只删元数据，所以物理删除由服务通过 Drive 做。
4. 存储抽象就是 Drive disk：新上传进 `nocoproject.attachmentDisk`，每行记住自己的 disk/key。迁 OSS = 配 `s3` disk（OSS 兼容 S3）+ 改配置 + 一次性脚本把旧对象复制过去并更新 `disk` 列；`contentUrl` 不变。

## 理由

- 复用插件的 multipart 解析、大小限制、元数据规范化、预览组件，避免第二套实现；插件升级带来的能力（Range、签名 URL）可以直接用上。
- 守卫放在 NocoProject 一侧，权限规则只有一处（`shared/authz.ts`）。

## 后果

- 依赖插件（beta）的路由形状与"贡献共享一个 router、按顺序执行"的挂载方式；`tests/logic/np-attachments-app.test.ts` 用整个应用覆盖匿名 / 运行令牌 / 无权 / 有权四种访问，插件升级后先跑它。
- 流式下载经过应用进程；迁到 OSS 后可评估 `accessMode: 'redirect'`（签名 URL），届时要确认守卫仍在跳转之前执行。
- 上传与挂载是两次提交：放弃的表单会留下未挂任务的文件，由 sweeper 24 小时后清理。
