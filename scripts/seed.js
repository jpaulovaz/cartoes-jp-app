const db = require("../src/db");

const cards = [
  { name: "Assaí", due_day: 5 },
  { name: "Carrefour", due_day: 11 },
  { name: "Inter", due_day: 12 },
  { name: "Sams Club", due_day: 12 },
  { name: "Itaú", due_day: 15 },
  { name: "Mercado Pago", due_day: 17 },
  { name: "Nubank", due_day: 17 }
];

const people = ["João Paulo", "Cleiton"];

const insCard = db.prepare("INSERT OR IGNORE INTO cards(name, due_day, holiday_scope) VALUES (?, ?, ?)");
for (const c of cards) insCard.run(c.name, c.due_day, "BR");

const insPerson = db.prepare("INSERT OR IGNORE INTO people(name, active) VALUES (?, 1)");
for (const p of people) insPerson.run(p);

console.log("✅ Seed concluído (cartões/pessoas iniciais)");
