"""Examinations — papers, sections and the question bank.

A translation of the desktop's ``electron/ipc/academics.js`` exam handlers, so
a paper written in the office and a paper written in a browser are the same
row in the same three tables.

Why it is worth having online at all: a teacher writes an end-of-term paper at
home on a Sunday, not at the one PC in the office on a Friday afternoon. The
question bank is the part that compounds — three years of questions, tagged by
class, subject and difficulty, is a resource a school builds once and draws on
every term, and it is worth nothing if it can only be reached from one machine.

Access is `academics`: view to read, create to add, edit to change, delete to
remove. A paper is not a mark — it decides nothing about a pupil — so it does
not carry the stricter gates the score sheets do.
"""
from . import security

PAPER_FIELDS = ["title", "class_group_id", "subject_id", "term_id", "exam_type",
                "total_marks", "duration_minutes", "instructions", "status"]

QUESTION_FIELDS = ["exam_paper_id", "section_id", "class_group_id", "subject_id",
                   "question_type", "question_text", "question_image_path", "marks",
                   "difficulty", "option_a", "option_b", "option_c", "option_d",
                   "correct_option", "model_answer", "display_order", "in_question_bank"]

SECTION_FIELDS = ["exam_paper_id", "section_label", "instructions",
                  "marks_allocation", "display_order"]


def _clean(data, fields):
    out = {}
    for k in fields:
        if k in (data or {}):
            v = data[k]
            out[k] = None if v == "" else v
    return out


# ── papers ──────────────────────────────────────────────────────────────────

def list_papers(db, actor, class_id=None, subject_id=None, term_id=None, status=None):
    sql = """
      SELECT ep.*, cg.name AS class_name, s.name AS subject_name, t.label AS term_label,
             u.full_name AS created_by_name,
             (SELECT count(*) FROM exam_questions q WHERE q.exam_paper_id = ep.id) AS question_count
        FROM exam_papers ep
        LEFT JOIN class_groups cg ON cg.id = ep.class_group_id
        LEFT JOIN subjects s ON s.id = ep.subject_id
        LEFT JOIN terms t ON t.id = ep.term_id
        LEFT JOIN users u ON u.id = ep.created_by
       WHERE 1=1"""
    params = []
    if class_id:
        sql += " AND ep.class_group_id = %s"; params.append(class_id)
    if subject_id:
        sql += " AND ep.subject_id = %s"; params.append(subject_id)
    if term_id:
        sql += " AND ep.term_id = %s"; params.append(term_id)
    if status:
        sql += " AND ep.status = %s"; params.append(status)
    sql += " ORDER BY ep.id DESC"
    return {"ok": True, "papers": db.all(sql, tuple(params)),
            "may_edit": security.can(actor, "academics", "edit"),
            "may_create": security.can(actor, "academics", "create")}


def get_paper(db, actor, paper_id):
    paper = db.one("""
      SELECT ep.*, cg.name AS class_name, s.name AS subject_name, t.label AS term_label
        FROM exam_papers ep
        LEFT JOIN class_groups cg ON cg.id = ep.class_group_id
        LEFT JOIN subjects s ON s.id = ep.subject_id
        LEFT JOIN terms t ON t.id = ep.term_id
       WHERE ep.id = %s""", (paper_id,))
    if not paper:
        return {"ok": False, "status": 404, "error": "No such paper."}
    paper["sections"] = db.all(
        "SELECT * FROM exam_sections WHERE exam_paper_id = %s ORDER BY display_order, id",
        (paper_id,))
    paper["questions"] = db.all(
        "SELECT * FROM exam_questions WHERE exam_paper_id = %s ORDER BY display_order, id",
        (paper_id,))
    return {"ok": True, "paper": paper}


def save_paper(db, actor, data):
    row = _clean(data, PAPER_FIELDS)
    if not str(row.get("title") or "").strip():
        return {"ok": False, "status": 400, "error": "Give the paper a title."}
    paper_id = (data or {}).get("id")
    if paper_id:
        sets = ", ".join(f'"{k}" = %s' for k in row)
        db.run(f"UPDATE exam_papers SET {sets} WHERE id = %s", tuple(row.values()) + (paper_id,))
    else:
        row.setdefault("status", "draft")
        row["created_by"] = actor["user_id"]
        paper_id = db.insert("exam_papers", row)
    security.audit(db, actor, "exam_paper", paper_id, "save_exam_paper", row["title"])
    return {"ok": True, "id": paper_id}


def delete_paper(db, actor, paper_id):
    paper = db.one("SELECT id, title FROM exam_papers WHERE id = %s", (paper_id,))
    if not paper:
        return {"ok": False, "status": 404, "error": "No such paper."}
    with db.tx() as tx:
        # Questions written INTO the bank survive the paper they were written
        # for; that is the whole point of a bank. The rest go with it.
        tx.run("""UPDATE exam_questions SET exam_paper_id = NULL, section_id = NULL
                   WHERE exam_paper_id = %s AND in_question_bank = 1""", (paper_id,))
        tx.run("DELETE FROM exam_questions WHERE exam_paper_id = %s", (paper_id,))
        tx.run("DELETE FROM exam_sections WHERE exam_paper_id = %s", (paper_id,))
        tx.run("DELETE FROM exam_papers WHERE id = %s", (paper_id,))
    security.audit(db, actor, "exam_paper", paper_id, "delete_exam_paper", paper["title"], "high")
    return {"ok": True}


# ── sections ────────────────────────────────────────────────────────────────

def save_section(db, actor, data):
    row = _clean(data, SECTION_FIELDS)
    if not row.get("exam_paper_id") or not str(row.get("section_label") or "").strip():
        return {"ok": False, "status": 400, "error": "A section needs a paper and a label."}
    section_id = (data or {}).get("id")
    if section_id:
        sets = ", ".join(f'"{k}" = %s' for k in row)
        db.run(f"UPDATE exam_sections SET {sets} WHERE id = %s", tuple(row.values()) + (section_id,))
    else:
        section_id = db.insert("exam_sections", row)
    return {"ok": True, "id": section_id}


def delete_section(db, actor, section_id):
    with db.tx() as tx:
        tx.run("UPDATE exam_questions SET section_id = NULL WHERE section_id = %s", (section_id,))
        tx.run("DELETE FROM exam_sections WHERE id = %s", (section_id,))
    return {"ok": True}


# ── questions and the bank ──────────────────────────────────────────────────

def list_questions(db, actor, paper_id=None, class_id=None, subject_id=None,
                   question_type=None, difficulty=None, in_bank=None, search=None):
    sql = """
      SELECT q.*, cg.name AS class_name, s.name AS subject_name, ep.title AS paper_title
        FROM exam_questions q
        LEFT JOIN class_groups cg ON cg.id = q.class_group_id
        LEFT JOIN subjects s ON s.id = q.subject_id
        LEFT JOIN exam_papers ep ON ep.id = q.exam_paper_id
       WHERE 1=1"""
    params = []
    if paper_id:
        sql += " AND q.exam_paper_id = %s"; params.append(paper_id)
    if class_id:
        sql += " AND q.class_group_id = %s"; params.append(class_id)
    if subject_id:
        sql += " AND q.subject_id = %s"; params.append(subject_id)
    if question_type:
        sql += " AND q.question_type = %s"; params.append(question_type)
    if difficulty:
        sql += " AND q.difficulty = %s"; params.append(difficulty)
    if in_bank:
        sql += " AND q.in_question_bank = 1"
    if search:
        sql += " AND q.question_text ILIKE %s"; params.append(f"%{search}%")
    sql += " ORDER BY q.display_order, q.id LIMIT 500"
    return {"ok": True, "questions": db.all(sql, tuple(params))}


def save_question(db, actor, data):
    row = _clean(data, QUESTION_FIELDS)
    if not str(row.get("question_text") or "").strip():
        return {"ok": False, "status": 400, "error": "A question needs its text."}
    question_id = (data or {}).get("id")
    if question_id:
        sets = ", ".join(f'"{k}" = %s' for k in row)
        db.run(f"UPDATE exam_questions SET {sets} WHERE id = %s",
               tuple(row.values()) + (question_id,))
    else:
        row["created_by"] = actor["user_id"]
        question_id = db.insert("exam_questions", row)
    return {"ok": True, "id": question_id}


def delete_question(db, actor, question_id):
    db.run("DELETE FROM exam_questions WHERE id = %s", (question_id,))
    return {"ok": True}


def copy_from_bank(db, actor, paper_id, section_id, question_ids):
    """Put bank questions onto a paper — copied, not moved.

    A bank question used on this term's paper has to still be in the bank for
    next term's, so each is duplicated rather than re-pointed. That is also why
    the copy has `in_question_bank = 0`: the bank would otherwise fill up with
    one entry per time a question was ever used.
    """
    if not paper_id or not question_ids:
        return {"ok": False, "status": 400, "error": "Choose a paper and at least one question."}
    order = db.value("""SELECT COALESCE(max(display_order), 0) FROM exam_questions
                         WHERE exam_paper_id = %s""", (paper_id,), 0)
    copied = 0
    with db.tx() as tx:
        for qid in question_ids:
            q = db.one("SELECT * FROM exam_questions WHERE id = %s", (qid,))
            if not q:
                continue
            order += 1
            tx.run("""INSERT INTO exam_questions
                        (exam_paper_id, section_id, class_group_id, subject_id, question_type,
                         question_text, question_image_path, marks, difficulty,
                         option_a, option_b, option_c, option_d, correct_option, model_answer,
                         display_order, in_question_bank, created_by)
                      VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,%s)""",
                   (paper_id, section_id, q["class_group_id"], q["subject_id"], q["question_type"],
                    q["question_text"], q["question_image_path"], q["marks"], q["difficulty"],
                    q["option_a"], q["option_b"], q["option_c"], q["option_d"],
                    q["correct_option"], q["model_answer"], order, actor["user_id"]))
            copied += 1
    return {"ok": True, "copied": copied}
