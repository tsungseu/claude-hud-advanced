# Claude HUD

一个 Claude Code 插件，实时显示正在发生的事情——上下文使用率、活跃工具、运行中的 Agent 和待办进度。始终在你的输入下方可见。

[![License](https://img.shields.io/github/license/tsungseu/claude-hud-advanced?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/tsungseu/claude-hud-advanced)](https://github.com/tsungseu/claude-hud-advanced/stargazers)

![Claude HUD in action](claude-hud-preview-5-2.png)

> 🌐 [English README](README.md) | 中文文档

## 安装

在 Claude Code 实例中，运行以下命令：

**步骤 1：添加市场**
```
/plugin marketplace add tsungseu/claude-hud-advanced
```

**步骤 2：安装插件**

<details>
<summary><strong>⚠️ Linux 用户：请先点击此处</strong></summary>

在 Linux 上，`/tmp` 通常是独立的文件系统（tmpfs），这会导致插件安装失败并报错：
```
EXDEV: cross-device link not permitted
```

**修复方法**：在安装前设置 TMPDIR：
```bash
mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp claude
```

然后在该会话中运行下面的安装命令。这是 [Claude Code 平台的限制](https://github.com/anthropics/claude-code/issues/14799)。

</details>

```
/plugin install claude-hud
```

安装完成后，重新加载插件：

```
/reload-plugins
```


**步骤 3：配置状态栏**
```
/claude-hud:setup
```

<details>
<summary><strong>⚠️ Windows 用户：如果 setup 提示未找到 JavaScript 运行时，请点击此处</strong></summary>

在 Windows 上，Claude HUD setup 支持的运行时是 Node.js LTS。如果 setup 提示未找到 JavaScript 运行时，请先为你的 shell 安装 Node.js：
```powershell
winget install OpenJS.NodeJS.LTS
```
然后重启 shell 并再次运行 `/claude-hud:setup`。

</details>

完成！重启 Claude Code 以加载新的 statusLine 配置，HUD 将会出现。

在 Windows 上，setup 写入新的 `statusLine` 配置后，请完整重启 Claude Code。

---

## 什么是 Claude HUD？

Claude HUD 让你在 Claude Code 会话中获得更清晰的洞察。

| 你看到的内容 | 为什么重要 |
|--------------|------------|
| **项目路径** | 知道你当前在哪个项目中（可配置 1-3 级目录深度） |
| **上下文健康度** | 在上下文窗口满之前准确了解还剩多少 |
| **工具活动** | 实时观察 Claude 读取、编辑和搜索文件 |
| **Agent 追踪** | 查看哪些子 Agent 正在运行以及它们在做什么 |
| **待办进度** | 实时跟踪任务完成情况 |

## 显示效果

### 默认（2 行）
```
[Fabel] │ my-project git:(main*)
上下文 █████░░░░░ 45% │ 使用率 ██░░░░░░░░ 25%（1小时30分 / 5小时）
```
- **第 1 行** — 模型、提供商标签（如能正面识别，例如 `Bedrock`、`Vertex`）、项目路径、git 分支
- **第 2 行** — 上下文进度条（绿 → 黄 → 红）和使用率限制

### 可选行（通过 `/claude-hud:configure` 启用）
```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← 工具活动
◐ explore [haiku]: 查找认证代码（2分15秒）       ← Agent 状态
▸ 修复认证漏洞（2/5）                             ← 待办进度
```

---

## 工作原理

Claude HUD 使用 Claude Code 原生的 **statusline API**——无需独立窗口，不需要 tmux，在任何终端都能工作。

```
Claude Code → stdin JSON → claude-hud → stdout → 在终端中显示
           ↘ transcript JSONL（工具、Agent、待办）
```

**核心特性：**
- 来自 Claude Code 的原生 Token 数据（非估算）
- 适配 Claude Code 报告的上下文窗口大小，包括最新的 1M 上下文会话
- 解析转录文件以获取工具/Agent 活动
- 约每 300ms 更新一次

---

## 配置

随时自定义你的 HUD：

```
/claude-hud:configure
```

引导式配置涵盖布局、语言和常用显示开关。高级选项（自定义颜色、阈值、`timeFormat`）会保留，但需直接编辑 `~/.claude/plugins/claude-hud/config.json` 设置。

### 预设

| 预设 | 显示内容 |
|------|----------|
| **完整（Full）** | 全部启用——工具、Agent、待办、Git、使用率、时长 |
| **核心（Essential）** | 活动行 + Git 状态，减少信息冗余 |
| **极简（Minimal）** | 仅核心——只有模型名称和上下文进度条 |

### 选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `language` | `en` \| `zh` \| `zh-Hans` | `en` | HUD 标签语言 |
| `lineLayout` | string | `expanded` | `expanded`（多行）或 `compact`（单行） |
| `pathLevels` | 1-3 | 1 | 项目路径显示的目录层级数 |
| `maxWidth` | number \| `null` | `null` | 终端宽度检测失败时的回退宽度 |
| `forceMaxWidth` | boolean | false | 设置 `maxWidth` 后始终使用，即使终端更窄 |
| `elementOrder` | string[] | `["project","addedDirs","context","usage","promptCache","memory","environment","tools","skills","mcp","agents","todos","sessionTime"]` | 展开模式下的元素顺序；省略即隐藏 |
| `display.mergeGroups` | string[][] | `[["context","usage"]]` | 展开模式下共享一行的元素分组；`[]` 禁用合并 |
| `gitStatus.enabled` | boolean | true | 显示 git 分支 |
| `gitStatus.showDirty` | boolean | true | 显示 `*` 表示未提交更改 |
| `gitStatus.showAheadBehind` | boolean | false | 显示 `↑N ↓N` 领先/落后 |
| `gitStatus.pushWarningThreshold` | number | 0 | 未推送数 ≥N 时用警告色（`0` 禁用） |
| `gitStatus.pushCriticalThreshold` | number | 0 | 未推送数 ≥N 时用严重色（`0` 禁用） |
| `gitStatus.showFileStats` | boolean | false | 显示文件变更数量 `!M +A ✘D ?U` |
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | `wrap` 让 git 块单独换到下一行 |
| `display.showModel` | boolean | true | 显示模型名称 `[Fabel]` |
| `display.showProvider` | boolean | false | 在模型前显示提供商标签，如 `[Bedrock \| Fabel]` |
| `display.providerName` | string | `""` | `showProvider` 的显式标签；为空时回退到自动检测 |
| `display.showAddedDirs` | boolean | true | 显示 `/add-dir` 工作区（如 `+sparkle`）；最多 5 个，基名截断到 24 字符 |
| `display.addedDirsLayout` | `inline` \| `line` | `inline` | `inline`（项目旁，`+name`）或 `line`（单独 `Added dirs:` 行） |
| `display.showContextBar` | boolean | true | 显示可视化上下文进度条 `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | 上下文显示格式 |
| `display.autoCompactWindow` | number \| `null` | `null` | 设置后按此 auto-compact 窗口计算上下文百分比（对齐 `/context`） |
| `display.showConfigCounts` | boolean | false | 显示 CLAUDE.md、rules、MCPs、hooks 数量 |
| `display.showCost` | boolean | false | 显示会话费用（原生 `cost.total_cost_usd`，附本地估算回退） |
| `display.showOutputStyle` | boolean | false | 显示当前 `outputStyle`，如 `style: <名称>` |
| `display.showDuration` | boolean | false | 显示会话时长 `⏱️ 5m` |
| `display.showSpeed` | boolean | false | 显示输出 Token 速度 `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | 显示订阅用户使用率限制（可用时） |
| `display.usageValue` | `percent` \| `remaining` | `percent` | 使用率格式：已使用或剩余 |
| `display.usageBarEnabled` | boolean | true | 将使用率显示为可视化进度条 |
| `display.usageCompact` | boolean | false | 短文本形式 `5h: 25% (1h 30m)`；优先于 `usageBarEnabled` |
| `display.showResetLabel` | boolean | true | 倒计时前显示 `resets in` 前缀 |
| `display.timeFormat` | `relative` \| `absolute` \| `both` \| `elapsed` \| `elapsedAndAbsolute` | `relative` | 使用率窗口时间的显示方式 |
| `display.sevenDayThreshold` | 0-100 | 80 | 7 天使用率 ≥ 阈值时显示（`0` = 始终） |
| `display.externalUsagePath` | string | `""` | 本地使用率快照的绝对路径（见[厂商用量桥接](#厂商用量桥接)） |
| `display.externalUsageWritePath` | string | `""` | 将 stdin rate_limits 写入此处，供其他本地工具使用 |
| `display.externalUsageFreshnessMs` | number | `300000` | 快照允许的最长存活时间，超时即忽略 |
| `display.showTokenBreakdown` | boolean | true | 高上下文时（85%+）显示 Token 详情 |
| `display.showTools` | boolean | false | 显示工具活动行 |
| `display.showSkills` | boolean | false | 显示活跃 Skills |
| `display.showMcp` | boolean | false | 显示活跃 MCP 服务器 |
| `display.toolNameMaxLength` | number | `0` | 工具名称最大长度（`0` = 完整） |
| `display.toolsMaxVisible` | number | `4` | 最多显示的已完成工具数（`0` = 不限） |
| `display.showAgents` | boolean | false | 显示 Agent 活动行 |
| `display.showTodos` | boolean | false | 显示待办进度行 |
| `display.showSessionName` | boolean | false | 显示会话 slug/`/rename` 标题 |
| `display.showAdvisor` | boolean | false | 在 project 行内联显示 `/advisor` 顾问模型 |
| `display.advisorOverride` | string | `""` | 手动覆盖顾问标签 |
| `display.showSessionStartDate` | boolean | false | 显示 transcript 会话开始时间戳 |
| `display.showLastResponseAt` | boolean | false | 距最后一次 assistant 响应多久 |
| `display.showCompactions` | boolean | false | 本会话上下文压缩次数 |
| `display.showClaudeCodeVersion` | boolean | false | 显示已安装的 Claude Code 版本，如 `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | 显示近似系统 RAM 使用（仅展开布局；可能高估真实压力） |
| `display.showPromptCache` | boolean | false | 显示 prompt cache 倒计时（首次 assistant 响应前隐藏） |
| `display.promptCacheTtlSeconds` | number | `300` | Prompt cache TTL——Pro 用 `300`，Max 用 `3600` |
| `colors.*` | 颜色值 | — | 对应元素的颜色：`context`、`usage`、`warning`、`usageWarning`、`critical`、`model`、`project`、`git`、`gitBranch`、`label`、`custom` |
| `colors.barFilled` / `colors.barEmpty` | string | `█` / `░` | 进度条填充/空白字符（单个可见字素） |

支持的颜色值：`dim`、`red`、`green`、`yellow`、`magenta`、`cyan`、`brightBlue`、`brightMagenta`，256 色数字（`0-255`）或十六进制（`#rrggbb`）。

### 使用率限制

当 Claude Code 在 stdin 上提供订阅用户 `rate_limits` 时，使用率显示**默认启用**（在第 2 行与上下文进度条一起显示）。仅用 API 密钥的会话、或 Bedrock/Vertex 等托管提供商看不到此显示（它们的计费另在他处）。

- `display.usageValue` — `percent`（已使用）或 `remaining`
- `display.timeFormat` — 倒计时、墙钟、已用时长或其组合
- `display.sevenDayThreshold` — 周窗口在达到此值后显示（默认 80；`0` 始终显示）
- `display.usageCompact` / `display.showResetLabel` — 更短的文本格式
- 免费/仅限每周账户会单独显示每周窗口（不会有幽灵 `5h: --` 占位符）

`display.externalUsagePath` 指向的本地快照可以追加 `balance_label`，或在 stdin `rate_limits` 缺失时**完全**作为使用率窗口的回退。下面的厂商用量桥接正是这样把用量喂给 HUD 的。

### 安全说明

ClaudeHUD **设计为纯本地**：它只读取 stdin 的 statusline JSON、会话 transcript、`~/.claude` 下的部分配置文件和 git 元数据，不发起任何网络请求，也不调用未记录的 API。缓存文件在 POSIX 上以私有权限写入。

`--extra-cmd` 除非在 HUD 进程环境中设置 `CLAUDE_HUD_ALLOW_EXTRA_CMD=1`，否则处于禁用状态。请把它当作任意代码执行对待——切勿使用来自不可信来源的命令。

### 配置示例

```json
{
  "lineLayout": "expanded",
  "showSeparators": false,
  "language": "zh",
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": false,
    "showFileStats": false
  },
  "display": {
    "showModel": true,
    "showContextBar": true,
    "showTools": true,
    "showSkills": true,
    "showMcp": true,
    "showAgents": true,
    "showTodos": true,
    "showProject": true,
    "showAddedDirs": true,
    "showUsage": true,
    "showOutputStyle": true,
    "showCompactions": true,
    "showAdvisor": true,
    "externalUsagePath": "C:/Users/.claude/<provider>-usage-snapshot.json"
  }
}
```

### 显示示例

**1 级（默认）：** `[Fabel] │ my-project git:(main)`

**2 级：** `[Fabel] │ apps/my-project git:(main)`

**3 级：** `[Fabel] │ dev/apps/my-project git:(main)`

**带 dirty 标记：** `[Fabel] │ my-project git:(main*)`

**带领先/落后：** `[Fabel] │ my-project git:(main ↑2 ↓1)`

**带文件统计：** `[Fabel] │ my-project git:(main* !3 +1 ?2)`
- `!` = 修改的文件，`+` = 新增/暂存，`✘` = 删除，`?` = 未跟踪
- 计数为 0 时不显示

### 临时禁用 HUD

设置 `CLAUDE_HUD_DISABLE` 环境变量——无需编辑 `settings.json`：

```bash
CLAUDE_HUD_DISABLE=1 claude
```

---

## CN模型厂商用量桥接

当你通过**非 Anthropic 厂商代理**（BigModel、MiniMax、阿里、Moonshot）运行 Claude Code 时，这些代理**不会**在 statusline stdin 上发送 Anthropic 风格的 `rate_limits`，因此使用率行一直为空。Claude HUD 为每家厂商内置了**桥接**：一个独立的后台轮询进程，按定时器查询厂商配额 API，并把结果写入本地快照供 HUD 读取。

### 实现原理

桥接是**解耦**的——短命的 statusline 进程（每 ~300ms 重新唤起一次）从不发起网络请求，它只读取本地 JSON 快照。所有 API 调用都由独立、长命的轮询守护进程完成：

```
┌──────────────────────┐  原子化 JSON 写入  ┌─────────────────────────┐  读取   ┌──────────────┐
│  厂商轮询进程         │ ─────────────────> │ ~/.claude/<p>-snapshot  │ ──────> │ claude-hud   │
│  长命守护进程         │                    │ .json  (0600)           │         │ statusline   │
│  轮询厂商 API         │                    │                         │         │ （渲染进度条）│
│  约每 5 分钟          │                    │  共享快照文件           │         │              │
└──────────────────────┘                    └─────────────────────────┘         └──────────────┘
```

**共享快照契约**——每个轮询进程写入（HUD 也按此读取）的结构：

```jsonc
{
  "updated_at": "2026-07-03T12:00:00Z",
  "five_hour": { "used_percentage": 0-100, "resets_at": "ISO8601" },   // 使用率进度条
  "seven_day":  { "used_percentage": 0-100, "resets_at": "ISO8601" },  // 可选周窗口
  "balance_label": "¥6.35"                                             // 可选预付费余额
}
```

HUD 只在快照足够新鲜时（由 `display.externalUsageFreshnessMs` 控制，默认 5 分钟）且时间戳有效时才采用；相对路径/非法 JSON 会静默忽略。轮询进程采用**原子写入**（临时文件 + `rename` + `0600` 权限），API 失败绝不会用坏数据覆盖好快照——下个周期自动恢复。

**零依赖**——每个轮询进程都是单个 `.mjs`，仅用 Node 18+ 内置（`fs`、`os`、全局 `fetch`），无需 npm install，无需额外运行时。

**API Key 自动检测**（按优先级从高到低）：
1. 厂商环境变量（如 `GLM_API_KEY`）
2. `src/providers/<name>/config.json` 中的 `apiKey`（从 `config.example.json` 拷贝）
3. 从 `~/.claude/settings.json` 自动检测——`ANTHROPIC_AUTH_TOKEN` **仅当 `ANTHROPIC_BASE_URL` 指向该厂商时**才会复用，确保真实的 Anthropic 凭证永远不会被发到国产端点。

**代理感知 fetch**——Node 内置 `fetch` 会忽略 `HTTP(S)_PROXY`。共享的 `src/providers/shared/proxy-fetch.mjs` 自实现 HTTP CONNECT 隧道（在套接字上做 TLS 并支持 Basic 代理认证），遵循 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`。

**自动启动**——`plugin.json` 注册了 `SessionStart` hook，以 `--ensure` 方式运行各轮询进程。借助 PID 文件，`--ensure` 仅在尚未运行时才启动一个分离守护进程（跨会话幂等），随后立即返回，绝不阻塞会话启动。守护进程在会话结束后继续存活；机器重启后，下次开启 Claude Code 时自动重启——无需 systemd/launchd/NSSM。

### 支持的厂商

| 厂商 | API 端点 | 鉴权 | 环境变量 | 默认快照 | 运行 |
|------|----------|------|----------|----------|------|
| **ZAI / BigModel** | `GET open.bigmodel.cn/api/monitor/usage/quota/limit` | `Authorization: <key>`（无 Bearer） | `GLM_API_KEY` | `~/.claude/glm-usage-snapshot.json` | `npm run glm:poll` |
| **MiniMax** | `GET api.minimaxi.com/.../coding_plan/remains`（国内）或 `api.minimax.io`（EN） | `Authorization: Bearer <key>` | `MINIMAX_API_KEY` | `~/.claude/minimax-usage-snapshot.json` | `npm run minimax:poll` |
| **阿里百炼** | `POST {gateway}/data/api.json`（intl + 国内双网关，自动回退） | `Bearer` + `x-api-key` + `X-Dashscope-API-Key` | `ALIBABA_API_KEY` / `DASHSCOPE_API_KEY` | `~/.claude/alibaba-usage-snapshot.json` | `npm run alibaba:poll` |
| **Moonshot** | `GET {baseURL}/coding/v1/usages`（默认 `api.kimi.com`） | `Authorization: Bearer <key>` | `KIMI_CODE_API_KEY` | `~/.claude/kimi-usage-snapshot.json` | `npm run kimi:poll` |

> 加 `:once`（如 `npm run glm:poll:once`）可单次抓取以验证 Key。每个轮询进程都有 `config.example.json`，说明 `apiKey`、`intervalSec`、`snapshotPath` 以及厂商特有选项（GLM 的 `weeklyLimitType`、MiniMax/阿里的 `region`、Kimi 的 `baseURL`）。

### 使用方式

1. **提供 API Key**——任选其一：环境变量、`config.json` 中的 `apiKey`，或从 `settings.json` 自动检测（当 `ANTHROPIC_BASE_URL` 已指向该厂商时自动生效）。
2. **安装并重启**——`/plugin install claude-hud` 后，下次开启 Claude Code 会话会自动启动已解析到 Key 的轮询进程。
3. **把 HUD 指向快照**，编辑 `~/.claude/plugins/claude-hud/config.json`：

```json
{
  "display": {
    "externalUsagePath": "/absolute/path/to/glm-usage-snapshot.json",
    "sevenDayThreshold": 0,
    "timeFormat": "elapsed"
  }
}
```

- `sevenDayThreshold: 0` 无条件显示周窗口（默认 80 会隐藏）。
- `timeFormat: "elapsed"` 把使用率进度条渲染为 `25% (1小时30分 / 5小时)`。

切换厂商只需把 `externalUsagePath` 改成对应的快照路径。

### 注意事项

- **已用时长提示：** HUD 把周窗口标注为 `7d`，并在 `timeFormat: "elapsed"` 下按固定 7 天窗口计算已用时长。对于不是 7 天的周期（如 GLM 约 18 天的 `TIME_LIMIT`），**百分比正确但已用时长跨度和标签是近似的**。想要精确的重置倒计时（`resets in 18d`），请用 `timeFormat: "relative"`。
- **GLM 周窗口：** 短窗口 `TOKENS_LIMIT`（约 5 小时）默认驱动使用率进度条；若要同时显示长周期窗口，在 `src/providers/glm/config.json` 中设置 `"weeklyLimitType": "TIME_LIMIT"`。
- **阿里** 提供 `five_hour` + `seven_day`（月配额被丢弃——HUD 没有对应的槽位）。
- **MiniMax** 仅在 `current_weekly_status == 1` 时写入周窗口（status 3 = 无周限制）。
- **路径**必须为绝对路径；Windows 上需转义反斜杠。
- **优先级：** 如果 Claude Code 原生订阅 `rate_limits` 存在，它会优先使用，仅追加快照的 `balance_label`。

---

## 环境要求

- Claude Code v1.0.80+
- macOS/Linux：Node.js 18+ 或 Bun
- Windows：Node.js 18+

---

## 开发

```bash
git clone https://github.com/tsungseu/claude-hud-advanced
cd claude-hud
npm ci && npm run build
npm test
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 许可证

MIT — 见 [LICENSE](LICENSE)

---

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=tsungseu/claude-hud-advanced&type=Date)](https://star-history.com/#tsungseu/claude-hud-advanced&Date)
