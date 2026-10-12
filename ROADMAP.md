# BajetBro Roadmap

## Next feature update: Tax relief (planned, v3.5.0)

### Why

Most users (like the author) have never filed income tax. In Malaysia, a salaried
employee's tax is already deducted monthly (PCB). Filing is mostly about claiming
**reliefs** so you get some of it back, and that means tracking eligible spending
and keeping receipts all year. BajetBro already records spending, so it is the
natural place to do this.

BajetBro does **not** do the tax calculation for LHDN. Its two jobs are:

1. **During the year:** a receipt shoebox. Tag eligible purchases and keep the photo.
2. **At filing time:** a cheat sheet. One screen of totals per relief, in the same
   order as the e-Filing form, ready to copy across.

### The real-world workflow this feature follows

| When | What happens | What BajetBro does |
|---|---|---|
| Jan–Dec | Employer deducts PCB from salary every month | Nothing needed (optional: record PCB for the estimator) |
| Jan–Dec | You buy relief-eligible things (gym, books, gadgets, medical, insurance, SSPN...) | Tag the transaction with a relief type, attach a receipt photo |
| Jan–Dec | Each relief has a yearly limit | Relief tracker shows usage against each limit |
| By end Feb | Employer gives the EA form (yearly income + PCB) | Enter the EA figures for the estimator |
| Mar–Apr | File Form BE on MyTax e-Filing: type income, type relief totals (no uploads) | Filing summary screen: totals per relief, in e-Filing order |
| After filing | Refund if PCB was too much, pay the balance if too little | Estimator gives a rough preview |
| 7 years | LHDN may ask for proof of any claim | Receipts stay stored and exportable |

### Scope, built in this order

1. **Relief tagging**: optional "Tax relief" field on an entry (add and edit), with a
   relief type picker. The list of reliefs and limits lives in a per-year data file
   (e.g. `src/data/tax/ya2026.json`), so each Budget's changes are a data edit, not a
   code change.
2. **Receipt photos**: attach one or more photos to an entry. Compress on device
   (about 150–300 KB each, WebP/JPEG) and store as blobs in Dexie. Backup export gets
   "with receipts / without receipts", since photos make backups much bigger.
3. **Relief tracker**: a page per year of assessment with progress bars per relief
   ("Lifestyle RM1,840 / RM2,500"), with a tap-through to the tagged entries and receipts.
4. **Filing summary**: a single screen listing the claimable total per relief (capped
   at each limit), in e-Filing order, with copy buttons. Optional PDF/print view to
   keep with your records.
5. **Tax estimator (bonus)**: enter yearly income + PCB from the EA form; apply reliefs,
   progressive rates and rebates; show an estimated refund or balance. Clearly
   labelled as an estimate, not tax advice.

**Out of scope for now:** automatic receipt reading (OCR). On-device OCR is heavy and
unreliable on thermal receipts, and cloud OCR would send receipts off the device,
which breaks BajetBro's local-only privacy.

### Rules and accuracy

- Relief types, limits, rates and rebates come from **official LHDN sources** for each
  year of assessment, researched before building. The source link is shown in-app.
- Each year of assessment has its own rules file. Entries are grouped by the year of
  the transaction date.
- In-app wording avoids promising outcomes: "estimated", "check against your EA form".

### How we'll know it's right (validation plan)

- **Scenario tests**: a set of made-up people (income, spending, expected relief
  totals and estimated tax) checked against the app, written down in the repo.
- **Cross-check with LHDN's own calculators** using the same numbers.
- **Human check**: someone who has filed before reviews the filing summary screen
  ("is this what I type into e-Filing?").
- **Real test**: use it through 2026 and file YA2026 (Mar–Apr 2027) using only the
  filing summary.
- **Usability**: the author has never filed tax, so their job is judging whether a
  first-timer finds it clear and easy, not whether the tax rules are right.

### Open decisions

- Individual only, or also spouse/children reliefs (household)?
- Should the estimator be in v3.5.0 or a follow-up?
- Where does the relief tracker live: its own tab, or inside Settings/Insights?

---

## Automation: auto-record transactions (POSSIBLE WITH SETUP, not decided)

**Idea:** transactions from card, QR (DuitNow) or e-wallet payments appear in
BajetBro automatically.

**Status (updated 2026-10-12): now feasible, but not from the PWA alone.** Parked until
we pick a route below. Originally marked "not possible yet" (2026-10-05).

### What changed

- **iOS 27** added a Shortcuts automation trigger "When I receive a notification from
  [app]", filterable by title/body text, running in the background. Before iOS 27,
  iPhone could not react to other apps' notifications at all.
- **Dooit** (trydooit.app, Malaysian, local-first) uses this: its native app ships a
  Shortcuts action "Capture Bank Notification"; the user sets up one automation per
  bank app (MAE, HLB Connect, TNG eWallet, Ryt Bank) and Dooit turns the alert into a
  transaction to review. On Android, Dooit uses notification access (native listener).

### Why the PWA still can't do it alone

- A PWA cannot add its own Shortcuts action (only native apps can, via App Intents).
- Shortcuts "Open URL" opens Safari, whose storage is separate from the installed
  home-screen PWA's IndexedDB, so a prefilled-URL hand-off never reaches the user's data.
- On Android, reading other apps' notifications also needs native code
  (NotificationListenerService). A PWA cannot do it there either.
- Malaysia still has no open-banking API that individuals or small apps can connect to.

### Routes (pick one)

| Route | iPhone | Android | Trade-off |
|---|---|---|---|
| **A. Cloudflare Worker inbox** (preferred) | iOS 27 notification automation → "Get Contents of URL" POSTs the alert text to a Worker | MacroDroid / Tasker / Automate posts the same | One backend serves both. Fully background. Notification text passes through our server, so not 100% local any more. User does a one-time automation setup. BajetBro pulls the inbox on open and shows drafts to confirm. |
| **B. Clipboard hand-off** | Automation copies parsed amount/merchant | Same via automation app | No server, but clunky: open app, allow paste, clipboard gets overwritten. |
| **C. Native wrapper** (Capacitor / TWA) | Real Shortcuts action like Dooit | Real notification listener | Apple Developer $99/yr + App Store review; Google Play $25 one-time. Leaves the pure-PWA model. |

Any route needs one notification-text parser per bank/e-wallet (collect real sample
notifications first) and requires iOS 27+ on iPhone.

### Other partial workarounds considered (not planned)

- **iPhone Shortcuts "Transaction" automation**: runs when an Apple Pay card is tapped
  and passes the amount and merchant. Only covers Apple Pay, not DuitNow QR in bank
  apps or e-wallets, and has the same Safari-storage hand-off problem (would use route A).
- **Bank statement import** (CSV/PDF, monthly) with duplicate removal and
  merchant→category rules. Semi-automatic; needs one parser per bank.
- **Android Web Share Target**: share a payment screenshot or text into BajetBro.
  Not supported for PWAs on iOS.

### Open decisions

- Route A, B or C?
- Is sending notification text to our own Worker acceptable for a "local-only" app
  (opt-in, delete-after-pull, no storage beyond the inbox)?
- Before or after the tax-relief feature?

If it is ever built, a prefilled entry must still be confirmed with a Save tap, which
also keeps the streak rule ("a day counts when an entry is saved") meaningful.
