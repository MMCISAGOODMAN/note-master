# Ops Notepad · 运维专属记事本

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.9%2B-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.x-green.svg)](https://flask.palletsprojects.com/)

专为运维工程师设计的**本地 Web 记事本**：工作日志、故障知识库、命令收藏、服务器关联、日报生成。  
数据全部保存在本机 SQLite，**不上传云端**。

> 仓库地址：[github.com/MMCISAGOODMAN/note-master](https://github.com/MMCISAGOODMAN/note-master)

---

## 特性

| 模块 | 能力 |
|------|------|
| **笔记管理** | Markdown 编辑、分类/多标签、置顶、归档、软删除与恢复、拖拽排序 |
| **快捷输入** | Shell/Python/SQL 代码块、服务器信息、时间戳、常用短语、故障模板 |
| **搜索** | 全文检索、标签/分类/服务器筛选、关键词高亮、搜索历史 |
| **知识库** | 问题-方案沉淀、相似推荐、点赞、一键复用方案 |
| **日报** | 自动汇总今日笔记，导出 Markdown / 保存为日报笔记 |
| **运维扩展** | 命令收藏夹、运维日历、统计看板、服务器关联 |
| **数据安全** | 30 秒自动保存、版本历史（最多 20）、JSON/Markdown/HTML 导出导入 |

---

## 环境要求

- Python **3.9+**
- 现代浏览器（Chrome / Edge / Firefox / Safari）
- macOS / Linux / Windows

---

## 快速开始

### 一键启动（推荐）

```bash
git clone https://github.com/MMCISAGOODMAN/note-master.git
cd note-master
bash scripts/start.sh
```

脚本会自动：创建虚拟环境 → 安装依赖 → 初始化数据库 → 启动服务。

Windows 用户请双击或运行：

```bat
scripts\start.bat
```

### 手动启动

```bash
python3 -m venv .venv

# macOS / Linux
source .venv/bin/activate

# Windows
# .venv\Scripts\activate

pip install -r requirements.txt
python init_db.py
python app.py
```

浏览器访问：**http://localhost:18765**

### 端口配置

默认端口为 **18765**（避开常见占用）。可通过环境变量修改：

```bash
PORT=19000 python app.py
```

---

## 数据存储

所有业务数据存储在用户目录下的 SQLite 数据库中：

| 项 | 路径 |
|----|------|
| 数据目录 | `~/.ops-notepad/` |
| 数据库文件 | `~/.ops-notepad/data.db` |

- **macOS / Linux**：`/Users/<你>/` 或 `/home/<你>/.ops-notepad/data.db`
- **Windows**：`C:\Users\<你>\.ops-notepad\data.db`

### 备份与迁移

1. **应用内导出**：工具栏 ⬇ → JSON（完整备份）/ Markdown（ZIP）/ HTML  
2. **应用内导入**：工具栏 ⬆ → 选择 JSON 备份文件  
3. **直接拷贝**：复制整个 `~/.ops-notepad/` 目录即可迁移

> 多设备通过网盘同步该目录时，请避免两端同时写入同一数据库文件。

---

## 使用指南

### 常用操作

1. **新建笔记**：点击「新建笔记」或 `Ctrl+N`（Mac 用 `Cmd`）
2. **故障记录**：点击「故障模板」，自动填充现象/原因/方案等结构，并标记为知识库
3. **生成日报**：点击「日报」，可复制、导出 `.md` 或保存为笔记
4. **命令收藏**：侧栏「命令」→ 添加常用命令，一键复制
5. **按服务器筛选**：侧栏「服务器」→「筛选笔记」

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建笔记 |
| `Ctrl+S` | 保存当前笔记 |
| `Ctrl+Shift+S` | 另存为副本 |
| `Ctrl+F` | 聚焦搜索框 |
| `Ctrl+D` | 插入当前时间戳 |
| `Ctrl+Shift+C` | 插入 bash 代码块 |
| `Ctrl+Shift+P` | 切换预览（编辑 → 分屏 → 纯预览） |
| `Ctrl+Delete` | 删除当前笔记（进回收站） |
| `Esc` | 关闭弹窗 / 清空搜索 |

macOS 下将 `Ctrl` 替换为 `Cmd`。

### 笔记技巧

- 标签输入以 `#` 开头，回车确认；点击标签可筛选
- 勾选「知识库」后，输入标题会推荐相似故障方案
- 编辑器工具栏可快速插入代码块、服务器信息、常用短语
- 右键笔记列表：置顶 / 归档 / 复制标题 / 删除

---

## 项目结构

```
note-master/
├── app.py                      # Flask 后端（API + 页面）
├── init_db.py                  # 数据库初始化与默认数据
├── requirements.txt            # Python 依赖
├── README.md
├── LICENSE
├── scripts/
│   ├── start.sh                # macOS / Linux 启动
│   ├── start.bat               # Windows 启动
│   └── install-autostart.sh    # 开机自启（可选）
├── templates/
│   └── index.html              # 前端页面
└── static/
    ├── css/style.css           # 样式
    └── js/app.js               # 交互逻辑
```

---

## API 概览

服务启动后，主要接口如下（均可在本机调用）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 前端页面 |
| GET/POST | `/api/notes` | 列表 / 新建 |
| GET/PUT/DELETE | `/api/notes/:id` | 详情 / 更新 / 软删除 |
| POST | `/api/notes/:id/restore` | 从回收站恢复 |
| GET | `/api/notes/:id/versions` | 版本历史 |
| POST | `/api/notes/:id/like` | 知识库点赞 |
| GET | `/api/knowledge/similar?title=` | 相似问题推荐 |
| GET | `/api/daily` | 今日日报汇总 |
| GET | `/api/calendar` · `/api/calendar/day` | 日历数据 |
| GET | `/api/stats` | 统计看板 |
| CRUD | `/api/commands` · `/api/servers` | 命令 / 服务器 |
| GET | `/api/export?format=json\|markdown\|html` | 导出 |
| POST | `/api/import` | 导入 JSON |
| GET | `/api/health` | 健康检查（含库路径） |

查询笔记时支持参数：`q`、`category`、`tag`、`server_ip`、`date_from`、`date_to`、`archived`、`deleted`、`knowledge`、`pinned`。

---

## 开机自启（可选）

```bash
# macOS LaunchAgent / Linux systemd --user
bash scripts/install-autostart.sh
```

Windows：将 `scripts/start.bat` 的快捷方式放入「启动」文件夹（运行 `shell:startup`）。

---

## 常见问题

**Q: 刷新页面后笔记还在吗？**  
在。数据在 `~/.ops-notepad/data.db`，与浏览器缓存无关。

**Q: 误删笔记怎么办？**  
侧栏筛选「回收站」→ 右键「恢复」。需要永久删除时走硬删除接口（应用内默认软删除）。

**Q: 端口被占用？**  
```bash
PORT=19000 python app.py
```

**Q: 如何完全卸载？**  
删除项目目录，并删除数据目录 `~/.ops-notepad/`（会清除全部笔记，请先备份）。

---

## 设计原则

1. **快速** — 启动轻、搜索快、编辑流畅  
2. **可靠** — 自动保存、版本历史、本地持久化  
3. **专注** — 界面简洁，减少干扰  
4. **运维特色** — 故障模板、命令收藏、服务器关联  
5. **隐私优先** — 数据仅存本机，不上传云端  

---

## 许可证

本项目采用 [MIT License](LICENSE) 开源。
