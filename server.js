require('dotenv').config();
const path = require("path");
const express = require("express");
const multer = require("multer");
const dayjs = require("dayjs");

// Dependências Auth
const session = require('express-session');
const passport = require('passport');
const { Strategy } = require('passport-openidconnect');
const SQLiteStore = require('connect-sqlite3')(session);

const db = require("./src/db");
const { parseCsvByCardName } = require("./src/importers");
const { formatBRLFromCents, parseMonthYear, toISOFromBRDate, centsFromPtBrMoney } = require("./src/utils");
const { computeDueDate } = require("./src/dueDate");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// --- CONFIGURAÇÃO DE SESSÃO E AUTH ---
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: './' }),
  secret: process.env.SESSION_SECRET || 'chave-secreta-cartoes-jp',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 dias
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use('oidc', new Strategy({
  issuer: process.env.POCKET_ID_URL,
  authorizationURL: `${process.env.POCKET_ID_URL}/api/oidc/authorize`,
  tokenURL: `${process.env.POCKET_ID_URL}/api/oidc/token`,
  userInfoURL: `${process.env.POCKET_ID_URL}/api/oidc/userinfo`,
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL,
  scope: 'profile email'
}, (issuer, profile, done) => {
  // --- SEGURANÇA: COLOQUE SEU EMAIL AQUI ---
  const authorizedEmails = ['seu-email@exemplo.com'];
  const userEmail = profile.emails && profile.emails[0].value;

  if (authorizedEmails.includes(userEmail)) {
    return done(null, profile);
  }
  return done(null, false, { message: 'Acesso negado.' });
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

// --- ROTAS DE AUTENTICAÇÃO ---
app.get('/login', passport.authenticate('oidc'));
app.get('/auth/callback', passport.authenticate('oidc', {
  successRedirect: '/',
  failureRedirect: '/login'
}));
app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect(process.env.POCKET_ID_URL + '/logout');
  });
});

// --- HELPER FUNCTIONS ---
function nowIso() { return dayjs().toISOString(); }
function getCards() { return db.prepare("SELECT id, name, due_day, holiday_scope FROM cards ORDER BY name").all(); }
function getPeopleAll() { return db.prepare("SELECT id, name, active FROM people ORDER BY active DESC, name").all(); }
function getPeopleActive() { return db.prepare("SELECT id, name FROM people WHERE active=1 ORDER BY name").all(); }
function likeParam(s) { return `%${String(s).trim()}%`; }

// --- ROTAS PROTEGIDAS ---

app.get("/", ensureAuthenticated, (req, res) => {
  const recent = db.prepare(`
    SELECT i.id, i.month, i.year, i.created_at, i.original_filename, c.name AS card_name, c.id AS card_id,
           (SELECT COUNT(*) FROM transactions t WHERE t.import_id=i.id) AS txn_count,
           (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions t WHERE t.import_id=i.id) AS import_total
    FROM imports i
    JOIN cards c ON c.id=i.card_id
    ORDER BY i.year DESC, i.month DESC, i.id DESC
  `).all();

  const statementsRows = db.prepare("SELECT card_id, month, year, paid_cents FROM card_statements").all();
  const statements = {};
  statementsRows.forEach(s => {
    statements[`${s.year}-${s.month}-${s.card_id}`] = s.paid_cents || 0;
  });

  const groupedMap = new Map();
  recent.forEach(r => {
    const key = `${r.year}-${r.month}`;
    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        year: r.year,
        month: r.month,
        label: `${String(r.month).padStart(2, '0')}/${r.year}`,
        cards: [],
        total_cents: 0,
        paid_cents: 0,
        unique_cards: new Set()
      });
    }
    const group = groupedMap.get(key);
    group.cards.push(r);
    group.total_cents += r.import_total;
    group.unique_cards.add(r.card_id);
  });

  for (const group of groupedMap.values()) {
    for (const cid of group.unique_cards) {
      const paid = statements[`${group.year}-${group.month}-${cid}`] || 0;
      group.paid_cents += paid;
    }
    group.remaining_cents = Math.max(0, group.total_cents - group.paid_cents);
  }

  const groupedRecent = Array.from(groupedMap.values());
  groupedRecent.sort((a, b) => (b.year !== a.year) ? b.year - a.year : b.month - a.month);
  res.render("home", { groupedRecent, formatBRLFromCents });
});

app.get("/people", ensureAuthenticated, (req, res) => res.render("people", { people: getPeopleAll() }));
app.post("/people", ensureAuthenticated, (req, res) => {
  const name = (req.body.name || "").trim();
  if (name) db.prepare("INSERT OR IGNORE INTO people(name, active) VALUES (?, 1)").run(name);
  res.redirect("/people");
});
app.post("/people/:id/toggle", ensureAuthenticated, (req, res) => {
  db.prepare("UPDATE people SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?").run(Number(req.params.id));
  res.redirect("/people");
});

app.get("/cards", ensureAuthenticated, (req, res) => res.render("cards", { cards: getCards() }));
app.post("/cards", ensureAuthenticated, (req, res) => {
  const name = (req.body.name || "").trim();
  const dueDay = Number(req.body.due_day) || null;
  if (name) db.prepare("INSERT OR IGNORE INTO cards(name, due_day, holiday_scope) VALUES (?, ?, ?)").run(name, dueDay, "BR");
  res.redirect("/cards");
});
app.post("/cards/:id/update", ensureAuthenticated, (req, res) => {
  db.prepare("UPDATE cards SET due_day=? WHERE id=?").run(Number(req.body.due_day) || null, Number(req.params.id));
  res.redirect("/cards");
});

app.get("/import", ensureAuthenticated, (req, res) => res.render("import", { cards: getCards(), error: null }));

app.post("/import", ensureAuthenticated, upload.single("csvfile"), (req, res) => {
  const cards = getCards();
  try {
    const cardId = Number(req.body.card_id);
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    if (!req.file) throw new Error("Envie um arquivo CSV.");
    const card = db.prepare("SELECT id, name FROM cards WHERE id=?").get(cardId);
    if (!card) throw new Error("Cartão inválido.");

    const txns = parseCsvByCardName(card.name, req.file.buffer);
    const info = db.prepare(`INSERT INTO imports(card_id, month, year, created_at, original_filename) VALUES (?, ?, ?, ?, ?)`).run(cardId, month, year, nowIso(), req.file.originalname);
    const insTxn = db.prepare(`INSERT INTO transactions(import_id, card_id, txn_date, description, amount_cents, card_number, raw_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    db.transaction((items) => {
      for (const t of items) {
        const isoDate = toISOFromBRDate(t.txn_date) || null;
        insTxn.run(info.lastInsertRowid, cardId, isoDate, t.description, t.amount_cents, t.card_number || null, JSON.stringify(t.raw || {}), nowIso());
      }
    })(txns);
    res.redirect(`/month/${year}/${month}`);
  } catch (e) {
    res.status(400).render("import", { cards, error: e.message || String(e) });
  }
});

app.get("/month/:year/:month", ensureAuthenticated, (req, res) => {
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;
  const sort = (req.query.sort || "date").toString();
  const dir = (req.query.dir || "asc").toString();

  const txns = db.prepare(`
    SELECT t.id, t.txn_date, t.description, t.amount_cents, t.card_number, c.name AS card_name,
           (SELECT COUNT(*) FROM allocations a WHERE a.transaction_id=t.id) AS alloc_count,
           (SELECT GROUP_CONCAT(a.person_id) FROM allocations a WHERE a.transaction_id=t.id) AS selected_csv
    FROM transactions t
    JOIN cards c ON c.id=t.card_id
    JOIN imports i ON i.id=t.import_id
    WHERE i.month=? AND i.year=?
  `).all(month, year);

  txns.forEach(t => {
    t.selected_ids = (t.selected_csv ? t.selected_csv.split(",").map(Number) : []);
  });

  res.render("month", { month, year, txns, people: getPeopleActive(), cards: getCards(), formatBRLFromCents, sort, dir, filters: {} });
});

app.post("/txn/:id/alloc", ensureAuthenticated, (req, res) => {
  const id = Number(req.params.id);
  const txn = db.prepare("SELECT id, amount_cents, import_id FROM transactions WHERE id=?").get(id);
  let personIds = req.body.person_ids || [];
  if (!Array.isArray(personIds)) personIds = [personIds];
  personIds = personIds.map(Number).filter(Boolean);

  db.transaction(() => {
    db.prepare("DELETE FROM allocations WHERE transaction_id=?").run(id);
    if (personIds.length > 0) {
      const share = Math.floor(txn.amount_cents / personIds.length);
      const remainder = txn.amount_cents - (share * personIds.length);
      personIds.forEach((pid, idx) => {
        const s = share + (idx < Math.abs(remainder) ? Math.sign(remainder) : 0);
        db.prepare("INSERT INTO allocations(transaction_id, person_id, share_cents, created_at) VALUES (?, ?, ?, ?)").run(id, pid, s, nowIso());
      });
    }
  })();
  const imp = db.prepare("SELECT month, year FROM imports WHERE id=?").get(txn.import_id);
  res.redirect(`/month/${imp.year}/${imp.month}`);
});

app.get("/summary/:year/:month", ensureAuthenticated, (req, res) => {
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  const cardsPanel = getCards().map(ct => {
    const ct_total = db.prepare("SELECT SUM(amount_cents) as total FROM transactions t JOIN imports i ON i.id=t.import_id WHERE t.card_id=? AND i.month=? AND i.year=?").get(ct.id, month, year);
    const stmt = db.prepare("SELECT * FROM card_statements WHERE card_id=? AND month=? AND year=?").get(ct.id, month, year);
    const computed = computeDueDate({ year, month, dueDay: ct.due_day, holidayScope: ct.holiday_scope || "BR" });
    return {
      card_id: ct.id,
      card_name: ct.name,
      computed_due_date: computed,
      due_date: stmt?.override_due_date || computed,
      paid_cents: stmt?.paid_cents || 0,
      total_cents: ct_total.total || 0
    };
  });

  const personPanel = getPeopleActive().map(pt => {
    const pt_total = db.prepare("SELECT SUM(a.share_cents) as total FROM allocations a JOIN transactions t ON t.id=a.transaction_id JOIN imports i ON i.id=t.import_id WHERE a.person_id=? AND i.month=? AND i.year=?").get(pt.id, month, year);
    const pay = db.prepare("SELECT paid_cents FROM person_payments WHERE person_id=? AND month=? AND year=?").get(pt.id, month, year);
    return {
      person_id: pt.id,
      person_name: pt.name,
      total_cents: pt_total.total || 0,
      paid_cents: pay?.paid_cents || 0
    };
  });

  // Dados para a matriz (Pessoa x Cartão)
  const rows = db.prepare(`
    SELECT a.person_id, t.card_id, SUM(a.share_cents) as total_cents
    FROM allocations a
    JOIN transactions t ON t.id=a.transaction_id
    JOIN imports i ON i.id=t.import_id
    WHERE i.month=? AND i.year=?
    GROUP BY a.person_id, t.card_id
  `).all(month, year);

  const unassigned = db.prepare(`
    SELECT c.name as card_name, SUM(t.amount_cents) as total_cents
    FROM transactions t
    JOIN cards c ON c.id=t.card_id
    JOIN imports i ON i.id=t.import_id
    WHERE i.month=? AND i.year=? AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.transaction_id=t.id)
    GROUP BY c.id
  `).all(month, year);

  res.render("summary", { month, year, people: getPeopleActive(), cards: getCards(), rows, unassigned, cardsPanel, personPanel, formatBRLFromCents });
});

app.post("/summary/:year/:month/cards", ensureAuthenticated, (req, res) => {
  const { month, year } = parseMonthYear(req.params.month, req.params.year);
  const cardIds = [].concat(req.body.card_id);
  const paid = [].concat(req.body.paid);
  const overrideDue = [].concat(req.body.override_due);

  db.transaction(() => {
    for (let i = 0; i < cardIds.length; i++) {
      const card_id = Number(cardIds[i]);
      const paid_cents = centsFromPtBrMoney(paid[i]);
      db.prepare(`INSERT INTO card_statements(card_id, month, year, override_due_date, paid_cents, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(card_id,month,year) DO UPDATE SET override_due_date=excluded.override_due_date, paid_cents=excluded.paid_cents, updated_at=excluded.updated_at`).run(card_id, month, year, overrideDue[i] || null, paid_cents, nowIso());
    }
  })();
  res.redirect(`/summary/${year}/${month}`);
});

app.post("/summary/:year/:month/people", ensureAuthenticated, (req, res) => {
  const { month, year } = parseMonthYear(req.params.month, req.params.year);
  const personIds = [].concat(req.body.person_id);
  const paid = [].concat(req.body.paid);

  db.transaction(() => {
    for (let i = 0; i < personIds.length; i++) {
      db.prepare(`INSERT INTO person_payments(person_id, month, year, paid_cents, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(person_id,month,year) DO UPDATE SET paid_cents=excluded.paid_cents, updated_at=excluded.updated_at`).run(Number(personIds[i]), month, year, centsFromPtBrMoney(paid[i]), nowIso());
    }
  })();
  res.redirect(`/summary/${year}/${month}`);
});

app.get("/whatsapp/:year/:month/:personId", ensureAuthenticated, (req, res) => {
  const { month, year } = parseMonthYear(req.params.month, req.params.year);
  const personId = Number(req.params.personId);
  const person = db.prepare("SELECT * FROM people WHERE id=?").get(personId);
  const items = db.prepare(`SELECT t.txn_date, t.description, c.name as card_name, a.share_cents FROM allocations a JOIN transactions t ON t.id=a.transaction_id JOIN cards c ON c.id=t.card_id JOIN imports i ON i.id=t.import_id WHERE i.month=? AND i.year=? AND a.person_id=? ORDER BY t.txn_date`).all(month, year, personId);
  const totalsByCard = db.prepare(`SELECT c.name as card_name, SUM(a.share_cents) as total_cents FROM allocations a JOIN transactions t ON t.id=a.transaction_id JOIN cards c ON c.id=t.card_id JOIN imports i ON i.id=t.import_id WHERE i.month=? AND i.year=? AND a.person_id=? GROUP BY c.id`).all(month, year, personId);
  const total = totalsByCard.reduce((acc, r) => acc + r.total_cents, 0);
  const pay = db.prepare("SELECT paid_cents FROM person_payments WHERE person_id=? AND month=? AND year=?").get(personId, month, year);
  res.render("whatsapp", { month, year, person, items, totalsByCard, total, paid_cents: pay?.paid_cents || 0, remaining_cents: Math.max(0, total - (pay?.paid_cents || 0)), formatBRLFromCents });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Rodando em http://localhost:${PORT}`));