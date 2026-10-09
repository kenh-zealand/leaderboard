# Administrationsligaen

Første udkast til et dansk leaderboard til undervisning. En lille webapp med Python, SQLite og en responsiv grænseflade uden et eksternt webframework. På Windows installeres tidszonedata med nedenstående kommando.

## Privat hosted beta
Den hostede beta bruger en Cloudflare Worker og D1 til fælles, vedvarende data. Python-versionen er bevaret til lokal brug. Hostingidentitet ligger i `.openai/hosting.json`; adgangskode og offentlig basisadresse håndteres som runtime-konfiguration hos Sites.

Betaen starter med et tydeligt mærket demohold. Demodata er fiktive. Opret et separat undervisningshold til egne afprøvninger. Site-adgangen er privat; personlige elevlinks omgår ikke platformens adgangskontrol. Deling til andre testpersoner kræver en senere ændring af Site-adgangen.

Worker-kontrol: `node --experimental-sqlite --test tests/worker.test.mjs`.
Build: `npm ci` og `npm run build`. Produktion anvender ikke den eksperimentelle Node-SQLite-adapter; den findes alene til lokal udvikling og tests.

Browseren tilbyder to valgfrie WebMCP-værktøjer til at læse den synlige oversigt og skifte fane. Validering i en understøttet WebMCP-browser var ikke tilgængelig ved første betaudgivelse.

## Start
Installer Python 3.12 eller nyere.

PowerShell:
```powershell
$env:ADMIN_PASSWORD = Read-Host "Vælg en adminadgangskode på mindst 12 tegn"
$env:BASE_URL = "http://localhost:8000"
python -m pip install -r requirements.txt
python server.py
```

Åbn http://localhost:8000 og log ind som underviser. Opret undervisningshold, grupper og studerende. Kopiér invitationslinks fra administrationen. Links er personlige adgangsnøgler; del dem kun med den rette studerende.

Linux/macOS:
```sh
ADMIN_PASSWORD='vælg-en-lang-unik-adgangskode' BASE_URL='http://localhost:8000' python server.py
```

## Indeholder
- Beskyttet adminadgang og personlige invitationslinks, som udveksles til HttpOnly-sessioner.
- Flere undervisningshold, grupper og studerende, navneredigering og gruppeskift.
- Offentligt scoreboard med top 3/5, delte placeringer og fælles holdmissioner.
- Personlig oversigt: XP, level, credits, badges, awards, krav og næste milepæl.
- Holdmissioner og individuelle missioner med tekstaflevering.
- Tildelt medstuderendevurdering med fire kriterier, styrke, forbedringsforslag og begrundelse.
- Underviserens godkendelse af vurderinger; to godkendte vurderinger beregner faglighed og begrundelse (65 point). Forbedring og samarbejde registreres af underviseren (35 point).
- Individuel vurdering efter 10+5+5-modellen; belønninger tildeles kun én gang pr. del.
- Belønningsbutik med serverkontrolleret creditforbrug og indløsninger.
- Redigerbare levels, badges, awards og belønninger.
- Manuel og automatisk ugentlig nulstilling med Europe/Copenhagen som tidszone.
- Udvalgt nulstilling, historik, begrundelser, fortryd seneste ændring og JSON-eksport.
- Fælles SQLite-data på serveren; ingen elevdata i browserens localStorage.

## Undervisningsgang
1. Opret et undervisningshold, grupper og studerende.
2. Opret en holdmission og en individuel mission.
3. Studerende afleverer fra deres personlige link.
4. Tildel medstuderendevurderinger. Vælg to forskellige vurderere uden for målets gruppe.
5. Godkend feedback og vurder individuelle besvarelser.
6. Justér holdpoint, tildel badges/awards, og behandl indløsninger.
7. Nulstil ugepoint. XP, badges, awards og credits bevares, medmindre du vælger dem eksplicit.

## Drift og afgrænsning
GitHub opbevarer koden. Et push opretter ikke en offentligt tilgængelig tjeneste. GitHub Pages kan ikke køre Python-serveren.

Til delte elevlinks skal appen køre på en server med en vedvarende disk og HTTPS. Sæt BASE_URL til den præcise offentlige adresse, SECURE_COOKIE=1 og en unik ADMIN_PASSWORD. Brug en reverse proxy med TLS. PORT (standard 8000), HOST (standard 127.0.0.1) og DATA_DIR (standard ./data) kan konfigureres.

Tag backup af data/leaderboard.sqlite3, mens appen er stoppet, eller brug SQLite backup API. JSON-eksport omfatter faglige data, men ikke adgangsnøgler eller sessioner. Slet ikke databasen ved en opdatering.

Førsteudkastet har én underviseradgang, tekstafleveringer og manuel tildeling af vurderere. Det har ikke mailudsendelse, Moodle-integration, filuploads, SSO, automatisk bedømmelse af fritekst eller automatisk hosting. Automatiske ugeskift gennemføres ved første anmodning efter ugeskiftet. Nye ugeaktiviteter oprettes af underviseren. En badgegrænse viser XP-fremdrift; faglige kriterier kontrolleres af underviseren.

Holdscore pr. mission bruger de to tidligst godkendte, forskellige vurderere. Senere vurderinger giver feedback, men ændrer ikke automatisk scoren. En manuel scoreændring kan tilsidesætte beregningen. Der er ingen automatiske sommer-/semesterreset.

## Kontrol
```sh
python -m unittest discover -s tests -v
node --check static/app.js
```

GitHub Actions kører serverens integrationstests og browserkontrol på hvert push.
