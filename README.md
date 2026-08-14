# dsh-usage-stats

最小可跑的 DeepSeek Harness（DSH）用量统计插件：通过 `llm/stream` waterfall 包一层，把每次模型调用的 token 用量（输入 / 输出 / 缓存读 / 缓存写）落进本地 SQLite，并注册一个 `read_usage` 工具供 agent 查询，同时提供**费用折算**和**网页仪表盘**。

- 只观察、不改流：记账失败不会影响模型调用本身
- 仅依赖 Node 内置模块（`node:sqlite`、`node:fs` 等），零运行时依赖
- 数据存 `~/.dsh/usage-stats.db`（可用 `config.dbPath` 覆盖）
- 费用按默认 DeepSeek 官方单价折算（人民币 ¥，可用 `config.prices` 覆盖）
- 网页面板：`http://127.0.0.1:3080/usage-stats/panel`

## 安装

```bash
# 方式 1：从 GitHub 安装
npx -y @deepseek-ai/dsh plugin --profile web add github:<your-user>/dsh-usage-stats

# 方式 2：本地目录安装
npx -y @deepseek-ai/dsh plugin --profile web add link:D:\path\to\dsh-usage-stats
```

装完重启 DSH（`dsh web`）。需要 Node ≥ 22.13（`node:sqlite` 依赖）。

## 使用

插件自动记录所有经 DSH 发起的模型调用。要查看统计，在会话里让 agent 调用 `read_usage` 工具，或直接：

```bash
node -e "import('node:sqlite').then(({DatabaseSync})=>{const db=new DatabaseSync(process.env.DSH_HOME||require('os').homedir()+'/.dsh' + '/usage-stats.db');console.log(db.prepare('SELECT COUNT(*) n, SUM(input_tokens) i, SUM(output_tokens) o FROM requests').get())})"
```

`read_usage` 参数：

| 参数 | 取值 | 说明 |
|------|------|------|
| `since` | `1d` / `7d` / `30d` / `all` | 时间窗口，默认 `all` |
| `group` | `model` / `day` | 分组维度，默认 `model` |

返回结构：

```json
{
  "since": "all",
  "group": "model",
  "totals": { "requests": 1, "input_tokens": 120, "output_tokens": 60, "cache_read_tokens": 30, "cache_write_tokens": 10 },
  "breakdown": [ { "bucket": "deepseek-v4-pro", "requests": 1, "input_tokens": 120, "output_tokens": 60, ... } ]
}
```

## 开发 / 冒烟测试

```bash
node smoke.mjs
```

## 结构

```
dsh-usage-stats/
├── package.json        # dsh.bundle.patch -> cordis.patch.yml
├── cordis.patch.yml    # 挂载插件
├── dsh/index.js        # 插件本体（llm/stream 包装 + SQLite + read_usage）
├── smoke.mjs           # 冒烟测试
└── README.md
```

## License

MIT
