import copy
import hashlib
import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Store, make_server, week_key

PASSWORD = "a-test-password-12345"


class Client:
    def __init__(self, url):
        self.url = url
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.csrf = ""

    def call(self, path, data=None, origin=True, csrf=True):
        headers = {}
        if data is not None:
            headers["Content-Type"] = "application/json"
            if origin:
                headers["Origin"] = self.url
            if csrf:
                headers["X-CSRF-Token"] = self.csrf
        req = urllib.request.Request(self.url + path,
            data=json.dumps(data).encode() if data is not None else None, headers=headers)
        try:
            res = self.opener.open(req)
        except urllib.error.HTTPError as e:
            res = e
        body = res.read()
        try:
            result = json.loads(body)
        except ValueError:
            result = body.decode()
        return res.status, result

    def login(self):
        assert self.call("/api/login", {"password":PASSWORD})[0] == 200
        self.csrf = self.call("/api/me")[1]["csrf"]

    def invite(self, token):
        assert self.call("/api/invite", {"token":token})[0] == 200
        self.csrf = self.call("/api/me")[1]["csrf"]


class AppTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name)/"data.sqlite3")
        self.server = make_server("127.0.0.1",0,self.store,PASSWORD,"")
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.server.RequestHandlerClass.base_url = self.url
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.admin = Client(self.url)
        self.admin.login()
        self.act(dict(op="class",name="Semester 2",top=3,autoReset=False))
        self.cid = self.store.read()["classes"][0]["id"]
        self.act(dict(op="team",classId=self.cid,name="Budget"))
        self.act(dict(op="team",classId=self.cid,name="Proces"))
        self.t1,self.t2 = [t["id"] for t in self.store.read()["teams"]]
        for name,tid in [("Anna",self.t1),("Bo",self.t2),("Cia",self.t2)]:
            self.act(dict(op="student",classId=self.cid,teamId=tid,name=name,active=True))
        self.p1,self.p2,self.p3 = [p["id"] for p in self.store.read()["students"]]
        self.student = Client(self.url)
        self.student.invite(self.store.invitation(self.p1))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def act(self, data, client=None, status=200):
        client = client or self.admin
        payload = dict(data,version=self.store.read()["version"])
        route = "/api/admin/action" if client is self.admin else "/api/student/action"
        code,body = client.call(route,payload)
        self.assertEqual(code,status,body)
        return body

    def task(self,kind="individual"):
        self.act(dict(op="task",classId=self.cid,kind=kind,title="Mission",
                      description="Forklar dit valg.",criteria="Begrundet, korrekt.",open=True))
        return self.store.read()["tasks"][-1]["id"]

    def submit(self,task,client=None):
        self.act(dict(op="submit",taskId=task,body="En fagligt begrundet løsning."),client or self.student)
        return self.store.read()["submissions"][-1]["id"]

    def test_auth_csrf_and_role_separation(self):
        public = Client(self.url)
        self.assertEqual(public.call("/api/state")[0],401)
        self.assertEqual(public.call("/api/login",{"password":PASSWORD},origin=False)[0],403)
        self.assertEqual(self.admin.call("/api/admin/action",{"op":"class"},csrf=False)[0],403)
        self.assertEqual(self.student.call("/api/admin/invite",{"studentId":self.p2})[0],403)
        self.assertEqual(self.student.call("/api/admin/action",{"op":"reset"})[0],403)
        self.assertEqual(self.admin.call("/../server.py")[0],404)

    def test_rate_limit_is_shared_across_requests(self):
        client = Client(self.url)
        for _ in range(12):
            self.assertEqual(client.call("/api/login",{"password":"wrong"})[0],401)
        self.assertEqual(client.call("/api/login",{"password":PASSWORD})[0],429)

    def test_private_projection_and_public_board(self):
        state = self.student.call("/api/state")[1]
        self.assertEqual(state["student"]["id"],self.p1)
        self.assertNotIn("students",state)
        self.assertNotIn("audit",state)
        self.assertNotIn("invitations",state)
        board = Client(self.url).call("/api/public?class="+self.cid)[1]
        self.assertNotIn("Anna",json.dumps(board))
        self.assertNotIn("credits",json.dumps(board))
        self.assertEqual([x["rank"] for x in board["teams"]],[1,1])

    def test_invite_rotation_revokes_session(self):
        token = self.store.invitation(self.p1)
        self.assertEqual(self.student.call("/api/state")[0],401)
        self.student.invite(token)
        self.assertEqual(self.student.call("/api/state")[0],200)
        self.act(dict(op="student",id=self.p1,classId=self.cid,teamId=self.t1,name="Anna",active=False))
        self.assertEqual(self.student.call("/api/state")[0],401)

    def test_grade_is_idempotent_and_mission_limit(self):
        task = self.task()
        sub = self.submit(task)
        grade = dict(op="grade",id=sub,good=True,reasoning=True,improved=False,feedback="Godt.")
        self.act(grade)
        self.act(grade)
        self.assertEqual(self.store.read()["students"][0]["xp"],15)
        self.assertEqual(self.store.read()["students"][0]["credits"],5)
        self.act(dict(grade,improved=True))
        self.assertEqual(self.store.read()["students"][0]["xp"],20)
        self.assertEqual(self.store.read()["students"][0]["credits"],7)
        other = self.submit(self.task())
        self.act(dict(grade,id=other),status=400)

    def test_purchase_stale_version_and_refund(self):
        self.act(dict(op="metrics",type="student",id=self.p1,xp=20,credits=5,levelOverride=""))
        reward = self.store.read()["rewards"][0]
        stale = self.store.read()["version"]
        self.act(dict(op="buy",id=reward["id"]),self.student)
        self.assertEqual(self.store.read()["students"][0]["credits"],0)
        self.assertEqual(self.student.call("/api/student/action",
                         dict(op="buy",id=reward["id"],version=stale))[0],400)
        self.act(dict(op="buy",id=reward["id"]),self.student,status=400)
        redemption = self.store.read()["redemptions"][0]
        self.act(dict(op="redemption",id=redemption["id"],status="refunded"))
        self.act(dict(op="redemption",id=redemption["id"],status="refunded"),status=400)
        self.assertEqual(self.store.read()["students"][0]["credits"],5)

    def test_reset_preserves_personal_progress_and_undo(self):
        self.act(dict(op="metrics",type="student",id=self.p1,xp=70,credits=15,levelOverride=""))
        self.act(dict(op="metrics",type="team",id=self.t1,components=[30,20,10,10]))
        task = self.task()
        self.act(dict(op="reset",scope="class",id=self.cid,fields=["week"]))
        s = self.store.read()
        self.assertEqual(s["teams"][0]["score"],0)
        self.assertEqual(s["students"][0]["xp"],70)
        self.assertEqual(s["students"][0]["credits"],15)
        self.assertFalse(s["tasks"][0]["open"])
        self.assertEqual(s["archives"][0]["scores"][0]["score"],70)
        status,_ = self.admin.call("/api/admin/undo",{"version":s["version"]})
        self.assertEqual(status,200)
        self.assertEqual(self.store.read()["teams"][0]["score"],70)
        self.assertTrue(self.store.read()["tasks"][0]["open"])
        self.assertEqual(self.admin.call("/api/admin/undo",{"version":s["version"]})[0],400)

    def test_automatic_week_reset_and_copenhagen_week(self):
        self.act(dict(op="class",id=self.cid,name="Semester 2",top=3,autoReset=True))
        s = self.store.read()
        s["classes"][0]["week"] = "2000-W01"
        s["teams"][0]["score"] = 50
        self.store.write(s)
        self.admin.call("/api/state")
        self.assertEqual(self.store.read()["teams"][0]["score"],0)
        self.assertEqual(self.store.read()["classes"][0]["week"],week_key())
        count = len(self.store.read()["archives"])
        self.admin.call("/api/state")
        self.assertEqual(len(self.store.read()["archives"]),count)

    def test_peer_assessment_assignment_rewards_and_score(self):
        task = self.task("team")
        sub = self.submit(task)
        self.act(dict(op="assign",submissionId=sub,reviewer=self.p1),status=400)
        for pid in [self.p2,self.p3]:
            self.act(dict(op="assign",submissionId=sub,reviewer=pid))
            client = Client(self.url)
            client.invite(self.store.invitation(pid))
            r = self.store.read()["reviews"][-1]
            self.act(dict(op="review",id=r["id"],ratings=[4,4,3,3],
                          strength="Præcis løsning.",improvement="Uddyb antagelsen.",
                          evidence="Beregningsafsnittet viser metoden."),client)
            self.act(dict(op="approve_review",id=r["id"]))
            self.act(dict(op="approve_review",id=r["id"]))
        self.assertEqual(self.store.read()["teams"][0]["score"],65)
        self.assertEqual(self.store.read()["students"][1]["credits"],3)
        self.assertEqual(self.store.read()["students"][2]["credits"],3)
        self.act(dict(op="submit",taskId=task,body="Ændret efter vurdering."),self.student,status=400)
        self.act(dict(op="metrics",type="team",id=self.t1,components=[40,25,20,15]))
        self.assertEqual(self.store.read()["teams"][0]["score"],100)

    def test_cross_class_review_is_rejected(self):
        self.act(dict(op="class",name="Andet hold",top=3))
        cid = self.store.read()["classes"][-1]["id"]
        self.act(dict(op="student",name="Dan",classId=cid,teamId="",active=True))
        pid = self.store.read()["students"][-1]["id"]
        sub = self.submit(self.task())
        self.act(dict(op="assign",submissionId=sub,reviewer=pid),status=400)

    def test_negative_metrics_and_invalid_reset_rejected(self):
        self.act(dict(op="metrics",type="student",id=self.p1,xp=-1,credits=0),status=400)
        self.act(dict(op="reset",scope="class",id=self.cid,fields=["unknown"]),status=400)
        self.assertEqual(self.store.read()["students"][0]["xp"],0)

    def test_grant_remove_and_manual_level(self):
        s = self.store.read()
        badge = s["badges"][0]["id"]
        self.act(dict(op="grant",studentId=self.p1,kind="badges",itemId=badge,reason="Kontrolleret."))
        self.act(dict(op="grant",studentId=self.p1,kind="badges",itemId=badge,reason="Kontrolleret."))
        self.assertEqual(len(self.store.read()["students"][0]["badges"]),1)
        self.act(dict(op="grant",studentId=self.p1,kind="badges",itemId=badge,remove=True))
        self.assertEqual(self.store.read()["students"][0]["badges"],[])
        self.act(dict(op="metrics",type="student",id=self.p1,xp=0,credits=0,levelOverride=s["levels"][-1]["id"]))
        self.assertEqual(self.student.call("/api/state")[1]["level"]["name"],"Strategisk rådgiver")


if __name__ == "__main__":
    unittest.main()
