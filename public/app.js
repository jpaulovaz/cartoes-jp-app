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
  let dialogState = null;

  function toneClasses(tone) {
    const base = 'w-full rounded-2xl px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900';
    if (tone === 'danger') return `${base} bg-red-600 text-white hover:bg-red-700 focus:ring-red-500`;
    if (tone === 'primary') return `${base} bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-500 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white dark:focus:ring-slate-300`;
    return `${base} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:focus:ring-slate-500`;
  }

  function setDialogVisibility(state, visible) {
    state.root.classList.toggle('hidden', !visible);
    document.body.classList.toggle('overflow-hidden', visible);
  }

  function ensureActionDialog() {
    if (dialogState && dialogState.root && document.body.contains(dialogState.root)) {
      return dialogState;
    }

    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-[9999] hidden';
    root.innerHTML = `
      <div class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" data-dialog-backdrop></div>
      <div class="relative z-10 flex min-h-full items-end justify-center p-4 sm:items-center">
        <div class="w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
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
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && dialogState?.activeResolve) {
        closeDialog(null);
      }
    });

    dialogState.close = closeDialog;
    return dialogState;
  }

  function showActionDialog({ title = 'Confirmar ação', message = '', options = [] } = {}) {
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
      title: 'Confirmar exclusão',
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

    const iconBell = '<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.389 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9"></path></svg>';
    const iconBellOff = '<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364L4.636 4.636m13.728 13.728A9.953 9.953 0 0112 20a9.953 9.953 0 01-5.895-1.93M6.343 6.343A5.97 5.97 0 006 8v3.159c0 .538-.214 1.055-.595 1.436L4 14h16l-1.405-1.405A2.032 2.032 0 0118 11.159V8a6 6 0 00-9.33-4.958M9 17a3 3 0 006 0"></path></svg>';
    const iconSpinner = '<svg class="w-5 h-5 mr-2 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>';
    const iconBlocked = '<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636A9 9 0 115.636 18.364M19 19L5 5"></path></svg>';

    const states = {
      idle: {
        html: `${iconBell}Ativar push`,
        disabled: false,
        className: 'inline-flex items-center justify-center rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-sky-700 transition-colors'
      },
      enabled: {
        html: `${iconBellOff}Desativar push`,
        disabled: false,
        className: 'inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 transition-colors'
      },
      loading: {
        html: `${iconSpinner}Processando...`,
        disabled: true,
        className: 'inline-flex items-center justify-center rounded-2xl bg-slate-400 px-4 py-2.5 text-sm font-bold text-white shadow-sm cursor-wait'
      },
      unsupported: {
        html: `${iconBlocked}Push indisponível`,
        disabled: true,
        className: 'inline-flex items-center justify-center rounded-2xl bg-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm cursor-not-allowed dark:bg-slate-700 dark:text-slate-200'
      }
    };

    const chosen = states[state] || states.idle;
    button.innerHTML = chosen.html;
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

  async function resolveInstallmentScope(form, { actionLabel = 'alterar a distribuição', destructive = false } = {}) {
    const hasFuture = String(form?.dataset?.hasFutureInstallments || '') === '1';
    const field = ensureHiddenScopeField(form);

    if (!hasFuture) {
      if (destructive) {
        const confirmed = await window.confirmTypedAction(
          form?.dataset?.confirmPrompt || 'Excluir este lançamento? Esta ação remove o item e a distribuição associada.'
        );
        if (!confirmed) return null;
      }
      field.value = 'single';
      return 'single';
    }

    const label = String(form?.dataset?.installmentLabel || '').trim();
    const message = [
      destructive
        ? 'Este lançamento faz parte de um parcelamento. Escolha o alcance da exclusão.'
        : `Este lançamento faz parte de um parcelamento. Escolha se deseja ${actionLabel} só nesta parcela ou também nas próximas.`,
      label ? `Lançamento: ${label}` : ''
    ].filter(Boolean).join('\n\n');

    const result = await window.showActionDialog({
      title: destructive ? 'Excluir lançamento parcelado' : 'Aplicar em compra parcelada',
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
        const actionLabel = formType === 'delete' ? 'excluir este lançamento' : 'alterar a distribuição';
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
    if (/^\/geral(?:\/|$)/.test(pathname)) return 'geral';
    if (/^\/shared-debts(?:\/|$)/.test(pathname) || /^\/notifications(?:\/|$)/.test(pathname)) return 'shared';
    if (/^\/people(?:\/|$)/.test(pathname)) return 'people';
    if (/^\/cards(?:\/|$)/.test(pathname)) return 'cards';
    if (/^\/import(?:\/|$)/.test(pathname)) return 'import';
    if (/^\/admin(?:\/|$)/.test(pathname)) return 'admin';
    if (/^\/month(?:\/|$)/.test(pathname) || /^\/summary(?:\/|$)/.test(pathname) || /^\/detalhamento(?:\/|$)/.test(pathname) || /^\/txn(?:\/|$)/.test(pathname) || pathname === '/') return 'painel';
    return '';
  }

  function applyActiveNavState() {
    const activeKey = detectNavKey(window.location.pathname || '/');
    if (!activeKey) return;

    document.querySelectorAll('[data-nav-key]').forEach((link) => {
      link.classList.toggle('is-active', link.dataset.navKey === activeKey);
    });
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
    const scheduleHide = (delay = 900) => {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hideNav, delay);
    };
    const registerActivity = (delay = 900) => {
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
      const extraBreathingRoom = 16;
      const fallbackClearance = 124;
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
      registerActivity(1400);
    }

    window.addEventListener('scroll', () => registerActivity(900), { passive: true });
    window.addEventListener('touchstart', () => registerActivity(1400), { passive: true });
    window.addEventListener('pointerdown', () => registerActivity(1400), { passive: true });
    window.addEventListener('focusin', () => registerActivity(1400));
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
      registerActivity(1400);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileBottomNavAutoHide);
  } else {
    initMobileBottomNavAutoHide();
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
