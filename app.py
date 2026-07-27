#!/usr/bin/env python3
"""Ops Notepad — 运维专属记事本 Flask 后端"""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import zipfile
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file
from flask_cors import CORS

from init_db import DB_PATH, DATA_DIR, get_connection, init_db

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

MAX_VERSIONS = 20


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def parse_tags(raw) -> list:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [normalize_tag(t) for t in raw if t]
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return []
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return [normalize_tag(t) for t in data if t]
        except json.JSONDecodeError:
            pass
        parts = re.split(r"[,，\s]+", raw)
        return [normalize_tag(p) for p in parts if p]
    return []


def normalize_tag(tag: str) -> str:
    t = str(tag).strip()
    if t.startswith("#"):
        t = t[1:]
    return t


def tags_to_json(tags) -> str:
    return json.dumps(parse_tags(tags), ensure_ascii=False)


def row_to_note(row) -> dict:
    d = dict(row)
    d["tags"] = parse_tags(d.get("tags"))
    for key in ("is_pinned", "is_archived", "is_deleted", "is_knowledge", "favorited"):
        d[key] = bool(d.get(key, 0))
    return d


def db():
    return get_connection()


def save_version(conn, note_id: int, title: str, content: str):
    conn.execute(
        "INSERT INTO note_versions (note_id, title, content, created_at) VALUES (?, ?, ?, ?)",
        (note_id, title, content, now_str()),
    )
    # Keep only latest MAX_VERSIONS
    rows = conn.execute(
        "SELECT id FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, id DESC",
        (note_id,),
    ).fetchall()
    if len(rows) > MAX_VERSIONS:
        drop_ids = [r["id"] for r in rows[MAX_VERSIONS:]]
        conn.execute(
            f"DELETE FROM note_versions WHERE id IN ({','.join('?' * len(drop_ids))})",
            drop_ids,
        )


def relevance_score(note: dict, keyword: str) -> int:
    if not keyword:
        return 0
    kw = keyword.lower()
    score = 0
    title = (note.get("title") or "").lower()
    content = (note.get("content") or "").lower()
    tags = " ".join(note.get("tags") or []).lower()
    if kw in title:
        score += 100
        score += title.count(kw) * 20
    if kw in tags:
        score += 50
    if kw in content:
        score += 10
        score += min(content.count(kw), 10) * 2
    if note.get("is_pinned"):
        score += 5
    return score


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Notes CRUD
# ---------------------------------------------------------------------------

@app.route("/api/notes", methods=["GET"])
def list_notes():
    q = request.args.get("q", "").strip()
    category = request.args.get("category", "").strip()
    tag = request.args.get("tag", "").strip()
    server_ip = request.args.get("server_ip", "").strip()
    date_from = request.args.get("date_from", "").strip()
    date_to = request.args.get("date_to", "").strip()
    archived = request.args.get("archived", "0")
    deleted = request.args.get("deleted", "0")
    knowledge = request.args.get("knowledge", "")
    pinned_only = request.args.get("pinned", "")

    conn = db()
    sql = "SELECT * FROM notes WHERE 1=1"
    params = []

    sql += " AND is_deleted = ?"
    params.append(1 if deleted == "1" else 0)

    if deleted != "1":
        sql += " AND is_archived = ?"
        params.append(1 if archived == "1" else 0)

    if category:
        sql += " AND category = ?"
        params.append(category)
    if server_ip:
        sql += " AND server_ip = ?"
        params.append(server_ip)
    if knowledge == "1":
        sql += " AND is_knowledge = 1"
    if pinned_only == "1":
        sql += " AND is_pinned = 1"
    if date_from:
        sql += " AND date(updated_at) >= date(?)"
        params.append(date_from)
    if date_to:
        sql += " AND date(updated_at) <= date(?)"
        params.append(date_to)
    if tag:
        sql += " AND tags LIKE ?"
        params.append(f'%"{normalize_tag(tag)}"%')

    sql += " ORDER BY is_pinned DESC, sort_order ASC, updated_at DESC"
    rows = conn.execute(sql, params).fetchall()
    notes = [row_to_note(r) for r in rows]

    if q:
        # Record search history
        conn.execute(
            "INSERT INTO search_history (query, created_at) VALUES (?, ?)",
            (q, now_str()),
        )
        # Deduplicate recent identical queries (keep latest)
        conn.execute(
            """DELETE FROM search_history WHERE id NOT IN (
                SELECT MAX(id) FROM search_history GROUP BY query
            ) AND query = ?""",
            (q,),
        )
        # Keep last 20
        conn.execute(
            """DELETE FROM search_history WHERE id NOT IN (
                SELECT id FROM search_history ORDER BY created_at DESC, id DESC LIMIT 20
            )"""
        )
        conn.commit()

        filtered = []
        for n in notes:
            hay = " ".join(
                [
                    n.get("title") or "",
                    n.get("content") or "",
                    " ".join(n.get("tags") or []),
                    n.get("server_ip") or "",
                    n.get("problem_title") or "",
                    n.get("solution") or "",
                ]
            ).lower()
            if q.lower() in hay:
                n["_score"] = relevance_score(n, q)
                filtered.append(n)
        # 相关度 DESC → 置顶优先 → 更新时间 DESC
        notes = sorted(
            filtered,
            key=lambda x: (
                x.get("_score", 0),
                int(bool(x.get("is_pinned"))),
                x.get("updated_at") or "",
            ),
            reverse=True,
        )

    conn.close()
    return jsonify({"ok": True, "data": notes})


@app.route("/api/notes/<int:note_id>", methods=["GET"])
def get_note(note_id):
    conn = db()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"ok": False, "error": "笔记不存在"}), 404
    return jsonify({"ok": True, "data": row_to_note(row)})


@app.route("/api/notes", methods=["POST"])
def create_note():
    data = request.get_json(force=True) or {}
    now = now_str()
    title = (data.get("title") or "").strip() or f"无标题笔记 - {today_str()}"
    content = data.get("content") or ""
    category = data.get("category") or "日常"
    tags = tags_to_json(data.get("tags"))
    server_ip = data.get("server_ip") or ""
    server_env = data.get("server_env") or ""
    is_knowledge = 1 if data.get("is_knowledge") else 0
    problem_title = data.get("problem_title") or ""
    solution = data.get("solution") or ""

    conn = db()
    # Put new notes at top of sort order
    max_order = conn.execute("SELECT MIN(sort_order) FROM notes").fetchone()[0]
    sort_order = (max_order - 1) if max_order is not None else 0

    cur = conn.execute(
        """INSERT INTO notes (
            title, content, category, tags, server_ip, server_env,
            is_pinned, is_archived, is_deleted, is_knowledge,
            problem_title, solution, likes, favorited, sort_order,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 0, 0, ?, ?, ?)""",
        (
            title, content, category, tags, server_ip, server_env,
            is_knowledge, problem_title, solution, sort_order, now, now,
        ),
    )
    note_id = cur.lastrowid
    save_version(conn, note_id, title, content)
    conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "data": row_to_note(row)})


@app.route("/api/notes/<int:note_id>", methods=["PUT", "PATCH"])
def update_note(note_id):
    data = request.get_json(force=True) or {}
    conn = db()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "error": "笔记不存在"}), 404

    old = dict(row)
    fields = {
        "title": data.get("title", old["title"]),
        "content": data.get("content", old["content"]),
        "category": data.get("category", old["category"]),
        "tags": tags_to_json(data["tags"]) if "tags" in data else old["tags"],
        "server_ip": data.get("server_ip", old["server_ip"]),
        "server_env": data.get("server_env", old["server_env"]),
        "is_pinned": int(bool(data["is_pinned"])) if "is_pinned" in data else old["is_pinned"],
        "is_archived": int(bool(data["is_archived"])) if "is_archived" in data else old["is_archived"],
        "is_deleted": int(bool(data["is_deleted"])) if "is_deleted" in data else old["is_deleted"],
        "is_knowledge": int(bool(data["is_knowledge"])) if "is_knowledge" in data else old["is_knowledge"],
        "problem_title": data.get("problem_title", old["problem_title"]),
        "solution": data.get("solution", old["solution"]),
        "likes": data.get("likes", old["likes"]),
        "favorited": int(bool(data["favorited"])) if "favorited" in data else old["favorited"],
        "sort_order": data.get("sort_order", old["sort_order"]),
        "updated_at": now_str(),
    }

    content_changed = (
        fields["title"] != old["title"] or fields["content"] != old["content"]
    )
    # Auto-save without version spam: only version when content meaningfully changes
    # and caller requests save_version, or content differs and force_version
    create_ver = data.get("save_version", content_changed and data.get("manual_save", False))
    if create_ver or (content_changed and data.get("force_version")):
        save_version(conn, note_id, fields["title"], fields["content"])
    elif content_changed and data.get("auto_save"):
        # Throttle versions on autosave: at most one version per 5 minutes of changes
        last = conn.execute(
            "SELECT created_at FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT 1",
            (note_id,),
        ).fetchone()
        should = True
        if last:
            try:
                last_dt = datetime.strptime(last["created_at"], "%Y-%m-%d %H:%M:%S")
                if datetime.now() - last_dt < timedelta(minutes=5):
                    should = False
            except ValueError:
                pass
        if should:
            save_version(conn, note_id, fields["title"], fields["content"])

    conn.execute(
        """UPDATE notes SET
            title=?, content=?, category=?, tags=?, server_ip=?, server_env=?,
            is_pinned=?, is_archived=?, is_deleted=?, is_knowledge=?,
            problem_title=?, solution=?, likes=?, favorited=?, sort_order=?, updated_at=?
        WHERE id=?""",
        (
            fields["title"], fields["content"], fields["category"], fields["tags"],
            fields["server_ip"], fields["server_env"], fields["is_pinned"],
            fields["is_archived"], fields["is_deleted"], fields["is_knowledge"],
            fields["problem_title"], fields["solution"], fields["likes"],
            fields["favorited"], fields["sort_order"], fields["updated_at"], note_id,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "data": row_to_note(row)})


@app.route("/api/notes/<int:note_id>", methods=["DELETE"])
def delete_note(note_id):
    """Soft delete by default; ?hard=1 for permanent."""
    hard = request.args.get("hard") == "1"
    conn = db()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "error": "笔记不存在"}), 404
    if hard:
        conn.execute("DELETE FROM note_versions WHERE note_id = ?", (note_id,))
        conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    else:
        conn.execute(
            "UPDATE notes SET is_deleted = 1, updated_at = ? WHERE id = ?",
            (now_str(), note_id),
        )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/notes/<int:note_id>/restore", methods=["POST"])
def restore_note(note_id):
    conn = db()
    conn.execute(
        "UPDATE notes SET is_deleted = 0, is_archived = 0, updated_at = ? WHERE id = ?",
        (now_str(), note_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"ok": False, "error": "笔记不存在"}), 404
    return jsonify({"ok": True, "data": row_to_note(row)})


@app.route("/api/notes/reorder", methods=["POST"])
def reorder_notes():
    data = request.get_json(force=True) or {}
    order = data.get("order") or []
    conn = db()
    for i, nid in enumerate(order):
        conn.execute("UPDATE notes SET sort_order = ? WHERE id = ?", (i, nid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/notes/<int:note_id>/like", methods=["POST"])
def like_note(note_id):
    conn = db()
    conn.execute("UPDATE notes SET likes = likes + 1 WHERE id = ?", (note_id,))
    conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"ok": False, "error": "笔记不存在"}), 404
    return jsonify({"ok": True, "data": row_to_note(row)})


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------

@app.route("/api/notes/<int:note_id>/versions", methods=["GET"])
def list_versions(note_id):
    conn = db()
    rows = conn.execute(
        "SELECT id, note_id, title, created_at, LENGTH(content) AS content_len FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, id DESC",
        (note_id,),
    ).fetchall()
    conn.close()
    return jsonify({"ok": True, "data": [dict(r) for r in rows]})


@app.route("/api/versions/<int:version_id>", methods=["GET"])
def get_version(version_id):
    conn = db()
    row = conn.execute("SELECT * FROM note_versions WHERE id = ?", (version_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"ok": False, "error": "版本不存在"}), 404
    return jsonify({"ok": True, "data": dict(row)})


@app.route("/api/notes/<int:note_id>/versions/<int:version_id>/restore", methods=["POST"])
def restore_version(note_id, version_id):
    conn = db()
    ver = conn.execute(
        "SELECT * FROM note_versions WHERE id = ? AND note_id = ?",
        (version_id, note_id),
    ).fetchone()
    if not ver:
        conn.close()
        return jsonify({"ok": False, "error": "版本不存在"}), 404
    current = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if current:
        save_version(conn, note_id, current["title"], current["content"])
    conn.execute(
        "UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?",
        (ver["title"], ver["content"], now_str(), note_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "data": row_to_note(row)})


# ---------------------------------------------------------------------------
# Tags / Categories / Phrases
# ---------------------------------------------------------------------------

@app.route("/api/tags", methods=["GET"])
def list_tags():
    conn = db()
    rows = conn.execute(
        "SELECT tags FROM notes WHERE is_deleted = 0"
    ).fetchall()
    conn.close()
    counter = {}
    for r in rows:
        for t in parse_tags(r["tags"]):
            counter[t] = counter.get(t, 0) + 1
    result = [{"name": k, "count": v} for k, v in sorted(counter.items(), key=lambda x: -x[1])]
    return jsonify({"ok": True, "data": result})


@app.route("/api/categories", methods=["GET"])
def list_categories():
    conn = db()
    rows = conn.execute("SELECT * FROM categories ORDER BY sort_order, id").fetchall()
    conn.close()
    return jsonify({"ok": True, "data": [dict(r) for r in rows]})


@app.route("/api/categories", methods=["POST"])
def create_category():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    color = data.get("color") or "#3d8bfd"
    if not name:
        return jsonify({"ok": False, "error": "分类名不能为空"}), 400
    conn = db()
    try:
        max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) FROM categories").fetchone()[0]
        conn.execute(
            "INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)",
            (name, color, max_order + 1),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"ok": False, "error": "分类已存在"}), 400
    rows = conn.execute("SELECT * FROM categories ORDER BY sort_order, id").fetchall()
    conn.close()
    return jsonify({"ok": True, "data": [dict(r) for r in rows]})


@app.route("/api/phrases", methods=["GET"])
def list_phrases():
    conn = db()
    rows = conn.execute("SELECT * FROM phrases ORDER BY sort_order, id").fetchall()
    conn.close()
    return jsonify({"ok": True, "data": [dict(r) for r in rows]})


@app.route("/api/search/history", methods=["GET"])
def search_history():
    conn = db()
    rows = conn.execute(
        "SELECT * FROM search_history ORDER BY created_at DESC, id DESC LIMIT 20"
    ).fetchall()
    conn.close()
    return jsonify({"ok": True, "data": [dict(r) for r in rows]})


@app.route("/api/search/history", methods=["DELETE"])
def clear_search_history():
    conn = db()
    conn.execute("DELETE FROM search_history")
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Knowledge base — similar problems
# ---------------------------------------------------------------------------

@app.route("/api/knowledge/similar", methods=["GET"])
def similar_knowledge():
    title = request.args.get("title", "").strip()
    if not title:
        return jsonify({"ok": True, "data": []})
    conn = db()
    rows = conn.execute(
        "SELECT * FROM notes WHERE is_deleted = 0 AND is_knowledge = 1 ORDER BY likes DESC, updated_at DESC"
    ).fetchall()
    conn.close()
    notes = [row_to_note(r) for r in rows]
    # Tokenize title for simple similarity
    tokens = [t for t in re.split(r"[\s\-\[\]【】|/]+", title.lower()) if len(t) >= 2]
    scored = []
    for n in notes:
        hay = f"{n.get('title','')} {n.get('problem_title','')} {' '.join(n.get('tags') or [])}".lower()
        score = sum(1 for t in tokens if t in hay)
        if score > 0 or (title.lower() in hay):
            if title.lower() in hay:
                score += 3
            n["_score"] = score
            scored.append(n)
    scored.sort(key=lambda x: (-x["_score"], -x.get("likes", 0)))
    return jsonify({"ok": True, "data": scored[:8]})


# ---------------------------------------------------------------------------
# Daily report
# ---------------------------------------------------------------------------

@app.route("/api/daily", methods=["GET"])
def daily_summary():
    day = request.args.get("date") or today_str()
    conn = db()
    rows = conn.execute(
        """SELECT * FROM notes WHERE is_deleted = 0
           AND (date(created_at) = date(?) OR date(updated_at) = date(?))
           ORDER BY updated_at DESC""",
        (day, day),
    ).fetchall()
    conn.close()
    notes = [row_to_note(r) for r in rows]
    created = [n for n in notes if (n.get("created_at") or "")[:10] == day]
    updated = [n for n in notes if (n.get("updated_at") or "")[:10] == day]

    lines = [
        f"# {day} 工作日报",
        "",
        "## 【今日完成】",
        "",
    ]
    if created:
        for n in created:
            lines.append(f"- {n['title']} ✓")
    else:
        lines.append("- （今日暂无新建笔记）")
    lines += ["", "## 【今日更新】", ""]
    for n in updated:
        if n not in created:
            lines.append(f"- {n['title']}")
    if len(lines) and lines[-1] == "":
        pass
    lines += [
        "",
        "## 【遇到的问题】",
        "",
        "- ",
        "",
        "## 【明日计划】",
        "",
        "- ",
        "",
    ]
    report_md = "\n".join(lines)
    return jsonify({
        "ok": True,
        "data": {
            "date": day,
            "created": created,
            "updated": updated,
            "report_md": report_md,
            "count_created": len(created),
            "count_updated": len(updated),
        },
    })


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------

@app.route("/api/calendar", methods=["GET"])
def calendar_data():
    year = int(request.args.get("year") or datetime.now().year)
    month = int(request.args.get("month") or datetime.now().month)
    conn = db()
    rows = conn.execute(
        """SELECT date(created_at) AS d, COUNT(*) AS cnt FROM notes
           WHERE is_deleted = 0
             AND strftime('%Y', created_at) = ?
             AND strftime('%m', created_at) = ?
           GROUP BY date(created_at)""",
        (str(year), f"{month:02d}"),
    ).fetchall()
    conn.close()
    data = {r["d"]: r["cnt"] for r in rows}
    return jsonify({"ok": True, "data": data, "year": year, "month": month})


@app.route("/api/calendar/day", methods=["GET"])
def calendar_day():
    day = request.args.get("date") or today_str()
    conn = db()
    rows = conn.execute(
        """SELECT * FROM notes WHERE is_deleted = 0
           AND date(created_at) = date(?)
           ORDER BY created_at DESC""",
        (day,),
    ).fetchall()
    conn.close()
    return jsonify({"ok": True, "data": [row_to_note(r) for r in rows], "date": day})


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@app.route("/api/stats", methods=["GET"])
def stats():
    conn = db()
    month_prefix = datetime.now().strftime("%Y-%m")
    month_count = conn.execute(
        "SELECT COUNT(*) FROM notes WHERE is_deleted = 0 AND created_at LIKE ?",
        (f"{month_prefix}%",),
    ).fetchone()[0]

    cats = conn.execute(
        """SELECT category, COUNT(*) AS cnt FROM notes
           WHERE is_deleted = 0 GROUP BY category ORDER BY cnt DESC"""
    ).fetchall()

    tag_rows = conn.execute("SELECT tags FROM notes WHERE is_deleted = 0").fetchall()
    tag_counter = {}
    for r in tag_rows:
        for t in parse_tags(r["tags"]):
            tag_counter[t] = tag_counter.get(t, 0) + 1
    top_tags = sorted(tag_counter.items(), key=lambda x: -x[1])[:10]

    # Streak: consecutive days with at least one note created/updated ending today or yesterday
    days = conn.execute(
        """SELECT DISTINCT date(updated_at) AS d FROM notes
           WHERE is_deleted = 0 ORDER BY d DESC"""
    ).fetchall()
    day_set = {r["d"] for r in days}
    streak = 0
    cursor = datetime.now().date()
    # If today has no activity, start from yesterday
    if cursor.isoformat() not in day_set:
        cursor = cursor - timedelta(days=1)
    while cursor.isoformat() in day_set:
        streak += 1
        cursor = cursor - timedelta(days=1)

    total = conn.execute("SELECT COUNT(*) FROM notes WHERE is_deleted = 0").fetchone()[0]
    knowledge = conn.execute(
        "SELECT COUNT(*) FROM notes WHERE is_deleted = 0 AND is_knowledge = 1"
    ).fetchone()[0]
    commands = conn.execute("SELECT COUNT(*) FROM commands").fetchone()[0]
    conn.close()

    return jsonify({
        "ok": True,
        "data": {
            "month_created": month_count,
            "total_notes": total,
            "knowledge_count": knowledge,
            "commands_count": commands,
            "top_tags": [{"name": k, "count": v} for k, v in top_tags],
            "top_categories": [{"name": r["category"], "count": r["cnt"]} for r in cats],
            "streak_days": streak,
        },
    })


# ---------------------------------------------------------------------------
# Commands favorites
# ---------------------------------------------------------------------------

@app.route("/api/commands", methods=["GET"])
def list_commands():
    category = request.args.get("category", "").strip()
    conn = db()
    if category:
        rows = conn.execute(
            "SELECT * FROM commands WHERE category = ? ORDER BY updated_at DESC",
            (category,),
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM commands ORDER BY category, updated_at DESC").fetchall()
    conn.close()
    return jsonify({"ok": True, "data": [dict(r) for r in rows]})


@app.route("/api/commands", methods=["POST"])
def create_command():
    data = request.get_json(force=True) or {}
    now = now_str()
    conn = db()
    cur = conn.execute(
        """INSERT INTO commands (title, command, category, scenario, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            data.get("title") or "未命名命令",
            data.get("command") or "",
            data.get("category") or "系统",
            data.get("scenario") or "",
            now,
            now,
        ),
    )
    cid = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM commands WHERE id = ?", (cid,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "data": dict(row)})


@app.route("/api/commands/<int:cmd_id>", methods=["PUT"])
def update_command(cmd_id):
    data = request.get_json(force=True) or {}
    conn = db()
    row = conn.execute("SELECT * FROM commands WHERE id = ?", (cmd_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "error": "命令不存在"}), 404
    old = dict(row)
    conn.execute(
        """UPDATE commands SET title=?, command=?, category=?, scenario=?, updated_at=? WHERE id=?""",
        (
            data.get("title", old["title"]),
            data.get("command", old["command"]),
            data.get("category", old["category"]),
            data.get("scenario", old["scenario"]),
            now_str(),
            cmd_id,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM commands WHERE id = ?", (cmd_id,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "data": dict(row)})


@app.route("/api/commands/<int:cmd_id>", methods=["DELETE"])
def delete_command(cmd_id):
    conn = db()
    conn.execute("DELETE FROM commands WHERE id = ?", (cmd_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Servers
# ---------------------------------------------------------------------------

@app.route("/api/servers", methods=["GET"])
def list_servers():
    conn = db()
    rows = conn.execute("SELECT * FROM servers ORDER BY env, name").fetchall()
    conn.close()
    return jsonify({"ok": True, "data": [dict(r) for r in rows]})


@app.route("/api/servers", methods=["POST"])
def create_server():
    data = request.get_json(force=True) or {}
    conn = db()
    cur = conn.execute(
        "INSERT INTO servers (name, ip, env, description, created_at) VALUES (?, ?, ?, ?, ?)",
        (
            data.get("name") or "",
            data.get("ip") or "",
            data.get("env") or "测试",
            data.get("description") or "",
            now_str(),
        ),
    )
    sid = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM servers WHERE id = ?", (sid,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "data": dict(row)})


@app.route("/api/servers/<int:sid>", methods=["PUT"])
def update_server(sid):
    data = request.get_json(force=True) or {}
    conn = db()
    row = conn.execute("SELECT * FROM servers WHERE id = ?", (sid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "error": "服务器不存在"}), 404
    old = dict(row)
    conn.execute(
        "UPDATE servers SET name=?, ip=?, env=?, description=? WHERE id=?",
        (
            data.get("name", old["name"]),
            data.get("ip", old["ip"]),
            data.get("env", old["env"]),
            data.get("description", old["description"]),
            sid,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM servers WHERE id = ?", (sid,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "data": dict(row)})


@app.route("/api/servers/<int:sid>", methods=["DELETE"])
def delete_server(sid):
    conn = db()
    conn.execute("DELETE FROM servers WHERE id = ?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

@app.route("/api/templates/incident", methods=["GET"])
def incident_template():
    tpl = """【故障现象】


【影响范围】


【故障原因】


【处理过程】
1. 
2. 

【解决方案】


【处理时长】


【预防措施】
1. 
2. 
"""
    return jsonify({"ok": True, "data": {"title": f"[故障]  - {today_str()}", "content": tpl, "category": "故障"}})


# ---------------------------------------------------------------------------
# Export / Import
# ---------------------------------------------------------------------------

@app.route("/api/export", methods=["GET"])
def export_data():
    fmt = request.args.get("format", "json")
    conn = db()
    notes = [row_to_note(r) for r in conn.execute("SELECT * FROM notes WHERE is_deleted = 0").fetchall()]
    commands = [dict(r) for r in conn.execute("SELECT * FROM commands").fetchall()]
    servers = [dict(r) for r in conn.execute("SELECT * FROM servers").fetchall()]
    categories = [dict(r) for r in conn.execute("SELECT * FROM categories").fetchall()]
    conn.close()

    if fmt == "json":
        payload = {
            "exported_at": now_str(),
            "version": 1,
            "notes": notes,
            "commands": commands,
            "servers": servers,
            "categories": categories,
        }
        buf = BytesIO(json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))
        buf.seek(0)
        return send_file(
            buf,
            mimetype="application/json",
            as_attachment=True,
            download_name=f"ops-notepad-backup-{today_str()}.json",
        )

    if fmt == "markdown":
        mem = BytesIO()
        with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as zf:
            for n in notes:
                cat = n.get("category") or "未分类"
                safe_title = re.sub(r'[\\/:*?"<>|]', "_", n.get("title") or f"note-{n['id']}")
                tags = " ".join(f"#{t}" for t in (n.get("tags") or []))
                md = f"# {n.get('title')}\n\n"
                md += f"> 分类: {cat} | 标签: {tags} | 服务器: {n.get('server_ip') or '-'} ({n.get('server_env') or '-'})\n"
                md += f"> 创建: {n.get('created_at')} | 更新: {n.get('updated_at')}\n\n"
                md += n.get("content") or ""
                zf.writestr(f"{cat}/{safe_title}.md", md.encode("utf-8"))
            index_lines = ["# Ops Notepad 导出索引\n"]
            for n in notes:
                index_lines.append(f"- [{n.get('title')}]({n.get('category')}/{re.sub(r'[\\\\/:*?\"<>|]', '_', n.get('title') or '')}.md)")
            zf.writestr("README.md", "\n".join(index_lines).encode("utf-8"))
        mem.seek(0)
        return send_file(
            mem,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"ops-notepad-md-{today_str()}.zip",
        )

    if fmt == "html":
        items = []
        for n in notes:
            tags = " ".join(f"#{t}" for t in (n.get("tags") or []))
            body = (n.get("content") or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            body = re.sub(r"```(\w*)\n([\s\S]*?)```", r"<pre><code>\2</code></pre>", body)
            body = body.replace("\n", "<br>\n")
            items.append(
                f"<article><h2>{n.get('title')}</h2>"
                f"<p class='meta'>{n.get('category')} · {tags} · {n.get('updated_at')}</p>"
                f"<div class='content'>{body}</div></article>"
            )
        html = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Ops Notepad Export</title>
<style>
body{{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:900px;margin:40px auto;padding:0 20px;background:#0f1419;color:#e7ecf3;line-height:1.6}}
article{{border-bottom:1px solid #2a3340;padding:24px 0}}
.meta{{color:#8b9bb4;font-size:13px}}
pre{{background:#1a2332;padding:12px;overflow:auto;border-radius:6px}}
h1{{color:#2dd4bf}}
</style></head><body>
<h1>运维记事本导出 · {now_str()}</h1>
{''.join(items)}
</body></html>"""
        buf = BytesIO(html.encode("utf-8"))
        buf.seek(0)
        return send_file(
            buf,
            mimetype="text/html",
            as_attachment=True,
            download_name=f"ops-notepad-{today_str()}.html",
        )

    return jsonify({"ok": False, "error": "不支持的格式，可选: json / markdown / html"}), 400


@app.route("/api/import", methods=["POST"])
def import_data():
    if "file" not in request.files:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"ok": False, "error": "请上传备份文件"}), 400
        payload = data
    else:
        f = request.files["file"]
        try:
            payload = json.loads(f.read().decode("utf-8"))
        except Exception as e:
            return jsonify({"ok": False, "error": f"JSON 解析失败: {e}"}), 400

    notes = payload.get("notes") or []
    commands = payload.get("commands") or []
    servers = payload.get("servers") or []
    now = now_str()
    conn = db()
    imported = 0
    for n in notes:
        conn.execute(
            """INSERT INTO notes (
                title, content, category, tags, server_ip, server_env,
                is_pinned, is_archived, is_deleted, is_knowledge,
                problem_title, solution, likes, favorited, sort_order,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                n.get("title") or "导入笔记",
                n.get("content") or "",
                n.get("category") or "日常",
                tags_to_json(n.get("tags")),
                n.get("server_ip") or "",
                n.get("server_env") or "",
                int(bool(n.get("is_pinned"))),
                int(bool(n.get("is_archived"))),
                int(bool(n.get("is_knowledge"))),
                n.get("problem_title") or "",
                n.get("solution") or "",
                int(n.get("likes") or 0),
                int(bool(n.get("favorited"))),
                int(n.get("sort_order") or 0),
                n.get("created_at") or now,
                n.get("updated_at") or now,
            ),
        )
        imported += 1
    for c in commands:
        conn.execute(
            """INSERT INTO commands (title, command, category, scenario, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                c.get("title") or "",
                c.get("command") or "",
                c.get("category") or "系统",
                c.get("scenario") or "",
                c.get("created_at") or now,
                c.get("updated_at") or now,
            ),
        )
    for s in servers:
        conn.execute(
            "INSERT INTO servers (name, ip, env, description, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                s.get("name") or "",
                s.get("ip") or "",
                s.get("env") or "测试",
                s.get("description") or "",
                s.get("created_at") or now,
            ),
        )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "imported_notes": imported})


# ---------------------------------------------------------------------------
# Health / meta
# ---------------------------------------------------------------------------

@app.route("/api/health")
def health():
    return jsonify({
        "ok": True,
        "db_path": str(DB_PATH),
        "time": now_str(),
    })


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

def ensure_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DB_PATH.exists():
        init_db()
    else:
        # Ensure schema exists (idempotent)
        init_db()


if __name__ == "__main__":
    ensure_db()
    port = int(os.environ.get("PORT", 18765))
    print(f"Ops Notepad 启动: http://localhost:{port}")
    print(f"数据目录: {DATA_DIR}")
    app.run(host="0.0.0.0", port=port, debug=False)
