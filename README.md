# SQL Lab — skolēnu personīgo SQL datubāzu laboratorija

Vercel-ready web lietotne ar **personīgiem datubāzu projektiem**, SQL redaktoru, rezultātu tabulām, tabulu sarakstu, vēsturi, skolotāja paneli un SQL piemēriem (PK, FK, CHECK, SQL integritāte).

## Kas ir īsts un kas nav

- **SQLite**: īsts SQLite SQL dzinis (sql.js, WebAssembly) darbojas pārlūkā. Pēc katras veiksmīgas izpildes datubāzes saturs tiek saglabāts **Neon PostgreSQL** kā kodēts SQLite fails. Atjaunojot lapu, faili tiek ielādēti no Neon. Tas ir paredzēts nelieliem mācību projektiem (~850 KB saglabātam SQLite failam). Tas NAV reāls attālināts SQLite serveris.
- **PostgreSQL**: īsts PostgreSQL serveris atsevišķā **Neon laboratorijas projektā**. Katra skolēna kontam piešķir nodalītu shēmu un ierobežotu PostgreSQL lietotāju. Skolēna SQL NETIEK izpildīts ar admin kontu.
- **MySQL**: īsts ārējs MySQL serveris (piemēram, VM vai pārvaldīts MySQL, kas atļauj `CREATE DATABASE`, `CREATE USER`, `GRANT`). Katram skolēnam tiek veidota atsevišķa datubāze un ierobežots lietotājs. Skolēna SQL NETIEK izpildīts ar admin kontu.
- **Vercel**: izvieto statisko saskarni un HTTP API. Vercel neuztur MySQL/PostgreSQL procesus.

> Šis ir **mācību MVP**, nevis pierādīti droša daudznomnieku SQL-as-a-Service platforma publiskam neierobežotam lietotāju skaitam. Pirms lietošanas reālā skolā nepieciešama infrastruktūras pārbaude, pakalpojumu izmaksu limiti, uzraudzība, rezerve, privātuma un drošības izvērtēšana, kā arī lietotāju datu glabāšanas politika.

## Palaišana uz Vercel

1. **Izveido jaunus, no skolas produkcijas un TicketLab izolētus resursus:**
   - Neon projekts **SQL Lab kontiem** → `DATABASE_URL`.
   - Cits Neon projekts **skolēnu PostgreSQL laboratorijai** → `PG_LAB_ADMIN_URL` (admin lietotājam vajag `CREATE ROLE`, `CREATE SCHEMA`; Neon parasti atļauj lomu un datubāzu pārvaldību ar atbilstošām tiesībām).
   - Izolēts MySQL serveris **mācību SQL** → `MYSQL_LAB_ADMIN_URL` (admin tiesības izveidot DB + SQL lietotājus un piešķirt atļaujas). Ja nav MySQL servera, atstāj šo env neiestatītu, un MySQL vide būs atslēgta.
2. **Neon SQL Editor** kontu datubāzē, uz kuru norāda `DATABASE_URL`, izpildi visu failu `db/schema.sql`. Šis solis ir obligāts. Deploy pats tabulas neizveido.
3. Repo augšupielādē GitHub, tad Vercel **New Project → Import**. Framework **Other**, Root Directory šī projekta sakne; Build Command `npm run build` (jau `vercel.json`), Output Directory `dist` (jau `vercel.json`), Install Command `npm install`.
4. Vercel → **Settings → Environment Variables** ieliec visus obligātos `.env.example` mainīgos. `SESSION_SECRET` ģenerē vismaz 32 simbolu nejaušu virkni; `ADMIN_PASSWORD` — vismaz 12 simbolu unikālu paroli. Pēc iestatīšanas **Redeploy**.
5. Pārbaude: `https://tavs-projekts.vercel.app/api?action=health` atgriež `storage:true`, `postgres:true` un `mysql:true` (ja visi integrēti). Atver sākumlapu, pieslēdzies kā skolotājs, tad reģistrē testa skolēnu ar `CLASS_CODE`.
6. SQLite kļūst pieejama uzreiz. PostgreSQL un MySQL sadaļās skolēns nospiež **“Izveidot manu datubāzi”** — tas ir datubāzes shēmas/lietotāja inicializēšanas solis, kuram ārējā hostinga admin kontam vajag atbilstošas tiesības.

### Vercel Environment Variables

| Mainīgais | Obligāts? | Nozīme |
|---|---|---|
| `DATABASE_URL` | Jā | Neon PostgreSQL **lietotnes metadatiem** (`lab_users`, `lab_workspaces`, `lab_queries`) |
| `SESSION_SECRET` | Jā | Nejauša virkne ≥32 simboli; paraksta sesiju cookies un atvasina skolēnu SQL lomu paroles |
| `CLASS_CODE` | Jā | Kodam jābūt zināmam tikai grupai, lai neautorizētas personas nereģistrētos |
| `ADMIN_USERNAME` | Jā | Skolotāja lietotājvārds |
| `ADMIN_PASSWORD` | Jā | Skolotāja parole ≥12 rakstzīmes |
| `PG_LAB_ADMIN_URL` | PG nepieciešams | **Atsevišķa** Neon projekta admin PostgreSQL connection string |
| `MYSQL_LAB_ADMIN_URL` | MySQL nepieciešams | Atsevišķā MySQL servera admin connection string |
| `MYSQL_LAB_SSL` | MySQL pēc vajadzības | `true` (noklusēti) vai `false` tikai uzticamam lokālam serverim |

**Nedrīkst** publicēt `.env` GitHub! Vercel env vērtības ievada tikai servera pusē, nevis `NEXT_PUBLIC_...`.

### Vietējā izstrāde

```bash
npm install
# izveido .env.local no .env.example un ievadi īstās vērtības
npx vercel dev
```

`npx vercel dev` izmanto Vercel CLI. Var arī izmantot projekta vieglo `npm run dev` skriptu, kas izmanto Vercel CLI (ja tā ir pieejama). Testē ar `npm run build`, kas kopē SQL.js WASM no `node_modules` uz `dist/vendor`.

## Skolēna darba gaita

1. Reģistrējas: lietotājvārds, vārds, grupa, parole (min 10), skolotāja `CLASS_CODE`.
2. Atver SQLite vai izveido personīgo PostgreSQL/MySQL darba vidi.
3. Raksta SQL (`CREATE TABLE`, `INSERT`, `SELECT`, `JOIN`, `FOREIGN KEY` u.c.).
4. `Ctrl+Enter`/`⌘+Enter` vai **Izpildīt SQL**. Dati ir viņa personīgajā datubāzē, parādās tabulu sarakstā.
5. **Saglabāt** saglabā redaktora kodu, SQLite arī faila saturu. SQL kodu var lejupielādēt kā `.sql`; SQLite var lejupielādēt kā `.sqlite`.
6. Skolotājs pārskatā redz skolēnu, darba vides, redaktora kodu un pēdējos 80 SQL izpildes ierakstus.

### Par MySQL un vairāku komandu izpildi

MySQL drošības dēļ neļauj vienā reizē sūtīt vairākas SQL komandas (`multipleStatements:false`). Izpildi `CREATE TABLE`, `INSERT`, `SELECT` pa vienam. PostgreSQL un SQLite atļauj komandu blokus.

## Ierobežojumi / drošība / izmaksas

- Mācību eksperimentus **nekad** nepieslēdz reālām biznesa vai skolas datubāzēm. Privilegētie `PG_LAB_ADMIN_URL` un `MYSQL_LAB_ADMIN_URL` tiek izmantoti **tikai izolētas skolēnu darba vides izveidei**, ne viņu SQL izpildei.
- PostgreSQL lomām nav superuser, role-creation vai database-creation tiesību, tās pārvalda savu shēmu; MySQL lietotājiem ir atļaujas tikai savā datubāzē. Tomēr SQL laboratorija var radīt lielu slodzi vai pārtērēt apjoma limitus. Izmanto īpaši šim paredzētu projektu/instanci, hostinga kvotas, un, ja nepieciešams, atsevišķu izpildes pakalpojumu ar CPU/atmiņas limitiem.
- PostgreSQL klientam uzstādīts 5s statement timeout; MySQL vaicājumiem 7s timeout; rezultātu saraksts rāda līdz 150 rindām (PG draiveris var nolasīt vairāk rindas no servera, pirms samazina attēlojamo rezultātu). Mācību slodzēm vajadzīgi pakalpojuma līmeņa resursu limiti.
- SQLite fails saglabājas Neon datubāzē kā Base64; kopējais viena faila limits ~850 KB. Pārlūka sesijā var izpildīt lielākus vaicājumus, bet saglabāšana pārsniedzot limitu atteiks.
- Skolotājs redz SQL vaicājumu vēsturi un skolēnu vārdus; skolēni jāinformē par šo datu apstrādi. Neievadiet personu sensitīvus datus.
- `SESSION_SECRET` maiņa pārtrauc esošās sesijas un **var izjaukt piekļuvi iepriekš izveidotām PostgreSQL/MySQL skolēnu lomām**; izveidoto lomu paroles būs jāatiestata vai jāatjauno. Saglabā šo noslēpumu droši un stabili.
- SQLite tiek darbināta **pārlūkā**, tāpēc tās SQL izpildes loģika nav servera autoritatīva. Skolotāja vēsturi var izmantot mācību progresam, nevis kā drošu eksāmena auditu.
- Pirmā versija nav paredzēta cilvēkiem bez uzraudzības no interneta. Klasei izmanto tikai autorizētus kontus, izvērtē piekļuves ierobežošanu, rezerves kopijas un uzraudzību.

## Kam paredzētas mapes?

```
api/index.js       Vercel Node.js API, konti, sesijas, SQL izpilde, admin panelis
public/index.html  SQL redaktora un lietotāja saskarnes HTML
public/style.css   Dizains un pielāgojums telefonam
public/app.js      Pārlūka funkcionalitāte, sql.js SQLite dzinis
scripts/build.mjs  Iepako WASM un statisko UI Vercel dist/
db/schema.sql      Izpilda Neon kontu datubāzē pirms pirmās palaišanas
```

## Gada moduļa izmantošana

- 5.1. Datu integritāte: `NOT NULL`, `UNIQUE`, `CHECK`, `PRIMARY KEY`, `FOREIGN KEY`, `ON DELETE`.
- 5.1. Optimizācija: `CREATE INDEX`, `EXPLAIN`, vaicājumu uzlabojumi.
- 5.2. SQL testēšana: `JOIN`, `GROUP BY`, apakšvaicājumi, kļūdainu SQL labošana.
- 6.1. Datu tipi un apmaiņa: `CAST`, CSV/JSON datu sagatavošana; web UI vēl nav pilnvērtīga CSV importa/eksporta, izņemot `.sql` un SQLite faila eksportu.
