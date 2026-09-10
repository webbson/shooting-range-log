"""Guide text and figure callouts, one entry per language.

Callout coordinates are fractions of the screenshot (0–1 from its top-left), so
they survive a re-capture at another resolution as long as the layout is the
same. Screens: docs/guide/img/<lang>/<name>.jpg.
"""

from build import bullets, figure, h1, h2, note, p, pagebreak, steps

FULL = 293.0  # a 1432x835 screenshot scaled to the text column

# ── shared callout positions (same UI, both languages) ───────────────────────

CO_OPERATOR = [(0.499, 0.301, "1"), (0.499, 0.381, "2")]
CO_SELECTOR = [(0.377, 0.322, "1"), (0.377, 0.50, "2"), (0.636, 0.756, "3")]
CO_CANDIDATES = [
    (0.377, 0.322, "1"),
    (0.636, 0.34, "2"),
    (0.636, 0.456, "3"),
    (0.636, 0.569, "4"),
    (0.377, 0.756, "5"),
]
CO_FORM = [
    (0.251, 0.479, "1"),
    (0.747, 0.479, "2"),
    (0.464, 0.121, "3"),
    (0.021, 0.853, "4"),
    (0.5, 0.938, "5"),
]
CO_WEAPON_PICKER = [
    (0.733, 0.359, "1"),
    (0.733, 0.668, "2"),
    (0.189, 0.441, "3"),
    (0.205, 0.604, "4"),
]
CO_MEMBER_PICKER = [(0.499, 0.234, "1"), (0.846, 0.653, "2")]
CO_GUEST = [(0.30, 0.353, "1"), (0.70, 0.287, "2"), (0.70, 0.479, "3")]
CO_CHECKIN_LIST = [
    (0.038, 0.240, "1"),
    (0.337, 0.240, "2"),
    (0.376, 0.240, "3"),
    (0.429, 0.240, "4"),
    (0.469, 0.240, "5"),
    (0.914, 0.126, "6"),
]
CO_CHECKIN_NUMPAD = [(0.5, 0.292, "1"), (0.5, 0.764, "2")]
CO_DEBT = [(0.396, 0.422, "1"), (0.347, 0.535, "2"), (0.652, 0.532, "3"), (0.679, 0.619, "4")]
CO_TAGS = [(0.423, 0.40, "1"), (0.499, 0.559, "2"), (0.499, 0.643, "3")]
CO_MEMBERS = [
    (0.384, 0.121, "1"),
    (0.829, 0.121, "2"),
    (0.943, 0.121, "3"),
    (0.286, 0.188, "4"),
    (0.457, 0.188, "5"),
    (0.895, 0.238, "6"),
    (0.952, 0.238, "7"),
]
CO_MEMBER_EDIT = [(0.365, 0.357, "1"), (0.618, 0.357, "2"), (0.514, 0.413, "3"), (0.281, 0.725, "4")]
CO_WEAPONS = [
    (0.391, 0.121, "1"),
    (0.061, 0.182, "2"),
    (0.80, 0.121, "3"),
    (0.943, 0.121, "4"),
    (0.846, 0.29, "5"),
    (0.891, 0.29, "6"),
]
CO_WEAPON_EDIT = [(0.499, 0.352, "1"), (0.426, 0.448, "2"), (0.426, 0.543, "3"), (0.399, 0.729, "4")]
CO_MENU = [(0.94, 0.038, "1"), (0.94, 0.317, "2"), (0.94, 0.365, "3"), (0.86, 0.534, "4")]


SV = {
    "title": "Skjutbanelogg — Användarguide",
    "subtitle": "Utlämning, återlämning, medlemmar och vapen — med och utan skanner",
    "toc": [
        "1.  Kom igång — operatör, meny och skanner",
        "2.  Utlämning — låna ut ett vapen",
        "3.  Återlämning — ta emot ett vapen",
        "4.  Medlemmar",
        "5.  Vapen",
        "6.  Snabbreferens",
    ],
    "blocks": [
        h1("1. Kom igång"),
        p(
            "Programmet sköter utlåning av klubbens vapen. Fyra knappar i sidhuvudet räcker för "
            "det dagliga arbetet: Utlämning, Återlämning, Medlemmar och Vapen. Allt annat ligger "
            "i menyn längst till höger."
        ),
        h2("Välj operatör"),
        p(
            "Operatören är den i personalen som sitter vid datorn. Varje utlämning, återlämning, "
            "skuld och servicepost märks med operatörens namn, så valet måste göras innan något "
            "annat. Rutan visas automatiskt vid start."
        ),
        figure(
            "operator-picker.jpg",
            "Operatörsvalet visas vid start och när ingen operatör är vald.",
            CO_OPERATOR,
            FULL,
        ),
        steps([
            "Sök på namn om listan är lång.",
            "Tryck på ditt namn. Namnet visas sedan i menyknappen uppe till höger.",
        ]),
        note(
            "Efter en tids inaktivitet loggas operatören ut automatiskt och rutan visas igen. "
            "Tiden ställs in under Inställningar → Övrigt."
        ),
        pagebreak(),
        h2("Menyn"),
        p(
            "Menyknappen längst till höger visar vem som är operatör just nu. Där finns även "
            "loggar, statistik, underhåll, språkval, mörkt läge, helskärm och den här guiden."
        ),
        figure(
            "menu-drawer.jpg",
            "Menyn — knappen visar operatörens namn.",
            CO_MENU,
            FULL,
        ),
        steps([
            "Menyknappen: visar operatörens namn.",
            "Byt operatör genom att trycka på namnbrickan.",
            "Byt språk mellan svenska och engelska.",
            "Öppna den här guiden som PDF.",
        ]),
        h2("Med eller utan skanner"),
        p(
            "Allt går att göra med fingret på pekskärmen. Finns en streckkods- eller QR-läsare "
            "inkopplad går samma sak snabbare: läsaren skriver in koden åt dig och programmet "
            "reagerar direkt. Skannern behöver inget eget fält — rikta och skjut var som helst "
            "på utlämnings- eller återlämningssidan."
        ),
        bullets([
            "Vapenetikett: skannas som vapen-ID, samma sak som att knappa in numret.",
            "Medlemskort med personnummer: identifierar medlemmen, samma sak som att välja "
            "namnet i listan.",
            "Skannern slås på under Inställningar → Skanner. Är den avstängd fungerar allt "
            "precis som beskrivs i stegen med sifferknappar och listor.",
        ]),
        pagebreak(),
        h1("2. Utlämning"),
        p(
            "Utlämning börjar alltid med vapnet. Du knappar in eller skannar vapnets ID-nummer "
            "(numret på etiketten), och programmet föreslår vem som troligen ska låna det."
        ),
        figure(
            "checkout-selector-empty.jpg",
            "Utlämningssidan innan något är valt.",
            CO_SELECTOR,
            FULL,
        ),
        steps([
            "Skriv vapnets ID med sifferknapparna — eller skanna etiketten.",
            "Är skannern på räcker det att skanna; siffrorna fylls i automatiskt.",
            "Manuellt val öppnar det fullständiga formuläret när du hellre söker på namn.",
        ]),
        pagebreak(),
        h2("Föreslagna låntagare"),
        p(
            "När vapnet är känt visas upp till två förslag: medlemmen som har vapnet tilldelat "
            "och den som lånade det senast. Tryck på rätt person och sedan Lämna ut — det är "
            "hela utlämningen."
        ),
        figure(
            "checkout-selector-candidates.jpg",
            "Vapen 36 inknappat: tilldelad medlem och senaste låntagare föreslås.",
            CO_CANDIDATES,
            FULL,
        ),
        steps([
            "Inknappat eller skannat vapen-ID.",
            "Vapnet som hittades — märke, modell, kaliber och ID.",
            "TILLDELAT: medlemmen som har vapnet som sitt. Förvalt.",
            "SENAST: den som lånade vapnet sist.",
            "Lämna ut genomför utlåningen direkt.",
        ]),
        note(
            "Med skanner: skanna först vapnet, sedan medlemmens personnummer. Är medlemmen en av "
            "de föreslagna sker utlämningen direkt utan fler tryck. Andra medlemmar hamnar i "
            "formuläret med både vapen och medlem ifyllda."
        ),
        pagebreak(),
        h2("Formuläret"),
        p(
            "Manuellt val (eller en okänd låntagare) visar formuläret med två kort: medlem till "
            "vänster, vapen till höger. Tryck på ett kort för att byta innehåll."
        ),
        figure(
            "checkout-form-filled.jpg",
            "Formuläret med medlem och vapen valda.",
            CO_FORM,
            FULL,
        ),
        steps([
            "Medlemskortet — tryck för att söka fram en annan medlem.",
            "Vapenkortet — tryck för att välja ett annat vapen.",
            "Gäst: för besökare som inte är medlemmar.",
            "Tilldela vapnet till medlemmen — kryssa i om vapnet ska bli medlemmens eget.",
            "Lämna ut avslutar.",
        ]),
        pagebreak(),
        h2("Välja vapen i listan"),
        figure(
            "weapon-picker.jpg",
            "Vapenväljaren — sifferknappar, filter och tydliga markeringar.",
            CO_WEAPON_PICKER,
            FULL,
        ),
        steps([
            "Sifferknappar för vapnets ID.",
            "Filtrera på märke, kaliber, endast tillgängliga eller endast otilldelade.",
            "Färgade brickor visar vapnets skick och vem det är tilldelat.",
            "Utlånade vapen ligger sist och är gråmarkerade med nuvarande låntagare.",
        ]),
        h2("Välja medlem i listan"),
        figure(
            "member-picker.jpg",
            "Medlemsväljaren — sök på namn, skuld syns direkt.",
            CO_MEMBER_PICKER,
            FULL,
        ),
        steps([
            "Sök på namn; listan sorteras annars efter senaste skjutdatum.",
            "Röd bricka visar obetald skuld.",
        ]),
        pagebreak(),
        h2("Gäst"),
        p(
            "En besökare som inte är medlem läggs upp som gäst direkt i utlämningen. "
            "Personnumret identifierar gästen, så samma person återanvänds vid nästa besök."
        ),
        figure(
            "guest-modal.jpg",
            "Gästutlåning — välj tidigare gäst eller lägg upp en ny.",
            CO_GUEST,
            FULL,
        ),
        steps([
            "Tidigare gäster — sök och tryck.",
            "Ny gäst: personnummer och namn.",
            "Fortsätt tar dig tillbaka till utlämningen med gästen vald.",
        ]),
        note(
            "En gäst kan senare göras om till fullvärdig medlem av en administratör under "
            "Underhåll → Gäster."
        ),
        pagebreak(),
        h2("Varningar"),
        p(
            "Programmet stoppar inte tyst — det visar varför något inte bör lånas ut. Vapnets "
            "skickmarkeringar, obetald skuld, inaktiv medlem eller ett vapen som redan är utlånat "
            "syns i orange eller rött på kortet."
        ),
        figure(
            "checkout-form-tag-warning.jpg",
            "Vapnet är markerat som 'Behöver rengöring' med teknikerns kommentar.",
            [],
            FULL,
        ),
        h2("Kvitto"),
        p("Efter utlämning visas en bekräftelse i fem sekunder och sidan nollställs för nästa låntagare."),
        figure("checkout-success.jpg", "Bekräftelse efter utlämning.", [], FULL),
        pagebreak(),
        h1("3. Återlämning"),
        p(
            "Återlämningssidan visar alla vapen som är ute just nu, ett kort per lån. Siffran i "
            "sidhuvudet är antalet öppna lån."
        ),
        figure(
            "checkin-list.jpg",
            "Utlånade vapen med knappar för varje lån.",
            CO_CHECKIN_LIST,
            FULL,
        ),
        steps([
            "Vapnets ID i den färgade listen.",
            "Stjärna: tilldela vapnet till låntagaren.",
            "Mynt: lägg till eller reglera skuld.",
            "Etikett: markera vapnets skick.",
            "Pil: ta emot vapnet — lånet stängs.",
            "Snabb återlämning: knappa in ett vapen-ID i stället för att leta i listan.",
        ]),
        note(
            "Med skanner: skanna vapnets etikett så återlämnas det direkt, oavsett var i listan "
            "det ligger. Skannas ett vapen som inte är utlånat hoppar programmet i stället till "
            "utlämningen med vapnet ifyllt."
        ),
        pagebreak(),
        h2("Snabb återlämning"),
        figure(
            "checkin-numpad.jpg",
            "Snabb återlämning — knappa in vapnets ID.",
            CO_CHECKIN_NUMPAD,
            FULL,
        ),
        steps([
            "Knappa in vapnets ID.",
            "Återlämna stänger lånet.",
        ]),
        h2("Skuld"),
        figure("debt-modal.jpg", "Skuld för en låntagare.", CO_DEBT, FULL),
        steps([
            "Utestående belopp.",
            "Belopp i hela kronor.",
            "Lägg till skuld sparar posten.",
            "Reglera markerar en tidigare skuld som betald.",
        ]),
        pagebreak(),
        h2("Skickmarkeringar"),
        p(
            "Vem som helst kan markera ett vapens skick — det kräver ingen administratör. "
            "Markeringarna följer med vapnet och visas i väljare, listor och vid utlämning."
        ),
        figure("tag-modal.jpg", "Taggar för ett vapen.", CO_TAGS, FULL),
        steps([
            "Tryck på de markeringar som gäller.",
            "Skriv en kommentar till nästa person som tar i vapnet.",
            "Spara.",
        ]),
        figure(
            "checkin-done.jpg",
            "Efter återlämning försvinner kortet och räknaren minskar.",
            [],
            FULL,
        ),
        pagebreak(),
        h1("4. Medlemmar"),
        p(
            "Medlemslistan visar aktiva medlemmar med senaste skjutdatum och tilldelat vapen. "
            "Tryck på en rad för att se medlemmens uppgifter och historik."
        ),
        figure("members-list.jpg", "Medlemslistan.", CO_MEMBERS, FULL),
        steps([
            "Sök på namn.",
            "Växla mellan aktiva, inaktiva och alla.",
            "Ny medlem.",
            "Senaste skjutdatum — kolumnen går att sortera.",
            "Tilldelat vapen.",
            "Skuld öppnar medlemmens skulder.",
            "Redigera öppnar formuläret.",
        ]),
        pagebreak(),
        h2("Medlemsuppgifter"),
        figure(
            "member-info.jpg",
            "Uppgifter och skjuthistorik för en medlem.",
            [],
            FULL,
        ),
        h2("Redigera medlem"),
        figure("member-edit.jpg", "Redigeringsformuläret.", CO_MEMBER_EDIT, FULL),
        steps([
            "Namn är obligatoriskt; övriga fält är frivilliga.",
            "Tilldelat vapen — ett vapen kan bara vara tilldelat en medlem.",
            "Administratör ger tillgång till inställningar och känsliga åtgärder.",
            "Inaktivera i stället för att ta bort: historiken finns kvar.",
        ]),
        note(
            "Medlemmar tas aldrig bort. En inaktiverad medlem visas som 'namn [inaktiv]' i "
            "loggar och listor, och all historik står kvar."
        ),
        pagebreak(),
        h1("5. Vapen"),
        p(
            "Vapenlistan visar klubbens vapen med ID, märke, modell, serienummer, kaliber, "
            "tilldelning och skick."
        ),
        figure("weapons-list.jpg", "Vapenlistan.", CO_WEAPONS, FULL),
        steps([
            "Sök på märke, modell eller serienummer.",
            "Filtrera på skickmarkering eller otilldelade vapen.",
            "Visa inaktiva vapen.",
            "Nytt vapen.",
            "Etikettknappen öppnar skickmarkeringarna.",
            "Service öppnar vapnets servicelogg.",
        ]),
        pagebreak(),
        h2("Redigera vapen"),
        figure("weapon-edit.jpg", "Vapenformuläret.", CO_WEAPON_EDIT, FULL),
        steps([
            "ID är etikettnumret och måste finnas så länge vapnet är aktivt.",
            "Märke, modell och kaliber föreslås från tidigare inmatningar.",
            "Serienumret är vapnets juridiska identitet och är unikt.",
            "Inaktivera när vapnet säljs eller tas ur bruk — ID:t kan då återanvändas.",
        ]),
        note(
            "ID:t (etiketten) får flyttas till ett annat vapen när det blivit ledigt. "
            "Serienumret följer alltid samma vapen och byts aldrig."
        ),
        pagebreak(),
        h1("6. Snabbreferens"),
        h2("Utan skanner"),
        bullets([
            "Utlämning: knappa in vapnets ID → tryck på låntagaren → Lämna ut.",
            "Okänd låntagare: Manuellt val → tryck på medlemskortet → sök namn.",
            "Besökare: Gäst → personnummer och namn → Fortsätt.",
            "Återlämning: leta upp kortet → pilknappen. Eller Snabb återlämning → vapen-ID.",
        ]),
        h2("Med skanner"),
        bullets([
            "Utlämning: skanna vapnet → skanna medlemmens personnummer. Är medlemmen tilldelad "
            "vapnet eller lånade det senast sker utlämningen direkt.",
            "Okänt personnummer: gästrutan öppnas med numret ifyllt.",
            "Återlämning: skanna vapnet — lånet stängs direkt.",
            "Skannas ett vapen som inte är ute hoppar programmet till utlämningen.",
        ]),
        h2("Bra att veta"),
        bullets([
            "Operatören loggas ut efter en tids inaktivitet; välj namn igen för att fortsätta.",
            "Ingenting raderas — medlemmar och vapen inaktiveras, loggar byggs på.",
            "Skulder och skickmarkeringar följer med och visas vid nästa utlämning.",
            "Guiden öppnas när som helst från menyn.",
        ]),
    ],
}


EN = {
    "title": "Shooting Range Log — User guide",
    "subtitle": "Checkout, check-in, members and weapons — with and without a scanner",
    "toc": [
        "1.  Getting started — operator, menu and scanner",
        "2.  Checkout — lending a weapon out",
        "3.  Check-in — taking a weapon back",
        "4.  Members",
        "5.  Weapons",
        "6.  Quick reference",
    ],
    "blocks": [
        h1("1. Getting started"),
        p(
            "The app handles lending out the club's weapons. Four header buttons cover the daily "
            "work: Checkout, Check-in, Members and Weapons. Everything else lives in the menu on "
            "the far right."
        ),
        h2("Pick an operator"),
        p(
            "The operator is the staff member at the computer. Every checkout, check-in, debt and "
            "service entry is stamped with that name, so the choice comes before anything else. "
            "The dialog opens by itself at launch."
        ),
        figure(
            "operator-picker.jpg",
            "The operator dialog opens at launch and whenever no operator is set.",
            CO_OPERATOR,
            FULL,
        ),
        steps([
            "Search by name if the list is long.",
            "Tap your name. It then shows in the menu button at the top right.",
        ]),
        note(
            "After a period of inactivity the operator is logged out and the dialog returns. "
            "The delay is set under Settings → Misc."
        ),
        pagebreak(),
        h2("The menu"),
        p(
            "The menu button on the far right shows who the current operator is. It also holds "
            "logs, statistics, maintenance, language, dark mode, fullscreen and this guide."
        ),
        figure("menu-drawer.jpg", "The menu — the button carries the operator's name.", CO_MENU, FULL),
        steps([
            "Menu button: shows the operator's name.",
            "Tap the name badge to switch operator.",
            "Switch between Swedish and English.",
            "Open this guide as a PDF.",
        ]),
        h2("With or without a scanner"),
        p(
            "Everything can be done with a finger on the touch screen. With a barcode or QR "
            "reader attached the same work goes faster: the reader types the code for you and the "
            "app reacts at once. The scanner needs no field of its own — aim and shoot anywhere "
            "on the checkout or check-in screen."
        ),
        bullets([
            "A weapon label scans as a weapon ID, exactly like typing the number.",
            "A member card holding a personnummer identifies the member, exactly like picking "
            "the name from the list.",
            "The scanner is switched on under Settings → Scanner. With it off, everything works "
            "as described in the steps, using the keypad and the lists.",
        ]),
        pagebreak(),
        h1("2. Checkout"),
        p(
            "Checkout always starts with the weapon. Type or scan the weapon's ID (the number on "
            "its label) and the app suggests who is likely to borrow it."
        ),
        figure("checkout-selector-empty.jpg", "The checkout screen before anything is selected.", CO_SELECTOR, FULL),
        steps([
            "Type the weapon ID on the keypad — or scan the label.",
            "With the scanner on, scanning is enough; the digits fill in by themselves.",
            "Manual choice opens the full form when you would rather search by name.",
        ]),
        pagebreak(),
        h2("Suggested borrowers"),
        p(
            "Once the weapon is known, up to two suggestions appear: the member the weapon is "
            "assigned to, and whoever borrowed it last. Tap the right person, then Check out — "
            "that is the whole flow."
        ),
        figure(
            "checkout-selector-candidates.jpg",
            "Weapon 36 typed in: the assigned member and the last borrower are offered.",
            CO_CANDIDATES,
            FULL,
        ),
        steps([
            "The weapon ID you typed or scanned.",
            "The weapon found — brand, model, caliber and ID.",
            "ASSIGNED: the member this weapon belongs to. Preselected.",
            "LAST: whoever borrowed it most recently.",
            "Check out completes the loan.",
        ]),
        note(
            "With a scanner: scan the weapon, then the member's personnummer. If that member is "
            "one of the suggestions the checkout completes with no further taps. Any other known "
            "member lands on the form with both weapon and member filled in."
        ),
        pagebreak(),
        h2("The form"),
        p(
            "Manual choice (or an unknown borrower) opens the form with two cards: member on the "
            "left, weapon on the right. Tap a card to change what it holds."
        ),
        figure("checkout-form-filled.jpg", "The form with member and weapon selected.", CO_FORM, FULL),
        steps([
            "Member card — tap to search for another member.",
            "Weapon card — tap to pick another weapon.",
            "Guest: for visitors who are not members.",
            "Assign the weapon to the member — tick if it should become their own.",
            "Check out finishes.",
        ]),
        pagebreak(),
        h2("Picking a weapon from the list"),
        figure("weapon-picker.jpg", "The weapon picker — keypad, filters and clear markings.", CO_WEAPON_PICKER, FULL),
        steps([
            "Keypad for the weapon ID.",
            "Filter by brand, caliber, available only or unassigned only.",
            "Coloured chips show the weapon's condition and who it is assigned to.",
            "Weapons that are out sit at the bottom, greyed, with their current borrower.",
        ]),
        h2("Picking a member from the list"),
        figure("member-picker.jpg", "The member picker — search by name, debt shows at a glance.", CO_MEMBER_PICKER, FULL),
        steps([
            "Search by name; otherwise the list is sorted by last shooting date.",
            "A red badge marks an unsettled debt.",
        ]),
        pagebreak(),
        h2("Guests"),
        p(
            "A visitor who is not a member is created as a guest straight from checkout. The "
            "personnummer identifies the guest, so the same person is reused on their next visit."
        ),
        figure("guest-modal.jpg", "Guest checkout — pick a previous guest or add a new one.", CO_GUEST, FULL),
        steps([
            "Previous guests — search and tap.",
            "New guest: personnummer and name.",
            "Continue returns to checkout with the guest selected.",
        ]),
        note("An administrator can later promote a guest to a full member under Maintenance → Guests."),
        pagebreak(),
        h2("Warnings"),
        p(
            "The app never blocks silently — it says why something should perhaps not go out. "
            "Condition markings, an unsettled debt, an inactive member or a weapon that is "
            "already out all show in orange or red on the card."
        ),
        figure(
            "checkout-form-tag-warning.jpg",
            "The weapon is marked 'Needs cleaning' with the technician's comment.",
            [],
            FULL,
        ),
        h2("Receipt"),
        p("After checkout a confirmation shows for five seconds and the screen resets for the next borrower."),
        figure("checkout-success.jpg", "Confirmation after checkout.", [], FULL),
        pagebreak(),
        h1("3. Check-in"),
        p(
            "The check-in screen lists every weapon that is out right now, one card per loan. The "
            "number in the header is the count of open loans."
        ),
        figure("checkin-list.jpg", "Weapons on loan, with per-loan buttons.", CO_CHECKIN_LIST, FULL),
        steps([
            "The weapon ID in the coloured stripe.",
            "Star: assign the weapon to this borrower.",
            "Coins: add or settle a debt.",
            "Tag: mark the weapon's condition.",
            "Arrow: take the weapon back — the loan closes.",
            "Quick check-in: type a weapon ID instead of hunting through the list.",
        ]),
        note(
            "With a scanner: scan the weapon's label and it is checked in at once, wherever it "
            "sits in the list. Scanning a weapon that is not out jumps to checkout instead, with "
            "that weapon filled in."
        ),
        pagebreak(),
        h2("Quick check-in"),
        figure("checkin-numpad.jpg", "Quick check-in — type the weapon ID.", CO_CHECKIN_NUMPAD, FULL),
        steps(["Type the weapon ID.", "Check in closes the loan."]),
        h2("Debt"),
        figure("debt-modal.jpg", "Debt for a borrower.", CO_DEBT, FULL),
        steps([
            "Outstanding amount.",
            "Amount in whole kronor.",
            "Add debt saves the entry.",
            "Settle marks an earlier debt as paid.",
        ]),
        pagebreak(),
        h2("Condition markings"),
        p(
            "Anyone can mark a weapon's condition — no administrator needed. The markings follow "
            "the weapon and show up in pickers, lists and at checkout."
        ),
        figure("tag-modal.jpg", "Tags for a weapon.", CO_TAGS, FULL),
        steps([
            "Tap the markings that apply.",
            "Write a comment for whoever handles the weapon next.",
            "Save.",
        ]),
        figure("checkin-done.jpg", "After check-in the card disappears and the counter drops.", [], FULL),
        pagebreak(),
        h1("4. Members"),
        p(
            "The member list shows active members with their last shooting date and assigned "
            "weapon. Tap a row to see that member's details and history."
        ),
        figure("members-list.jpg", "The member list.", CO_MEMBERS, FULL),
        steps([
            "Search by name.",
            "Switch between active, inactive and all.",
            "New member.",
            "Last shooting date — the column sorts.",
            "Assigned weapon.",
            "Debt opens that member's debts.",
            "Edit opens the form.",
        ]),
        pagebreak(),
        h2("Member details"),
        figure("member-info.jpg", "Details and shooting history for a member.", [], FULL),
        h2("Editing a member"),
        figure("member-edit.jpg", "The edit form.", CO_MEMBER_EDIT, FULL),
        steps([
            "Name is required; every other field is optional.",
            "Assigned weapon — a weapon can belong to one member only.",
            "Administrator grants access to settings and sensitive actions.",
            "Deactivate rather than delete: the history stays.",
        ]),
        note(
            "Members are never deleted. A deactivated member shows as 'name [disabled]' in logs "
            "and lists, and all history remains."
        ),
        pagebreak(),
        h1("5. Weapons"),
        p(
            "The weapon list shows the club's weapons with ID, brand, model, serial, caliber, "
            "assignment and condition."
        ),
        figure("weapons-list.jpg", "The weapon list.", CO_WEAPONS, FULL),
        steps([
            "Search by brand, model or serial.",
            "Filter by condition marking or unassigned weapons.",
            "Show inactive weapons.",
            "New weapon.",
            "The tag button opens the condition markings.",
            "Service opens the weapon's service log.",
        ]),
        pagebreak(),
        h2("Editing a weapon"),
        figure("weapon-edit.jpg", "The weapon form.", CO_WEAPON_EDIT, FULL),
        steps([
            "The ID is the label number and is required while the weapon is active.",
            "Brand, model and caliber are suggested from earlier entries.",
            "The serial is the weapon's legal identity and is unique.",
            "Deactivate when the weapon is sold or retired — the ID can then be reused.",
        ]),
        note(
            "The ID (the label) may move to another weapon once it is free. The serial always "
            "stays with the same weapon and never changes."
        ),
        pagebreak(),
        h1("6. Quick reference"),
        h2("Without a scanner"),
        bullets([
            "Checkout: type the weapon ID → tap the borrower → Check out.",
            "Unknown borrower: Manual choice → tap the member card → search by name.",
            "Visitor: Guest → personnummer and name → Continue.",
            "Check-in: find the card → arrow button. Or Quick check-in → weapon ID.",
        ]),
        h2("With a scanner"),
        bullets([
            "Checkout: scan the weapon → scan the member's personnummer. If that member is "
            "assigned the weapon or borrowed it last, the checkout completes immediately.",
            "Unknown personnummer: the guest dialog opens with the number filled in.",
            "Check-in: scan the weapon — the loan closes at once.",
            "Scanning a weapon that is not out jumps to checkout.",
        ]),
        h2("Worth knowing"),
        bullets([
            "The operator is logged out after a period of inactivity; pick the name again to continue.",
            "Nothing is deleted — members and weapons are deactivated, logs only grow.",
            "Debts and condition markings follow along and surface at the next checkout.",
            "The guide opens from the menu at any time.",
        ]),
    ],
}


CONTENT = {"sv": SV, "en": EN}
