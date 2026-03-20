(function () {
  if (typeof window.fetch !== 'function') return;

  const nativeFetch = window.fetch.bind(window);

  function isSameOriginRequest(input) {
    try {
      const rawUrl = typeof input === 'string'
        ? input
        : (input && typeof input.url === 'string' ? input.url : window.location.href);
      const targetUrl = new URL(rawUrl, window.location.href);
      return targetUrl.origin === window.location.origin;
    } catch (error) {
      return false;
    }
  }

  window.fetch = async function (input, init) {
    const nextInit = init ? { ...init } : {};

    if (isSameOriginRequest(input)) {
      const headers = new Headers(nextInit.headers || (input instanceof Request ? input.headers : undefined) || {});
      headers.set('X-Requested-With', 'XMLHttpRequest');
      nextInit.headers = headers;
    }

    const response = await nativeFetch(input, nextInit);
    if (response.headers.get('x-session-expired') === '1') {
      const redirectUrl = response.headers.get('x-session-expired-redirect') || '/login?reason=idle';
      window.location.href = redirectUrl;
      const error = new Error('Sua sessão expirou por inatividade. Faça login novamente.');
      error.code = 'SESSION_EXPIRED';
      error.response = response;
      throw error;
    }

    return response;
  };
})();

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
      alert("Selecione pelo menos uma pessoa antes de copiar.");
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
      alert("Nada copiado ainda. Use o botão Copiar primeiro.");
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
  let dialogState = null;

  function toneClasses(tone) {
    const base = 'w-full rounded-2xl px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900';
    if (tone === 'danger') return `${base} bg-red-600 text-white hover:bg-red-700 focus:ring-red-500`;
    if (tone === 'primary') return `${base} bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-500 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white dark:focus:ring-slate-300`;
    return `${base} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:focus:ring-slate-500`;
  }

  function hasVisibleMonthSheet() {
    const surface = document.querySelector('[data-month-sheet-surface]');
    if (!surface) return false;
    const root = surface.closest('.fixed.inset-0');
    return !!(root && !root.classList.contains('hidden'));
  }

  function setDialogVisibility(state, visible) {
    state.root.classList.toggle('hidden', !visible);
    if (visible) {
      if (state.root.parentElement === document.body) {
        document.body.appendChild(state.root);
      }
      document.body.classList.add('overflow-hidden');
      return;
    }

    if (!hasVisibleMonthSheet()) {
      document.body.classList.remove('overflow-hidden');
    }
  }

  function ensureActionDialog() {
    if (dialogState && dialogState.root && document.body.contains(dialogState.root)) {
      return dialogState;
    }

    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-[10050] hidden';
    root.innerHTML = `
      <div class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" data-dialog-backdrop></div>
      <div class="relative z-10 flex min-h-full items-end justify-center p-4 sm:items-center">
        <div class="w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700" data-dialog-surface>
          <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <h3 class="text-base font-bold text-slate-900 dark:text-slate-100" data-dialog-title></h3>
          </div>
          <div class="px-5 py-4">
            <p class="text-sm leading-6 text-slate-600 whitespace-pre-line dark:text-slate-300" data-dialog-message></p>
          </div>
          <div class="flex flex-col gap-2 px-5 pb-5" data-dialog-buttons></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    dialogState = {
      root,
      surface: root.querySelector('[data-dialog-surface]'),
      title: root.querySelector('[data-dialog-title]'),
      message: root.querySelector('[data-dialog-message]'),
      buttons: root.querySelector('[data-dialog-buttons]'),
      activeResolve: null
    };

    const closeDialog = (value) => {
      if (!dialogState?.activeResolve) return;
      const resolve = dialogState.activeResolve;
      dialogState.activeResolve = null;
      setDialogVisibility(dialogState, false);
      resolve(value);
    };

    root.querySelector('[data-dialog-backdrop]')?.addEventListener('click', () => closeDialog(null));
    root.addEventListener('click', (event) => {
      const surface = dialogState?.surface;
      if (!dialogState?.activeResolve || !surface) return;
      if (!surface.contains(event.target)) closeDialog(null);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && dialogState?.activeResolve) {
        closeDialog(null);
      }
    });

    dialogState.close = closeDialog;
    return dialogState;
  }

  function showActionDialog({ title = 'Confirma essa ação?', message = '', options = [] } = {}) {
    const state = ensureActionDialog();

    if (state.activeResolve) {
      const previousResolve = state.activeResolve;
      state.activeResolve = null;
      previousResolve(null);
    }

    state.title.textContent = title;
    state.message.textContent = message;
    state.buttons.innerHTML = '';

    return new Promise((resolve) => {
      state.activeResolve = resolve;

      options.forEach((option, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = toneClasses(option.tone || 'secondary');
        button.textContent = option.label;
        button.addEventListener('click', () => state.close(option.value));
        state.buttons.appendChild(button);
        if (index === 0) {
          window.requestAnimationFrame(() => button.focus());
        }
      });

      setDialogVisibility(state, true);
    });
  }

  async function confirmTypedAction(message, phrase = 'Eu confirmo') {
    const result = await showActionDialog({
      title: 'Confirma a exclusão?',
      message,
      options: [
        { label: 'Cancelar', value: false, tone: 'secondary' },
        { label: 'Excluir', value: true, tone: 'danger' }
      ]
    });

    return result === true;
  }

  window.showActionDialog = showActionDialog;
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

    form.__opRefreshFirstDue = refreshSuggestion;

    dateInput.addEventListener('change', refreshSuggestion);
    dateInput.addEventListener('input', refreshSuggestion);
    cardSelect.addEventListener('change', refreshSuggestion);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-auto-first-due-form]').forEach(bindAutoFirstDue);
  });
})();

(function () {
  function getLocalTodayISO() {
    const now = new Date();
    const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 10);
  }

  function focusManualAmount(input) {
    if (!(input instanceof HTMLInputElement)) return;

    const focusNow = () => {
      try {
        input.focus({ preventScroll: true });
      } catch (error) {
        input.focus();
      }
      try {
        input.select();
      } catch (error) {
        // noop
      }
    };

    focusNow();
    requestAnimationFrame(focusNow);
    window.setTimeout(focusNow, 120);
  }

  function syncManualPurchaseDefaults(modal) {
    if (!(modal instanceof HTMLElement)) return;

    const form = modal.querySelector('[data-auto-first-due-form]');
    if (!(form instanceof HTMLFormElement)) return;

    const dateInput = form.querySelector('[data-manual-date-input]');
    if (dateInput instanceof HTMLInputElement && !dateInput.value) {
      dateInput.value = getLocalTodayISO();
    }

    if (typeof form.__opRefreshFirstDue === 'function') {
      form.__opRefreshFirstDue();
    }
  }

  function setupManualPurchaseModal() {
    const modal = document.querySelector('[data-manual-modal]');
    if (!(modal instanceof HTMLElement)) return;

    const form = modal.querySelector('[data-auto-first-due-form]');
    const amountInput = modal.querySelector('[data-manual-amount-input]');
    const openButtons = Array.from(document.querySelectorAll('[data-manual-modal-open]')).filter((element) => element instanceof HTMLElement);
    const closeButtons = Array.from(modal.querySelectorAll('[data-manual-modal-close]')).filter((element) => element instanceof HTMLElement);

    const openModal = () => {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      syncManualPurchaseDefaults(modal);
      if (amountInput instanceof HTMLInputElement) {
        focusManualAmount(amountInput);
      }
    };

    const closeModal = () => {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    };

    openButtons.forEach((button) => {
      button.addEventListener('click', openModal);
    });

    closeButtons.forEach((button) => {
      button.addEventListener('click', closeModal);
    });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
        closeModal();
      }
    });

    if (form instanceof HTMLFormElement) {
      form.addEventListener('submit', () => {
        modal.setAttribute('aria-hidden', 'true');
      });
    }

    syncManualPurchaseDefaults(modal);
  }

  document.addEventListener('DOMContentLoaded', setupManualPurchaseModal);
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

  window.OPMoneyMask = {
    bind: bindMoneyMask,
    toCents(value) {
      const digits = extractMoneyDigits(value);
      return digits ? Number(digits) : 0;
    },
    formatFromCents(cents) {
      const numeric = Number(cents);
      if (!Number.isFinite(numeric)) return '';
      return formatMoneyDigits(String(Math.max(0, Math.round(numeric))));
    }
  };

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
  const iconBell = '<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.389 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9"></path></svg>';
  const iconBellOff = '<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364L4.636 4.636m13.728 13.728A9.953 9.953 0 0112 20a9.953 9.953 0 01-5.895-1.93M6.343 6.343A5.97 5.97 0 006 8v3.159c0 .538-.214 1.055-.595 1.436L4 14h16l-1.405-1.405A2.032 2.032 0 0118 11.159V8a6 6 0 00-9.33-4.958M9 17a3 3 0 006 0"></path></svg>';
  const iconSpinner = '<svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>';
  const iconBlocked = '<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636A9 9 0 115.636 18.364M19 19L5 5"></path></svg>';

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

  function getPushPublicKey(button) {
    const buttonKey = String(button?.dataset?.pushPublicKey || '').trim();
    if (buttonKey) return buttonKey;
    return String(document.body?.dataset?.pushPublicKey || '').trim();
  }

  function getPushStatusMessage(state) {
    if (state === 'enabled') return 'Tudo certo! Este aparelho já vai te chamar quando pintar novidade.';
    if (state === 'blocked') return 'Os alertas foram bloqueados neste navegador. Para ligar de novo, libere a permissão nas configurações do navegador.';
    if (state === 'unsupported') return 'Este navegador não consegue receber alertas por aqui, ou o recurso ainda não foi configurado.';
    if (state === 'loading') return 'Preparando os alertas deste aparelho...';
    return 'Ligue os alertas neste aparelho e deixe o app te dar um toque quando algo mudar.';
  }

  function getToggleStateConfig(state) {
    const states = {
      idle: {
        html: `${iconBell}Ativar alertas`,
        disabled: false,
        className: 'op-btn op-btn-warning-soft op-btn--block'
      },
      blocked: {
        html: `${iconBlocked}Alertas bloqueados`,
        disabled: true,
        className: 'op-btn op-btn-danger-soft op-btn--block'
      },
      enabled: {
        html: `${iconBellOff}Desligar alertas`,
        disabled: false,
        className: 'op-btn op-btn-success op-btn--block'
      },
      loading: {
        html: `${iconSpinner}Preparando...`,
        disabled: true,
        className: 'op-btn op-btn-muted op-btn--block'
      },
      unsupported: {
        html: `${iconBlocked}Alertas indisponíveis`,
        disabled: true,
        className: 'op-btn op-btn-muted op-btn--block'
      }
    };

    return states[state] || states.idle;
  }

  function getCenterTriggerConfig(state, variant) {
    if (variant === 'cta') {
      if (state === 'enabled') {
        return {
          html: `${iconBell}<span>Alertas ligados</span>`,
          helper: 'Tudo pronto: este aparelho já pode receber avisos de vencimento, respostas e confirmações.',
          ariaLabel: 'Gerenciar alertas deste aparelho'
        };
      }

      if (state === 'blocked') {
        return {
          html: `${iconBlocked}<span>Alertas bloqueados</span>`,
          helper: 'Os alertas foram barrados pelo navegador. Toque aqui para ver como está e ajustar quando quiser.',
          ariaLabel: 'Ver status dos alertas deste aparelho'
        };
      }

      if (state === 'unsupported') {
        return {
          html: `${iconBell}<span>Ver alertas</span>`,
          helper: 'Neste navegador o push não rola, mas o sininho segue guardando seus avisos recentes.',
          ariaLabel: 'Abrir central de alertas'
        };
      }

      if (state === 'loading') {
        return {
          html: `${iconSpinner}<span>Checando alertas...</span>`,
          helper: 'Só um confere rápido para descobrir como este aparelho está com os alertas.',
          ariaLabel: 'Abrir central de alertas'
        };
      }

      return {
        html: `${iconBellOff}<span>Ativar alertas</span>`,
        helper: 'Receba avisos de vencimento, respostas e confirmações neste aparelho — sem precisar caçar novidade no app.',
        ariaLabel: 'Ativar alertas deste aparelho'
      };
    }

    if (state === 'enabled') {
      return {
        icon: iconBell,
        ariaLabel: 'Abrir central de alertas'
      };
    }

    if (state === 'blocked') {
      return {
        icon: iconBlocked,
        ariaLabel: 'Abrir central de alertas. Os alertas deste aparelho estão bloqueados.'
      };
    }

    if (state === 'unsupported') {
      return {
        icon: iconBell,
        ariaLabel: 'Abrir central de alertas'
      };
    }

    if (state === 'loading') {
      return {
        icon: iconSpinner,
        ariaLabel: 'Abrir central de alertas'
      };
    }

    return {
      icon: iconBellOff,
      ariaLabel: 'Abrir central de alertas e ativar alertas neste aparelho'
    };
  }

  function showPushToast(message, tone = 'info') {
    if (!message) return;

    let container = document.querySelector('[data-push-toast-root]');
    if (!(container instanceof HTMLElement)) {
      container = document.createElement('div');
      container.dataset.pushToastRoot = '1';
      container.className = 'pointer-events-none fixed inset-x-0 top-4 z-[10060] flex justify-center px-4';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const toneClasses = tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/35 dark:text-emerald-100'
      : tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/35 dark:text-red-100'
        : 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-900/35 dark:text-sky-100';
    toast.className = `pointer-events-auto w-full max-w-md rounded-[22px] border px-4 py-3 text-sm font-semibold shadow-2xl backdrop-blur ${toneClasses}`;
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
      if (container && !container.childElementCount) container.remove();
    }, 3200);
  }

  function setPushToggleState(button, statusEl, state) {
    if (!(button instanceof HTMLButtonElement)) return;

    const chosen = getToggleStateConfig(state);
    button.innerHTML = chosen.html;
    button.disabled = chosen.disabled;
    button.className = chosen.className;

    if (statusEl instanceof HTMLElement) {
      statusEl.textContent = getPushStatusMessage(state);
    }
  }

  function setPushCenterTriggerState(trigger, state) {
    if (!(trigger instanceof HTMLElement)) return;

    const variant = String(trigger.dataset.pushCenterOpenVariant || 'icon').trim();
    const chosen = getCenterTriggerConfig(state, variant);
    trigger.dataset.pushVisualState = state;

    if (variant === 'cta') {
      const labelHost = trigger.querySelector('[data-push-center-label]');
      if (labelHost) labelHost.innerHTML = chosen.html;
      trigger.setAttribute('aria-label', chosen.ariaLabel);
      trigger.setAttribute('title', chosen.ariaLabel);
      const copySelector = String(trigger.dataset.pushCopyTarget || '').trim();
      const copyTarget = copySelector ? document.querySelector(copySelector) : null;
      if (copyTarget instanceof HTMLElement && chosen.helper) {
        copyTarget.textContent = chosen.helper;
      }
      return;
    }

    const iconHost = trigger.querySelector('[data-push-center-icon]');
    if (iconHost) {
      const badge = iconHost.querySelector('.op-utility-btn__badge');
      const badgeMarkup = badge ? badge.outerHTML : '';
      iconHost.innerHTML = `${chosen.icon}${badgeMarkup}`;
    }

    const badgeText = trigger.querySelector('.op-utility-btn__badge')?.textContent?.trim();
    const badgeSuffix = badgeText ? `. ${badgeText} aviso${badgeText === '1' ? '' : 's'} sem abrir.` : '';
    trigger.setAttribute('aria-label', `${chosen.ariaLabel}${badgeSuffix}`.trim());
    trigger.setAttribute('title', 'Abrir central de alertas');
  }

  function syncPushCenterTriggers(state) {
    document.querySelectorAll('[data-push-center-open]').forEach((trigger) => {
      setPushCenterTriggerState(trigger, state);
    });
  }

  async function resolvePushState(publicKey) {
    if (!supportsPushNotifications() || !publicKey) {
      return 'unsupported';
    }

    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) return 'enabled';
    if (Notification.permission === 'denied') return 'blocked';
    return 'idle';
  }

  async function sendSubscriptionToServer(subscription) {
    const response = await fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });

    if (!response.ok) {
      throw new Error('Não consegui guardar este aparelho para receber alertas.');
    }
  }

  async function removeSubscriptionFromServer(endpoint) {
    const response = await fetch('/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint })
    });

    if (!response.ok) {
      throw new Error('Não consegui desligar os alertas deste aparelho agora.');
    }
  }

  async function syncPushUi() {
    const sampleButton = document.querySelector('[data-push-toggle]');
    const publicKey = getPushPublicKey(sampleButton);
    const nextState = await resolvePushState(publicKey);

    document.querySelectorAll('[data-push-toggle]').forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const statusSelector = String(button.dataset.pushStatusTarget || '').trim();
      const statusEl = statusSelector ? document.querySelector(statusSelector) : null;
      setPushToggleState(button, statusEl, nextState);
    });

    syncPushCenterTriggers(nextState);
    return nextState;
  }

  async function togglePush(button, statusEl) {
    const publicKey = getPushPublicKey(button);
    if (!publicKey) {
      setPushToggleState(button, statusEl, 'unsupported');
      syncPushCenterTriggers('unsupported');
      return;
    }

    document.querySelectorAll('[data-push-toggle]').forEach((item) => {
      if (!(item instanceof HTMLButtonElement)) return;
      const selector = String(item.dataset.pushStatusTarget || '').trim();
      const itemStatusEl = selector ? document.querySelector(selector) : null;
      setPushToggleState(item, itemStatusEl, 'loading');
    });
    syncPushCenterTriggers('loading');

    try {
      const registration = await navigator.serviceWorker.ready;
      const existingSubscription = await registration.pushManager.getSubscription();

      if (existingSubscription) {
        await removeSubscriptionFromServer(existingSubscription.endpoint);
        await existingSubscription.unsubscribe();
        const nextState = await syncPushUi();
        showPushToast(nextState === 'blocked'
          ? 'Os alertas ficaram bloqueados neste navegador.'
          : 'Pronto! Os alertas deste aparelho foram desligados.', 'info');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        await syncPushUi();
        throw new Error(permission === 'denied'
          ? 'Os alertas foram bloqueados pelo navegador. Para liberar, ajuste a permissão nas configurações do navegador.'
          : 'Sem permissão para alertas. Se quiser, é só liberar no navegador.');
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      await sendSubscriptionToServer(subscription);
      await syncPushUi();
      showPushToast('Boa! Este aparelho já está pronto para receber alertas.', 'success');
    } catch (error) {
      console.error(error);
      await syncPushUi().catch((syncError) => console.error(syncError));
      window.alert(error?.message || 'Não deu para configurar os alertas neste aparelho agora.');
    }
  }

  function setupNotificationCenter() {
    const center = document.querySelector('[data-notification-center]');
    if (!(center instanceof HTMLElement)) return;

    const openButtons = Array.from(document.querySelectorAll('[data-push-center-open]')).filter((element) => element instanceof HTMLElement);
    const closeButtons = Array.from(center.querySelectorAll('[data-notification-center-close]')).filter((element) => element instanceof HTMLElement);
    const backdrop = center.querySelector('[data-notification-center-backdrop]');
    const focusTarget = center.querySelector('[data-notification-center-close]');

    function setExpanded(expanded) {
      openButtons.forEach((button) => {
        button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      });
    }

    function openCenter() {
      center.classList.remove('hidden');
      center.setAttribute('aria-hidden', 'false');
      document.body.classList.add('op-notification-center-open');
      setExpanded(true);
      window.requestAnimationFrame(() => {
        if (focusTarget instanceof HTMLElement) focusTarget.focus();
      });
    }

    function closeCenter() {
      center.classList.add('hidden');
      center.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('op-notification-center-open');
      setExpanded(false);
    }

    openButtons.forEach((button) => {
      button.addEventListener('click', () => openCenter());
    });

    closeButtons.forEach((button) => {
      button.addEventListener('click', () => closeCenter());
    });

    if (backdrop instanceof HTMLElement) {
      backdrop.addEventListener('click', () => closeCenter());
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !center.classList.contains('hidden')) {
        closeCenter();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupNotificationCenter();

    document.querySelectorAll('[data-push-toggle]').forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;

      button.addEventListener('click', () => {
        const statusSelector = String(button.dataset.pushStatusTarget || '').trim();
        const statusEl = statusSelector ? document.querySelector(statusSelector) : null;
        togglePush(button, statusEl).catch((error) => {
          console.error(error);
        });
      });
    });

    syncPushUi().catch((error) => {
      console.error(error);
      document.querySelectorAll('[data-push-toggle]').forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) return;
        const statusSelector = String(button.dataset.pushStatusTarget || '').trim();
        const statusEl = statusSelector ? document.querySelector(statusSelector) : null;
        setPushToggleState(button, statusEl, 'unsupported');
      });
      syncPushCenterTriggers('unsupported');
    });
  });
})();


(function () {
  function ensureHiddenScopeField(form) {
    let field = form.querySelector('input[name="apply_scope"]');
    if (!(field instanceof HTMLInputElement)) {
      field = document.createElement('input');
      field.type = 'hidden';
      field.name = 'apply_scope';
      form.appendChild(field);
    }
    return field;
  }

  async function resolveInstallmentScope(form, { actionLabel = 'ajustar a divisão', destructive = false } = {}) {
    const hasFuture = String(form?.dataset?.hasFutureInstallments || '') === '1';
    const field = ensureHiddenScopeField(form);

    if (!hasFuture) {
      if (destructive) {
        const confirmed = await window.confirmTypedAction(
          form?.dataset?.confirmPrompt || 'Excluir este item? Isso apaga a compra e a divisão dela.'
        );
        if (!confirmed) return null;
      }
      field.value = 'single';
      return 'single';
    }

    const label = String(form?.dataset?.installmentLabel || '').trim();
    const message = [
      destructive
        ? 'Este item faz parte de uma compra parcelada. Escolha o alcance da exclusão.'
        : `Este item faz parte de uma compra parcelada. Escolha se deseja ${actionLabel} só nesta parcela ou também nas próximas.`,
      label ? `Compra: ${label}` : ''
    ].filter(Boolean).join('\n\n');

    const result = await window.showActionDialog({
      title: destructive ? 'Excluir compra parcelada' : 'Aplicar em compra parcelada',
      message,
      options: destructive
        ? [
            { label: 'Cancelar', value: null, tone: 'secondary' },
            { label: 'Excluir só esta parcela', value: 'single', tone: 'danger' },
            { label: 'Excluir esta e próximas', value: 'future', tone: 'danger' }
          ]
        : [
            { label: 'Cancelar', value: null, tone: 'secondary' },
            { label: 'Aplicar só nesta parcela', value: 'single', tone: 'primary' },
            { label: 'Aplicar nesta e nas próximas', value: 'future', tone: 'primary' }
          ]
    });

    if (!result) {
      return null;
    }

    field.value = result;
    return result;
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.allocForm) return;
    if (form.dataset.scopeFlowHandled === '1') return;

    const formType = String(form.dataset.installmentScopeForm || '').trim().toLowerCase();
    const needsScope = !!formType;
    const needsConfirm = !!form.dataset.confirmPrompt && formType !== 'delete';
    if (!needsScope && !needsConfirm) return;

    event.preventDefault();

    (async () => {
      if (needsScope) {
        const actionLabel = formType === 'delete' ? 'excluir esta compra' : 'ajustar a divisão';
        const chosenScope = await resolveInstallmentScope(form, {
          actionLabel,
          destructive: formType === 'delete'
        });
        if (!chosenScope) return;
      }

      if (needsConfirm) {
        const confirmed = await window.confirmTypedAction(form.dataset.confirmPrompt);
        if (!confirmed) return;
      }

      form.dataset.scopeFlowHandled = '1';
      HTMLFormElement.prototype.submit.call(form);
      delete form.dataset.scopeFlowHandled;
    })().catch((error) => {
      console.error(error);
      delete form.dataset.scopeFlowHandled;
    });
  }, true);

  window.resolveInstallmentScope = resolveInstallmentScope;
})();

(function () {
  function detectNavKey(pathname) {
    if (/^\/geral(?:\/|$)/.test(pathname) || /^\/month(?:\/|$)/.test(pathname) || /^\/summary(?:\/|$)/.test(pathname)) return 'geral';
    if (/^\/shared-debts(?:\/|$)/.test(pathname) || /^\/notifications(?:\/|$)/.test(pathname)) return 'shared';
    if (/^\/people(?:\/|$)/.test(pathname)) return 'people';
    if (/^\/cards(?:\/|$)/.test(pathname)) return 'cards';
    if (/^\/import(?:\/|$)/.test(pathname)) return 'import';
    if (/^\/admin(?:\/|$)/.test(pathname)) return 'admin';
    if (/^\/detalhamento(?:\/|$)/.test(pathname) || /^\/txn(?:\/|$)/.test(pathname) || pathname === '/') return 'painel';
    return '';
  }

  function applyActiveNavState() {
    const activeKey = detectNavKey(window.location.pathname || '/');
    if (!activeKey) return;

    document.querySelectorAll('[data-nav-key]').forEach((link) => {
      link.classList.toggle('is-active', link.dataset.navKey === activeKey);
    });

    const activeBottomLink = document.querySelector('.op-bottom-nav__link.is-active');
    if (activeBottomLink instanceof HTMLElement) {
      window.requestAnimationFrame(() => {
        activeBottomLink.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyActiveNavState);
  } else {
    applyActiveNavState();
  }
})();


(function () {
  function initMobileBottomNavAutoHide() {
    const nav = document.querySelector('.op-bottom-nav');
    if (!(nav instanceof HTMLElement)) return;

    const root = document.documentElement;
    const mainShell = document.querySelector('.op-app-main');
    let hideTimer = null;

    const isMobileViewport = () => !window.matchMedia('(min-width: 768px)').matches;
    const showNav = () => nav.classList.remove('is-idle-hidden');
    const hideNav = () => nav.classList.add('is-idle-hidden');
    const scheduleHide = (delay = 1900) => {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hideNav, delay);
    };
    const registerActivity = (delay = 1900) => {
      if (!isMobileViewport()) return;
      showNav();
      scheduleHide(delay);
    };

    const applyBottomClearance = () => {
      if (!isMobileViewport()) {
        root.style.removeProperty('--op-mobile-bottom-clearance');
        if (mainShell instanceof HTMLElement) {
          mainShell.style.removeProperty('padding-bottom');
          mainShell.style.removeProperty('scroll-padding-bottom');
        }
        return;
      }

      const navHeight = Math.ceil(nav.offsetHeight || nav.getBoundingClientRect().height || 0);
      const extraBreathingRoom = 4;
      const fallbackClearance = 96;
      const clearance = Math.max(fallbackClearance, navHeight + extraBreathingRoom);
      root.style.setProperty('--op-mobile-bottom-clearance', `${clearance}px`);
      if (mainShell instanceof HTMLElement) {
        mainShell.style.setProperty('padding-bottom', `${clearance}px`, 'important');
        mainShell.style.setProperty('scroll-padding-bottom', `${clearance}px`);
      }
    };

    const syncBottomClearance = () => window.requestAnimationFrame(applyBottomClearance);

    applyBottomClearance();

    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(() => syncBottomClearance());
      resizeObserver.observe(nav);
    }

    if (isMobileViewport()) {
      registerActivity(2400);
    }

    window.addEventListener('scroll', () => registerActivity(1900), { passive: true });
    window.addEventListener('touchstart', () => registerActivity(2400), { passive: true });
    window.addEventListener('pointerdown', () => registerActivity(2400), { passive: true });
    window.addEventListener('focusin', () => registerActivity(2400));
    window.addEventListener('load', syncBottomClearance, { once: true });
    window.addEventListener('pageshow', syncBottomClearance);
    window.addEventListener('orientationchange', syncBottomClearance, { passive: true });
    window.addEventListener('resize', () => {
      syncBottomClearance();
      if (!isMobileViewport()) {
        window.clearTimeout(hideTimer);
        showNav();
        return;
      }
      registerActivity(2400);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileBottomNavAutoHide);
  } else {
    initMobileBottomNavAutoHide();
  }
})();

(function () {
  function initMonthSwipeNavigation() {
    const swipeAreas = Array.from(document.querySelectorAll('[data-month-swipe-area]'));
    if (!swipeAreas.length) return;

    const supportsTouchMonthSwipe = () => {
      const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches || Number(navigator.maxTouchPoints || 0) > 0;
      return hasCoarsePointer && window.matchMedia('(max-width: 1023px)').matches;
    };

    const isIgnoredTarget = (target) => {
      if (!(target instanceof Element)) return false;
      return !!target.closest('a, button, input, select, textarea, label, summary, [role="button"], [contenteditable=""], [contenteditable="true"], [data-no-month-swipe], .overflow-x-auto, [data-allow-horizontal-scroll], .fixed');
    };

    swipeAreas.forEach((area) => {
      if (!(area instanceof HTMLElement)) return;

      let gesture = null;
      let navigationLocked = false;

      const resetGesture = () => {
        gesture = null;
      };

      area.addEventListener('touchstart', (event) => {
        if (!supportsTouchMonthSwipe()) return;
        if (navigationLocked) return;
        if (!event.touches || event.touches.length !== 1) {
          resetGesture();
          return;
        }

        const touch = event.touches[0];
        const edgeGuard = Math.max(24, Math.round(window.innerWidth * 0.06));
        if (touch.clientX <= edgeGuard || touch.clientX >= (window.innerWidth - edgeGuard)) {
          resetGesture();
          return;
        }

        if (isIgnoredTarget(event.target)) {
          resetGesture();
          return;
        }

        gesture = {
          startX: touch.clientX,
          startY: touch.clientY,
          lastX: touch.clientX,
          lastY: touch.clientY,
          startTime: Date.now(),
          axis: '',
          cancelled: false
        };
      }, { passive: true });

      area.addEventListener('touchmove', (event) => {
        if (!gesture || gesture.cancelled) return;
        if (!event.touches || event.touches.length !== 1) {
          gesture.cancelled = true;
          return;
        }

        const touch = event.touches[0];
        gesture.lastX = touch.clientX;
        gesture.lastY = touch.clientY;

        const deltaX = gesture.lastX - gesture.startX;
        const deltaY = gesture.lastY - gesture.startY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (!gesture.axis) {
          if (absY >= 14 && absY > absX * 1.1) {
            gesture.cancelled = true;
            return;
          }

          if (absX >= 14 && absX > absY * 1.25) {
            gesture.axis = 'x';
          }
        }
      }, { passive: true });

      area.addEventListener('touchend', () => {
        if (!gesture || gesture.cancelled || navigationLocked) {
          resetGesture();
          return;
        }

        const deltaX = gesture.lastX - gesture.startX;
        const deltaY = gesture.lastY - gesture.startY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);
        const elapsed = Date.now() - gesture.startTime;

        resetGesture();

        if (elapsed > 700) return;
        if (absX < 72) return;
        if (absX <= absY * 1.35) return;

        const destination = deltaX < 0 ? area.dataset.monthSwipeNext : area.dataset.monthSwipePrev;
        if (!destination) return;

        navigationLocked = true;
        window.location.assign(destination);
      }, { passive: true });

      area.addEventListener('touchcancel', resetGesture, { passive: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMonthSwipeNavigation);
  } else {
    initMonthSwipeNavigation();
  }
})();

(function () {
  function initBottomNavCarouselSnap() {
    const scroller = document.querySelector('.op-bottom-nav__inner');
    if (!(scroller instanceof HTMLElement)) return;

    const getLinks = () => Array.from(scroller.querySelectorAll('.op-bottom-nav__link')).filter((link) => link instanceof HTMLElement);
    if (getLinks().length < 2) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const isMobileViewport = () => window.matchMedia('(max-width: 767px)').matches;

    let snapTimer = null;
    let isPointerDown = false;
    let programmaticScrollLock = false;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const releaseProgrammaticLock = (delay = 0) => {
      window.setTimeout(() => {
        programmaticScrollLock = false;
      }, delay);
    };

    const snapToNearestItem = (behavior = 'smooth') => {
      if (!isMobileViewport() || programmaticScrollLock) return;

      const links = getLinks();
      if (!links.length) return;

      const viewportCenter = scroller.scrollLeft + (scroller.clientWidth / 2);
      let closestLink = links[0];
      let smallestDistance = Number.POSITIVE_INFINITY;

      links.forEach((link) => {
        const linkCenter = link.offsetLeft + (link.offsetWidth / 2);
        const distance = Math.abs(linkCenter - viewportCenter);
        if (distance < smallestDistance) {
          smallestDistance = distance;
          closestLink = link;
        }
      });

      const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const targetScrollLeft = clamp(
        closestLink.offsetLeft - ((scroller.clientWidth - closestLink.offsetWidth) / 2),
        0,
        maxScrollLeft
      );

      if (Math.abs(scroller.scrollLeft - targetScrollLeft) < 1) return;

      programmaticScrollLock = true;
      const resolvedBehavior = behavior === 'instant' || prefersReducedMotion.matches ? 'auto' : behavior;
      scroller.scrollTo({ left: targetScrollLeft, behavior: resolvedBehavior });
      releaseProgrammaticLock(resolvedBehavior === 'auto' ? 0 : 280);
    };

    const scheduleSnap = (delay = 90, behavior = 'smooth') => {
      window.clearTimeout(snapTimer);
      snapTimer = window.setTimeout(() => snapToNearestItem(behavior), delay);
    };

    scroller.addEventListener('scroll', () => {
      if (!isMobileViewport() || isPointerDown || programmaticScrollLock) return;
      scheduleSnap(80);
    }, { passive: true });

    const handlePointerStart = () => {
      isPointerDown = true;
      window.clearTimeout(snapTimer);
    };

    const handlePointerEnd = () => {
      if (!isMobileViewport()) return;
      isPointerDown = false;
      scheduleSnap(70);
    };

    scroller.addEventListener('touchstart', handlePointerStart, { passive: true });
    scroller.addEventListener('pointerdown', handlePointerStart, { passive: true });
    scroller.addEventListener('mousedown', handlePointerStart, { passive: true });

    scroller.addEventListener('touchend', handlePointerEnd, { passive: true });
    scroller.addEventListener('touchcancel', handlePointerEnd, { passive: true });
    scroller.addEventListener('pointerup', handlePointerEnd, { passive: true });
    scroller.addEventListener('pointercancel', handlePointerEnd, { passive: true });
    scroller.addEventListener('mouseup', handlePointerEnd, { passive: true });
    scroller.addEventListener('mouseleave', () => {
      if (isPointerDown) {
        handlePointerEnd();
      }
    }, { passive: true });

    window.addEventListener('resize', () => scheduleSnap(0, 'instant'), { passive: true });
    window.addEventListener('orientationchange', () => scheduleSnap(120, 'instant'), { passive: true });
    window.addEventListener('pageshow', () => scheduleSnap(0, 'instant'));
    window.addEventListener('load', () => scheduleSnap(0, 'instant'), { once: true });

    window.requestAnimationFrame(() => scheduleSnap(0, 'instant'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBottomNavCarouselSnap);
  } else {
    initBottomNavCarouselSnap();
  }
})();

(function () {
  function setButtonBusyState(button, isBusy) {
    if (!(button instanceof HTMLElement)) return;
    if (isBusy) {
      if (!button.dataset.originalHtml) {
        button.dataset.originalHtml = button.innerHTML;
      }
      const loadingLabel = button.dataset.loadingLabel || 'Processando...';
      button.disabled = true;
      button.classList.add('op-button-loading');
      button.innerHTML = `<span class="op-submit-spinner" aria-hidden="true"></span><span>${loadingLabel}</span>`;
      button.style.display = button.style.display || 'inline-flex';
      button.style.alignItems = 'center';
      button.style.justifyContent = 'center';
      button.style.gap = '0.55rem';
      return;
    }

    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
    button.disabled = false;
    button.classList.remove('op-button-loading');
  }

  function bindSubmitLoadingStates() {
    document.addEventListener('submit', (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.noSubmitState === '1') return;
      if (form.method && form.method.toUpperCase() === 'GET' && form.dataset.submitState !== 'force') return;

      if (event.defaultPrevented) return;

      const submitButtons = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'));
      if (!submitButtons.length) return;

      window.setTimeout(() => {
        submitButtons.forEach((button) => {
          if (button instanceof HTMLButtonElement) {
            setButtonBusyState(button, true);
          } else if (button instanceof HTMLInputElement) {
            if (!button.dataset.originalValue) {
              button.dataset.originalValue = button.value;
            }
            button.disabled = true;
            button.classList.add('op-button-loading');
            button.value = button.dataset.loadingLabel || 'Processando...';
          }
        });
      }, 0);
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSubmitLoadingStates);
  } else {
    bindSubmitLoadingStates();
  }
})();

(function () {
  const LAST_VISIT_STORAGE_KEY = 'organizapay:last-visit';
  const STATUS_STYLE_ID = 'organizapay-network-pill-style';

  function rememberLastVisit() {
    if (window.location.pathname === '/offline.html') return;

    const payload = {
      title: document.title || 'OrganizaPay',
      path: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      timestamp: new Date().toISOString()
    };

    try {
      localStorage.setItem(LAST_VISIT_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Sem drama: se o navegador bloquear storage, o app segue o baile.
    }
  }

  function initLastVisitMemory() {
    rememberLastVisit();
    window.addEventListener('pageshow', rememberLastVisit);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        rememberLastVisit();
      }
    });
  }

  function injectStatusStyles() {
    if (document.getElementById(STATUS_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STATUS_STYLE_ID;
    style.textContent = `
      .op-network-pill {
        position: fixed;
        left: 50%;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 5.75rem);
        transform: translate(-50%, 1rem);
        z-index: 70;
        display: flex;
        align-items: center;
        gap: 0.65rem;
        min-width: min(92vw, 320px);
        max-width: min(92vw, 420px);
        padding: 0.9rem 1rem;
        border-radius: 999px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        background: rgba(15, 23, 42, 0.94);
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.24);
        color: #f8fafc;
        font-size: 0.92rem;
        line-height: 1.3;
        opacity: 0;
        pointer-events: none;
        transition: opacity 180ms ease, transform 180ms ease;
      }

      .op-network-pill--visible {
        opacity: 1;
        transform: translate(-50%, 0);
      }

      .op-network-pill__dot {
        flex: 0 0 auto;
        width: 0.7rem;
        height: 0.7rem;
        border-radius: 999px;
        background: #f59e0b;
        box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.14);
      }

      .op-network-pill[data-state="online"] .op-network-pill__dot {
        background: #22c55e;
        box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.14);
      }

      @media (min-width: 768px) {
        .op-network-pill {
          bottom: 1.5rem;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createStatusPill() {
    injectStatusStyles();

    const pill = document.createElement('div');
    pill.className = 'op-network-pill';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    pill.innerHTML = '<span class="op-network-pill__dot" aria-hidden="true"></span><span data-network-pill-message></span>';
    document.body.appendChild(pill);
    return pill;
  }

  function initConnectivityFeedback() {
    if (window.location.pathname === '/offline.html') return;

    const pill = createStatusPill();
    const messageNode = pill.querySelector('[data-network-pill-message]');
    let hideTimer = null;
    let hasShownOffline = false;

    function show(message, state, autoHideMs) {
      if (!(messageNode instanceof HTMLElement)) return;
      window.clearTimeout(hideTimer);
      pill.dataset.state = state;
      messageNode.textContent = message;
      pill.classList.add('op-network-pill--visible');

      if (autoHideMs) {
        hideTimer = window.setTimeout(() => {
          pill.classList.remove('op-network-pill--visible');
        }, autoHideMs);
      }
    }

    function handleOffline() {
      hasShownOffline = true;
      show('Sem internet. Entramos no modo sobrevivência até a conexão voltar.', 'offline');
    }

    function handleOnline() {
      if (!hasShownOffline) return;
      show('Conexão de volta. Bora continuar de onde parou.', 'online', 2600);
    }

    if (!navigator.onLine) {
      handleOffline();
    }

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initLastVisitMemory();
      initConnectivityFeedback();
    });
  } else {
    initLastVisitMemory();
    initConnectivityFeedback();
  }
})();
