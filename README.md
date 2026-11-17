# 快捷操作 / Quick Actions

**简体中文** · [English](README.en.md)

会话头部上的三个纯图标快捷操作（新会话还没有消息时，显示在 hero 行）——打开当前会话的工作区文件夹、打开终端、用 VS Code 打开 —— 外加一个小巧的设置对话框，用来调整它们的顺序与显隐。

```
[打开文件夹]  [打开终端]  [用 VS Code 打开]
```

- **打开文件夹** —— 用系统文件管理器（资源管理器、Finder 或 `xdg-open`）打开当前会话的工作区文件夹。
- **打开终端** —— 与侧边栏自己的终端行为完全一致：已有终端标签页时把它切到前台（侧边栏收起时先展开），而不是再开一个；没有时才新建标签页，这也正是启动 shell 的时机。
- **用 VS Code 打开** —— 用 VS Code 或 VS Code Insiders 打开工作区文件夹。

## 按钮位置

| 状态 | 位置 |
|---|---|
| 已有消息的会话 | `conversation.session.header.utilities` 的最右端，紧挨头部的 `…` 与右侧边栏自带的「打开侧边栏」按钮 |
| 新建会话、还没有消息（头部行被 hero 取代） | hero 中「工作区／预设」那一行的最右端（`conversation.hero.options`） |

只有宿主能确认已安装的动作才会出现图标；终端图标还额外要求侧边栏注册了 `terminal` 标签类型。

## 设置

头部的**更多操作**菜单多出一行**快捷操作设置**，位置在「打开方式」（order 500）与内置的反馈行（order 600）之间。它打开一个居中对话框，逐行列出每个动作，包含：

- 一个**拖动手柄**：拖到另一行中间即**互换**两行，拖到该行的上／下边缘即**插入**到它前面／后面（聚焦手柄后 `Alt+↑` / `Alt+↓` 前后挪一位）；
- 动作的图标与名称；
- 一个**开关**，控制该动作显示或隐藏。

顺序与开关状态保存在页面的 `localStorage` 中，键为 `dsh.quick-actions.preferences`；它按浏览器 origin 存储，因此不会跨机器同步。

## 平台

| | 编辑器解析 | 文件管理器 | 说明 |
|---|---|---|---|
| **Windows** | 标准安装路径 → 安装器写入的 `App Paths` 注册表值 → `PATH` 上 `code` CLI 旁边的可执行文件 | `%SystemRoot%\explorer.exe` | 忽略 `explorer.exe` 的退出码：它把文件夹交给已运行的 shell 之后会返回非零状态 |
| **macOS** | `/Applications` 或 `~/Applications` 中的应用包（经 `open -a`），否则用 `PATH` 上的 `code` CLI | `open <dir>`（Finder） | |
| **Linux** | 先 `PATH` 上的 `code` CLI，再已知安装路径（`/usr/share/code`、`/snap/bin` 等） | `xdg-open`，且要求有显示服务器 | |

在 SSH 下插件不提供任何动作：那样打开的窗口会出现在远端主机上，而不是点击它的人面前。

## 安装

本包是一个 DSH **bundle**：一个普通 npm 包，由 `package.json` 里的 `dsh.bundle` 与 `dsh.client` 声明。它没有构建步骤，下面每种安装方式都只运行预构建文件。

```
# 本地检出或拷贝出来的目录（pnpm 会以链接方式安装，请保留该目录）
dsh plugin --profile desktop add ./dsh-quick-actions

# 打包后的 tarball（会拷贝进 profile）
pnpm pack && dsh plugin --profile desktop add ./dsh-quick-actions-1.0.0.tgz

# 从 git 安装（请固定 commit；没有构建脚本，因此不会出现 allowBuilds 提示）
dsh plugin --profile desktop add github:<owner>/dsh-quick-actions#<sha>

# 从 registry 安装
dsh plugin add @<scope>/dsh-quick-actions
```

在 Desktop 应用里，**插件 → 添加插件** 安装的是本地目录，而不是执行某条 CLI 命令。

要求：

- `engines.dsh` 为 `>=0.2.2-rc.3 <0.3.0`；不兼容的 DSH 会拒绝安装（并拒绝用这套配置启动）。
- 组合需要在 Host 侧提供 `webServer`、`connection`、`subprocess`，在 Client 侧提供 `slots`、`locale`、`contextMenus`、`sidebarRight`、`sidebarRightTabs` —— 它们都属于标准的 Web / Desktop profile。
- VS Code 动作所用的按钮文案来自内置的 `open-in-app` 字典；终端动作需要侧边栏终端特性。

## 为什么由它自己启动应用

这个 Desktop 构建把 Harness host 作为 Electron 的 "node" 子进程运行，因此 host 进程环境里带着 `ELECTRON_RUN_AS_NODE=1`，它启动的每个子进程都会继承该变量。Electron 应用带这个变量启动会进入 Node 模式并立即退出，这正是自带的 `open-in-app` 启动器在这个宿主里打不开 VS Code 的原因。本 bundle 的 Host 半侧自己负责它需要的启动，并先清掉这些 Electron 相关变量；它还会剔除形似凭据的变量与 `DSH_*`，并以 detached 方式启动子进程、不继承 stdio。

## 路由

```
GET  /quick-actions/apps  -> { apps: ('vscode'|'vscodeinsiders'|'filemanager')[] }
POST /quick-actions/open  -> { app, path } -> { ok: true }
```

两个路由都由组合的 `connection` 服务围栏保护，POST 请求体在启动任何进程之前就已校验：`application/json`、64 KiB 上限、已知的 app id，以及一个存在且为绝对路径的目录。

## 开发

纯 JavaScript，没有构建步骤。

- `index.js` —— Host 半侧：平台解析、detached 启动器、路由。
- `client.js` —— Client 半侧：按钮簇、设置对话框、终端动作、偏好存储。
- `locale/*.json` —— 插件管理器中的标题与描述。
- `icon.svg` —— bundle 图标。

那些必须在页面内客户端插件重载后依然存活的状态挂在 `window.__dshQuickActions` 上，因为 Client 插件可以在同一个页面里被重新应用，而已经挂载的组件仍在渲染；如果改用模块作用域的 store，就会分裂成两份副本，由新副本处理的点击永远到不了已挂载的那一份。

## 许可证

MIT（见 [LICENSE](LICENSE)）。Visual Studio Code 名称与徽标是 Microsoft 的商标；VS Code 图形取自 [Simple Icons](https://simpleicons.org/)（CC0 1.0），仅用于标识按钮所启动的应用。
