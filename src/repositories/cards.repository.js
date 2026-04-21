function createCardsRepository(deps = {}) {
  const { db, getCards, normalizeDayNumber, normalizeCardBrand, findCardByNameForUser } = deps;

  function findCardById(userId, cardId) {
    return db.prepare('SELECT id, name FROM cards WHERE id = ? AND user_id = ?').get(cardId, userId);
  }

  function updateCard(userId, cardId, { name, dueDay, closeDay, brand }) {
    return db.prepare('UPDATE cards SET name = ?, due_day = ?, close_day = ?, brand = ? WHERE id = ? AND user_id = ?')
      .run(name, dueDay, closeDay, brand, cardId, userId);
  }

  function createCard(userId, { name, dueDay, closeDay, brand }) {
    return db.prepare('INSERT INTO cards(user_id, name, due_day, close_day, holiday_scope, brand) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, name, dueDay, closeDay, 'BR', brand);
  }

  function findCardToggleState(userId, cardId) {
    return db.prepare('SELECT id, name, COALESCE(active, 1) AS active FROM cards WHERE id = ? AND user_id = ?').get(cardId, userId);
  }

  function toggleCard(userId, cardId) {
    return db.prepare(`
      UPDATE cards
      SET active = CASE COALESCE(active, 1) WHEN 1 THEN 0 ELSE 1 END
      WHERE id = ? AND user_id = ?
    `).run(cardId, userId);
  }

  function getCardUsage(userId, cardId) {
    return db.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM transactions WHERE user_id = ? AND card_id = ?) AS has_transactions,
        EXISTS(SELECT 1 FROM card_statements WHERE user_id = ? AND card_id = ?) AS has_statements
    `).get(userId, cardId, userId, cardId);
  }

  function deleteCard(userId, cardId) {
    return db.transaction(() => {
      db.prepare('DELETE FROM imports WHERE user_id = ? AND card_id = ?').run(userId, cardId);
      db.prepare('DELETE FROM cards WHERE id = ? AND user_id = ?').run(cardId, userId);
    })();
  }

  return {
    db,
    getCards,
    normalizeDayNumber,
    normalizeCardBrand,
    findCardByNameForUser,
    findCardById,
    updateCard,
    createCard,
    findCardToggleState,
    toggleCard,
    getCardUsage,
    deleteCard
  };
}

module.exports = {
  createCardsRepository
};
