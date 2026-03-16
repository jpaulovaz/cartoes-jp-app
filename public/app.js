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
  function bindRecurringToggle(form) {
    const recurringToggle = form.querySelector('[data-recurring-toggle]');
    const installmentsInput = form.querySelector('[data-installments-input]');

    if (!(recurringToggle instanceof HTMLInputElement) || !(installmentsInput instanceof HTMLInputElement)) {
      return;
    }

    const syncState = () => {
      if (recurringToggle.checked) {
        installmentsInput.value = '1';
        installmentsInput.setAttribute('readonly', 'readonly');
        installmentsInput.classList.add('opacity-60', 'cursor-not-allowed');
      } else {
        installmentsInput.removeAttribute('readonly');
        installmentsInput.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    };

    recurringToggle.addEventListener('change', syncState);
    installmentsInput.addEventListener('input', () => {
      if (recurringToggle.checked) {
        installmentsInput.value = '1';
      }
    });
    syncState();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-auto-first-due-form]').forEach(bindRecurringToggle);
  });
})();
