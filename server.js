require('dotenv').config(); // Carrega as variáveis do .env
const path = require("path");
const express = require("express");
const multer = require("multer");
const dayjs = require("dayjs");

// Novas dependências para Auth
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

// --- CONFIGURAÇÃO DE SESSÃO E AUTH ---
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: './' }),
  secret: process.env.SESSION_SECRET || 'chave-secreta-padrao',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // Login dura 7 dias
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
  // SEGURANÇA: Só permite o SEU e-mail.
  // ALTERE O EMAIL ABAIXO PARA O SEU
  const authorizedEmails = ['jpmcvs@gmail.com'];
  const userEmail = profile.emails && profile.emails[0].value;

  if (authorizedEmails.includes(userEmail)) {
    return done(null, profile);
  }
  return done(null, false, { message: 'Usuário não autorizado.' });
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Função para proteger as páginas
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

// --- ROTAS DE AUTH ---
// CORREÇÃO: Removido ensureAuthenticated daqui para evitar loop
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

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function nowIso() { return dayjs().toISOString(); }
function getCards() { return db.prepare("SELECT id, name, due_day, holiday_scope FROM cards ORDER BY name").all(); }
function getPeopleAll() { return db.prepare("SELECT id, name, active FROM people ORDER BY active DESC, name").all(); }
function getPeopleActive() { return db.prepare("SELECT id, name FROM people WHERE active=1 ORDER BY name").all(); }
function likeParam(s) { return `%${String(s).trim()}%`; }

app.get("/", ensureAuthenticated, (req, res) => {
  // 1. Puxamos todas as importações e somamos o total de cada uma
  const recent = db.prepare(`
    SELECT i.id, i.month, i.year, i.created_at, i.original_filename, c.name AS card_name, c.id AS card_id,
           (SELECT COUNT(*) FROM transactions t WHERE t.import_id=i.id) AS txn_count,
           (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions t WHERE t.import_id=i.id) AS import_total
    FROM imports i
    JOIN cards c ON c.id=i.card_id
    ORDER BY i.year DESC, i.month DESC, i.id DESC
  `).all();

  // 2. Puxamos o que já foi marcado como pago na tela de Resumo
  const statementsRows = db.prepare("SELECT card_id, month, year, paid_cents FROM card_statements").all();
  const statements = {};
  statementsRows.forEach(s => {
    statements[`${s.year}-${s.month}-${s.card_id}`] = s.paid_cents || 0;
  });

  // 3. Agrupamos por Mês/Ano e calculamos os totais
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
    // Registramos quais cartões estão neste mês para não duplicar pagamentos
    group.unique_cards.add(r.card_id);
  });

  // 4. Calculamos o Total Pago e o que Falta Pagar por Mês
  for (const group of groupedMap.values()) {
    for (const cid of group.unique_cards) {
      const paid = statements[`${group.year}-${group.month}-${cid}`] || 0;
      group.paid_cents += paid;
    }
    group.remaining_cents = Math.max(0, group.total_cents - group.paid_cents);
  }

  // 5. Transformamos em array e ordenamos (mais recentes primeiro)
  const groupedRecent = Array.from(groupedMap.values());
  groupedRecent.sort((a, b) => (b.year !== a.year) ? b.year - a.year : b.month - a.month);

  // Enviamos para o frontend, incluindo a função de formatar dinheiro
  res.render("home", { groupedRecent, formatBRLFromCents });
});

// People
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

// Cards
app.get("/cards", ensureAuthenticated, (req, res) => res.render("cards", { cards: getCards() }));
app.post("/cards", ensureAuthenticated, (req, res) => {
  const name = (req.body.name || "").trim();
  const dueDay = Number(req.body.due_day) || null;
  if (name) db.prepare("INSERT OR IGNORE INTO cards(name, due_day, holiday_scope) VALUES (?, ?, ?)").run(name, dueDay, "BR");
  res.redirect("/cards");
});
app.post("/cards/:id/update", (req, res) => {
  db.prepare("UPDATE cards SET due_day=? WHERE id=?").run(Number(req.body.due_day) || null, Number(req.params.id));
  res.redirect("/cards");
});

// Import
app.get("/import", ensureAuthenticated, (req, res) => res.render("import", { cards: getCards(), error: null }));

app.post("/import", ensureAuthenticated, upload.single("csvfile"), (req, res) => {
  const cards = getCards();
  try {
    const cardId = Number(req.body.card_id);
    const month = Number(req.body.month);
    const year = Number(req.body.year);

    if (!req.file) throw new Error("Envie um arquivo CSV.");
    if (!cardId) throw new Error("Selecione o cartão.");
    if (!month || month < 1 || month > 12) throw new Error("Mês inválido.");
    if (!year || year < 2000 || year > 2100) throw new Error("Ano inválido.");

    const card = db.prepare("SELECT id, name FROM cards WHERE id=?").get(cardId);
    if (!card) throw new Error("Cartão inválido.");

    const txns = parseCsvByCardName(card.name, req.file.buffer);

    const info = db.prepare(`
      INSERT INTO imports(card_id, month, year, created_at, original_filename)
      VALUES (?, ?, ?, ?, ?)
    `).run(cardId, month, year, nowIso(), req.file.originalname);

    const insTxn = db.prepare(`
      INSERT INTO transactions(import_id, card_id, txn_date, description, amount_cents, card_number, raw_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items) => {
      for (const t of items) {
        const isoDate = toISOFromBRDate(t.txn_date) || null;
        insTxn.run(info.lastInsertRowid, cardId, isoDate, t.description, t.amount_cents, t.card_number || null, JSON.stringify(t.raw || {}), nowIso());
      }
    });
    insertMany(txns);

    res.redirect(`/month/${year}/${month}`);
  } catch (e) {
    res.status(400).render("import", { cards, error: e.message || String(e) });
  }
});

function buildOrder(sort, dir) {
  const d = (dir || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const sortMap = {
    date: "t.txn_date",
    amount: "t.amount_cents",
    card: "c.name",
    desc: "t.description",
    allocated: "alloc_count",
    number: "t.card_number"
  };
  const col = sortMap[sort] || "t.txn_date";
  if (sort === "date") return `t.txn_date IS NULL ASC, ${col} ${d}, t.id ${d}`;
  return `${col} ${d}, t.id ${d}`;
}

app.get("/month/:year/:month", ensureAuthenticated, (req, res) => {
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  const sort = (req.query.sort || "date").toString();
  const dir = (req.query.dir || "asc").toString();
  const orderBy = buildOrder(sort, dir);

  const filters = {
    f_date: (req.query.f_date || "").toString().trim(),
    f_desc: (req.query.f_desc || "").toString().trim(),
    f_card: (req.query.f_card || "").toString().trim(),
    f_number: (req.query.f_number || "").toString().trim(),
    f_amount: (req.query.f_amount || "").toString().trim(),
    f_allocated: (req.query.f_allocated || "").toString().trim()
  };

  const where = ["i.month=? AND i.year=?"];
  const params = [month, year];

  if (filters.f_desc) { where.push("t.description LIKE ?"); params.push(likeParam(filters.f_desc)); }
  if (filters.f_card) { where.push("c.name LIKE ?"); params.push(likeParam(filters.f_card)); }
  if (filters.f_number) { where.push("COALESCE(t.card_number,'') LIKE ?"); params.push(likeParam(filters.f_number)); }
  if (filters.f_date) { where.push("COALESCE(t.txn_date,'') LIKE ?"); params.push(likeParam(filters.f_date)); }

  if (filters.f_amount) {
    const s = filters.f_amount.replace(/\s+/g, "");
    where.push("(CAST(ABS(t.amount_cents) AS TEXT) LIKE ? OR CAST(ABS(t.amount_cents)/100.0 AS TEXT) LIKE ?)");
    params.push(likeParam(s.replace(/[.,]/g, "")));
    params.push(likeParam(s.replace(",", ".")));
  }

  if (filters.f_allocated) {
    const f = filters.f_allocated.toLowerCase();
    if (f.startsWith("s")) where.push("alloc_count > 0");
    else if (f.startsWith("n")) where.push("alloc_count = 0");
  }

  const txns = db.prepare(`
    SELECT t.id, t.txn_date, t.description, t.amount_cents, t.card_number, c.name AS card_name,
           (SELECT COUNT(*) FROM allocations a WHERE a.transaction_id=t.id) AS alloc_count,
           (SELECT GROUP_CONCAT(a.person_id) FROM allocations a WHERE a.transaction_id=t.id) AS selected_csv
    FROM transactions t
    JOIN cards c ON c.id=t.card_id
    JOIN imports i ON i.id=t.import_id
    WHERE ${where.join(" AND ")}
    ORDER BY ${orderBy}
  `).all(...params);

  txns.forEach(t => {
    t.selected_ids = (t.selected_csv ? t.selected_csv.split(",").map(x => Number(x)) : []).filter(Boolean);
  });

  const people = getPeopleActive();
  const cards = getCards();
  const baseParams = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) baseParams.set(k, v); });

  const sortLink = (key) => {
    const p = new URLSearchParams(baseParams);
    const nextDir = (sort === key && dir === "asc") ? "desc" : "asc";
    p.set("sort", key);
    p.set("dir", nextDir);
    const qs = p.toString();
    return `/month/${year}/${month}${qs ? `?${qs}` : ""}`;
  };

  res.render("month", { month, year, txns, people, cards, formatBRLFromCents, sort, dir, sortLink, filters });
});

app.post("/txn/:id/alloc", ensureAuthenticated, (req, res) => {
  const id = Number(req.params.id);
  const txn = db.prepare("SELECT id, amount_cents, import_id FROM transactions WHERE id=?").get(id);
  if (!txn) return res.status(404).send("Transação não encontrada.");

  let personIds = req.body.person_ids || [];
  if (!Array.isArray(personIds)) personIds = [personIds];
  personIds = personIds.map(Number).filter(Boolean);

  const del = db.prepare("DELETE FROM allocations WHERE transaction_id=?");
  const ins = db.prepare("INSERT INTO allocations(transaction_id, person_id, share_cents, created_at) VALUES (?, ?, ?, ?)");

  db.transaction(() => {
    del.run(id);
    if (personIds.length > 0) {
      const share = Math.floor(txn.amount_cents / personIds.length);
      const remainder = txn.amount_cents - (share * personIds.length);
      personIds.forEach((pid, idx) => {
        const s = share + (idx < Math.abs(remainder) ? Math.sign(remainder) : 0);
        ins.run(id, pid, s, nowIso());
      });
    }
  })();

  const imp = db.prepare("SELECT month, year FROM imports WHERE id=?").get(txn.import_id);
  res.redirect(`/month/${imp.year}/${imp.month}`);
});

// Detail page
app.get("/txn/:id", ensureAuthenticated, (req, res) => {
  const id = Number(req.params.id);
  const txn = db.prepare(`
    SELECT t.id, t.txn_date, t.description, t.amount_cents, t.card_number, c.name AS card_name, i.month, i.year
    FROM transactions t
    JOIN cards c ON c.id=t.card_id
    JOIN imports i ON i.id=t.import_id
    WHERE t.id=?
  `).get(id);
  if (!txn) return res.status(404).send("Transação não encontrada.");

  const people = getPeopleActive();
  const selected = db.prepare("SELECT person_id FROM allocations WHERE transaction_id=?").all(id).map(r => r.person_id);
  res.render("txn", { txn, people, selected, formatBRLFromCents });
});

app.post("/txn/:id", ensureAuthenticated, (req, res) => {
  const id = Number(req.params.id);
  const txn = db.prepare("SELECT id, amount_cents, import_id FROM transactions WHERE id=?").get(id);
  if (!txn) return res.status(404).send("Transação não encontrada.");

  let personIds = req.body.person_ids || [];
  if (!Array.isArray(personIds)) personIds = [personIds];
  personIds = personIds.map(Number).filter(Boolean);

  const del = db.prepare("DELETE FROM allocations WHERE transaction_id=?");
  const ins = db.prepare("INSERT INTO allocations(transaction_id, person_id, share_cents, created_at) VALUES (?, ?, ?, ?)");

  db.transaction(() => {
    del.run(id);
    if (personIds.length > 0) {
      const share = Math.floor(txn.amount_cents / personIds.length);
      const remainder = txn.amount_cents - (share * personIds.length);
      personIds.forEach((pid, idx) => {
        const s = share + (idx < Math.abs(remainder) ? Math.sign(remainder) : 0);
        ins.run(id, pid, s, nowIso());
      });
    }
  })();

  const imp = db.prepare("SELECT month, year FROM imports WHERE id=?").get(txn.import_id);
  res.redirect(`/month/${imp.year}/${imp.month}`);
});

// Summary (minimal)
app.get("/summary/:year/:month", ensureAuthenticated, (req, res) => {
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  const people = getPeopleActive();
  const cards = getCards();

  const rows = db.prepare(`
    SELECT p.id AS person_id, p.name AS person_name, c.id AS card_id, c.name AS card_name,
           COALESCE(SUM(a.share_cents), 0) AS total_cents
    FROM people p
    CROSS JOIN cards c
    LEFT JOIN allocations a ON a.person_id=p.id
    LEFT JOIN transactions t ON t.id=a.transaction_id AND t.card_id=c.id
    LEFT JOIN imports i ON i.id=t.import_id AND i.month=? AND i.year=?
    WHERE p.active=1
      AND (i.id IS NOT NULL OR a.id IS NULL)
    GROUP BY p.id, c.id
    ORDER BY p.name, c.name
  `).all(month, year);

  const unassigned = db.prepare(`
    SELECT c.name AS card_name, COALESCE(SUM(t.amount_cents),0) AS total_cents
    FROM transactions t
    JOIN cards c ON c.id=t.card_id
    JOIN imports i ON i.id=t.import_id
    WHERE i.month=? AND i.year=?
      AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.transaction_id=t.id)
    GROUP BY c.id
    ORDER BY c.name
  `).all(month, year);

  // Card panel
  const cardTotals = db.prepare(`
    SELECT c.id as card_id, c.name as card_name, c.due_day, c.holiday_scope,
           COALESCE(SUM(t.amount_cents),0) as total_cents
    FROM cards c
    LEFT JOIN transactions t ON t.card_id=c.id
    LEFT JOIN imports i ON i.id=t.import_id AND i.month=? AND i.year=?
    GROUP BY c.id
    ORDER BY c.name
  `).all(month, year);

  const stmtRows = db.prepare(`
    SELECT card_id, computed_due_date, override_due_date, paid_cents
    FROM card_statements
    WHERE month=? AND year=?
  `).all(month, year);
  const stmtByCard = new Map(stmtRows.map(r => [r.card_id, r]));

  const cardsPanel = cardTotals.map(ct => {
    const stmt = stmtByCard.get(ct.card_id);
    const computed = computeDueDate({ year, month, dueDay: ct.due_day, holidayScope: ct.holiday_scope || "BR" });
    const due_date = stmt?.override_due_date || stmt?.computed_due_date || computed;
    return {
      card_id: ct.card_id,
      card_name: ct.card_name,
      computed_due_date: computed,
      due_date,
      paid_cents: stmt ? stmt.paid_cents : 0,
      total_cents: ct.total_cents
    };
  });

  // Person panel: total owed + paid
  const personTotals = db.prepare(`
    SELECT p.id AS person_id, p.name AS person_name,
           COALESCE(SUM(a.share_cents),0) AS total_cents
    FROM people p
    LEFT JOIN allocations a ON a.person_id=p.id
    LEFT JOIN transactions t ON t.id=a.transaction_id
    LEFT JOIN imports i ON i.id=t.import_id AND i.month=? AND i.year=?
    WHERE p.active=1 AND (i.id IS NOT NULL OR a.id IS NULL)
    GROUP BY p.id
    ORDER BY p.name
  `).all(month, year);

  const payRows = db.prepare(`
    SELECT person_id, paid_cents
    FROM person_payments
    WHERE month=? AND year=?
  `).all(month, year);
  const payByPerson = new Map(payRows.map(r => [r.person_id, r.paid_cents]));

  const personPanel = personTotals.map(pt => ({
    person_id: pt.person_id,
    person_name: pt.person_name,
    total_cents: pt.total_cents,
    paid_cents: payByPerson.get(pt.person_id) || 0
  }));

  res.render("summary", { month, year, people, cards, rows, unassigned, cardsPanel, personPanel, formatBRLFromCents });
});

app.post("/summary/:year/:month/cards", ensureAuthenticated, (req, res) => {
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  const cardIds = Array.isArray(req.body.card_id) ? req.body.card_id : [req.body.card_id];
  const paid = Array.isArray(req.body.paid) ? req.body.paid : [req.body.paid];
  const overrideDue = Array.isArray(req.body.override_due) ? req.body.override_due : [req.body.override_due];

  const upsert = db.prepare(`
    INSERT INTO card_statements(card_id, month, year, computed_due_date, override_due_date, paid_cents, created_at, updated_at)
    VALUES (@card_id, @month, @year, @computed_due_date, @override_due_date, @paid_cents, @now, @now)
    ON CONFLICT(card_id, month, year)
    DO UPDATE SET
      computed_due_date=excluded.computed_due_date,
      override_due_date=excluded.override_due_date,
      paid_cents=excluded.paid_cents,
      updated_at=excluded.updated_at
  `);

  db.transaction(() => {
    for (let i = 0; i < cardIds.length; i++) {
      const card_id = Number(cardIds[i]);
      if (!card_id) continue;

      const paid_cents = centsFromPtBrMoney(paid[i]);
      const override_due_date = (overrideDue[i] || "").toString().trim() || null;

      const card = db.prepare("SELECT due_day, holiday_scope FROM cards WHERE id=?").get(card_id);
      const computed_due_date = computeDueDate({ year, month, dueDay: card?.due_day, holidayScope: card?.holiday_scope || "BR" });

      upsert.run({ card_id, month, year, computed_due_date, override_due_date, paid_cents, now: nowIso() });
    }
  })();

  res.redirect(`/summary/${year}/${month}`);
});

app.post("/summary/:year/:month/people", ensureAuthenticated, (req, res) => {
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  const personIds = Array.isArray(req.body.person_id) ? req.body.person_id : [req.body.person_id];
  const paid = Array.isArray(req.body.paid) ? req.body.paid : [req.body.paid];

  const upsert = db.prepare(`
    INSERT INTO person_payments(person_id, month, year, paid_cents, created_at, updated_at)
    VALUES (@person_id, @month, @year, @paid_cents, @now, @now)
    ON CONFLICT(person_id, month, year)
    DO UPDATE SET
      paid_cents=excluded.paid_cents,
      updated_at=excluded.updated_at
  `);

  db.transaction(() => {
    for (let i = 0; i < personIds.length; i++) {
      const person_id = Number(personIds[i]);
      if (!person_id) continue;
      const paid_cents = centsFromPtBrMoney(paid[i]);
      upsert.run({ person_id, month, year, paid_cents, now: nowIso() });
    }
  })();

  res.redirect(`/summary/${year}/${month}`);
});

// WhatsApp
app.get("/whatsapp/:year/:month/:personId", ensureAuthenticated, (req, res) => {
  const parsed = parseMonthYear(req.params.month, req.params.year);
  const personId = Number(req.params.personId);
  if (!parsed) return res.status(400).send("Parâmetros inválidos.");

  const person = db.prepare("SELECT id, name FROM people WHERE id=?").get(personId);
  if (!person) return res.status(400).send("Pessoa inválida.");

  const { month, year } = parsed;

  const items = db.prepare(`
    SELECT t.txn_date, t.description, c.name AS card_name, a.share_cents
    FROM allocations a
    JOIN transactions t ON t.id=a.transaction_id
    JOIN cards c ON c.id=t.card_id
    JOIN imports i ON i.id=t.import_id
    WHERE i.month=? AND i.year=? AND a.person_id=?
    ORDER BY t.txn_date IS NULL, t.txn_date, c.name, t.id
  `).all(month, year, personId);

  const totalsByCard = db.prepare(`
    SELECT c.name AS card_name, COALESCE(SUM(a.share_cents),0) AS total_cents
    FROM allocations a
    JOIN transactions t ON t.id=a.transaction_id
    JOIN cards c ON c.id=t.card_id
    JOIN imports i ON i.id=t.import_id
    WHERE i.month=? AND i.year=? AND a.person_id=?
    GROUP BY c.id
    ORDER BY c.name
  `).all(month, year, personId);

  const total = totalsByCard.reduce((acc, r) => acc + r.total_cents, 0);

  // BUSCA O VALOR PAGO NO BANCO DE DADOS
  const paymentRow = db.prepare("SELECT paid_cents FROM person_payments WHERE person_id=? AND month=? AND year=?").get(personId, month, year);
  const paid_cents = paymentRow ? paymentRow.paid_cents : 0;
  const remaining_cents = Math.max(0, total - paid_cents);

  // AGORA ENVIA TUDO PARA A TELA
  res.render("whatsapp", { month, year, person, items, totalsByCard, total, paid_cents, remaining_cents, formatBRLFromCents });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Rodando em http://localhost:${PORT}`));