"""Real-browser checks of teacher and student flows; run explicitly in CI."""
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
with socket.socket() as sock:
    sock.bind(("127.0.0.1",0))
    port = sock.getsockname()[1]
url = f"http://127.0.0.1:{port}"
password = "browser-test-admin-123"
with tempfile.TemporaryDirectory() as folder:
    env = dict(os.environ,ADMIN_PASSWORD=password,BASE_URL=url,PORT=str(port),
               HOST="127.0.0.1",DATA_DIR=folder)
    command = ["node", "--experimental-sqlite", str(root/"scripts/dev.mjs")] if os.environ.get("SERVER_VARIANT") == "worker" else [sys.executable,str(root/"server.py")]
    process = subprocess.Popen(command,env=env,stdout=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(url)
                break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError("Server did not start")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width":1440,"height":1000})
            errors = []
            page.on("pageerror",lambda err:errors.append(str(err)))
            page.goto(url)
            page.get_by_role("button",name="Underviserlogin").click()
            page.get_by_label("Adminadgangskode").fill(password)
            page.get_by_role("dialog").get_by_role("button",name="Gem",exact=True).click()
            if os.environ.get("SERVER_VARIANT") != "worker":
                page.get_by_role("button",name="Opret første hold").click()
            else:
                page.get_by_role("button",name="Hold & studerende",exact=True).click()
                page.get_by_role("button",name="Nyt undervisningshold",exact=True).click()
            page.get_by_label("Holdnavn").fill("Testhold")
            page.get_by_role("dialog").get_by_role("button",name="Gem",exact=True).click()
            page.get_by_role("button",name="Hold & studerende",exact=True).click()
            page.get_by_role("button",name="Ny gruppe",exact=True).click()
            page.get_by_label("Gruppenavn").fill("Team Budget")
            page.get_by_role("dialog").get_by_role("button",name="Gem",exact=True).click()
            page.get_by_role("button",name="Ny studerende",exact=True).click()
            page.get_by_label("Navn eller visningsnavn").fill("Anna <script>alert(1)</script>")
            page.get_by_label("Gruppe",exact=True).select_option(label="Team Budget")
            page.get_by_role("dialog").get_by_role("button",name="Gem",exact=True).click()
            expect(page.get_by_text("Anna <script>alert(1)</script>",exact=True)).to_be_visible()
            page.on("dialog",lambda dialog:dialog.accept())
            page.get_by_role("button",name="Adgangslink",exact=True).click()
            link = page.get_by_label("Adgangslink",exact=True).input_value()
            page.get_by_role("button",name="Luk",exact=True).click()
            page.get_by_role("button",name="Aktiviteter",exact=True).click()
            page.get_by_role("button",name="Opret aktivitet").click()
            page.get_by_label("Titel",exact=True).fill("Find fejlen")
            page.get_by_label("Aktivitetstype").select_option("individual")
            page.get_by_label("Opgave og forventet produkt").fill("Find en budgetfejl og begrund rettelsen.")
            page.get_by_role("dialog").get_by_role("button",name="Gem",exact=True).click()

            student_context = browser.new_context(viewport={"width":390,"height":844})
            student = student_context.new_page()
            student.on("pageerror",lambda err:errors.append(str(err)))
            student.goto(link)
            expect(student.get_by_role("heading",name="Mit scoreboard",exact=True)).to_be_visible()
            assert "#invite=" not in student.url
            overflow = student.evaluate("""() => [...document.querySelectorAll('body *')]
              .filter(el => el.getBoundingClientRect().right > innerWidth + 1)
              .map(el => ({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right}))
              .slice(0,15)""")
            assert student.locator("body").evaluate("(el)=>el.scrollWidth <= innerWidth") is True, overflow
            student.get_by_role("button",name="Mine missioner",exact=True).click()
            student.get_by_role("button",name="Åbn og aflever",exact=True).click()
            student.get_by_label("Din individuelle besvarelse").fill("Budgettet mangler en udgift på 100 kr.")
            student.get_by_role("dialog").get_by_role("button",name="Gem",exact=True).click()
            expect(student.get_by_text("Budgettet mangler en udgift på 100 kr.",exact=True)).to_be_visible()
            page.get_by_role("button",name="Opdatér",exact=True).click()
            page.get_by_role("button",name="Vurdér individuelt",exact=True).click()
            page.get_by_label("Godkendt besvarelse: 10 XP + 5 credits").check()
            page.get_by_label("Tydelig begrundelse: 5 XP").check()
            page.get_by_label("Feedback",exact=True).fill("Korrekt og præcist.")
            page.get_by_role("dialog").get_by_role("button",name="Gem",exact=True).click()
            student.get_by_role("button",name="Opdatér",exact=True).click()
            student.get_by_role("button",name="Mit scoreboard",exact=True).click()
            expect(student.locator(".stat").filter(has_text="Personlige XP").locator("strong")).to_have_text("15")
            student.get_by_role("button",name="Badges & awards",exact=True).click()
            expect(student.get_by_role("heading",name="Badges — opnået og opnåeligt")).to_be_visible()
            student.get_by_role("button",name="Belønningsbutik",exact=True).click()
            student.on("dialog",lambda dialog:dialog.accept())
            student.get_by_role("button",name="Indløs",exact=True).first.click()
            expect(student.get_by_text("0 AdminCredits",exact=True)).to_be_visible()
            expect(student.get_by_text("Afventer underviseren",exact=False)).to_be_visible()
            # Server rejects attempts to reach administration from a student browser.
            code = student.evaluate("""async () => {
              const me=await (await fetch('/api/me')).json();
              return (await fetch('/api/admin/invite',{method:'POST',
                headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},
                body:JSON.stringify({studentId:'other'})})).status;
            }""")
            assert code == 403
            Path("test-results").mkdir(exist_ok=True)
            student.screenshot(path="test-results/student-mobile.png",full_page=True)
            page.get_by_role("button",name="Overblik",exact=True).click()
            page.screenshot(path="test-results/admin-desktop.png",full_page=True)
            assert not errors, errors
            browser.close()
            print("Browser flows passed: login, setup, invitation, privacy, mission, grading, shop, mobile.")
    finally:
        process.terminate()
        process.wait(timeout=10)
