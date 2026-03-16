(function () {
  function copyAlloc(btn) {
    // Encontra o widget cinza (o container da distribuição rápida)
    const container = btn.closest('.bg-slate-50\\/50');

    if (!container) {
      console.error("Container de distribuição não encontrado.");
      return;
    }

    // Busca apenas os checkboxes marcados dentro DESTE container
    const selected = Array.from(container.querySelectorAll('input[name="person_ids"]:checked'))
      .map(cb => cb.value);

    if (selected.length === 0) {
      alert("Selecione pelo menos uma pessoa para copiar!");
      return;
    }

    // Salva no navegador
    localStorage.setItem('copiedAlloc', JSON.stringify(selected));

    // Feedback visual no botão
    const originalText = btn.innerText;
    btn.innerText = "✅ Copiado!";
    setTimeout(() => { btn.innerText = originalText; }, 1000);
  }
  function pasteAlloc(btn) {
    const data = localStorage.getItem('copiedAlloc');

    if (!data) {
      alert("Nenhuma atribuição copiada. Use o botão Copiar antes.");
      return;
    }

    const ids = JSON.parse(data);
    const container = btn.closest('.bg-slate-50\\/50');

    if (!container) return;

    // 1. Limpa as seleções atuais deste item
    container.querySelectorAll('input[name="person_ids"]').forEach(cb => cb.checked = false);

    // 2. Marca os novos IDs
    ids.forEach(id => {
      const cb = container.querySelector(`input[name="person_ids"][value="${id}"]`);
      if (cb) cb.checked = true;
    });

    // Feedback visual
    const originalText = btn.innerText;
    btn.innerText = "✅ Colado!";
    setTimeout(() => { btn.innerText = originalText; }, 1000);
  }

  window.copyAlloc = copyAlloc;
  window.pasteAlloc = pasteAlloc;
})();


(function () {
  function confirmTypedAction(message, phrase = "Eu confirmo") {
    const typed = window.prompt(`${message}

Digite exatamente: ${phrase}`, "");
    const ok = typeof typed === "string" && typed.trim().toLowerCase() === phrase.trim().toLowerCase();

    if (!ok) {
      if (typed !== null) {
        alert("Confirmação não informada corretamente. Nenhuma ação foi executada.");
      }
      return false;
    }

    return true;
  }

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const message = form.dataset.confirmPrompt;
    if (!message) return;

    const phrase = form.dataset.confirmPhrase || "Eu confirmo";
    if (!confirmTypedAction(message, phrase)) {
      event.preventDefault();
    }
  });

  window.confirmTypedAction = confirmTypedAction;
})();

(function () {
  function normalizeDayNumber(value) {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 1 || num > 31) return null;
    return num;
  }

  function shiftMonth(year, month, amount) {
    let y = year;
    let m = month + amount;

    while (m > 12) {
      m -= 12;
      y += 1;
    }

    while (m < 1) {
      m += 12;
      y -= 1;
    }

    return { year: y, month: m };
  }

  function computeSuggestedFirstDue(dateValue, closeDayValue, dueDayValue) {
    if (!dateValue) return "";

    const parts = String(dateValue).split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return "";

    const [inputYear, inputMonth, inputDay] = parts;
    let year = inputYear;
    let month = inputMonth;
    const closeDay = normalizeDayNumber(closeDayValue);
    const dueDay = normalizeDayNumber(dueDayValue);

    if (closeDay && dueDay && closeDay > dueDay) {
      ({ year, month } = shiftMonth(year, month, 1));
    }

    if (closeDay) {
      const lastDayOfPurchaseMonth = new Date(inputYear, inputMonth, 0).getDate();
      const effectiveCloseDay = Math.min(closeDay, lastDayOfPurchaseMonth);
      if (inputDay >= effectiveCloseDay) {
        ({ year, month } = shiftMonth(year, month, 1));
      }
    }

    return `${year}-${String(month).padStart(2, '0')}`;
  }

  function bindAutoFirstDue(form) {
    const dateInput = form.querySelector('[data-manual-date-input]');
    const cardSelect = form.querySelector('[data-manual-card-select]');
    const firstDueInput = form.querySelector('[data-manual-first-due]');

    if (!(dateInput instanceof HTMLInputElement) || !(cardSelect instanceof HTMLSelectElement) || !(firstDueInput instanceof HTMLInputElement)) {
      return;
    }

    const refreshSuggestion = () => {
      const selectedOption = cardSelect.options[cardSelect.selectedIndex];
      const suggested = computeSuggestedFirstDue(dateInput.value, selectedOption?.dataset.closeDay || '', selectedOption?.dataset.dueDay || '');
      if (suggested) {
        firstDueInput.value = suggested;
      }
    };

    dateInput.addEventListener('change', refreshSuggestion);
    dateInput.addEventListener('input', refreshSuggestion);
    cardSelect.addEventListener('change', refreshSuggestion);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-auto-first-due-form]').forEach(bindAutoFirstDue);
  });
})();


(function () {
  const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function extractCurrencyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function formatCurrencyFromDigits(digits) {
    const cents = Number(digits || 0);
    return currencyFormatter.format(cents / 100);
  }

  function moveCursorToEnd(input) {
    try {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    } catch (err) {
      // Ignora campos que não suportam setSelectionRange.
    }
  }

  function bindCurrencyInput(input) {
    if (!(input instanceof HTMLInputElement) || input.dataset.currencyBound === '1') return;
    input.dataset.currencyBound = '1';

    const render = () => {
      const digits = extractCurrencyDigits(input.value);
      input.value = digits ? formatCurrencyFromDigits(digits) : '';
      requestAnimationFrame(() => moveCursorToEnd(input));
    };

    if (input.value) {
      const digits = extractCurrencyDigits(input.value);
      input.value = digits ? formatCurrencyFromDigits(digits) : '';
    }

    input.addEventListener('input', render);
    input.addEventListener('change', render);
    input.addEventListener('focus', () => requestAnimationFrame(() => moveCursorToEnd(input)));
  }

  function bindCurrencyInputs(root = document) {
    root.querySelectorAll('[data-currency-input]').forEach(bindCurrencyInput);
  }

  document.addEventListener('DOMContentLoaded', () => bindCurrencyInputs());
  window.bindCurrencyInputs = bindCurrencyInputs;
})();
