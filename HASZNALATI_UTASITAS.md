# ME-5 Editor – használati utasítás

A BOSS ME-5 gitár-multieffekt laptopos szerkesztője. A böngészőben egy virtuális pedalboard jelenik meg, a pedálok ugyanabban a sorrendben állnak, mint a jel útja az ME-5-ben. A program USB-MIDI kábelen keresztül beszél az ME-5-tel, de kábel nélkül is használható.

Ez az útmutató az editorból is elérhető: a felső sáv **Útmutató** linkje (`frontend/utmutato.html`). Az ME-5 történetét a **Bemutató** oldal mutatja be (`frontend/bemutato.html`).

## Miért készült?

Az ME-5 egy régi, de nagyon jól szóló eszköz, a kezelése viszont nehézkes. Egy hangzás beállításához patchenként egyenként kell végiglépkedni a paramétereken, közben le kell hajolni a pedálhoz, és egy apró kijelzőn kell követni, mi hol tart. Próbán vagy koncert előtt, amikor gyorsan kellene a hangot az adott erősítőhöz igazítani, ez különösen lassú.

Az ME-5-nek viszont van MIDI csatlakozója, és MIDI-n keresztül minden beállítása elérhető. Ez a program ezt használja ki: a laptopon **egy felületen látszik az egész patch**, minden gomb egyszerre állítható egérrel, és a változás azonnal hallható. A patchek elmenthetők, visszatölthetők, és a gyári hangzások is bármikor elérhetők.

A program arjenv [Boss-ME5-MIDI-Editor](https://github.com/arjenv/Boss-ME5-MIDI-Editor) projektjén alapul, amely eredetileg Raspberry Pi-n futott. Ez a változat Raspberry Pi nélkül, közvetlenül laptopról működik.

## 1. Amire szükség van

- Windows, Python 3.10 vagy újabb.
- USB-MIDI interfész. **Optocsatolós, jó minőségű interfész kell** (pl. Roland UM-ONE mkII). Az olcsó „USB2.0-MIDI” kábeleken a patchváltás átmegy, a SysEx (patch olvasás és írás) viszont nem.

### Hogyan kapcsolódik a laptop a pedálhoz?

```
 Laptop ──USB──► USB-MIDI interfész ──► két 5 tűs DIN dugó ──► ME-5 hátlap
```

1. **Kapcsold ki az ME-5-öt**, mielőtt a MIDI kábelt bedugod. Nem kötelező, de így biztonságosabb.
2. Az interfész két DIN dugóját **keresztbe** kell bedugni:
   - az interfész **OUT** jelű dugója (ezen megy a jel a laptopból) → az ME-5 **MIDI IN** aljzatába;
   - az interfész **IN** jelű dugója (ezen jön a jel a laptopba) → az ME-5 **MIDI OUT** aljzatába.

   Egyes kábeleken fordítva van a felirat, és azt jelöli, hová kell dugni. Ha a patchváltás nem megy, próbáld meg felcserélni a két dugót.
3. Dugd az interfész USB csatlakozóját a laptopba. A Windows magától felismeri; a Roland UM-ONE mkII-höz nem kell külön driver.
4. Kapcsold be az ME-5-öt. A MIDI csatorna bármelyik lehet (1–16): az Auto-detect megkeresi, kézi csatlakozásnál pedig te adod meg. Az ME-5 legyen **Play módban**: Edit módban nem fogad SysEx-et, így az editor nem tudja sem beolvasni, sem állítani a hangokat, csak a patchváltás működik.
5. Indítsd el a programot (3. pont), és csatlakozz a 4. pont szerint.

**Próba:** csatlakozás után a ◀ ▶ gombbal válts patchet. Ha az ME-5 kijelzőjén is átvált a szám, a kapcsolat működik. Ezután a **Read ME-5** gombbal ellenőrizheted, hogy a SysEx is átmegy-e: ha sikerül, a program kiolvassa mind a 64 patchet.

## 2. Első telepítés

Egyszer kell megcsinálni: kattints duplán a `tools\setup-python.cmd` fájlra. Letölt egy hordozható Pythont a `tools\python` mappába, és feltelepíti bele a szükséges csomagokat. A gépre semmit nem telepít, és a Pythonnak sem kell a gépen lennie. Ehhez az egy lépéshez internet kell.

Utána a teljes `BOSSME5` mappa hordozható: átmásolhatod másik helyre, pendrive-ra vagy másik Windowsos gépre, és ott is azonnal indul. Ha az USB MIDI illesztőhöz driver kell, azt az új gépen telepíteni kell.

## 3. Indítás

**Legegyszerűbben:** kattints duplán a `start-editor.cmd` fájlra. Elindítja a szervert, és megnyitja az editort a böngészőben. A szerver addig fut, amíg a fekete ablakot be nem zárod. Ha a szerver már fut, csak az oldalt nyitja meg.

**Ikonnal:** futtasd egyszer a `create-shortcut.cmd` fájlt. Az asztalon és a projekt mappájában létrehoz egy „ME-5 Editor” parancsikont az ME-5 ikonjával, amely a `start-editor.cmd`-t indítja. Ha áthelyezed a mappát, futtasd újra.

**VS Code-ból:** nyisd meg a projektet (`start-vscode.cmd`), majd *Terminal → Run Task… → „Backend: Start FastAPI server”*.

**Parancssorból:**

```
cd backend
..	ools\python\python.exe -m uvicorn app.main:app --port 8000
```

Utána nyisd meg a böngészőben: **http://localhost:8000/**

Ha a program a „Can't reach the backend” üzenetet írja ki, a szerver nem fut. Indítsd el, és frissítsd az oldalt.

## 4. Csatlakozás az ME-5-höz

1. Kattints a jobb felső sarokban az **Offline** feliratra.
2. Válassz egyet:
   - **Auto-detect**: minden portpáron és MIDI csatornán megkeresi az ME-5-öt. Ehhez működő SysEx kell.
   - Kézzel: válaszd ki az **Output (to ME-5)** és az **Input (from ME-5)** portot, az **ME-5 MIDI channel** mezőben az ME-5 csatornáját, majd kattints a **Use these ports** gombra. A patchváltás így akkor is működik, ha a SysEx nem.
3. Csatlakozás után a felirat zöldre vált, és a kimeneti port neve és a MIDI csatorna látszik rajta.
4. A **Go offline** gomb bontja a kapcsolatot.

Offline módban minden szerkesztés csak az editorban történik, az ME-5-re nem jut el semmi.

## 5. A képernyő részei

### Felső sáv

| Elem | Mit csinál |
|---|---|
| ◀ ▶ és a kijelző | Patchváltás. A kijelzőn a patch neve (pl. `2-3-4` = 2. csoport, 3. bank, 4. patch, mint a pedálon) és a sorszáma (`#01`–`#64`) látszik. |
| **EDIT** jelzés | Pirosan világít, ha az aktuális patchet módosítottad, de még nem írtad vissza. |
| **Write** | Beírja a módosított hangzást az aktuális patchbe. Kapcsolat esetén előbb megerősítést kér, mert felülírja a patchet az ME-5-ön. |
| **Revert** | Eldobja a módosításokat, és visszaállítja a patch eredeti értékeit. |
| **Factory** | Betölti a 64 gyári patchet az editorba. |
| **Load file…** / **Save file…** | Mind a 64 patchet `.syx` fájlba menti, vagy fájlból tölti be (részletek a 7. pontban). |
| **Read ME-5** | Kiolvassa mind a 64 patchet az ME-5-ből. Csak csatlakozás után használható. |
| **Repair N** | Csak akkor látszik, ha a Read ME-5 hibás (értelmetlen adatot tartalmazó) patcheket talált; ezeket a patchtérkép szaggatott, borostyánszínű kerettel jelöli, és az editor a gyári hangzást mutatja helyettük. A gomb megerősítés után a gyári hangzást írja vissza ezekbe a patchekbe az ME-5-ön. |
| **Factory reset ME-5** | Csak csatlakozás után látszik. Mind a 64 gyári patchet beírja az ME-5-be, függetlenül attól, mi van éppen az editorban. Előtte egy piros figyelmeztető ablakban megerősítést kér; a folyamat kb. 7 másodperc, egy folyamatjelző mutatja. **Ez a pedálon lévő összes saját hangzást felülírja**, ezért előtte a Read ME-5 és a Save file… gombbal érdemes biztonsági mentést készíteni. |
| **Útmutató** / **Bemutató** | Ez a használati utasítás, illetve az ME-5 történetét bemutató oldal, az editorból megnyitva. |

### Patches (patchtérkép)

A 64 patch rácsban látszik. A cellákban lévő színes pöttyök mutatják, melyik effekt van bekapcsolva az adott patchben, a pöttyök színe a pedál színe. Egy cellára kattintva azonnal arra a patchre váltasz. A **Patches** feliratra kattintva a térkép becsukható.

### A pedalboard

Balról jobbra, a jel útja szerint (INPUT → OUTPUT):

| # | Pedál | Mit utánoz | Állítható |
|---|---|---|---|
| 1 | Kompresszor | CS-2 | Level, Tone, Attack, Sustain |
| 2 | Overdrive / Distortion | OD-2, OD-2 Turbo, DS-1 (a *Type* kapcsolóval) | Level, Drive |
| 3 | Equalizer | GE-7 | Low, Mid, High, Level tolópotméterek; *Mid freq*: 0.5k / 1k / 2k |
| 4 | Chorus / Flanger | CE-2 vagy BF-2 (*Type*); a BF-2-nél *Mode* 1–4 | Rate, Depth, Res, Level |
| – | Send / Return | az effektloop | OFF / ON |
| NS | Zajzár | NS-2 | Threshold |
| B | Reverb / Delay | RV-2 (*Mode*: Room, Hall 15, Hall 30, Plate, Gated) vagy DD-2 (*Type*) | Time, F.B., Tone, Level |
| – | Master level | a kimeneti hangerő | Level (az 5.0 érték nem változtat a hangerőn) |

A pedál kinézete a kiválasztott típushoz igazodik, például DS-1 módban narancssárga lesz.

## 6. Kezelés

**Pedál ki- és bekapcsolása:** kattints a pedál taposójára (a nagy, számozott részre). A bekapcsolt pedálnál világít a **CHECK** LED, és piros csík jelenik meg alatta. Az NS pedál kikapcsolt állapota a 0-s Threshold érték; visszakapcsoláskor az utoljára használt érték tér vissza.

**Forgatógombok:**
- egérrel fel- vagy lefelé húzva;
- egérgörgővel, görgetésenként egy lépés;
- billentyűzettel, ha a gomb ki van jelölve: ↑/→ és ↓/← egy lépés, PgUp/PgDn nagyobb lépés, Home a minimum, End a maximum.

**GE-7 tolópotméterek:** húzással vagy egérgörgővel állíthatók.

**Patchváltás billentyűzettel:** a ← és → nyíl vált az előző, illetve a következő patchre, ha éppen nincs kijelölve gomb vagy beviteli mező.

### Mi jut el az ME-5-re, és mikor?

- **Patchváltás:** azonnal Program Change üzenetet küld, és az ME-5 átvált.
- **Tekerés, kapcsolás:** a módosított hangzás kb. 0,1 másodperc után átmegy az ME-5 ideiglenes memóriájába, így rögtön hallod. **Ez még nem mentés.** Ha patchet váltasz, a módosítás elvész, kivéve, ha előtte a **Write** gombra kattintasz.
- **Write:** véglegesen beírja a hangzást az ME-5 aktuális patchébe.

## 7. Mentés fájlba és betöltés

A fájlok a `backend/data/syx/` mappába kerülnek, `.syx` kiterjesztéssel.

- **Save file…:** add meg a nevet (a `.syx` végződést a program magától hozzáteszi), vagy válassz egy meglévő fájlt a felülíráshoz. A fájlba az editorban lévő 64 patch kerül. **A még be nem írt (EDIT állapotú) módosítások nem kerülnek bele**, ezért előtte kattints a **Write** gombra.
- **Load file…:** kattints a listában a fájlra. Betöltés után az editorban a fájl patchei lesznek; az ME-5-re ettől még nem kerülnek át.

A jobb oldali felirat mutatja, honnan származnak az éppen betöltött patchek (Factory, fájl vagy ME-5).

## 8. Gyakori problémák

| Tünet | Megoldás |
|---|---|
| „Can't reach the backend” | A szerver nem fut. Indítsd el a 3. pont szerint. |
| Az Auto-detect nem találja az ME-5-öt | Ellenőrizd, hogy az ME-5 Play módban van. Ellenőrizd a MIDI IN/OUT bekötést: az ME-5 MIDI OUT-ja az interfész bemenetére menjen, a MIDI IN-je a kimenetére. Ha a kézi portválasztással a patchváltás működik, de a SysEx nem, akkor a kábel nem viszi át a SysEx üzeneteket (lásd 1. pont). |
| Az editor beállításai nem hallatszanak, a Read ME-5 nem működik, de a patchváltás igen | Az ME-5 valószínűleg Edit módban van. Állítsd Play módba. |
| A „Read ME-5” gomb szürke | Előbb csatlakozz (4. pont). |
| A Read vagy a Write hibát jelez | A SysEx nem jut át. Ugyanaz az ok, mint fent. |
| A módosítás elveszett patchváltás után | Patchváltás előtt kattints a **Write** gombra. |

> **Manual mód:** az eredeti Raspberry Pi-s változat relével kapcsolta az ME-5 manual módját. Ennek laptopon még nincs megfelelője, így ez a funkció egyelőre nem elérhető.
