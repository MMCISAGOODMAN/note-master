#!/usr/bin/env python3
"""Initialize Ops Notepad SQLite database under ~/.ops-notepad/"""

import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

DATA_DIR = Path.home() / ".ops-notepad"
DB_PATH = DATA_DIR / "data.db"


def get_connection(db_path=None):
    path = db_path or DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path=None):
    conn = get_connection(db_path)
    cur = conn.cursor()

    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '日常',
            tags TEXT NOT NULL DEFAULT '[]',
            server_ip TEXT DEFAULT '',
            server_env TEXT DEFAULT '',
            is_pinned INTEGER NOT NULL DEFAULT 0,
            is_archived INTEGER NOT NULL DEFAULT 0,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            is_knowledge INTEGER NOT NULL DEFAULT 0,
            problem_title TEXT DEFAULT '',
            solution TEXT DEFAULT '',
            likes INTEGER NOT NULL DEFAULT 0,
            favorited INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS note_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT '',
            command TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '系统',
            scenario TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            ip TEXT NOT NULL DEFAULT '',
            env TEXT NOT NULL DEFAULT '测试',
            description TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS search_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT '#3d8bfd',
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS phrases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);
        CREATE INDEX IF NOT EXISTS idx_notes_server ON notes(server_ip);
        CREATE INDEX IF NOT EXISTS idx_notes_flags ON notes(is_deleted, is_archived, is_pinned);
        CREATE INDEX IF NOT EXISTS idx_versions_note ON note_versions(note_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_search_history ON search_history(created_at DESC);
        """
    )

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Seed categories
    default_categories = [
        ("日常", "#2dd4bf", 0),
        ("故障", "#f87171", 1),
        ("部署", "#60a5fa", 2),
        ("巡检", "#a78bfa", 3),
        ("学习", "#fbbf24", 4),
        ("日报", "#34d399", 5),
    ]
    for name, color, order in default_categories:
        cur.execute(
            "INSERT OR IGNORE INTO categories (name, color, sort_order) VALUES (?, ?, ?)",
            (name, color, order),
        )

    # Seed phrases
    cur.execute("SELECT COUNT(*) FROM phrases")
    if cur.fetchone()[0] == 0:
        phrases = [
            "已重启服务，验证正常",
            "已回滚至上一版本，服务恢复",
            "配置已更新并 reload，生效确认",
            "磁盘/内存/CPU 巡检正常",
            "告警已确认，持续观察中",
            "变更窗口已关闭，变更完成",
            "备份完成，校验通过",
            "网络连通性正常，排查上游",
        ]
        for i, text in enumerate(phrases):
            cur.execute(
                "INSERT INTO phrases (text, sort_order) VALUES (?, ?)",
                (text, i),
            )

    # Seed sample servers
    cur.execute("SELECT COUNT(*) FROM servers")
    if cur.fetchone()[0] == 0:
        servers = [
            ("Nginx网关", "10.0.1.100", "生产", "主入口反向代理"),
            ("App节点A", "10.0.1.101", "生产", "Java业务服务"),
            ("MySQL主库", "10.0.1.110", "生产", "主库"),
            ("测试环境", "10.0.2.50", "测试", "联调环境"),
        ]
        for name, ip, env, desc in servers:
            cur.execute(
                "INSERT INTO servers (name, ip, env, description, created_at) VALUES (?, ?, ?, ?, ?)",
                (name, ip, env, desc, now),
            )

    # Seed sample commands
    cur.execute("SELECT COUNT(*) FROM commands")
    if cur.fetchone()[0] == 0:
        commands = [
            ("查看容器状态", "docker ps -a", "容器", "排查容器异常退出"),
            ("进入容器", "docker exec -it <container> /bin/bash", "容器", "进入容器排查"),
            ("查看容器日志", "docker logs -f --tail 200 <container>", "容器", "实时看日志"),
            ("监听端口", "ss -lntp | grep <port>", "网络", "确认端口占用"),
            ("连通性测试", "curl -v http://<host>:<port>/health", "网络", "健康检查"),
            ("磁盘使用", "df -h && du -sh /* 2>/dev/null | sort -hr | head", "系统", "磁盘告警排查"),
            ("进程资源", "top -o %MEM -n 1 | head -20", "系统", "内存占用TOP"),
            ("MySQL慢查询", "SHOW FULL PROCESSLIST;", "数据库", "查看当前连接与慢查询"),
        ]
        for title, cmd, cat, scenario in commands:
            cur.execute(
                """INSERT INTO commands (title, command, category, scenario, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (title, cmd, cat, scenario, now, now),
            )

    # Seed one sample incident note if empty
    cur.execute("SELECT COUNT(*) FROM notes")
    if cur.fetchone()[0] == 0:
        sample_content = """【故障现象】
10:30 收到告警，nginx 返回 502

【处理过程】
1. 10:32 检查 nginx 状态 → `systemctl status nginx` ✅ 正常
2. 10:35 检查后端服务 → 发现 Java 服务内存溢出
3. 10:40 重启 Java 服务 → 恢复正常
4. 10:45 验证接口 → ✅ 正常

【根因】
JVM 内存配置过小，导致 OOM

【解决方案】
```bash
# 调整 JVM 参数示例
-Xmx2g -Xms1g
```

【预防措施】
1. 定期 review JVM 参数
2. 添加内存使用率监控
"""
        tags = json.dumps(["nginx", "故障", "生产环境"], ensure_ascii=False)
        cur.execute(
            """INSERT INTO notes (
                title, content, category, tags, server_ip, server_env,
                is_pinned, is_knowledge, problem_title, solution, likes,
                sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "[故障] Nginx 502 Bad Gateway - 示例",
                sample_content,
                "故障",
                tags,
                "10.0.1.100",
                "生产",
                1,
                1,
                "Nginx 502 Bad Gateway",
                "调整 JVM 参数 -Xmx2g -Xms1g，并添加内存监控告警",
                3,
                0,
                now,
                now,
            ),
        )

    conn.commit()
    conn.close()
    print(f"数据库已初始化: {db_path or DB_PATH}")
    return str(db_path or DB_PATH)


if __name__ == "__main__":
    init_db()
