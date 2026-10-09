"""Administrationsligaen: dependency-free educational leaderboard."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
from datetime import datetime
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
LOCK = threading.RLock()
SESSION_TTL = 60 * 60 * 12


def week_key():
    y, w, _ = datetime.now(ZoneInfo("Europe/Copenhagen")).isocalendar()
    return f"{y}-W{w:02d}"


def uid():
    return secrets.token_hex(12)


def text(value, limit=500):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError("Udfyld feltet med en gyldig tekst.")
    return value.strip()


def number(value, maximum=1000000):
    if isinstance(value, bool):
        raise ValueError("Brug et heltal.")
    n = int(value)
    if n != float(value) or n < 0 or n > maximum:
        raise ValueError(f"Brug et heltal mellem 0 og {maximum}.")
    return n


def find(items, item_id):
    item = next((x for x in items if x["id"] == item_id), None)
    if not item:
        raise ValueError("Elementet findes ikke.")
    return item


def initial_state():
    return dict(version=0, classes=[], teams=[], students=[], tasks=[], submissions=[],
                reviews=[], redemptions=[], archives=[], week=week_key(),
                levels=[dict(id=uid(), name=n, xp=x) for n, x in [
                    ("Administrationspraktikant", 0), ("Sagskoordinator", 40),
                    ("Administrationskonsulent", 100), ("Projektleder", 200),
                    ("Strategisk rådgiver", 350)]],
                badges=[dict(id=uid(), name=n, criteria=c, xp=x) for n, c, x in [
                    ("Budgetmester", "Godkendt budget med forklarede forudsætninger.", 20),
                    ("Procesforbedrer", "Begrundet og realistisk forbedring af en arbejdsgang.", 20),
                    ("Feedback i praksis", "Tre dokumenterede forbedringer efter feedback.", 40)]],
                awards=[dict(id=uid(), name=n, criteria=c) for n, c in [
                    ("Ugens fremgang", "Tydelig faglig forbedring, dokumenteret af underviseren."),
                    ("Ugens sparringspartner", "Særlig konkret og anvendelig hjælp til andre.")]],
                rewards=[dict(id=uid(), name=n, criteria=c, price=p) for n, c, p in [
                    ("Ekstra hint", "Et ekstra hint til en øvelsesmission.", 5),
                    ("Vælg en alternativ opgave", "Vælg blandt underviserens godkendte alternativer.", 5),
                    ("Vælg casetema", "Aftal temaet med underviseren.", 10)]], audit=[])


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions
                (token TEXT PRIMARY KEY, role TEXT, student TEXT, csrf TEXT, expires REAL);
                CREATE TABLE IF NOT EXISTS invitations
                (student TEXT PRIMARY KEY, digest TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS history
                (id TEXT PRIMARY KEY, before TEXT NOT NULL);
            """)
            db.execute("INSERT OR IGNORE INTO state VALUES (1,?)", (json.dumps(initial_state()),))

    def db(self):
        return sqlite3.connect(self.path)

    def read(self):
        with self.db() as db:
            return json.loads(db.execute("SELECT data FROM state WHERE id=1").fetchone()[0])

    def write(self, state):
        with self.db() as db:
            db.execute("UPDATE state SET data=? WHERE id=1", (json.dumps(state, ensure_ascii=False),))

    def mutate(self, actor, label, callback, version=None):
        with LOCK:
            state = self.read()
            if version is not None and state["version"] != version:
                raise ValueError("Data er ændret i en anden fane. Opdatér og prøv igen.")
            before = json.dumps(state, ensure_ascii=False)
            result = callback(state)
            event = dict(id=uid(), at=datetime.now(ZoneInfo("Europe/Copenhagen")).isoformat(),
                         actor=actor, label=label)
            state["version"] += 1
            state["audit"].append(event)
            state["audit"] = state["audit"][-100:]
            with self.db() as db:
                db.execute("INSERT INTO history VALUES (?,?)", (event["id"], before))
                db.execute("UPDATE state SET data=? WHERE id=1", (json.dumps(state, ensure_ascii=False),))
            return result

    def rollover(self):
        with LOCK:
            s = self.read()
            current = week_key()
            due = [c["id"] for c in s["classes"] if c["autoReset"] and c["week"] != current]
            if due:
                def apply(state):
                    for cid in due:
                        reset_week(state, cid)
                self.mutate("system", "Automatisk ugentlig nulstilling", apply)

    def invitation(self, student):
        token = secrets.token_urlsafe(32)
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO invitations VALUES (?,?)",
                       (student, hashlib.sha256(token.encode()).hexdigest()))
            # A rotated invitation also revokes all existing sessions for this student.
            db.execute("DELETE FROM sessions WHERE student=?", (student,))
        return token

    def student_for_token(self, token):
        if not isinstance(token, str):
            return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.db() as db:
            row = db.execute("SELECT student FROM invitations WHERE digest=?", (digest,)).fetchone()
        return row[0] if row else None

    def session(self, role, student=""):
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        with self.db() as db:
            db.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))
            db.execute("INSERT INTO sessions VALUES (?,?,?,?,?)",
                       (hashlib.sha256(token.encode()).hexdigest(), role, student, csrf,
                        time.time() + SESSION_TTL))
        return token

    def auth(self, token):
        with self.db() as db:
            row = db.execute("SELECT role,student,csrf FROM sessions WHERE token=? AND expires>?",
                             (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
        return dict(role=row[0], student=row[1], csrf=row[2]) if row else None

    def logout(self, token):
        with self.db() as db:
            db.execute("DELETE FROM sessions WHERE token=?",
                       (hashlib.sha256(token.encode()).hexdigest(),))

    def undo(self, version):
        with LOCK:
            s = self.read()
            if s["version"] != version or not s["audit"]:
                raise ValueError("Ingen aktuel ændring at fortryde.")
            last = s["audit"][-1]
            if last["label"].startswith("Fortryd:"):
                raise ValueError("Den seneste ændring er allerede fortrudt.")
            with self.db() as db:
                row = db.execute("SELECT before FROM history WHERE id=?", (last["id"],)).fetchone()
            restored = json.loads(row[0])
            restored["version"] = s["version"] + 1
            restored["audit"] = s["audit"] + [dict(id=uid(), actor="admin",
                at=datetime.now(ZoneInfo("Europe/Copenhagen")).isoformat(),
                label="Fortryd: " + last["label"])]
            self.write(restored)


def reset_week(s, cid):
    c = find(s["classes"], cid)
    teams = [t for t in s["teams"] if t["classId"] == cid]
    s["archives"].append(dict(id=uid(), classId=cid, week=c["week"],
                             at=datetime.now(ZoneInfo("Europe/Copenhagen")).isoformat(),
                             scores=[dict(name=t["name"], score=t["score"]) for t in teams]))
    s["archives"] = s["archives"][-200:]
    for t in teams:
        t["score"] = 0
        t["components"] = [0, 0, 0, 0]
    # Close old activities to prevent late reviews from restoring last week's score.
    for task in s["tasks"]:
        if task["classId"] == cid:
            task["open"] = False
    c["week"] = week_key()


def level_for(s, student):
    if student.get("levelOverride"):
        return find(s["levels"], student["levelOverride"])
    eligible = [x for x in s["levels"] if x["xp"] <= student["xp"]]
    return max(eligible, key=lambda x: x["xp"]) if eligible else min(s["levels"], key=lambda x: x["xp"])


def public_state(s, cid):
    c = find(s["classes"], cid)
    teams = [dict(id=t["id"], name=t["name"], score=t["score"],
                  components=t["components"]) for t in s["teams"] if t["classId"] == cid]
    teams.sort(key=lambda t: (-t["score"], t["name"]))
    previous, rank = None, 0
    for i, team in enumerate(teams):
        if team["score"] != previous:
            rank = i + 1
        team["rank"] = rank
        previous = team["score"]
    return dict(classroom=c, teams=[t for t in teams if t["rank"] <= c["top"]],
                tasks=[t for t in s["tasks"] if t["classId"] == cid and t["kind"] == "team" and t["open"]],
                version=s["version"])


def student_state(s, sid):
    student = find(s["students"], sid)
    cid = student["classId"]
    team = next((t for t in s["teams"] if t["id"] == student["teamId"]), None)
    assignments = []
    for review in s["reviews"]:
        if review["reviewer"] == sid:
            sub = find(s["submissions"], review["submissionId"])
            assignments.append(dict(**review, product=sub["body"], task=find(s["tasks"], sub["taskId"])))
    return dict(student=student, team=team, classroom=find(s["classes"], cid),
                level=level_for(s, student), levels=s["levels"], badges=s["badges"],
                awards=s["awards"], rewards=s["rewards"],
                tasks=[t for t in s["tasks"] if t["classId"] == cid],
                submissions=[x for x in s["submissions"] if x["studentId"] == sid
                    or (team and x["teamId"] == team["id"])],
                reviews=assignments,
                feedback=[dict(taskId=find(s["submissions"],r["submissionId"])["taskId"],
                               strength=r["strength"], improvement=r["improvement"], evidence=r["evidence"])
                    for r in s["reviews"] if r.get("approved") and
                    (find(s["submissions"],r["submissionId"])["studentId"] == sid or
                     (team and find(s["submissions"],r["submissionId"])["teamId"] == team["id"]))],
                redemptions=[r for r in s["redemptions"] if r["studentId"] == sid],
                scoreboard=public_state(s, cid), version=s["version"])


def admin_action(s, d):
    op = d["op"]
    if op == "class":
        if d.get("id"):
            c = find(s["classes"], d["id"])
        else:
            c = dict(id=uid(), week=week_key(), autoReset=False, top=3)
            s["classes"].append(c)
        c["name"] = text(d["name"], 120)
        c["top"] = number(d.get("top", c["top"]), 20)
        if c["top"] < 1:
            raise ValueError("Vis mindst én placering.")
        c["autoReset"] = bool(d.get("autoReset", c["autoReset"]))
    elif op == "team":
        cid = find(s["classes"], d["classId"])["id"]
        if d.get("id"):
            t = find(s["teams"], d["id"])
            if t["classId"] != cid:
                raise ValueError("Gruppen tilhører et andet hold.")
        else:
            t = dict(id=uid(), classId=cid, score=0, components=[0, 0, 0, 0])
            s["teams"].append(t)
        t["name"] = text(d["name"], 120)
    elif op == "student":
        cid = find(s["classes"], d["classId"])["id"]
        tid = d.get("teamId", "")
        if tid and find(s["teams"], tid)["classId"] != cid:
            raise ValueError("Vælg en gruppe i det samme undervisningshold.")
        if d.get("id"):
            student = find(s["students"], d["id"])
            if student["classId"] != cid:
                raise ValueError("Den studerende tilhører et andet hold.")
        else:
            student = dict(id=uid(), classId=cid, xp=0, credits=0, badges=[], awards=[],
                           levelOverride="", active=True)
            s["students"].append(student)
        student.update(name=text(d["name"], 120), teamId=tid, active=bool(d.get("active", True)))
    elif op == "metrics":
        if d["type"] == "team":
            t = find(s["teams"], d["id"])
            vals = d["components"]
            if not isinstance(vals, list) or len(vals) != 4:
                raise ValueError("Angiv fire vurderingspoint.")
            t["components"] = [number(v, cap) for v, cap in zip(vals, [40, 25, 20, 15])]
            t["score"] = sum(t["components"])
        else:
            p = find(s["students"], d["id"])
            p["xp"], p["credits"] = number(d["xp"]), number(d["credits"])
            override = d.get("levelOverride", "")
            if override:
                find(s["levels"], override)
            p["levelOverride"] = override
    elif op == "task":
        cid = find(s["classes"], d["classId"])["id"]
        if d.get("id"):
            task = find(s["tasks"], d["id"])
            if task["classId"] != cid:
                raise ValueError("Aktiviteten tilhører et andet hold.")
        else:
            task = dict(id=uid(), classId=cid, week=find(s["classes"],cid)["week"])
            s["tasks"].append(task)
        kind = d["kind"]
        if kind not in ("team", "individual"):
            raise ValueError("Vælg hold eller individuel aktivitet.")
        if task.get("kind") and task["kind"] != kind:
            raise ValueError("Opret en ny aktivitet for at ændre aktivitetstype.")
        task.update(title=text(d["title"], 160), description=text(d["description"], 8000),
                    criteria=text(d["criteria"], 4000), kind=kind, open=bool(d.get("open", True)))
    elif op == "catalog":
        kind = d["kind"]
        if kind not in ("levels", "badges", "awards", "rewards"):
            raise ValueError("Ukendt katalog.")
        item = find(s[kind], d["id"]) if d.get("id") else dict(id=uid())
        item["name"] = text(d["name"], 120)
        if kind != "levels":
            item["criteria"] = text(d["criteria"], 2000)
        if kind in ("levels", "badges"):
            item["xp"] = number(d["xp"])
        if kind == "rewards":
            item["price"] = number(d["price"], 10000)
        if not d.get("id"):
            s[kind].append(item)
    elif op == "grant":
        p = find(s["students"], d["studentId"])
        kind = d["kind"]
        if kind not in ("badges", "awards"):
            raise ValueError("Vælg badge eller award.")
        item = find(s[kind], d["itemId"])
        if d.get("remove"):
            p[kind] = [x for x in p[kind] if x["id"] != item["id"]]
        elif not any(x["id"] == item["id"] for x in p[kind]):
            p[kind].append(dict(id=item["id"], at=datetime.now(ZoneInfo("Europe/Copenhagen")).isoformat(),
                                reason=text(d["reason"], 1000)))
    elif op == "assign":
        sub = find(s["submissions"], d["submissionId"])
        task = find(s["tasks"], sub["taskId"])
        p = find(s["students"], d["reviewer"])
        if p["classId"] != task["classId"] or not p["active"]:
            raise ValueError("Vælg en aktiv studerende på samme hold.")
        if p["id"] == sub["studentId"] or (sub["teamId"] and p["teamId"] == sub["teamId"]):
            raise ValueError("Vurdereren skal være uden for den afleverende gruppe.")
        if any(r["reviewer"] == p["id"] and r["submissionId"] == sub["id"] for r in s["reviews"]):
            raise ValueError("Denne vurderer er allerede tildelt.")
        s["reviews"].append(dict(id=uid(), submissionId=sub["id"], reviewer=p["id"],
                                 approved=False, sent=False, credited=False))
    elif op == "approve_review":
        r = find(s["reviews"], d["id"])
        if not r["sent"]:
            raise ValueError("Vurderingen er ikke afleveret.")
        task = find(s["tasks"], find(s["submissions"], r["submissionId"])["taskId"])
        if not task["open"]:
            raise ValueError("Aktiviteten er lukket.")
        p = find(s["students"], r["reviewer"])
        if not r["credited"]:
            count = sum(1 for x in s["reviews"] if x["reviewer"] == p["id"] and x.get("credited")
                        and x.get("creditWeek") == week_key())
            if count < 2:
                p["credits"] += 3
            r["credited"] = True
            r["creditWeek"] = week_key()
        r["approved"] = True
        sub = find(s["submissions"], r["submissionId"])
        approved = [x for x in s["reviews"] if x["submissionId"] == sub["id"] and x["approved"]]
        if sub["teamId"] and len(approved) >= 2 and not sub.get("scored"):
            t = find(s["teams"], sub["teamId"])
            first = approved[:2]
            # Two anchored criteria; presentation/evidence criteria inform feedback.
            t["components"][0] = round(sum(x["ratings"][0] for x in first) / 2 / 4 * 40)
            t["components"][1] = round(sum(x["ratings"][1] for x in first) / 2 / 4 * 25)
            t["score"] = sum(t["components"])
            sub["scored"] = True
    elif op == "grade":
        sub = find(s["submissions"], d["id"])
        task = find(s["tasks"], sub["taskId"])
        if task["kind"] != "individual":
            raise ValueError("Brug holdets vurdering til holdmissioner.")
        if not task["open"]:
            raise ValueError("Aktiviteten er lukket.")
        p = find(s["students"], sub["studentId"])
        good, reasoning, improved = bool(d.get("good")), bool(d.get("reasoning")), bool(d.get("improved"))
        if (reasoning or improved) and not good:
            raise ValueError("Godkend grundbesvarelsen før ekstra XP.")
        flags = sub.setdefault("granted", dict(good=False, reasoning=False, improved=False))
        # At most one personal mission earns rewards per student and teaching week.
        already = any(x["id"] != sub["id"] and x["studentId"] == p["id"] and x.get("granted",{}).get("good")
                      and find(s["tasks"], x["taskId"])["week"] == task["week"] for x in s["submissions"])
        if already:
            raise ValueError("Ugens individuelle belønning er allerede optjent i en anden mission.")
        for key, flag, xp, credits in [("good",good,10,5),("reasoning",reasoning,5,0),("improved",improved,5,2)]:
            if flag and not flags[key]:
                p["xp"] += xp
                p["credits"] += credits
                flags[key] = True
        sub["feedback"] = text(d["feedback"], 4000)
    elif op == "redemption":
        r = find(s["redemptions"], d["id"])
        status = d["status"]
        if status not in ("fulfilled", "refunded"):
            raise ValueError("Ukendt status.")
        if r["status"] != "pending":
            raise ValueError("Indløsningen er allerede behandlet.")
        if status == "refunded":
            find(s["students"], r["studentId"])["credits"] += r["price"]
        r["status"] = status
    elif op == "reset":
        if d["scope"] == "class":
            cid = find(s["classes"], d["id"])["id"]
            people = [p for p in s["students"] if p["classId"] == cid]
            teams = [t for t in s["teams"] if t["classId"] == cid]
        elif d["scope"] == "team":
            t = find(s["teams"], d["id"])
            teams, people = [t], [p for p in s["students"] if p["teamId"] == t["id"]]
        elif d["scope"] == "student":
            people, teams = [find(s["students"], d["id"])], []
        else:
            raise ValueError("Ukendt nulstillingsområde.")
        fields = d["fields"]
        if not fields or not set(fields) <= {"week", "xp", "credits", "level", "badges", "awards"}:
            raise ValueError("Vælg gyldige felter.")
        if "week" in fields:
            if d["scope"] == "class":
                reset_week(s, d["id"])
            else:
                for t in teams:
                    t["score"], t["components"] = 0, [0, 0, 0, 0]
        for p in people:
            for field in fields:
                if field in ("xp", "credits"):
                    p[field] = 0
                elif field in ("badges", "awards"):
                    p[field] = []
                elif field == "level":
                    p["levelOverride"] = min(s["levels"], key=lambda x:x["xp"])["id"]
    else:
        raise ValueError("Ukendt handling.")


def student_action(s, sid, d):
    p = find(s["students"], sid)
    if not p["active"]:
        raise ValueError("Adgangen er deaktiveret.")
    op = d["op"]
    if op == "submit":
        task = find(s["tasks"], d["taskId"])
        if task["classId"] != p["classId"] or not task["open"]:
            raise ValueError("Aktiviteten er ikke åben.")
        tid = p["teamId"] if task["kind"] == "team" else ""
        if task["kind"] == "team" and not tid:
            raise ValueError("Du skal først placeres i en gruppe.")
        existing = next((x for x in s["submissions"] if x["taskId"] == task["id"] and
                         (x["teamId"] == tid if tid else x["studentId"] == sid)), None)
        body = text(d["body"], 12000)
        if existing:
            existing["body"] = body
            existing["updatedAt"] = datetime.now(ZoneInfo("Europe/Copenhagen")).isoformat()
            # Reviewed products are frozen to keep ratings tied to the displayed product.
            if any(r["submissionId"] == existing["id"] and r["sent"] for r in s["reviews"]):
                raise ValueError("Produktet er vurderet. Bed underviseren oprette en revisionsmission.")
        else:
            s["submissions"].append(dict(id=uid(), taskId=task["id"], studentId=sid if not tid else "",
                                         teamId=tid, body=body, feedback="",
                                         updatedAt=datetime.now(ZoneInfo("Europe/Copenhagen")).isoformat()))
    elif op == "review":
        r = find(s["reviews"], d["id"])
        if r["reviewer"] != sid or r["approved"]:
            raise ValueError("Du kan ikke ændre denne vurdering.")
        sub = find(s["submissions"], r["submissionId"])
        if not find(s["tasks"], sub["taskId"])["open"]:
            raise ValueError("Aktiviteten er lukket.")
        ratings = d["ratings"]
        if not isinstance(ratings, list) or len(ratings) != 4:
            raise ValueError("Vurder alle fire kriterier.")
        values = [number(v, 4) for v in ratings]
        if min(values) < 1:
            raise ValueError("Brug niveau 1–4.")
        r.update(ratings=values, strength=text(d["strength"],2000),
                 improvement=text(d["improvement"],2000), evidence=text(d["evidence"],2000), sent=True)
    elif op == "buy":
        reward = find(s["rewards"], d["id"])
        if p["credits"] < reward["price"]:
            raise ValueError("Du har ikke nok AdminCredits.")
        p["credits"] -= reward["price"]
        s["redemptions"].append(dict(id=uid(), studentId=sid, rewardId=reward["id"],
             name=reward["name"], price=reward["price"], status="pending",
             at=datetime.now(ZoneInfo("Europe/Copenhagen")).isoformat()))
    else:
        raise ValueError("Ukendt handling.")


class Handler(BaseHTTPRequestHandler):
    store = None
    password_hash = None
    password_salt = None
    base_url = ""
    secure_cookie = False
    failed = {}

    def log_message(self, *_):
        # Do not log student access tokens, cookies or student data.
        pass

    def reply(self, status, data, cookie=None, content_type="application/json"):
        body = json.dumps(data, ensure_ascii=False).encode() if content_type == "application/json" else data
        self.send_response(status)
        self.send_header("Content-Type", content_type + ("; charset=utf-8" if content_type.startswith(("text/", "application/json")) else ""))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def cookie_token(self):
        try:
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            return cookies["session"].value if "session" in cookies else ""
        except Exception:
            return ""

    def session_cookie(self, token, clear=False):
        return ("session=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" +
                ("0" if clear else str(SESSION_TTL)) + ("; Secure" if self.secure_cookie else ""))

    def identity(self):
        identity = self.store.auth(self.cookie_token())
        if identity and identity["role"] == "student":
            p = next((p for p in self.store.read()["students"] if p["id"] == identity["student"]), None)
            if not p or not p["active"]:
                return None
        return identity

    def do_GET(self):
        try:
            self.store.rollover()
            parsed = urlparse(self.path)
            path = parsed.path
            if path == "/api/public":
                cid = parse_qs(parsed.query).get("class", [""])[0]
                if not cid:
                    self.reply(200, {"classes":[dict(id=c["id"],name=c["name"]) for c in self.store.read()["classes"]]})
                else:
                    self.reply(200, public_state(self.store.read(), cid))
            elif path == "/api/me":
                a = self.identity()
                self.reply(200, a or {"role":"public"})
            elif path == "/api/state":
                a = self.identity()
                if not a:
                    return self.reply(401, {"error":"Log ind først."})
                s = self.store.read()
                self.reply(200, s if a["role"] == "admin" else student_state(s, a["student"]))
            else:
                allowed = {"/":"index.html", "/app.js":"app.js", "/style.css":"style.css"}
                if path not in allowed:
                    return self.reply(404, {"error":"Siden findes ikke."})
                file = ROOT / "static" / allowed[path]
                kind = {".html":"text/html", ".js":"text/javascript", ".css":"text/css"}[file.suffix]
                self.reply(200, file.read_bytes(), content_type=kind)
        except ValueError as e:
            self.reply(400, {"error":str(e)})
        except Exception:
            self.reply(500, {"error":"Serveren kunne ikke behandle anmodningen."})

    def do_POST(self):
        try:
            origin = self.headers.get("Origin")
            if origin != self.base_url or self.headers.get("Content-Type","").split(";")[0] != "application/json":
                return self.reply(403, {"error":"Anmodningen skal komme fra appens egen adresse."})
            length = int(self.headers.get("Content-Length",0))
            if length <= 0 or length > 100000:
                return self.reply(413, {"error":"Anmodningen er for stor eller tom."})
            d = json.loads(self.rfile.read(length))
            if not isinstance(d, dict):
                raise ValueError("Ugyldige data.")
            self.store.rollover()
            path = urlparse(self.path).path
            if path in ("/api/login", "/api/invite"):
                ip = self.client_address[0]
                with LOCK:
                    type(self).failed = {k:v for k,v in type(self).failed.items() if time.time()-v[1] < 300}
                    count, start = self.failed.get(ip,(0,time.time()))
                    if count >= 12:
                        return self.reply(429, {"error":"For mange forsøg. Vent fem minutter."})
                sid = ""
                valid = False
                if path == "/api/login":
                    password = d.get("password", "")
                    if not isinstance(password,str) or len(password) > 1024:
                        raise ValueError("Ugyldig adgangskode.")
                    actual = hashlib.pbkdf2_hmac("sha256",password.encode(),self.password_salt,200000)
                    valid = hmac.compare_digest(actual,self.password_hash)
                else:
                    sid = self.store.student_for_token(d.get("token",""))
                    p = next((p for p in self.store.read()["students"] if p["id"] == sid),None)
                    valid = bool(p and p["active"])
                if not valid:
                    with LOCK:
                        # Use shared class storage rather than per-request storage.
                        type(self).failed[ip] = (count+1,start)
                    return self.reply(401, {"error":"Adgangen kunne ikke godkendes."})
                with LOCK:
                    type(self).failed.pop(ip,None)
                token = self.store.session("student" if sid else "admin", sid)
                return self.reply(200, {"ok":True},cookie=self.session_cookie(token))
            a = self.identity()
            if not a:
                return self.reply(401, {"error":"Log ind først."})
            if not hmac.compare_digest(self.headers.get("X-CSRF-Token",""),a["csrf"]):
                return self.reply(403, {"error":"Opdatér siden og prøv igen."})
            if path == "/api/logout":
                self.store.logout(self.cookie_token())
                return self.reply(200, {"ok":True},cookie=self.session_cookie("",True))
            if path.startswith("/api/admin/"):
                if a["role"] != "admin":
                    return self.reply(403, {"error":"Kræver underviseradgang."})
                if path == "/api/admin/invite":
                    find(self.store.read()["students"], d["studentId"])
                    token = self.store.invitation(d["studentId"])
                    return self.reply(200, {"url":self.base_url + "/#invite=" + token})
                if path == "/api/admin/undo":
                    self.store.undo(d["version"])
                elif path == "/api/admin/action":
                    label = text(d.get("reason", "Underviser: " + d.get("op","ændring")),1000)
                    self.store.mutate("admin",label,lambda s:admin_action(s,d),version=d["version"])
                else:
                    return self.reply(404, {"error":"Ukendt handling."})
            elif path == "/api/student/action" and a["role"] == "student":
                self.store.mutate(a["student"], "Studerende: " + text(d["op"],30),
                                  lambda s:student_action(s,a["student"],d),version=d["version"])
            else:
                return self.reply(403, {"error":"Handlingen er ikke tilladt."})
            self.reply(200, {"ok":True})
        except (ValueError,KeyError,TypeError,OverflowError) as e:
            self.reply(400, {"error":str(e) if isinstance(e,ValueError) else "Udfyld alle felter korrekt."})
        except Exception:
            self.reply(500, {"error":"Serveren kunne ikke gemme ændringen."})


def make_server(host, port, store, password, base_url, secure=False):
    cls = type("AppHandler",(Handler,),{})
    cls.store, cls.base_url, cls.secure_cookie = store, base_url.rstrip("/"), secure
    cls.password_salt = secrets.token_bytes(16)
    cls.password_hash = hashlib.pbkdf2_hmac("sha256", password.encode(),cls.password_salt,200000)
    cls.failed = {}
    return ThreadingHTTPServer((host,port),cls)


if __name__ == "__main__":
    password = os.environ.get("ADMIN_PASSWORD","")
    if len(password) < 12:
        raise SystemExit("Sæt ADMIN_PASSWORD til en unik adgangskode på mindst 12 tegn.")
    port = int(os.environ.get("PORT",8000))
    url = os.environ.get("BASE_URL",f"http://localhost:{port}").rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme not in ("http","https") or not parsed.netloc or parsed.path:
        raise SystemExit("BASE_URL skal være en adresse uden sti, fx https://leaderboard.example.dk")
    secure = os.environ.get("SECURE_COOKIE","0") == "1" or parsed.scheme == "https"
    store = Store(Path(os.environ.get("DATA_DIR",str(ROOT/"data")))/"leaderboard.sqlite3")
    server = make_server(os.environ.get("HOST","127.0.0.1"),port,store,password,url,secure)
    print(f"Administrationsligaen er klar på {url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
