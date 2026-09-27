# NocoBase 3 应用前端交互最佳实践

适用于在 NocoBase 3 上构建的任何应用（业务系统、Solution、内部工具）的前端页面：信息架构、页面框架、密度与主题、颜色、表格、看板、表单与弹窗、状态、文案、动效、键盘、多语言、可访问性与验收。

**优先级**：用户或产品自己的设计规范优先于本文；本文优先于个人习惯。本文与应用模板自带的 `.agents/skills/nocobase-app-development/references/frontend/ui-guidelines.md`（规则编号 F / L / T / I / R / S / C / A）一致，并在其上细化；那份文档已写清的规则这里只点到为止。

组件名均为 NocoBase 3 应用模板里的真实组件（`client/components/`）。标注"应用自建"的组件由各应用按本文约定实现一次、全应用共用，括号里给出 NocoProject 的实现作参照。

## 目录

1. [总原则](#1-总原则)
2. [信息架构与导航](#2-信息架构与导航)
3. [页面框架与滚动](#3-页面框架与滚动)
4. [密度与主题预设](#4-密度与主题预设)
5. [颜色与标签](#5-颜色与标签)
6. [字体、排版与标识符](#6-字体排版与标识符)
7. [表格](#7-表格)
8. [看板](#8-看板)
9. [表单、弹窗与反馈](#9-表单弹窗与反馈)
10. [加载、空、失败](#10-加载空失败)
11. [文案](#11-文案)
12. [动效](#12-动效)
13. [键盘](#13-键盘)
14. [多语言](#14-多语言)
15. [可访问性](#15-可访问性)
16. [验收清单](#16-验收清单)

## 1. 总原则

1. **安静的底，活的信号。** 界面主体是中性灰阶；颜色只留给主要动作、正在发生的事、需要用户处理的事和语义标签。
2. **一个框架走到底。** 同一种页头、卡片、表格、标签、空状态；改共享组件让所有页面一起变，不在单页里另做一版。
3. **密度来自预设，不来自页面。** 页面只用间距刻度和组件尺寸变体，预设决定最终尺寸。
4. **状态可寻址。** 选中的标签页、打开的弹窗与抽屉、筛选条件都在 URL 里，刷新和前进后退都能还原。
5. **文字陈述事实与动作，不解释界面。**
6. **动效只解释变化。**

## 2. 信息架构与导航

### 2.1 侧边栏

- **平铺分区，分组永不折叠。** 没有自己页面的顶层分组渲染为一行小号分组标签，入口始终列在下面：

  ```tsx
  // 分组标签：没有 componentLoader、有 children 的顶层路由
  <div className='px-3 pt-1 pb-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase'>
    {label}
  </div>
  ```

  分区之间 `gap-5`，入口之间 `gap-1`。侧栏折叠为图标模式时分组标签变为一条 `bg-sidebar-border` 细线。参照 NocoProject 的 `client/layouts/components/navigation-sections.tsx`；设置区与开发区仍用模板的可折叠树。

- **入口沿用模板行尺寸**（`px-3 py-2 gap-3`，图标 16px），不另行压缩。未选中图标 `text-muted-foreground`；选中项底色 `bg-sidebar-primary`、文字加粗、图标变主色。
- **顺序按使用频率**：个人入口（收件箱、我的…）在最上，业务分区居中，报表与设置在最下。
- 菜单名即页面标题，用名词（"客户"），不用动词短语。
- 详情、标签页内容、弹窗等路由没有 `navigation`；打开时菜单高亮最近的有入口的祖先。

### 2.2 角标

- 一个入口最多一个计数角标，只数**需要当前用户处理**的项，不数"有更新"。
- 角标是 `attention` 色的计数胶囊（见 §5.4），位于行右端；超过 99 显示 `99+`；侧栏折叠时移到图标右上角。
- 角标同时给屏幕阅读器一句完整文本（"收件箱，7 项待处理"）。
- 计数为 0 时不渲染角标。

### 2.3 设置放哪里

| 放在产品侧（应用路由，侧栏最后一项"设置"）                                         | 放在系统外壳（`defineSettingsRoutes()`，顶栏齿轮进入）                        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 业务管理员日常要改的：成员与角色分工、流程或阶段模板、标签、阈值、集成连接、价格表 | 平台管理员才改的：用户、认证方式、权限集、API Key、插件、系统级存储与通知通道 |
| 用业务术语、按业务主题分标签页                                                     | 按平台能力组织                                                                |

产品侧设置页是普通页面：`PageContainer` + `PageHeader` + 子路由标签页（§3.3），每个主题一张卡片，各自保存（模板 T4）。

## 3. 页面框架与滚动

### 3.1 顶层页面

```tsx
<PageContainer>
  <PageHeader
    title={t('orders.title')} // 与菜单名一致
    description={t('orders.description')} // 一句话，陈述事实
    actions={
      <>
        <Button variant='outline'>{t('orders.import')}</Button>
        <Button
          nativeButton={false}
          render={<Link to={{ pathname: 'new', search: location.search }} />}
        >
          <PlusIcon data-icon='inline-start' />
          {t('orders.create')}
        </Button>
      </>
    }
  />
  {/* 页内标签 → 工具栏 → 内容 */}
  <Outlet />
</PageContainer>
```

- `PageContainer` 提供 `p-6 md:p-8` 与区块间 `space-y-6`，**不限宽**：页面级不写 `max-w-*`、`mx-auto`。
- 只有表单与阅读型内容限宽：表单 `FieldGroup className='max-w-2xl'`，弹窗由组件自带宽度。
- `PageHeader`：标题 `text-2xl font-semibold tracking-tight`，说明 `text-sm text-muted-foreground`；动作右侧垂直居中，一页最多一个实心主按钮且放在最右。
- 每页一个 `PageContainer`：内联子路由和标签页内容用父页面的；覆盖式子页面（`RouteChildPage`）自带一个；弹窗和抽屉不加。

### 3.2 一个滚动容器

- **一页只有一个滚动容器。** 页面或覆盖页整体滚动，内部各栏不单独滚动。
- 例外只有三种，且各自有明确边界：主从布局的列表与详情（§3.5）、占满视口的表格与看板（§7.1、§8）、弹窗与抽屉的内容区（组件自带）。
- 需要常驻的元素用 `sticky`，不用第二个滚动区：详情页的输入框 `sticky bottom-0`，表头 `sticky top-0`，动作条 `sticky top-0`。

### 3.3 页内标签

- 页面级标签是子路由：选中项从 URL 推导，打开父路径时 `replace` 重定向到默认标签（模板 `child-routes.md` §4）。
- 覆盖式详情页的分区用 `?tab=`，因为详情页的子路由留给它的弹窗。两种标签外观相同：下划线，选中为主色。
- 标签带计数时用 `tabular-nums` 的弱化数字，不用彩色角标。

### 3.4 记录详情：三栏

```
┌ 侧栏 ┬ 主栏 flex-1 min-w-0 ───────────────────────┬ 右栏 20rem ──────┐
│      │ 面包屑                                     │ ┌ 属性 ────────┐ │
│      │ 标题 text-2xl                            ✎ │ └──────────────┘ │
│      │ 元信息一行：编号 · 状态 · 所属 · 进行中    │ ┌ 记录 ────────┐ │
│      │ 区块卡片（space-y-6）                      │ └──────────────┘ │
│      │ 活动                                       │                  │
│      │ ─────────────── 输入框 sticky bottom-0 ─── │   （sticky）     │
└──────┴────────────────────────────────────────────┴──────────────────┘
```

- 记录有多个区块、子表或标签页时用覆盖式 `RouteChildPage`；字段少（约 15 个以内）且无子表时用 `RouteDrawer`（模板 T2.1）。
- 主栏 `flex-1 min-w-0`；右栏固定 `lg:w-[20rem] lg:shrink-0`（用 rem 写死并注释原因，见 §4.3），底色 `bg-muted/30`，里面是一摞小卡片；`lg` 以下两栏折成一栏，右栏排到主栏下方。
- **右栏吸顶**：右栏内容容器在 `lg` 及以上 `sticky top-0`，随页面滚动时停在页头下方；右栏内容高于视口时取消 sticky，随页面一起滚动。右栏永远不单独出现滚动条。右栏背景铺满整页高度，吸顶时背景连贯。
- 主栏顺序固定：`Breadcrumbs` → 记录标题 → 一行元信息 → 区块卡片 → 活动。区块卡片 `rounded-lg border bg-card p-4`，块标题 `text-sm font-semibold` + 计数 + 右侧动作。
- **空区块不占地方**：没有描述时是一行灰字加"编辑"；可选关联（依赖、附件、PR）为空时不渲染，由描述下方的"添加"小按钮唤出。

### 3.5 主从布局

- 列表固定宽度（如 `w-[26rem]`，注释原因），详情取剩余宽度；两栏在占满视口的容器里**各自滚动**。
- 选中项写进 URL（`?item=`），刷新后仍选中同一项。
- 详情顶部是 `sticky top-0` 的动作条：标题、一句事实、动作按钮。
- 窄屏先显示列表，点开后进入详情，详情左上角"返回"。

### 3.6 占满视口的页面

列表页、看板页的内容区占满页头与工具栏以下的剩余高度，页面本身不滚动：

```tsx
<PageContainer className='flex h-full min-h-0 flex-col gap-6 space-y-0'>
  <PageHeader … />
  <Toolbar … />
  <DataTable fillHeight … />   {/* 或 <Board fill /> */}
</PageContainer>
```

## 4. 密度与主题预设

### 4.1 预设

NocoBase 3 模板有两个预设，只在密度上不同：

| 预设      | 标签                   | `--spacing` | `--radius` | 行高           |
| --------- | ---------------------- | ----------- | ---------- | -------------- |
| `compact` | 紧凑（默认，也是回退） | `0.2rem`    | `0.375rem` | 比 Tailwind 紧 |
| `default` | 宽松                   | `0.25rem`   | `0.5rem`   | Tailwind 默认  |

**compact 是默认预设，页面必须首先在 compact 下好看。** compact 下所有 `p-*`、`gap-*`、`h-*`、`w-*`、`size-*` 都是 default 下的 80%：`h-8` 在 compact 是 1.6rem，在 default 是 2rem。按 default 预设挑选的偏紧数值，到 compact 下会挤在一起。

### 4.2 怎么定尺寸

1. **永远不在页面或组件里覆盖预设令牌**（`--spacing`、`--radius`、`--text-*`、颜色），不为某一页单独设密度，不改根字号模拟密度。
2. **用间距刻度和组件尺寸变体，不手挑紧凑值**：

   | 元素     | 用                                                                    |
   | -------- | --------------------------------------------------------------------- |
   | 按钮     | `default`；工具栏、行内用 `sm`；图标按钮 `icon`，行内密集处 `icon-sm` |
   | 导航行   | 模板的导航行尺寸                                                      |
   | 表格行   | `DataTable` 默认行高                                                  |
   | 卡片     | 区块卡 `p-4` / `p-5`，紧凑列表项 `p-3`                                |
   | 区块间距 | `space-y-6`（`PageContainer` 已提供）；相关控件 `gap-2`               |
   | 表单字段 | `FieldGroup` 默认间距                                                 |

3. **点击目标**：独立点击目标以 default 预设计不小于 32px，即不小于 `h-8` / `size-8`（按钮 `default` 与 `icon`）。`sm`、`icon-sm` 只用于有行或卡片承托的密集位置；`xs`、`icon-xs` 不用于主要操作。
4. 以参考页为密度基准：写之前先看 `client/pages/reference/examples/` 里同类区块用的尺寸（它们按 compact 设计）。

### 4.3 固定尺寸的例外

布局性宽度不能随密度缩小，用 rem 写死并在代码里注明原因：

```tsx
{
  /* 20rem on purpose: w-80 would shrink under the compact preset */
}
<aside className='lg:w-[20rem] lg:shrink-0'>…</aside>;
```

常用值：详情右栏 `20rem`、主从列表 `26rem`、看板列 `18rem`。颜色、字号、普通间距不适用这条例外（模板 F7）。

### 4.4 字号

| 角色                               | 类                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------- |
| 页面标题、记录标题                 | `text-2xl font-semibold tracking-tight`                                |
| 区块标题                           | `text-sm font-semibold`（卡片内）/ `text-base font-medium`（独立分区） |
| 正文、表格、表单、卡片说明         | `text-sm`                                                              |
| 说明、元信息（时间、计数、编号行） | `text-xs text-muted-foreground`                                        |
| 分组标签                           | `text-xs font-medium tracking-wider text-muted-foreground uppercase`   |
| 标签胶囊                           | 13px 的应用工具类（如 `badge-text`，定义在应用样式表里）               |

正文一律 `text-sm`；`text-xs` 只给说明和元信息，不给正文。不写 `text-[13px]` 这类任意值，需要的中间字号定义成一个 `@utility`。

### 4.5 两个预设、两种模式都要验

每次改动都在 compact · 浅色、compact · 深色、default · 浅色、default · 深色下看一遍，至少截 compact · 深色与 default · 浅色两张。检查项：文字不被截断、按钮不挤、固定宽度的栏不被压窄、深色下分层清楚。

## 5. 颜色与标签

### 5.1 只用语义令牌

- 中性色、主色、图表色来自主题预设（`client/theme/themes/*.css`）：`bg-background`、`bg-card`、`bg-muted`、`text-foreground`、`text-muted-foreground`、`border-border`、`bg-primary`、`text-destructive`、`var(--chart-N)`。
- 不写 `bg-white`、`text-gray-500`、`#1677ff`、`rgb(…)`；不写 `dark:` 前缀，令牌自带浅深两套。
- 分层靠明度，不靠阴影：卡片比底色亮一档，弹层再亮一档；阴影只在拖拽和浮层上出现。
- 修改预设颜色在预设文件里改，两个预设、浅深两条规则同步改；不在页面里覆盖。

### 5.2 强调色的用途

主色（`--primary`）只用于：主要动作按钮、焦点环、选中的导航项与标签页、**正在发生的事**（运行中、实时进度）。不用于装饰、标题、普通链接之外的文字、图标堆。

### 5.3 标签：淡色胶囊

所有状态、优先级、类型、角色标记都用**同一个标签组件**（应用自建，NocoProject 为 `NpTag`）：

- 圆角胶囊 `rounded-full px-2.5 py-0.5`，13px `font-medium`；
- 底色是该色相的低饱和淡色，文字是**同色相的深色**；深色模式下底色为半透明的暗淡色、文字提亮，不发光；
- 状态类标签带一个同色小圆点（`bg-current`）；
- **不用实心填充，不用"中性胶囊 + 彩色小圆点"，不在这些位置用 shadcn `Badge`。**

```tsx
<NpTag tone='blue' dot>{t('status.inProgress')}</NpTag>
<NpTag tone='red' icon={<AlertTriangleIcon />}>{t('priority.urgent')}</NpTag>
```

**一张颜色表，按语义取色**：色相集合固定（如 grey、blue、violet、amber、green、slate、red、orange），组件只接受 `tone`，由一个 `Record<Tone, string>` 映射到类名（NocoProject 的 `NP_TONE_CLASS`）。业务值到色相的映射写成函数（如 `statusTone(status)`），按**生命周期语义**而不是用户配置的颜色名取色，所以自定义状态也落在正确的色相上：

| 语义            | 色相   |
| --------------- | ------ |
| 未开始          | grey   |
| 进行中          | blue   |
| 待验收 / 待审核 | violet |
| 受阻 / 需要注意 | amber  |
| 已完成 / 成功   | green  |
| 已取消 / 已关闭 | slate  |
| 失败 / 紧急     | red    |
| 高              | orange |

看板列头、分布条等只需要颜色点的地方，用同一色相的深色（`NP_TONE_DOT_CLASS`）。

### 5.4 应用自己的语义色

预设令牌不够时，在单独的样式表里定义应用语义色，两个预设、两种模式共享：

```css
/* client/<app>-tones.css，由 client/styles.css 导入 */
:root {
  --attention: oklch(0.75 0.16 70); /* 需要你 */
  --attention-foreground: oklch(0.28 0.07 60);
  --success: oklch(0.6 0.15 155);
  --np-tint-blue: oklch(0.95 0.035 245); /* 标签淡底 */
  --np-ink-blue: oklch(0.5 0.15 250); /* 标签深字 */
}
:root.dark {
  --attention: oklch(0.8 0.15 75);
  --np-tint-blue: oklch(0.65 0.13 250 / 0.2);
  --np-ink-blue: oklch(0.8 0.1 250);
}
```

```css
/* client/styles.css */
@theme inline {
  --color-attention: var(--attention);
  --color-np-tint-blue: var(--np-tint-blue);
  --color-np-ink-blue: var(--np-ink-blue);
}
```

- 变量名带应用前缀（NocoProject 用 `np-`），不写进主题预设文件，不加进预设令牌契约。
- 每个语义色只有一个用途，写在样式表头部注释里。
- 淡底与深字的对比度达到 WCAG AA，浅深两套都要测。

## 6. 字体、排版与标识符

- 字体用预设的系统字体栈（含苹方、微软雅黑）；标题用 `font-heading`。
- **标识符等宽**：编号、slug、版本、分支、提交号 `font-mono text-xs`，辅助位置再加 `text-muted-foreground`。
- **数字用 `tabular-nums`**；金额、数量右对齐，带千分位；用 `Intl.NumberFormat` 绑定当前语言。
- 日期按当前语言格式化（`date-fns` + `useLocale()`）；相对时间（"2 小时前"）悬停显示完整时间（`<time dateTime title>`）。
- **标题用句子式**：只有首字母大写（英文），不加句号；中文标题不加标点。
- **空值显示灰色 "—"**，屏幕阅读器仍读出含义：

  ```tsx
  <span className='text-muted-foreground'>
    <span aria-hidden='true'>—</span>
    <span className='sr-only'>{t('common.noOwner')}</span>
  </span>
  ```

  不写"无负责人""未指派"这类字样；可编辑控件的下拉列表里保留"无"选项名。

## 7. 表格

### 7.1 框架

- 列表用 `DataTable`；外框 `rounded-lg border bg-card`，表头 `bg-muted/40 text-muted-foreground`，行高用默认值，可点击行悬停 `bg-muted/50`。
- **表头吸顶在有界滚动区内**：表格放在有界高度里（`fillHeight`），滚动发生在表格框内，表头 `sticky top-0`，"加载更多"固定在表格下方。
- 工具栏在表格上方：左侧搜索、筛选、视图切换，右侧次要动作；主按钮在页头。搜索框 placeholder 写明搜索哪些字段。

### 7.2 列宽

列宽写在列定义的 `meta.className` 上，由 `DataTable` 同时应用到表头和单元格：

```tsx
const columns: ColumnDef<Order>[] = [
  { accessorKey: 'number', meta: { className: 'w-28' },
    cell: ({ row }) => <span className='font-mono text-xs'>{row.original.number}</span> },
  { accessorKey: 'title', meta: { className: 'w-full max-w-0' },
    header: ({ column }) => <DataTableColumnHeader column={column} title={t('orders.columns.title')} />,
    cell: ({ row }) => (
      <span className='block max-w-[30rem] truncate' title={row.original.title}>{row.original.title}</span>
    ) },
  { accessorKey: 'status', meta: { className: 'w-32' },
    cell: ({ row }) => <NpTag tone={statusTone(row.original.status)} dot>{…}</NpTag> },
  { accessorKey: 'owner', meta: { className: 'w-40' }, … },
  { accessorKey: 'updatedAt', meta: { className: 'w-32' }, … },
];
```

- 标题列取剩余宽度但可收缩（`w-full max-w-0`），内容单行截断、最长 `30rem`、悬停 `title` 显示全文。一个长标题永远撑不开表格。
- 编号、状态、优先级、人、日期列给固定宽度。
- 第一列是记录的名称或编号，点击打开详情。
- 空值 "—"（§6）。

### 7.3 排序与列

- 可排序的表头用 `DataTableColumnHeader`：点击即排序，升序 → 降序 → 取消循环，图标反映当前状态；表头上没有下拉菜单。
- 列的显示与隐藏放在工具栏右侧的 `DataTableViewOptions`。
- 默认按最近更新时间倒序。

### 7.4 分页与长列表

| 数据来源             | 做法                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| 客户端全量           | `DataTable` 分页，`pageSize={20}`                                                  |
| 服务端游标分页       | `pagination={false}`，表格下方"加载更多"（`useInfiniteQuery`，游标来自上一页响应） |
| 服务端有上限且无总数 | 达到上限时提示"只显示前 N 条，请用搜索或筛选缩小范围"（模板 T1.10）                |

- **虚拟化阈值**：表格超过 200 行、时间线或看板列超过 100 项时虚拟化（`react-virtuoso`），以最近的滚动祖先为滚动容器（NocoProject：`DataTable virtualizeAfter={200}`、`NpVirtualList`）。
- 查询键挂在实时推送会失效的那一族下（如 `keys.orders`），推送到达时整族失效。

### 7.5 共享表格能力放在共享组件里

`fillHeight`、`virtualizeAfter`、列 `meta.className` 是 `DataTable` 的能力（NocoProject 的 `client/components/data-table.tsx` 已实现）。应用缺少哪项就加到自己的共享 `DataTable` 里，不在单页里另写一个表格。

## 8. 看板

- **占满视口**（§3.6）：看板区占满剩余高度，列与列横向滚动，**每列各自纵向滚动**。
- 列宽固定 `18rem`（rem 写死），列底 `rounded-xl bg-muted/40`；列头 = 同色相深色圆点 + 状态名 + 计数。
- 卡片 `rounded-lg border bg-card p-3`：编号（等宽）与优先级在第一行；标题最多三行（`line-clamp-3`）；标签；底行是人与时间。悬停只变边框色，拖拽时才有 `shadow-md`，目标列底色加深。
- 拖拽即改状态：非法转换弹回并说明原因；会产生后果的转换（触发自动化、通知外部）先弹确认。乐观更新，失败回滚并 toast。
- 列内游标分页，列底"加载更多"；超过 100 张卡虚拟化。
- **列表 / 看板的选择按页面记住**：存 `localStorage`，键名带应用前缀和页面名（如 `nocoproject:issues-view:<page>`），每次读写包在 `try/catch` 里；URL 的 `?view=` 优先，切换时总是显式写入 URL。

```ts
function readView(page: string): 'board' | 'list' | null {
  try {
    const v = localStorage.getItem(`myapp:view:${page}`);
    return v === 'board' || v === 'list' ? v : null;
  } catch {
    return null;
  }
}
```

## 9. 表单、弹窗与反馈

### 9.1 容器

| 场景                               | 用                                      | 打开状态在 |
| ---------------------------------- | --------------------------------------- | ---------- |
| 新建、编辑（≤ 8 个字段）           | `RouteDialog`（子路由）                 | URL        |
| 记录详情（字段少）                 | `RouteDrawer`（子路由）                 | URL        |
| 长表单、多区块详情、批量录入       | `RouteChildPage` 或加宽的 `RouteDrawer` | URL        |
| 确认单个动作                       | `AlertDialog`                           | 组件状态   |
| 与记录无关的临时面板（帮助、说明） | `Sheet`                                 | 组件状态   |

- 表单、编辑器、详情类弹窗一律是子路由：链接可直接打开，刷新可还原，前进后退可开关；打开与关闭保留列表的查询参数。
- 关闭用 `useRouteOverlay().close()`，只在弹窗内部的组件里调用；不用 `navigate(-1)`。
- 提交中不可关闭：`beforeClose={() => !submittingRef.current}`；字段多的表单关闭前确认未保存的修改。
- 叠放：抽屉上可开对话框和确认框；对话框上只能开确认框；Esc 与点遮罩只关最上层。

### 9.2 表单

- 标签在输入框上方；必填字段标签后加 `*`，选填不标。
- 失焦校验单个字段，提交时校验全部；错误显示在字段下方，写明哪里错、怎么改；提交失败时焦点移到第一个出错字段。
- 按钮右对齐：取消在左，提交在右；提交按钮写具体动作（"创建""保存"），不写"确定""提交"。
- 提交中：提交按钮显示 `Spinner` 并禁用，取消也禁用。
- 编辑表单打开时先拉取最新数据再预填，不用列表里的旧数据。
- 成功后立即用返回数据更新当前视图，再刷新列表。

### 9.3 有后果先确认

- 删除、停用、清空、撤销权限、撤回批量操作，以及会通知外部或触发自动执行的动作，先弹 `AlertDialog`。
- 标题点名对象（`删除客户"张三"？`），说明写后果（"此操作不可撤销"，或"本批已执行过的记录会保留"），确认按钮写具体动作；破坏性动作用 `variant='destructive'`。

```tsx
<AlertDialogAction
  variant='destructive'
  disabled={deleting}
  onClick={confirmDelete}
>
  {deleting ? <Spinner data-icon='inline-start' /> : null}
  {t('actions.delete')}
</AlertDialogAction>
```

### 9.4 反馈

| 情况                   | 做法                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| 显式写操作成功         | toast 一句结果，含记录名：`toast.add({ type: 'success', title: t('orders.created', { name }) })` |
| 显式写操作失败         | 错误 toast，文案本地化；403、404、409 各有专门文案                                               |
| 就地编辑属性、表情回应 | 原地变化，只在失败时 toast                                                                       |
| 表单校验失败           | 字段下方行内错误，不 toast                                                                       |
| 弹窗内请求失败         | 错误显示在弹窗内，弹窗不关                                                                       |
| 页面数据加载失败       | 页内错误状态（§10）                                                                              |

- 每个写操作都有反馈，没有"点了没反应"。
- 不向用户显示原始后端错误（未翻译的异常、堆栈、SQL）。
- 乐观更新先改界面再发请求，失败回滚并 toast。
- 没有权限的动作不显示；暂时不可用的动作禁用并用 tooltip 说明原因。

## 10. 加载、空、失败

全应用共用一组状态组件（应用自建，NocoProject 为 `client/components/np-states.tsx`）：

| 状态     | 组件                                                       | 规则                                                                                      |
| -------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 首次加载 | `ListSkeleton` / `DetailSkeleton`                          | 骨架形状贴近内容（表格是行、看板是列、详情是标题加块）；`role='status'`，可访问名"加载中" |
| 重新加载 | 保留旧数据 + 轻量指示                                      | 搜索、刷新时不整块换成骨架                                                                |
| 空列表   | `Empty`（图标 + 标题 + 一句事实 + 可选创建按钮，虚线边框） | 页头已有同一主按钮时，空状态里的按钮用 `outline`                                          |
| 无结果   | 同一组件，不同文案                                         | 说明没有匹配项，给"清除筛选"                                                              |
| 空区块   | 不渲染                                                     | §3.4                                                                                      |
| 加载失败 | `LoadError`（`Alert variant='destructive'`）               | 本地化原因；可重试的给"重试"；403 不给重试；404 给"返回列表"                              |

```tsx
if (query.isPending) return <NpListSkeleton />;
if (query.isError)
  return (
    <NpLoadError
      title={t('orders.loadFailed')}
      error={query.error}
      onRetry={() => void query.refetch()}
    />
  );
if (rows.length === 0)
  return (
    <NpEmpty
      icon={<ReceiptIcon />}
      title={t('orders.empty')}
      description={t('orders.emptyFact')}
      action={createButton}
    />
  );
```

## 11. 文案

- **只写事实与动作，不解释界面。** 禁止"在这里可以…""下面是…""点击此处…""就在这里决定…"。
- **不写填充词**：不写"欢迎""轻松""一键搞定""智能地"；不加感叹号。
- 空状态一句写事实：可以写"Agent 开工前会读这里的约定"，不写"点击新建按钮创建第一条"。
- 页面说明一句话；toast 不超过 20 个汉字（不含记录名）。
- 页面级按钮"动词 + 对象"（"新建客户"）；记录上下文和弹窗里的按钮只写动词（"编辑""保存"）；弹窗标题与打开它的按钮同一动词。
- 提到具体记录时带上名称：中文用中文引号（已删除客户“张三”），英文用英文引号（Deleted customer "Zhang San"）。
- 同一概念全应用同一个词；维护一张术语表。
- 错误写"发生了什么 + 怎么办"，不责怪用户。

## 12. 动效

- 只用于解释变化：新出现的东西滑入，处理完的东西变淡，进行中的东西脉动，数值变化平滑过渡。
- 时长 150–300ms，`ease-out`；首屏已有的内容不做入场动画。
- **全部尊重"减少动态效果"**：Tailwind 用 `motion-reduce:animate-none` / `motion-reduce:transition-none`；自定义动画在 `@media (prefers-reduced-motion: reduce)` 里关掉，并用静态样式保留含义（如呼吸环变成静态描边）。

| 场景                 | 动效                                           |
| -------------------- | ---------------------------------------------- |
| 实时推送来的新项     | `animate-in fade-in slide-in-from-top-1` 200ms |
| 处理完成（乐观更新） | 降到 55% 不透明度 + 成功标记                   |
| 运行中               | 主色脉冲点；头像外圈 1.6s 呼吸环               |
| 进度                 | 描边 300ms 过渡                                |
| 拖拽                 | 抬起阴影 + 描边，目标区底色加深                |

## 13. 键盘

| 键                      | 作用                              | 范围         |
| ----------------------- | --------------------------------- | ------------ |
| `C`                     | 新建当前页面的主对象              | 全局         |
| `⌘K` / `Ctrl+K`         | 搜索并打开记录（`CommandDialog`） | 全局         |
| `⌘Enter` / `Ctrl+Enter` | 发送、保存当前编辑器              | 输入框内     |
| `j` / `k`               | 下一项 / 上一项                   | 列表、收件箱 |
| `e`                     | 归档当前项并移到下一项            | 收件箱类列表 |
| `Enter`                 | 打开当前项                        | 列表         |
| `Esc`                   | 关闭最上层弹窗                    | 弹窗         |

- 单字母快捷键在输入框、可编辑区域内、输入法组合中、弹窗打开时一律不响应。
- 全局快捷键由每个顶层页面挂一次的快捷键组件统一注册（NocoProject 为 `NpShortcuts`），不在多个组件里重复监听。
- 快捷键在界面上用 `Kbd` 提示（按钮内 `data-icon='inline-end'`，列表底部一行说明）。
- 所有动作都能只用键盘完成：弹窗打开焦点进入，Esc 关闭，Enter 提交。

## 14. 多语言

- 每一段用户可见文字都是翻译键，经 `useTranslation()`（`@nocobase/i18n/client`）读取，包括 `aria-label`、placeholder、toast、校验信息、空值的读屏文本。
- `client/locales/` 下 `en-US` 与 `zh-CN` 同时提供；新功能的一组键放在一个按功能命名的模块里。
- 用测试保证不缺键：遍历 `en-US` 的键，断言 `zh-CN` 都有且非空（NocoProject：`tests/logic/locale-coverage.test.ts`）。
- 避免依赖 i18next 复数后缀；数量用插值（`{{count}} 条草稿`）。
- 中英文分别检查排版：英文更长，按钮和列宽不能被撑破。

## 15. 可访问性

- 图标按钮有 `aria-label`；独立执行动作的图标按钮加 tooltip。
- 不只靠颜色传达信息：状态有文字，执行者类型有形状差异加读屏文本，错误有文字说明。
- 焦点样式可见且一致；删除行、关闭抽屉后焦点落到稳定位置（搜索框或页面标题）。
- 文本与背景对比度达到 WCAG AA；自定义语义色要实测。
- 选中的列表项用 `aria-current`；分组用 `role='group'` + `aria-labelledby`。
- 375px 宽度可用：工具栏换行、表格横向滚动、弹窗在屏内且底部按钮可达。
- 输入框支持中文输入法组合、逐字输入与中间编辑；输入中外部状态（URL、推送、自动刷新）不覆盖输入内容。
- 信息提示不用 alert 语义，alert 只给错误。

## 16. 验收清单

**静态与测试**

- [ ] `pnpm exec tsc -p tsconfig.json --noEmit` 通过（改了服务端再跑 `tsconfig.server.json`）
- [ ] `pnpm exec eslint --max-warnings 0 <files>` 与 `pnpm exec prettier --check <files>` 通过
- [ ] 关键行为有 jsdom 组件测试（`tests/components/`）：状态切换、提交、失败、空状态、快捷键
- [ ] 新页面的路由名加入 `tests/logic/client-routes.test.ts` 的授权列表
- [ ] 多语言覆盖测试通过

**截图**

- [ ] compact · 浅色、compact · 深色、default · 浅色、default · 深色各看一遍，至少保留 compact · 深色与 default · 浅色截图
- [ ] 375px 宽度截一张

**逐项核对**

- [ ] 页面框架：`PageContainer` + `PageHeader`，页面级不限宽，一页一个主按钮（§3.1）
- [ ] 一个滚动容器；sticky 元素正确；右栏吸顶且不单独滚动（§3.2、§3.4）
- [ ] 没有覆盖预设令牌；尺寸来自刻度与变体；固定宽度用 rem 并有注释；点击目标达标（§4）
- [ ] 颜色只用令牌；标签全部是同一个淡色胶囊组件、按语义取色；主色只用于主动作与进行中（§5）
- [ ] 标识符等宽、数字 `tabular-nums`、空值 "—"（§6）
- [ ] 表格：表头吸顶、标题列封顶截断、固定列宽、点击排序、游标加载更多、虚拟化阈值（§7）
- [ ] 看板：占满视口、列内滚动、视图选择记住且 URL 优先（§8）
- [ ] 弹窗是子路由；有后果先确认；每个写操作有 toast（§9）
- [ ] 加载、空、无结果、失败四种状态都有，用共享组件（§10）
- [ ] 文案只写事实与动作，无解释界面的句子（§11）
- [ ] 动效可被"减少动态效果"关闭（§12）
- [ ] 快捷键在输入时不误触（§13）
- [ ] 中英文齐全（§14）；可访问性各项（§15）
