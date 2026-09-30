"""从 ECDICT 生成词库 JSON。

用法：
    python scripts/build_words.py <ecdict.csv 路径>

ECDICT：https://github.com/skywind3000/ECDICT（MIT 协议）
输出：data/index.json 及每个词库的 data/<id>.json，格式见 DESIGN.md 4.1。
"""

import csv
import json
import re
import sys
from pathlib import Path

# 词库：ECDICT 考试标签 → 显示名称
LIBRARIES = [
    ("cet4", "大学英语四级"),
    ("cet6", "大学英语六级"),
    ("ielts", "雅思"),
]
LEVELS = 5          # 难度等级数，按词频均分
MAX_SENSES = 2      # 每个单词保留的词性行数
MAX_MEANINGS = 3    # 每个词性保留的义项数

WORD_RE = re.compile(r"^[a-z][a-z-]*[a-z]$")
POS_RE = re.compile(r"^([a-z]+\.)\s*(.*)$")
NOTE_RE = re.compile(r"\([^)]*\)|（[^）]*）|<[^>]*>")
OUT_DIR = Path(__file__).resolve().parent.parent / "data"


def clean_translation(raw):
    """保留前几个词性和常用义项，去掉括号说明和 [网络]、[计] 等专业标注行。"""
    senses = []
    for line in raw.replace("\\n", "\n").splitlines():
        line = NOTE_RE.sub("", line).strip()
        if not line or line.startswith("["):
            continue
        m = POS_RE.match(line)
        pos, body = (m.group(1) + " ", m.group(2)) if m else ("", line)
        meanings = [s.strip() for s in re.split(r"[,，;；]", body) if s.strip()]
        if meanings:
            senses.append(pos + "，".join(meanings[:MAX_MEANINGS]))
        if len(senses) == MAX_SENSES:
            break
    return "；".join(senses)


def frequency_rank(row):
    """词频排名：优先当代语料库（frq），其次 BNC；都没有则排在最后。"""
    for key in ("frq", "bnc"):
        value = int(row[key] or 0)
        if value > 0:
            return value
    return sys.maxsize


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    csv.field_size_limit(2**31 - 1)

    buckets = {lib_id: [] for lib_id, _ in LIBRARIES}
    with open(sys.argv[1], encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            word = row["word"].strip()
            if not WORD_RE.match(word):
                continue
            libs = [lib_id for lib_id in buckets if lib_id in row["tag"].split()]
            if not libs:
                continue
            # 跳过词形变化（如复数、过去式，exchange 中带 "0:" 原型）
            if "0:" in row["exchange"]:
                continue
            translation = clean_translation(row["translation"])
            if not translation or translation.startswith("abbr."):
                continue
            entry = (frequency_rank(row), word, row["phonetic"].strip(), translation)
            for lib_id in libs:
                buckets[lib_id].append(entry)

    OUT_DIR.mkdir(exist_ok=True)
    index = []
    for lib_id, name in LIBRARIES:
        entries = sorted(buckets[lib_id])
        total = len(entries)
        words = [
            {"w": w, "p": p, "t": t, "lv": i * LEVELS // total + 1}
            for i, (_, w, p, t) in enumerate(entries)
        ]
        payload = {"id": lib_id, "name": name, "words": words}
        (OUT_DIR / f"{lib_id}.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        index.append({"id": lib_id, "name": name, "count": total})
        print(f"{lib_id:<6} {total:>6}")

    (OUT_DIR / "index.json").write_text(
        json.dumps({"libraries": index}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
