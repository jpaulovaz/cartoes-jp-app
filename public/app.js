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


(function () {
  const brlFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function hasMathSyntax(value) {
    return /[+\-*/()]/.test(String(value || ''));
  }

  function extractMoneyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function formatMoneyDigits(digits) {
    if (!digits) return '';
    return brlFormatter.format(Number(digits) / 100);
  }

  function placeCaretToEnd(input) {
    const len = input.value.length;
    try { input.setSelectionRange(len, len); } catch (e) { }
  }

  function renderMoneyInput(input, force) {
    const raw = input.value || '';
    if (!force && hasMathSyntax(raw)) return;
    const digits = extractMoneyDigits(raw);
    input.dataset.moneyDigits = digits;
    input.value = digits ? formatMoneyDigits(digits) : '';
  }

  function bindMoneyMask(input) {
    if (!(input instanceof HTMLInputElement) || input.dataset.moneyMaskBound === '1') return;
    input.dataset.moneyMaskBound = '1';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'off');

    if (!hasMathSyntax(input.value)) {
      renderMoneyInput(input, true);
    }

    input.addEventListener('beforeinput', (event) => {
      if (event.inputType && event.inputType.startsWith('delete')) return;
      if (!event.data) return;
      if (/\D/.test(event.data)) {
        event.preventDefault();
      }
    });

    input.addEventListener('input', () => {
      renderMoneyInput(input, true);
      placeCaretToEnd(input);
    });

    input.addEventListener('paste', () => {
      requestAnimationFrame(() => {
        renderMoneyInput(input, true);
        placeCaretToEnd(input);
      });
    });

    input.addEventListener('focus', () => {
      if (!hasMathSyntax(input.value)) {
        placeCaretToEnd(input);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-money-mask]').forEach(bindMoneyMask);
  });
})();


(function () {
  const brlFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function debounceWithKey(store, key, fn, delay = 450) {
    const previous = store.get(key);
    if (previous) window.clearTimeout(previous);
    const handle = window.setTimeout(fn, delay);
    store.set(key, handle);
  }

  function centsFromValue(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits ? Number(digits) : 0;
  }

  function formatCents(cents) {
    return brlFormatter.format(Number(cents || 0) / 100);
  }

  function syncRemainingCell(cell, remainingCents) {
    if (!cell) return;
    cell.textContent = formatCents(remainingCents);
    cell.classList.remove('text-red-500', 'text-emerald-500');
    cell.classList.add(remainingCents > 0 ? 'text-red-500' : 'text-emerald-500');
  }

  function syncCardsSummary(root) {
    let paidTotal = 0;
    let remainingTotal = 0;
    root.querySelectorAll('[data-summary-card-row]').forEach((row) => {
      const totalCents = Number(row.getAttribute('data-total-cents') || 0);
      const cardId = row.getAttribute('data-card-id');
      const paidInput = root.querySelector(`[data-summary-card-paid][data-card-id="${cardId}"]`);
      const paidCents = centsFromValue(paidInput ? paidInput.value : '');
      const remainingCents = totalCents - paidCents;
      paidTotal += paidCents;
      remainingTotal += remainingCents;
      syncRemainingCell(root.querySelector(`[data-summary-card-remaining][data-card-id="${cardId}"]`), remainingCents);
    });

    const paidCell = root.querySelector('[data-summary-cards-total-paid]');
    const remainingCell = root.querySelector('[data-summary-cards-total-remaining]');
    if (paidCell) paidCell.textContent = formatCents(paidTotal);
    syncRemainingCell(remainingCell, remainingTotal);
  }

  function syncPeopleSummary(root) {
    let paidTotal = 0;
    let remainingTotal = 0;
    root.querySelectorAll('[data-summary-person-row]').forEach((row) => {
      const totalCents = Number(row.getAttribute('data-total-cents') || 0);
      const personId = row.getAttribute('data-person-id');
      const paidInput = root.querySelector(`[data-summary-person-paid][data-person-id="${personId}"]`);
      const paidCents = centsFromValue(paidInput ? paidInput.value : '');
      const remainingCents = totalCents - paidCents;
      paidTotal += paidCents;
      remainingTotal += remainingCents;
      syncRemainingCell(root.querySelector(`[data-summary-person-remaining][data-person-id="${personId}"]`), remainingCents);
    });

    const paidCell = root.querySelector('[data-summary-people-total-paid]');
    const remainingCell = root.querySelector('[data-summary-people-total-remaining]');
    if (paidCell) paidCell.textContent = formatCents(paidTotal);
    syncRemainingCell(remainingCell, remainingTotal);
  }

  async function postForm(url, data) {
    const body = new URLSearchParams();
    Object.entries(data).forEach(([key, value]) => {
      body.append(key, value == null ? '' : String(value));
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: body.toString()
    });

    if (!response.ok) {
      throw new Error(`Autosave failed: ${response.status}`);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('[data-summary-autosave-root]');
    if (!root) return;

    const month = root.getAttribute('data-month');
    const year = root.getAttribute('data-year');
    if (!month || !year) return;

    const timers = new Map();

    const saveCard = (cardId) => {
      const paidInput = root.querySelector(`[data-summary-card-paid][data-card-id="${cardId}"]`);
      const dueInput = root.querySelector(`[data-summary-card-due][data-card-id="${cardId}"]`);
      if (!paidInput && !dueInput) return;
      syncCardsSummary(root);
      postForm(`/summary/${year}/${month}/cards/async`, {
        card_id: cardId,
        paid: paidInput ? paidInput.value : 'R$ 0,00',
        override_due: dueInput ? dueInput.value : ''
      }).catch((error) => console.error(error));
    };

    const savePerson = (personId) => {
      const paidInput = root.querySelector(`[data-summary-person-paid][data-person-id="${personId}"]`);
      if (!paidInput) return;
      syncPeopleSummary(root);
      postForm(`/summary/${year}/${month}/people/async`, {
        person_id: personId,
        paid: paidInput.value
      }).catch((error) => console.error(error));
    };

    root.querySelectorAll('[data-summary-card-paid]').forEach((input) => {
      if (input.disabled) return;
      const cardId = input.getAttribute('data-card-id');
      if (!cardId) return;
      input.addEventListener('input', () => {
        syncCardsSummary(root);
        debounceWithKey(timers, `card-paid-${cardId}`, () => saveCard(cardId));
      });
      input.addEventListener('blur', () => saveCard(cardId));
      input.addEventListener('change', () => saveCard(cardId));
    });

    root.querySelectorAll('[data-summary-card-due]').forEach((input) => {
      if (input.disabled) return;
      const cardId = input.getAttribute('data-card-id');
      if (!cardId) return;
      input.addEventListener('change', () => saveCard(cardId));
    });

    root.querySelectorAll('[data-summary-person-paid]').forEach((input) => {
      if (input.disabled) return;
      const personId = input.getAttribute('data-person-id');
      if (!personId) return;
      input.addEventListener('input', () => {
        syncPeopleSummary(root);
        debounceWithKey(timers, `person-paid-${personId}`, () => savePerson(personId));
      });
      input.addEventListener('blur', () => savePerson(personId));
      input.addEventListener('change', () => savePerson(personId));
    });

    syncCardsSummary(root);
    syncPeopleSummary(root);
  });
})();

(function () {
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }

  function supportsPushNotifications() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function setPushToggleState(button, statusEl, state) {
    if (!(button instanceof HTMLButtonElement)) return;

    const states = {
      idle: {
        label: 'Ativar push',
        disabled: false,
        className: 'inline-flex items-center justify-center rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-sky-700 transition-colors'
      },
      enabled: {
        label: 'Desativar push',
        disabled: false,
        className: 'inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 transition-colors'
      },
      loading: {
        label: 'Processando...',
        disabled: true,
        className: 'inline-flex items-center justify-center rounded-2xl bg-slate-400 px-4 py-2.5 text-sm font-bold text-white shadow-sm cursor-wait'
      },
      unsupported: {
        label: 'Push indisponível',
        disabled: true,
        className: 'inline-flex items-center justify-center rounded-2xl bg-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm cursor-not-allowed dark:bg-slate-700 dark:text-slate-200'
      }
    };

    const chosen = states[state] || states.idle;
    button.textContent = chosen.label;
    button.disabled = chosen.disabled;
    button.className = chosen.className;

    if (statusEl) {
      if (state === 'enabled') {
        statusEl.textContent = 'Este aparelho já pode receber notificações push. Toque no botão para desativar.';
      } else if (state === 'unsupported') {
        statusEl.textContent = 'Este navegador não suporta push ou o recurso não está configurado.';
      } else if (state === 'idle') {
        statusEl.textContent = 'Ative as notificações push neste aparelho para receber avisos mesmo fora da tela.';
      }
    }
  }

  async function sendSubscriptionToServer(subscription) {
    const response = await fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });

    if (!response.ok) {
      throw new Error('Não foi possível salvar a inscrição de push no servidor.');
    }
  }

  async function removeSubscriptionFromServer(endpoint) {
    const response = await fetch('/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint })
    });

    if (!response.ok) {
      throw new Error('Não foi possível remover a inscrição de push no servidor.');
    }
  }

  async function syncPushButton(button, statusEl) {
    const publicKey = String(button.dataset.pushPublicKey || '').trim();

    if (!supportsPushNotifications() || !publicKey) {
      setPushToggleState(button, statusEl, 'unsupported');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();
    setPushToggleState(button, statusEl, existingSubscription ? 'enabled' : 'idle');
  }

  async function togglePush(button, statusEl) {
    const publicKey = String(button.dataset.pushPublicKey || '').trim();
    if (!publicKey) {
      setPushToggleState(button, statusEl, 'unsupported');
      return;
    }

    setPushToggleState(button, statusEl, 'loading');

    try {
      const registration = await navigator.serviceWorker.ready;
      const existingSubscription = await registration.pushManager.getSubscription();

      if (existingSubscription) {
        await removeSubscriptionFromServer(existingSubscription.endpoint);
        await existingSubscription.unsubscribe();
        setPushToggleState(button, statusEl, 'idle');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error('Permissão de notificações não concedida.');
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      await sendSubscriptionToServer(subscription);
      setPushToggleState(button, statusEl, 'enabled');
    } catch (error) {
      console.error(error);
      setPushToggleState(button, statusEl, 'idle');
      window.alert(error?.message || 'Não foi possível configurar as notificações push neste aparelho.');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-push-toggle]').forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;

      const statusSelector = String(button.dataset.pushStatusTarget || '').trim();
      const statusEl = statusSelector ? document.querySelector(statusSelector) : null;
      syncPushButton(button, statusEl).catch((error) => {
        console.error(error);
        setPushToggleState(button, statusEl, 'unsupported');
      });

      button.addEventListener('click', () => {
        togglePush(button, statusEl).catch((error) => {
          console.error(error);
          setPushToggleState(button, statusEl, 'idle');
        });
      });
    });
  });
})();
