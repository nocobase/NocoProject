# 邮箱邀请（NP-88）

负责人确认的规则（NP-88 评论）：通过邀请链接邀请，一次可以输入多个邮箱；真实发送邮件（Brevo SMTP，NP-89）；可以多选项目，按 member 加入；owner/admin 可邀请进任意项目，项目负责人只能邀请进自己负责的项目；已有账号的邮箱不发邀请，直接加入所选项目。

## 规则

| 场景                     | 行为                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 谁能邀请                 | owner/admin：任意项目，也可以不选项目；项目负责人：至少选一个项目，且每个都是自己负责的；其他人 403                                              |
| 一次多个邮箱             | 最多 50 个，去空格、转小写、去重；任何一个格式不对整个请求 400 `INVALID_EMAIL`                                                                   |
| 邮箱已有账号             | 不发邀请，直接加入所选项目（已是成员的保持原角色）：`added`；没有新加入的项目：`alreadyMember`                                                   |
| 同一邮箱已有待接受的邀请 | 合并项目、换新链接、重新计 7 天并重新发信，旧链接失效：`invited`                                                                                 |
| 链接                     | `<publicOrigin 或请求 origin><publicBasePath>/invite/<token>`；token 32 字节随机数，库里只存 SHA-256                                             |
| 有效期                   | 7 天；过期的邀请仍在列表里（状态"已过期"），可以"重新发送"                                                                                       |
| 发信                     | 行提交后通过通知插件的 `np-email` SMTP 通道发出；失败时响应里返回一次 `inviteUrl` 供手动转发，行记 `sendError`                                   |
| 接受                     | 公开接口，校验 token；同一事务里建账号（认证插件的用户管理服务，`forConnection` 绑定事务）、写 `members`（member）、加入仍存在的项目；只能用一次 |
| 接受时邮箱已被注册       | 不建账号，只加入项目，返回 `existingAccount: true`，页面提示用原密码登录                                                                         |
| 撤销                     | owner/admin 或邀请人；撤销后链接 409 `INVITATION_REVOKED`                                                                                        |

## 接口

浏览器（会话守卫，`/api/np/invitations`）：

- `GET /np/invitations`：待接受与已过期的邀请；owner/admin 看全部，其他人只看自己发的。
- `POST /np/invitations` `{ emails: string[], projectIds?: string[] }` → 201 `{ data: { results: InvitationResult[] } }`，每个邮箱一条：`{ email, outcome: 'invited' | 'added' | 'alreadyMember', emailSent?, inviteUrl? }`。
- `POST /np/invitations/:id/resend` → `InvitationResult`（换新链接）。
- `DELETE /np/invitations/:id` → 204。

公开（`server/routes/np-invitations.ts`，只拒绝 run token；token 放在 body 里，不进请求日志）：

- `POST /np/public/invitations/lookup` `{ token }` → `{ email, inviterName, projectNames, expiresAt }`。
- `POST /np/public/invitations/accept` `{ token, name, password }` → `{ email, existingAccount }`。密码 8–128 位（认证插件的默认规则）。

错误码：404 `NOT_FOUND`（token 不对）；409 `INVITATION_EXPIRED` / `INVITATION_ACCEPTED` / `INVITATION_REVOKED` / `INVITATION_CLOSED`（重发或撤销非待接受的邀请）/ `ACCOUNT_CONFLICT`；400 `INVALID_EMAILS` / `INVALID_EMAIL` / `TOO_MANY_EMAILS` / `INVALID_PROJECT` / `INVALID_NAME` / `INVALID_PASSWORD`；403 `FORBIDDEN`。

类型在 `server/modules/shared/protocol.invitations-server.ts`（CLI 不复制），浏览器副本 `client/pages/np/types-invitations.ts`。

## 数据

迁移 `2026100500001_np_invitations`：表 `npInvitations`（`email`、`tokenHash` 唯一、`projectIds` JSON、`status` pending | accepted | revoked、`invitedById`、`expiresAt`、`sentAt`、`sendError`、`acceptedUserId`、`acceptedAt`），索引 `(email, status)`。

## 邮件配置（Brevo SMTP）

`server/config/notification.ts` 定义通道 `np-email`（provider `smtp`，默认 `smtp-relay.brevo.com:587`、STARTTLS），默认关闭，因为通知插件在启用的通道配置不完整时拒绝启动。部署时设置：

| 环境变量                                      | 值                                                              |
| --------------------------------------------- | --------------------------------------------------------------- |
| `NOCOPROJECT_SMTP_ENABLED`                    | `true`                                                          |
| `NOCOPROJECT_SMTP_USER`                       | Brevo 的 SMTP 登录名（SMTP & API → SMTP 页面上的 Login）        |
| `NOCOPROJECT_SMTP_PASSWORD`                   | Brevo 的 SMTP key（不是 API key）                               |
| `NOCOPROJECT_SMTP_FROM`                       | 在 Brevo 验证过的发件人，如 `NocoProject <noreply@nocobase.cn>` |
| `NOCOPROJECT_SMTP_HOST` / `_PORT` / `_SECURE` | 可选，换别的 SMTP 服务时用                                      |

没配置时邀请照常创建，结果里显示"邮件未发出"和链接。队列是 `sync`，发信在请求内完成，一次邀请很多人时请求会慢一些；每封信的投递记录在通知插件的日志里。

## 界面

- 设置 → 成员：owner/admin 与项目负责人看到"邀请成员"。对话框：邮箱（多行、逗号或空格分隔）、加入的项目（多选，负责人只列自己负责的项目且必选）；提交后逐个邮箱显示结果，发信失败的给出链接和复制按钮。
- 成员表下方"待接受的邀请"：邮箱、项目、状态（等待接受 / 邮件未发出 / 已过期）、邀请人、有效期，操作"重新发送""撤销"（确认框）。没有待接受的邀请时不显示。
- `/invite/:token`（`auth: 'optional'`）：认证页布局，显示邀请人和项目，填姓名和密码后建账号并自动登录进入首页；已登录的访问者先提示退出；无效、过期、已使用、已撤销分别提示。

## 没做的

- 邀请被接受后通知邀请人（收件箱）。
- 按项目角色（lead）邀请；负责人以后在项目里再改。
- 发信的异步重试与投递状态回写（`sentAt` 表示已提交给 SMTP 且未报失败）。
