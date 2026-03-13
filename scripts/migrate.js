const db = require("../src/db");

function columnExists(table, col) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  return cols.includes(col);
}

db.exec(`
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  original_filename TEXT,
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER,
  card_id INTEGER NOT NULL,
  txn_date TEXT,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  card_number TEXT,
  raw_json TEXT,
  due_month INTEGER,
  due_year INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (import_id) REFERENCES imports(id),
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  share_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(transaction_id, person_id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (person_id) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_txn_card ON transactions(card_id);
CREATE INDEX IF NOT EXISTS idx_txn_import ON transactions(import_id);
CREATE INDEX IF NOT EXISTS idx_alloc_txn ON allocations(transaction_id);
`);

if (!columnExists("cards", "due_day")) db.exec(`ALTER TABLE cards ADD COLUMN due_day INTEGER`);
if (!columnExists("cards", "holiday_scope")) db.exec(`ALTER TABLE cards ADD COLUMN holiday_scope TEXT`);

// Adiciona colunas de vencimento manual para transacoes manuais
if (!columnExists("transactions", "due_month")) db.exec(`ALTER TABLE transactions ADD COLUMN due_month INTEGER`);
if (!columnExists("transactions", "due_year")) db.exec(`ALTER TABLE transactions ADD COLUMN due_year INTEGER`);

db.exec(`
CREATE TABLE IF NOT EXISTS card_statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  computed_due_date TEXT,
  override_due_date TEXT,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(card_id, month, year),
  FOREIGN KEY (card_id) REFERENCES cards(id)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS person_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(person_id, month, year),
  FOREIGN KEY (person_id) REFERENCES people(id)
);
`);

// Adiciona flag de titular na tabela people
try { db.exec("ALTER TABLE people ADD COLUMN is_owner INTEGER DEFAULT 0"); } catch (e) { }

// Tabela de Categorias (Luz, Internet, etc)
db.exec(`
  CREATE TABLE IF NOT EXISTS finance_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
  )
`);

// Tabela de Movimentações (Entradas e Gastos Fixos)
db.exec(`
  CREATE TABLE IF NOT EXISTS monthly_finances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    type TEXT NOT NULL, -- 'income' ou 'expense'
    category_id INTEGER,
    description TEXT,
    formula TEXT,
    amount_cents INTEGER DEFAULT 0,
    created_at TEXT
  )
`);

// Tabela de Bloco de Notas (Rascunhos)
db.exec(`
  CREATE TABLE IF NOT EXISTS scratchpad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    content_text TEXT,
    content_math TEXT,
    UNIQUE(month, year)
  )
`);

// Categorias Padrão
const categories = ['Prestação Apartamento', 'Luz', 'Internet', 'Condomínio', 'Tim'];
const insertCat = db.prepare("INSERT OR IGNORE INTO finance_categories (name) VALUES (?)");
categories.forEach(cat => insertCat.run(cat));

console.log("✅ Migração do Desmembramento concluída!");

console.log("✅ Migração concluída");
