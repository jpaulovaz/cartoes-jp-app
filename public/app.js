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
  function detectIOS() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const maxTouchPoints = navigator.maxTouchPoints || 0;
    return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  }

  function detectStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }

  function syncPlatformState() {
    const root = document.documentElement;
    const body = document.body;
    const isIOS = detectIOS();
    const isStandalone = detectStandalone();
    const visualViewport = window.visualViewport;
    const viewportHeight = Math.round((visualViewport && visualViewport.height) || window.innerHeight || document.documentElement.clientHeight || 0);
    const viewportWidth = Math.round((visualViewport && visualViewport.width) || window.innerWidth || document.documentElement.clientWidth || 0);
    const offsetTop = Math.round((visualViewport && visualViewport.offsetTop) || 0);
    const keyboardInset = Math.max(0, Math.round((window.innerHeight || viewportHeight) - viewportHeight - offsetTop));
    const keyboardOpen = keyboardInset > 120;

    root.classList.toggle('op-ios', isIOS);
    root.classList.toggle('op-standalone', isStandalone);
    root.classList.toggle('op-ios-standalone', isIOS && isStandalone);
    root.dataset.opPlatform = isIOS ? 'ios' : 'default';
    root.dataset.opDisplayMode = isStandalone ? 'standalone' : 'browser';
    root.style.setProperty('--op-app-height', `${Math.max(viewportHeight, 1)}px`);
    root.style.setProperty('--op-visual-viewport-height', `${Math.max(viewportHeight, 1)}px`);
    root.style.setProperty('--op-visual-viewport-width', `${Math.max(viewportWidth, 1)}px`);
    root.style.setProperty('--op-keyboard-inset', `${Math.max(keyboardInset, 0)}px`);

    if (body) {
      body.classList.toggle('op-ios', isIOS);
      body.classList.toggle('op-standalone', isStandalone);
      body.classList.toggle('op-ios-standalone', isIOS && isStandalone);
      body.classList.toggle('op-virtual-keyboard-open', isIOS && keyboardOpen);
    }
  }

  syncPlatformState();
  document.addEventListener('DOMContentLoaded', syncPlatformState);
  window.addEventListener('load', syncPlatformState);
  window.addEventListener('pageshow', syncPlatformState);
  window.addEventListener('resize', syncPlatformState, { passive: true });
  window.addEventListener('orientationchange', () => window.setTimeout(syncPlatformState, 120), { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncPlatformState, { passive: true });
    window.visualViewport.addEventListener('scroll', syncPlatformState, { passive: true });
  }

  if (window.matchMedia) {
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    if (typeof standaloneQuery.addEventListener === 'function') {
      standaloneQuery.addEventListener('change', syncPlatformState);
    } else if (typeof standaloneQuery.addListener === 'function') {
      standaloneQuery.addListener(syncPlatformState);
    }
  }
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
    if (tone === 'cancel') return `${base} border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus:ring-red-400 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200 dark:hover:bg-red-900/35 dark:focus:ring-red-500`;
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
        { label: 'Excluir', value: true, tone: 'danger' },
        { label: 'Cancelar', value: false, tone: 'cancel' }
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

  window.OPComputeSuggestedFirstDue = computeSuggestedFirstDue;

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
      document.body.classList.add('op-manual-modal-open');
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
      document.body.classList.remove('op-manual-modal-open');
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
    let manualTotal = 0;
    let remainingTotal = 0;
    root.querySelectorAll('[data-summary-person-row]').forEach((row) => {
      const totalCents = Number(row.getAttribute('data-total-cents') || 0);
      const autoPaidCents = Number(row.getAttribute('data-auto-paid-cents') || 0);
      const personId = row.getAttribute('data-person-id');
      const paidInput = root.querySelector(`[data-summary-person-paid][data-person-id="${personId}"]`);
      const manualPaidCents = centsFromValue(paidInput ? paidInput.value : '');
      const paidCents = autoPaidCents + manualPaidCents;
      const remainingCents = totalCents - paidCents;
      paidTotal += paidCents;
      manualTotal += manualPaidCents;
      remainingTotal += remainingCents;
      const combinedCell = root.querySelector(`[data-summary-person-combined][data-person-id="${personId}"]`);
      if (combinedCell) combinedCell.textContent = formatCents(paidCents);
      syncRemainingCell(root.querySelector(`[data-summary-person-remaining][data-person-id="${personId}"]`), remainingCents);
    });

    const paidCell = root.querySelector('[data-summary-people-total-paid]');
    const manualCell = root.querySelector('[data-summary-people-total-manual]');
    const remainingCell = root.querySelector('[data-summary-people-total-remaining]');
    if (paidCell) paidCell.textContent = formatCents(paidTotal);
    if (manualCell) manualCell.textContent = formatCents(manualTotal);
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
  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const donutPalette = ['#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6', '#f97316'];
  const prefersReducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function formatMoney(cents) {
    return currency.format(Number(cents || 0) / 100);
  }

  function formatCompactMonthSummary(point) {
    return `${point.label} · ${formatMoney(point.total_cents)}`;
  }

  function buildMonthUrl(year, month, extra = {}) {
    const params = new URLSearchParams();
    Object.entries(extra || {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
    });
    const qs = params.toString();
    return `/month/${year}/${month}${qs ? `?${qs}` : ''}`;
  }

  function buildSummaryUrl(year, month, base = 'summary') {
    const cleanBase = String(base || 'summary').replace(/[^a-z-]/gi, '') || 'summary';
    return `/${cleanBase}/${year}/${month}`;
  }

  function setInteractionHint(root, message) {
    const node = root.querySelector('[data-summary-interaction-hint]');
    if (node && message) node.textContent = message;
    const status = root.querySelector('[data-summary-graphs-status]');
    if (status && message) status.textContent = message;
  }

  function setGraphsReady(root, ready) {
    if (root) root.setAttribute('data-summary-graphs-ready', ready ? 'true' : 'false');
  }

  function readSummaryGraphs(root) {
    if (root.__summaryGraphsPayload) return root.__summaryGraphsPayload;
    const node = root.querySelector('[data-summary-graphs-json]');
    if (!node) return null;
    try {
      root.__summaryGraphsPayload = JSON.parse(node.textContent || '{}');
      return root.__summaryGraphsPayload;
    } catch (error) {
      console.error('Nao consegui ler os dados dos gráficos do summary.', error);
      return null;
    }
  }

  function bindSummaryDisclosure({ button, panel, label, openLabel, closeLabel, onOpen = null }) {
    if (!button || !panel || !label) return;

    function applyState(expanded) {
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      panel.hidden = !expanded;
      label.textContent = expanded ? closeLabel : openLabel;
      if (expanded && typeof onOpen === 'function') {
        window.requestAnimationFrame(() => onOpen());
      }
    }

    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      applyState(!expanded);
    });

    applyState(button.getAttribute('aria-expanded') === 'true');
  }

  function buildPageScrollStorageKey(prefix) {
    return `${prefix}:${window.location.pathname}${window.location.search}`;
  }

  function storePageScrollState(prefix, state) {
    try {
      window.sessionStorage.setItem(buildPageScrollStorageKey(prefix), JSON.stringify({ ...state, savedAt: Date.now() }));
    } catch (_) {}
  }

  function restorePageScrollState(prefix, beforeRestore = null) {
    try {
      const key = buildPageScrollStorageKey(prefix);
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      window.sessionStorage.removeItem(key);
      const state = JSON.parse(raw || '{}');
      if (typeof beforeRestore === 'function') beforeRestore(state);
      const attemptRestore = () => {
        if (state && state.selector) {
          const target = document.querySelector(state.selector);
          if (target) {
            target.scrollIntoView({ block: 'center', behavior: 'auto' });
            return;
          }
        }
        if (state && Number.isFinite(Number(state.y))) {
          window.scrollTo({ top: Math.max(0, Number(state.y)), behavior: 'auto' });
        }
      };
      window.requestAnimationFrame(() => {
        attemptRestore();
        window.setTimeout(attemptRestore, 180);
      });
      return state;
    } catch (_) {
      return null;
    }
  }

  function foldCategoryItems(items) {
    const filtered = Array.isArray(items)
      ? items.filter((item) => Number(item && item.total_cents || 0) > 0)
      : [];

    if (filtered.length <= 5) return filtered;

    const visible = filtered.slice(0, 5);
    const others = filtered.slice(5).reduce((acc, item) => {
      acc.total_cents += Number(item.total_cents || 0);
      acc.txn_count += Number(item.txn_count || 0);
      return acc;
    }, { id: null, label: 'Outras categorias', total_cents: 0, txn_count: 0, is_uncategorized: false, is_aggregate: true });

    if (others.total_cents > 0) visible.push(others);
    return visible;
  }


  function renderDonutChart(root, items) {
    const chartNode = root.querySelector('[data-summary-donut-chart]');
    const legendNode = root.querySelector('[data-summary-donut-legend]');
    const summaryNode = root.querySelector('[data-summary-donut-summary]');
    if (!chartNode || !legendNode || !summaryNode) return;

    const filtered = foldCategoryItems(items);
    const total = filtered.reduce((acc, item) => acc + Number(item.total_cents || 0), 0);

    if (!filtered.length || total <= 0) {
      chartNode.innerHTML = '<div class="flex min-h-[260px] items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm font-semibold leading-6 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">Ainda falta categoria suficiente para montar esse retrato. Quando o mês ganhar mais cara, esse gráfico entra no jogo.</div>';
      legendNode.innerHTML = '';
      summaryNode.innerHTML = '';
      return;
    }

    const isNarrowScreen = window.matchMedia('(max-width: 767px)').matches;
    const radius = isNarrowScreen ? 82 : 92;
    const strokeWidth = isNarrowScreen ? 28 : 30;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const segments = filtered.map((item, index) => {
      const ratio = Number(item.total_cents || 0) / total;
      const segmentLength = Math.max(ratio * circumference, 0);
      const dashOffset = circumference - offset;
      offset += segmentLength;
      const color = donutPalette[index % donutPalette.length];
      const share = Math.max(1, Math.round(ratio * 100));
      return {
        ...item,
        color,
        share,
        dashArray: `${segmentLength.toFixed(2)} ${(circumference - segmentLength).toFixed(2)}`,
        dashOffset: dashOffset.toFixed(2)
      };
    });

    const topCategory = segments[0] || null;
    const totalPurchases = segments.reduce((acc, item) => acc + Number(item.txn_count || 0), 0);

    chartNode.innerHTML = `
      <div class="op-analytics-donut-shell">
        <div class="op-analytics-donut-figure">
          <svg viewBox="0 0 220 220" class="op-analytics-donut-svg" role="img" aria-label="Distribuição por categoria">
            <circle cx="110" cy="110" r="${radius}" fill="none" stroke="rgba(148,163,184,0.16)" stroke-width="${strokeWidth}"></circle>
            ${segments.map((segment, index) => `
              <circle
                cx="110"
                cy="110"
                r="${radius}"
                fill="none"
                stroke="${segment.color}"
                stroke-width="${strokeWidth}"
                stroke-linecap="round"
                class="transition-all duration-300"
                data-summary-donut-segment
                data-segment-index="${index}"
                data-segment-focus="false"
                stroke-dasharray="${segment.dashArray}"
                stroke-dashoffset="${segment.dashOffset}"></circle>
            `).join('')}
          </svg>
          <div class="op-analytics-donut-center">
            <span class="op-analytics-donut-center__eyebrow">Total</span>
            <span class="op-analytics-donut-center__value">${formatMoney(total)}</span>
            <span class="op-analytics-donut-center__copy" data-summary-donut-center-copy>${filtered.length} categorias no mapa</span>
          </div>
        </div>
      </div>`;

    legendNode.innerHTML = `
      <div class="op-analytics-category-list">
        ${segments.map((segment, index) => {
          const canOpen = !segment.is_aggregate && !segment.is_uncategorized && Number(segment.id || 0) > 0;
          return `
            <button type="button" class="op-analytics-category-item group" data-summary-category-link data-category-id="${Number(segment.id || 0)}" data-category-label="${String(segment.label || 'Sem nome').replace(/"/g, '&quot;')}" data-segment-index="${index}" ${canOpen ? '' : 'data-category-disabled="true"'}>
              <span class="op-analytics-category-item__body">
                <span class="op-analytics-category-item__top">
                  <span class="op-analytics-category-item__title">
                    <span class="op-analytics-category-item__swatch" style="background:${segment.color}"></span>
                    <span class="op-analytics-category-item__label">${segment.label || 'Sem nome'}</span>
                  </span>
                  <span class="op-analytics-category-item__share">${segment.share}%</span>
                </span>
                <span class="op-analytics-category-item__meta-row">
                  <span class="op-analytics-category-item__meta">${segment.txn_count || 0} compra(s)</span>
                  <span class="op-analytics-category-item__amount">${formatMoney(segment.total_cents)}</span>
                </span>
                <span class="op-analytics-category-item__bar"><span style="width:${Math.max(8, Number(segment.share || 0))}%;background:${segment.color}"></span></span>
              </span>
            </button>`;
        }).join('')}
      </div>`;

    summaryNode.innerHTML = `
      <div class="op-analytics-donut-summary op-analytics-donut-summary--below">
        <div class="op-analytics-donut-summary-card">
          <span class="op-analytics-donut-summary-card__label">Campeã</span>
          <strong class="op-analytics-donut-summary-card__value">${topCategory ? topCategory.label : 'Ainda sem líder'}</strong>
          <span class="op-analytics-donut-summary-card__sub">${topCategory ? `${topCategory.share}% do seu pedaço` : 'Quando pintar gasto, a campeã aparece.'}</span>
        </div>
        <div class="op-analytics-donut-summary-card">
          <span class="op-analytics-donut-summary-card__label">Compras lidas</span>
          <strong class="op-analytics-donut-summary-card__value">${totalPurchases}</strong>
          <span class="op-analytics-donut-summary-card__sub">só no que entrou no mapa</span>
        </div>
        <div class="op-analytics-donut-summary-card">
          <span class="op-analytics-donut-summary-card__label">Categorias</span>
          <strong class="op-analytics-donut-summary-card__value">${filtered.length}</strong>
          <span class="op-analytics-donut-summary-card__sub">aparecendo por aqui</span>
        </div>
      </div>`;

    const centerCopy = chartNode.querySelector('[data-summary-donut-center-copy]');
    const segmentNodes = Array.from(chartNode.querySelectorAll('[data-summary-donut-segment]'));
    const legendButtons = Array.from(legendNode.querySelectorAll('[data-summary-category-link]'));

    function highlightSegment(index = null) {
      segmentNodes.forEach((segmentNode, segmentIndex) => {
        const active = index !== null && Number(index) === segmentIndex;
        segmentNode.style.opacity = active || index === null ? '1' : '0.28';
        segmentNode.style.transformOrigin = '110px 110px';
        segmentNode.style.transform = active && !(prefersReducedMotion && prefersReducedMotion.matches) ? 'scale(1.03)' : 'scale(1)';
      });
      if (!centerCopy) return;
      if (index === null) {
        centerCopy.textContent = `${filtered.length} categorias no mapa`;
        return;
      }
      const activeSegment = segments[Number(index)];
      if (!activeSegment) return;
      centerCopy.textContent = `${activeSegment.label} · ${activeSegment.share}% do seu pedaço`;
    }

    legendButtons.forEach((button) => {
      const index = Number(button.getAttribute('data-segment-index') || -1);
      const disabled = button.hasAttribute('data-category-disabled');
      const handleEnter = () => highlightSegment(index);
      const handleLeave = () => highlightSegment(null);
      button.addEventListener('mouseenter', handleEnter);
      button.addEventListener('focus', handleEnter);
      button.addEventListener('mouseleave', handleLeave);
      button.addEventListener('blur', handleLeave);
      button.addEventListener('click', () => {
        const categoryId = Number(button.getAttribute('data-category-id') || 0);
        const categoryLabel = button.getAttribute('data-category-label') || 'essa categoria';
        const year = Number(root.getAttribute('data-summary-year') || 0);
        const month = Number(root.getAttribute('data-summary-month') || 0);
        if (disabled || !categoryId) {
          setInteractionHint(root, `${categoryLabel} ficou só na vitrine por enquanto, porque esse pedaço é um agrupado rápido.`);
          return;
        }
        setInteractionHint(root, `Abrindo ${categoryLabel} para você ver onde essa grana apareceu.`);
        window.location.href = buildMonthUrl(year, month, { f_category: categoryId });
      });
    });
  }



  function renderLineChart(root, points) {
    const chartNode = root.querySelector('[data-summary-line-chart]');
    if (!chartNode) return;

    const filtered = Array.isArray(points) ? points : [];
    if (!filtered.length) {
      chartNode.innerHTML = '<div class="flex min-h-[260px] items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm font-semibold leading-6 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">Ainda não deu para desenhar essa linha direitinho.</div>';
      return;
    }

    const isNarrowScreen = window.matchMedia('(max-width: 767px)').matches;
    const pointSpacing = isNarrowScreen ? 110 : 88;
    const width = Math.max((filtered.length - 1) * pointSpacing + 96, isNarrowScreen ? 560 : 520);
    const height = isNarrowScreen ? 240 : 250;
    const padding = isNarrowScreen ? { top: 24, right: 24, bottom: 42, left: 24 } : { top: 24, right: 18, bottom: 38, left: 18 };
    const values = filtered.map((point) => Number(point.total_cents || 0));
    const maxValue = Math.max(...values, 0);
    const safeMax = maxValue <= 0 ? 1 : maxValue;
    const stepX = filtered.length === 1 ? 0 : (width - padding.left - padding.right) / (filtered.length - 1);

    const coords = filtered.map((point, index) => {
      const x = padding.left + (stepX * index);
      const y = padding.top + ((safeMax - Number(point.total_cents || 0)) / safeMax) * (height - padding.top - padding.bottom);
      return {
        ...point,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2))
      };
    });

    const polyline = coords.map((point) => `${point.x},${point.y}`).join(' ');
    const areaPolyline = `${padding.left},${height - padding.bottom} ${polyline} ${coords[coords.length - 1].x},${height - padding.bottom}`;
    const pointCardsMarkup = coords.map((point, index) => `
          <button type="button" class="rounded-2xl border ${point.is_current ? 'border-violet-300 bg-violet-50/70 dark:border-violet-800 dark:bg-violet-900/20' : 'border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/70'} px-3 py-2.5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-50/80 focus:outline-none focus:ring-2 focus:ring-violet-400 dark:hover:border-violet-700 dark:hover:bg-violet-900/20" data-summary-month-point data-point-index="${index}" data-point-year="${point.year}" data-point-month="${point.month}" data-point-label="${point.label}">
            <div class="text-[11px] font-bold uppercase tracking-[0.18em] ${point.is_current ? 'text-violet-700 dark:text-violet-300' : 'text-slate-500 dark:text-slate-400'}">${point.label}</div>
            <div class="mt-1 text-sm font-black ${point.is_current ? 'text-violet-700 dark:text-violet-200' : 'text-slate-900 dark:text-white'}">${formatMoney(point.total_cents)}</div>
          </button>
        `).join('');

    chartNode.innerHTML = `
      <div class="op-analytics-line-layout${isNarrowScreen ? '' : ' op-analytics-line-layout--desktop'}">
        <div class="op-analytics-line-shell">
          <div class="op-analytics-line-scroller" data-summary-chart-scroller>
            <div class="op-analytics-line-stage" style="min-width:${width}px">
              <svg viewBox="0 0 ${width} ${height}" class="op-analytics-line-svg" role="img" aria-label="Seu pedaço no cartão, mês a mês">
                <defs>
                  <linearGradient id="summaryLineFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.30"></stop>
                    <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.02"></stop>
                  </linearGradient>
                </defs>
                ${[0.25, 0.5, 0.75, 1].map((step) => {
                  const y = padding.top + ((height - padding.top - padding.bottom) * step);
                  return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(148,163,184,0.22)" stroke-dasharray="4 6"></line>`;
                }).join('')}
                <polygon points="${areaPolyline}" fill="url(#summaryLineFill)"></polygon>
                <polyline points="${polyline}" fill="none" stroke="#8b5cf6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
                ${coords.map((point) => `
                  <g>
                    <circle cx="${point.x}" cy="${point.y}" r="${point.is_current ? 6.5 : 5}" fill="#ffffff" stroke="#8b5cf6" stroke-width="${point.is_current ? 4 : 3}"></circle>
                    <text x="${point.x}" y="${height - 12}" text-anchor="middle" class="fill-slate-500 text-[11px] font-bold">${point.label}</text>
                  </g>
                `).join('')}
              </svg>
              ${isNarrowScreen ? '' : coords.map((point, index) => `
                <button
                  type="button"
                  class="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-transparent bg-transparent outline-none transition focus:border-violet-400"
                  style="left:${((point.x / width) * 100).toFixed(3)}%;top:${((point.y / height) * 100).toFixed(3)}%"
                  aria-label="Abrir detalhes de ${point.label}"
                  data-summary-month-hotspot
                  data-point-index="${index}"
                  data-point-year="${point.year}"
                  data-point-month="${point.month}"
                  data-point-label="${point.label}"></button>
              `).join('')}
            </div>
          </div>
          ${isNarrowScreen ? '<div class="op-analytics-line-hint">Arraste para os lados para passear pelos meses.</div>' : ''}
        </div>
        <div class="op-analytics-line-points grid grid-cols-2 gap-3 sm:grid-cols-3">
          ${pointCardsMarkup}
        </div>
      </div>`;

    const scroller = chartNode.querySelector('[data-summary-chart-scroller]');
    if (scroller && isNarrowScreen) {
      const activePoint = coords.find((point) => point.is_current) || coords[coords.length - 1];
      if (activePoint) {
        window.requestAnimationFrame(() => {
          const targetLeft = Math.max(0, activePoint.x - (scroller.clientWidth / 2));
          scroller.scrollLeft = targetLeft;
        });
      }
    }

    const hotspots = Array.from(chartNode.querySelectorAll('[data-summary-month-hotspot]'));
    const pointButtons = Array.from(chartNode.querySelectorAll('[data-summary-month-point]'));

    function handlePreview(index) {
      const point = coords[Number(index)];
      if (!point) return;
      setInteractionHint(root, `${formatCompactMonthSummary(point)}. Toque de novo para abrir esse mês.`);
    }

    function bindNavigation(button) {
      button.addEventListener('mouseenter', () => handlePreview(button.getAttribute('data-point-index')));
      button.addEventListener('focus', () => handlePreview(button.getAttribute('data-point-index')));
      button.addEventListener('click', () => {
        const year = Number(button.getAttribute('data-point-year') || 0);
        const month = Number(button.getAttribute('data-point-month') || 0);
        const label = button.getAttribute('data-point-label') || 'esse mês';
        setInteractionHint(root, `Indo para ${label}. Bora comparar esse capítulo da novela financeira.`);
        const detailBase = root.getAttribute('data-summary-detail-base') || 'summary';
        window.location.href = buildSummaryUrl(year, month, detailBase);
      });
    }

    hotspots.forEach(bindNavigation);
    pointButtons.forEach(bindNavigation);
  }


  function scheduleRender(callback) {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(callback, { timeout: 400 });
      return;
    }
    window.setTimeout(callback, 30);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const summaryRoot = document.querySelector('[data-summary-graphs-root]');
    if (summaryRoot) {
      const payload = readSummaryGraphs(summaryRoot);
      let hasRendered = false;
      let graphPanelSeen = false;

      const renderCharts = () => {
        if (!payload || hasRendered) return;
        hasRendered = true;
        scheduleRender(() => {
          renderDonutChart(summaryRoot, payload.categories || []);
          renderLineChart(summaryRoot, payload.monthlyTrend || []);
          setGraphsReady(summaryRoot, true);
          setInteractionHint(summaryRoot, 'Gráficos prontos. Agora é só tocar e seguir o fio da meada.');
        });
      };

      const graphButton = summaryRoot.querySelector('[data-summary-graphs-toggle]');
      const graphPanel = summaryRoot.querySelector('[data-summary-graphs-panel]');
      const graphLabel = summaryRoot.querySelector('[data-summary-graphs-toggle-label]');
      if (graphButton && graphPanel && graphLabel) {
        bindSummaryDisclosure({
          button: graphButton,
          panel: graphPanel,
          label: graphLabel,
          openLabel: 'Mostrar gráficos',
          closeLabel: 'Esconder gráficos',
          onOpen: () => {
            if (graphPanelSeen) return renderCharts();
            graphPanelSeen = true;
            if ('IntersectionObserver' in window && graphPanel) {
              const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                  if (!entry.isIntersecting) return;
                  renderCharts();
                  observer.disconnect();
                });
              }, { rootMargin: '140px 0px' });
              observer.observe(graphPanel);
            } else {
              renderCharts();
            }
          }
        });
      } else {
        graphPanelSeen = true;
        renderCharts();
      }

      const intelRoot = document.querySelector('[data-summary-intel-root]');
      if (intelRoot) {
        bindSummaryDisclosure({
          button: intelRoot.querySelector('[data-summary-intel-toggle]'),
          panel: intelRoot.querySelector('[data-summary-intel-panel]'),
          label: intelRoot.querySelector('[data-summary-intel-toggle-label]'),
          openLabel: 'Mostrar inteligência',
          closeLabel: 'Esconder inteligência'
        });
      }

      const rankingRoot = document.querySelector('[data-summary-ranking-root]');
      if (rankingRoot) {
        bindSummaryDisclosure({
          button: rankingRoot.querySelector('[data-summary-ranking-toggle]'),
          panel: rankingRoot.querySelector('[data-summary-ranking-panel]'),
          label: rankingRoot.querySelector('[data-summary-ranking-toggle-label]'),
          openLabel: 'Mostrar ranking',
          closeLabel: 'Esconder ranking'
        });
      }

      restorePageScrollState('op-summary-scroll', (state) => {
        if (!state) return;
        if (state.expandIntel) {
          const btn = document.querySelector('[data-summary-intel-toggle]');
          if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
        }
        if (state.expandRanking) {
          const rankBtn = document.querySelector('[data-summary-ranking-toggle]');
          if (rankBtn && rankBtn.getAttribute('aria-expanded') !== 'true') rankBtn.click();
        }
      });
      document.querySelectorAll('[data-scroll-preserve-form]').forEach((form) => {
        form.addEventListener('submit', () => {
          const preferredSelector = form.getAttribute('data-scroll-restore-target');
          const selector = preferredSelector || '[data-summary-intel-root]';
          storePageScrollState('op-summary-scroll', {
            selector,
            y: window.scrollY || 0,
            expandIntel: Boolean(form.closest('[data-summary-intel-root]')),
            expandRanking: Boolean(form.closest('[data-summary-ranking-root]'))
          });
        });
      });
    }

    const monthRoot = document.querySelector('.op-screen--month');
    if (monthRoot) {
      restorePageScrollState('op-month-scroll');
      let activeTxnSelector = '';

      document.querySelectorAll('[data-month-row][data-txn-id]').forEach((row) => {
        row.addEventListener('click', () => {
          const txnId = String(row.getAttribute('data-txn-id') || '').trim();
          if (!txnId) return;
          activeTxnSelector = `[data-month-row][data-txn-id="${txnId.replace(/"/g, '\"')}"]`;
          storePageScrollState('op-month-scroll', { selector: activeTxnSelector, y: window.scrollY || 0 });
        }, { capture: true });
      });

      document.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (!form.closest('.op-screen--month')) return;
        storePageScrollState('op-month-scroll', { selector: activeTxnSelector, y: window.scrollY || 0 });
      }, true);

      const nativeAssign = window.location.assign.bind(window.location);
      window.location.assign = (url) => {
        if (document.querySelector('.op-screen--month')) {
          storePageScrollState('op-month-scroll', { selector: activeTxnSelector, y: window.scrollY || 0 });
        }
        return nativeAssign(url);
      };
    }
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
    const scopeKind = String(form?.dataset?.futureScopeKind || 'installment').trim().toLowerCase();
    const hasFuture = String(form?.dataset?.hasFutureCategoryScope || form?.dataset?.hasFutureInstallments || '') === '1';
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
    const isRecurring = scopeKind === 'recurring';
    const entityLabel = isRecurring ? 'compra recorrente' : 'compra parcelada';
    const message = [
      destructive
        ? `Este item faz parte de uma ${entityLabel}. Escolha o alcance da exclusão.`
        : isRecurring
          ? `Este item faz parte de uma ${entityLabel}. Escolha se deseja ${actionLabel} só nesta compra ou também nas próximas recorrências.`
          : `Este item faz parte de uma ${entityLabel}. Escolha se deseja ${actionLabel} só nesta parcela ou também nas próximas.`,
      label ? `Compra: ${label}` : ''
    ].filter(Boolean).join('\n\n');

    const result = await window.showActionDialog({
      title: destructive ? `Excluir ${entityLabel}` : `Aplicar em ${entityLabel}`,
      message,
      options: destructive
        ? [
            { label: `Excluir Só ${isRecurring ? 'Esta Compra' : 'Esta Parcela'}`, value: 'single', tone: 'danger' },
            { label: `Excluir ${isRecurring ? 'Esta Compra e Próximas Recorrências' : 'Esta e Próximas'}`, value: 'future', tone: 'danger' },
            { label: 'Cancelar', value: null, tone: 'cancel' }
          ]
        : [
            { label: `Aplicar Só ${isRecurring ? 'Nesta Compra' : 'Nesta Parcela'}`, value: 'single', tone: 'primary' },
            { label: `Aplicar ${isRecurring ? 'Nesta Compra e nas Próximas Recorrências' : 'Nesta e nas Próximas'}`, value: 'future', tone: 'primary' },
            { label: 'Cancelar', value: null, tone: 'cancel' }
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
        const actionLabel = formType === 'delete'
          ? 'excluir esta compra'
          : formType === 'category'
            ? 'mudar a categoria'
            : formType === 'edit'
              ? 'salvar essa edição'
              : 'ajustar a divisão';
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
  const LAST_VISIT_STORAGE_KEY = 'acerttapay:last-visit';
  const STATUS_STYLE_ID = 'acerttapay-network-pill-style';

  function rememberLastVisit() {
    if (window.location.pathname === '/offline.html') return;

    const payload = {
      title: document.title || 'AcerttaPay',
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


(function () {
  function sortPurchaseCategoryOptions(select) {
    if (!(select instanceof HTMLSelectElement)) return;

    const options = Array.from(select.options || []);
    if (!options.length) return;

    const firstOption = options.find((option) => String(option.value || '') === '') || null;
    const customOption = options.find((option) => String(option.value || '') === '__new__') || null;
    const sortableOptions = options.filter((option) => option !== firstOption && option !== customOption);

    sortableOptions.sort((a, b) => String(a.textContent || '').localeCompare(String(b.textContent || ''), 'pt-BR', { sensitivity: 'base' }));

    const orderedOptions = [];
    if (firstOption) orderedOptions.push(firstOption);
    orderedOptions.push(...sortableOptions);
    if (customOption) orderedOptions.push(customOption);

    orderedOptions.forEach((option) => {
      select.appendChild(option);
    });
  }

  function bindPurchaseCategoryControl(root) {
    if (!(root instanceof HTMLElement)) return;
    const select = root.querySelector('[data-purchase-category-select]');
    const customShell = root.querySelector('[data-purchase-category-custom-shell]');
    const customInput = root.querySelector('[data-purchase-category-custom-input]');
    if (!(select instanceof HTMLSelectElement)) return;

    sortPurchaseCategoryOptions(select);

    const sync = () => {
      const wantsCustom = String(select.value || '') === '__new__';
      if (customShell instanceof HTMLElement) {
        customShell.hidden = !wantsCustom;
      }
      if (customInput instanceof HTMLInputElement) {
        customInput.disabled = !wantsCustom;
        if (!wantsCustom) {
          customInput.value = '';
        } else {
          window.requestAnimationFrame(() => customInput.focus());
        }
      }
    };

    select.addEventListener('change', sync);
    sync();
  }

  function initPurchaseCategoryControls(scope = document) {
    if (!(scope instanceof Document) && !(scope instanceof HTMLElement) && !(scope instanceof DocumentFragment)) {
      scope = document;
    }
    scope.querySelectorAll('[data-purchase-category-control]').forEach((root) => {
      bindPurchaseCategoryControl(root);
    });
  }

  window.OPInitPurchaseCategoryControls = initPurchaseCategoryControls;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initPurchaseCategoryControls(document));
  } else {
    initPurchaseCategoryControls(document);
  }
})();

(function () {
  const STYLE_STORAGE_KEY = 'op-theme-style';
  const VALID_STYLES = new Set(['classic', 'confete', 'orgulho']);
  const root = document.documentElement;
  const body = document.body;

  function getCurrentStyle() {
    const style = root.dataset.themeStyle;
    return VALID_STYLES.has(style) ? style : 'classic';
  }

  function getCurrentAppearance() {
    return root.classList.contains('dark') ? 'dark' : 'light';
  }

  function getThemeColor(style, appearance) {
    if (style === 'confete') {
      return appearance === 'dark' ? '#221531' : '#fff1f7';
    }
    if (style === 'orgulho') {
      return appearance === 'dark' ? '#34173a' : '#f75f70';
    }
    return appearance === 'dark' ? '#020617' : '#eaf2ff';
  }

  function syncThemeChrome() {
    const style = getCurrentStyle();
    const appearance = getCurrentAppearance();
    root.dataset.themeStyle = style;

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', getThemeColor(style, appearance));
    }

    document.querySelectorAll('[data-theme-style-choice]').forEach((button) => {
      const isActive = button.getAttribute('data-theme-style-choice') === style;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    const styleLabels = {
      classic: 'Visual Clássico ativo',
      confete: 'Visual Confete ativo',
      orgulho: 'Visual Orgulho ativo'
    };
    const styleCaptions = {
      classic: 'Clássico ativo',
      confete: 'Confete ativo',
      orgulho: 'Orgulho ativo'
    };

    document.querySelectorAll('[data-theme-style-open]').forEach((button) => {
      const label = styleLabels[style] || styleLabels.classic;
      button.setAttribute('title', `${label}. Toque para trocar.`);
      button.setAttribute('aria-label', `${label}. Toque para trocar.`);
    });

    document.querySelectorAll('[data-mobile-theme-style-caption]').forEach((node) => {
      node.textContent = styleCaptions[style] || styleCaptions.classic;
    });

    const nextAppearanceLabel = appearance === 'dark' ? 'Modo claro' : 'Modo escuro';
    const nextAppearanceHelper = appearance === 'dark'
      ? 'Clareia a tela e deixa tudo mais aberto.'
      : 'Deixa a tela mais confortável quando a luz abaixa.';

    document.querySelectorAll('[data-mobile-appearance-mode-label]').forEach((node) => {
      node.textContent = nextAppearanceLabel;
    });
    document.querySelectorAll('[data-mobile-appearance-mode-helper]').forEach((node) => {
      node.textContent = nextAppearanceHelper;
    });
    document.querySelectorAll('[data-mobile-appearance-mode-button]').forEach((button) => {
      button.setAttribute('title', nextAppearanceLabel);
      button.setAttribute('aria-label', nextAppearanceLabel);
    });
  }

  function setThemeStyle(style) {
    const nextStyle = VALID_STYLES.has(style) ? style : 'classic';
    root.dataset.themeStyle = nextStyle;
    try {
      localStorage.setItem(STYLE_STORAGE_KEY, nextStyle);
    } catch (error) {
      // ignore storage issues
    }
    syncThemeChrome();
  }

  function initMobileAppearanceMenu() {
    const menu = document.querySelector('[data-mobile-appearance-menu]');
    if (!(menu instanceof HTMLElement)) return;

    const panel = menu.querySelector('.op-mobile-appearance-menu__panel');
    const openButtons = document.querySelectorAll('[data-mobile-appearance-open]');
    const backdrop = menu.querySelector('[data-mobile-appearance-backdrop]');
    const actionButtons = menu.querySelectorAll('[data-mobile-appearance-action]');
    let isOpen = false;

    function setVisibility(visible) {
      isOpen = visible;
      menu.classList.toggle('hidden', !visible);
      menu.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    openButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setVisibility(!isOpen);
      });
    });

    if (backdrop instanceof HTMLElement) {
      backdrop.addEventListener('click', () => setVisibility(false));
    }

    actionButtons.forEach((button) => {
      button.addEventListener('click', () => {
        window.setTimeout(() => setVisibility(false), 0);
      });
    });

    document.addEventListener('click', (event) => {
      if (!isOpen) return;
      if (!(event.target instanceof Node)) return;
      if (panel instanceof HTMLElement && panel.contains(event.target)) return;
      if (Array.from(openButtons).some((button) => button.contains(event.target))) return;
      setVisibility(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen) {
        setVisibility(false);
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth >= 768 && isOpen) {
        setVisibility(false);
      }
    });
  }

  function initThemeStyleCenter() {
    const center = document.querySelector('[data-theme-style-center]');
    if (!(center instanceof HTMLElement)) {
      syncThemeChrome();
      return;
    }

    const openButtons = document.querySelectorAll('[data-theme-style-open]');
    const closeButtons = center.querySelectorAll('[data-theme-style-close]');
    const backdrop = center.querySelector('[data-theme-style-backdrop]');
    const choiceButtons = center.querySelectorAll('[data-theme-style-choice]');
    let isOpen = false;

    function setVisibility(visible) {
      isOpen = visible;
      center.classList.toggle('hidden', !visible);
      center.setAttribute('aria-hidden', visible ? 'false' : 'true');
      if (body) {
        body.classList.toggle('overflow-hidden', visible);
      }
    }

    openButtons.forEach((button) => {
      button.addEventListener('click', () => setVisibility(true));
    });

    closeButtons.forEach((button) => {
      button.addEventListener('click', () => setVisibility(false));
    });

    if (backdrop instanceof HTMLElement) {
      backdrop.addEventListener('click', () => setVisibility(false));
    }

    center.addEventListener('click', (event) => {
      const panel = center.querySelector('.op-style-center-panel');
      if (!(panel instanceof HTMLElement)) return;
      if (event.target === center && !panel.contains(event.target)) {
        setVisibility(false);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen) {
        setVisibility(false);
      }
    });

    choiceButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const style = button.getAttribute('data-theme-style-choice') || 'classic';
        setThemeStyle(style);
        window.setTimeout(() => setVisibility(false), 120);
      });
    });

    syncThemeChrome();
  }

  window.OPSyncThemeChrome = syncThemeChrome;
  window.OPSetThemeStyle = setThemeStyle;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initMobileAppearanceMenu();
      initThemeStyleCenter();
    });
  } else {
    initMobileAppearanceMenu();
    initThemeStyleCenter();
  }
})();


(function () {
  function initAnalyticsTabs() {
    document.querySelectorAll('[data-op-tabs]').forEach((root) => {
      const buttons = Array.from(root.querySelectorAll('[data-op-tab-target]'));
      const panels = Array.from(root.querySelectorAll('[data-op-tab-panel]'));
      if (!buttons.length || !panels.length) return;

      const tabStrip = root.querySelector('.op-tab-strip');

      const activate = (targetId, { focus = false } = {}) => {
        buttons.forEach((button) => {
          const isActive = button.getAttribute('data-op-tab-target') === targetId;
          button.classList.toggle('is-active', isActive);
          button.setAttribute('aria-selected', isActive ? 'true' : 'false');
          button.setAttribute('tabindex', isActive ? '0' : '-1');
          if (isActive && focus) button.focus();
          if (isActive && tabStrip && tabStrip.scrollWidth > tabStrip.clientWidth + 4) {
            button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: focus ? 'smooth' : 'auto' });
          }
        });

        panels.forEach((panel) => {
          const isActive = panel.getAttribute('data-op-tab-panel') === targetId;
          panel.hidden = !isActive;
        });
      };

      buttons.forEach((button, index) => {
        button.addEventListener('click', () => activate(button.getAttribute('data-op-tab-target') || ''));
        button.addEventListener('keydown', (event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          let nextIndex = index;
          if (event.key === 'ArrowRight') nextIndex = (index + 1) % buttons.length;
          if (event.key === 'ArrowLeft') nextIndex = (index - 1 + buttons.length) % buttons.length;
          if (event.key === 'Home') nextIndex = 0;
          if (event.key === 'End') nextIndex = buttons.length - 1;
          const nextButton = buttons[nextIndex];
          if (!nextButton) return;
          activate(nextButton.getAttribute('data-op-tab-target') || '', { focus: true });
        });
      });

      const initialButton = buttons.find((button) => button.getAttribute('aria-selected') === 'true') || buttons[0];
      activate(initialButton.getAttribute('data-op-tab-target') || '');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnalyticsTabs);
  } else {
    initAnalyticsTabs();
  }
})();


(function () {
  const body = document.body;
  if (!(body instanceof HTMLElement)) return;

  const appPinEnabled = body.dataset.appPinEnabled === '1';
  const appPinScreen = String(body.dataset.appPinScreen || 'app').toLowerCase();
  if (!appPinEnabled || appPinScreen === 'lock') return;

  const lockUrl = body.dataset.appPinLockUrl || '/lock/engage';
  const touchUrl = body.dataset.appPinTouchUrl || '/lock/touch';
  const idleSeconds = Math.max(0, Number(body.dataset.appPinIdleSeconds || 0) || 0);
  const idleMs = idleSeconds > 0 ? idleSeconds * 1000 : 0;
  const hiddenAtKey = 'op-app-pin-hidden-at';
  const syncStorageKey = 'op-app-pin-sync';
  const syncChannelName = 'op-app-pin';
  const sourceId = `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const heartbeatGapMs = Math.min(30000, Math.max(10000, idleMs > 0 ? Math.floor(idleMs / 2) : 15000));
  let idleTimer = null;
  let touchTimer = null;
  let lastTouchAt = 0;
  let lastActivityAt = Date.now();
  let lockInFlight = false;
  let syncChannel = null;

  function currentRelativeUrl() {
    return `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
  }

  function buildFallbackLockUrl(reason = 'locked') {
    const params = new URLSearchParams();
    params.set('reason', reason || 'locked');
    params.set('next', currentRelativeUrl());
    return `/lock?${params.toString()}`;
  }

  function redirectToLock(url) {
    window.location.href = url || buildFallbackLockUrl('locked');
  }

  function openSyncChannel() {
    try {
      if (typeof window.BroadcastChannel === 'function') {
        syncChannel = new window.BroadcastChannel(syncChannelName);
        syncChannel.addEventListener('message', (event) => {
          handleSyncPayload(event?.data || null);
        });
      }
    } catch (_error) {
      syncChannel = null;
    }
  }

  function readStorageKey() {
    try {
      return window.localStorage;
    } catch (_error) {
      return null;
    }
  }

  function broadcastPinState(type, extra = {}) {
    const payload = {
      type,
      at: Date.now(),
      sourceId,
      url: currentRelativeUrl(),
      ...extra
    };

    if (syncChannel) {
      try {
        syncChannel.postMessage(payload);
      } catch (_error) {}
    }

    const storage = readStorageKey();
    if (!storage) return;
    try {
      storage.setItem(syncStorageKey, JSON.stringify(payload));
    } catch (_error) {}
  }

  function handleSyncPayload(payload) {
    if (!payload || payload.sourceId === sourceId) return;
    const type = String(payload.type || '').trim().toLowerCase();
    if (!type) return;

    if (type === 'locked') {
      if (lockInFlight) return;
      const redirect = String(payload.redirect || '').trim() || buildFallbackLockUrl(payload.reason || 'locked');
      redirectToLock(redirect);
      return;
    }

    if (type === 'unlocked') {
      if (lockInFlight) return;
      lastActivityAt = Date.now();
      scheduleIdleLock();
      scheduleTouchTimer();
      touchServer(true);
    }
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== syncStorageKey || !event.newValue) return;
    try {
      handleSyncPayload(JSON.parse(event.newValue));
    } catch (_error) {}
  });

  openSyncChannel();

  async function resolveLockRedirect(response, fallbackReason) {
    let redirectUrl = response?.headers?.get('x-app-lock-redirect') || '';
    if (!redirectUrl && response && typeof response.clone === 'function') {
      try {
        const payload = await response.clone().json();
        redirectUrl = String(payload?.redirect || '').trim();
      } catch (_error) {}
    }
    if (!redirectUrl) {
      redirectUrl = buildFallbackLockUrl(fallbackReason || 'locked');
    }
    return redirectUrl;
  }

  async function handleLockedResponse(response, fallbackReason) {
    if (!response) return false;
    const locked = Number(response.status || 0) === 423 || response.headers.get('x-app-locked') === '1';
    if (!locked) return false;
    const redirectUrl = await resolveLockRedirect(response, fallbackReason);
    broadcastPinState('locked', { reason: fallbackReason || 'locked', redirect: redirectUrl });
    redirectToLock(redirectUrl);
    return true;
  }

  function isSameOriginRequest(input) {
    try {
      const rawUrl = typeof input === 'string'
        ? input
        : input && typeof input === 'object' && 'url' in input
          ? input.url
          : '';
      if (!rawUrl) return true;
      return new URL(rawUrl, window.location.origin).origin === window.location.origin;
    } catch (_error) {
      return true;
    }
  }

  const previousFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  if (previousFetch) {
    window.fetch = async function (input, init = {}) {
      const sameOrigin = isSameOriginRequest(input);
      const headers = sameOrigin ? new Headers(init?.headers || {}) : null;
      if (sameOrigin) {
        if (!headers.has('X-AcerttaPay-Async')) {
          headers.set('X-AcerttaPay-Async', '1');
        }
        if (!headers.has('X-Requested-With')) {
          headers.set('X-Requested-With', 'fetch');
        }
      }
      const response = await previousFetch(input, sameOrigin ? { ...init, headers } : init);
      if (sameOrigin && await handleLockedResponse(response, 'locked')) {
        const error = new Error('O app foi bloqueado por PIN.');
        error.code = 'APP_PIN_LOCKED';
        error.response = response;
        throw error;
      }
      return response;
    };
  }

  if (typeof window.XMLHttpRequest === 'function') {
    const XHR = window.XMLHttpRequest;
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url, ...rest) {
      this.__opPinWatchBound = false;
      this.__opPinSameOrigin = isSameOriginRequest(url);
      return originalOpen.call(this, method, url, ...rest);
    };

    XHR.prototype.send = function (...args) {
      if (!this.__opPinWatchBound) {
        this.__opPinWatchBound = true;
        this.addEventListener('readystatechange', () => {
          if (!this.__opPinSameOrigin || this.readyState !== 4) return;
          const locked = Number(this.status || 0) === 423 || this.getResponseHeader('X-App-Locked') === '1';
          if (!locked) return;
          const redirectUrl = this.getResponseHeader('X-App-Lock-Redirect') || buildFallbackLockUrl('locked');
          broadcastPinState('locked', { reason: 'locked', redirect: redirectUrl });
          redirectToLock(redirectUrl);
        });
      }

      if (this.__opPinSameOrigin) {
        try {
          this.setRequestHeader('X-AcerttaPay-Async', '1');
          this.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        } catch (_error) {}
      }

      return originalSend.apply(this, args);
    };
  }

  function clearIdleTimer() {
    if (idleTimer) {
      window.clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function clearTouchTimer() {
    if (touchTimer) {
      window.clearTimeout(touchTimer);
      touchTimer = null;
    }
  }

  async function touchServer(force = false) {
    if (lockInFlight) return;
    const now = Date.now();
    if (!force && now - lastTouchAt < heartbeatGapMs) return;
    lastTouchAt = now;

    try {
      const response = await fetch(touchUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'X-AcerttaPay-Async': '1'
        }
      });
      await handleLockedResponse(response, 'locked');
    } catch (error) {
      if (error?.code !== 'APP_PIN_LOCKED') {
        console.warn('Não consegui atualizar o bloqueio por PIN agora.', error);
      }
    }
  }

  function scheduleTouchTimer() {
    clearTouchTimer();
    touchTimer = window.setTimeout(() => {
      touchServer(true).finally(() => {
        if (!lockInFlight) {
          scheduleTouchTimer();
        }
      });
    }, heartbeatGapMs);
  }

  async function lockNow(reason = 'manual', { keepalive = false } = {}) {
    if (lockInFlight) return;
    lockInFlight = true;
    clearIdleTimer();
    clearTouchTimer();

    const payload = new URLSearchParams();
    payload.set('reason', reason);
    payload.set('return_to', currentRelativeUrl());

    try {
      const response = await fetch(lockUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'X-AcerttaPay-Async': '1'
        },
        body: payload.toString(),
        keepalive
      });
      const redirectUrl = await resolveLockRedirect(response, reason);
      broadcastPinState('locked', { reason, redirect: redirectUrl });
      redirectToLock(redirectUrl);
    } catch (_error) {
      redirectToLock(buildFallbackLockUrl(reason));
    }
  }

  function scheduleIdleLock() {
    clearIdleTimer();
    if (lockInFlight || idleMs <= 0) return;
    const elapsedMs = Math.max(0, Date.now() - lastActivityAt);
    const remainingMs = Math.max(0, idleMs - elapsedMs);
    if (remainingMs <= 0) {
      lockNow('idle');
      return;
    }
    idleTimer = window.setTimeout(() => {
      lockNow('idle');
    }, remainingMs);
  }

  function markActivity() {
    if (lockInFlight) return;
    lastActivityAt = Date.now();
    scheduleIdleLock();
    scheduleTouchTimer();
    touchServer(false);
  }

  function handleVisibilityReturn() {
    const hiddenAt = Number(sessionStorage.getItem(hiddenAtKey) || 0);
    sessionStorage.removeItem(hiddenAtKey);
    if (lockInFlight) return;

    if (idleSeconds === 0) {
      if (hiddenAt) {
        lockNow('background');
        return;
      }
      scheduleTouchTimer();
      touchServer(true);
      return;
    }

    if ((hiddenAt && idleMs > 0 && (Date.now() - hiddenAt) >= idleMs) || (idleMs > 0 && (Date.now() - lastActivityAt) >= idleMs)) {
      lockNow('background');
      return;
    }

    scheduleIdleLock();
    scheduleTouchTimer();
    touchServer(true);
  }

  ['pointerdown', 'touchstart', 'mousedown'].forEach((eventName) => {
    document.addEventListener(eventName, markActivity, { passive: true });
  });
  document.addEventListener('keydown', markActivity);

  window.addEventListener('focus', handleVisibilityReturn, { passive: true });
  window.addEventListener('pageshow', handleVisibilityReturn, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      sessionStorage.setItem(hiddenAtKey, String(Date.now()));
      clearIdleTimer();
      clearTouchTimer();
      if (idleSeconds === 0) {
        lockNow('background', { keepalive: true });
      }
      return;
    }
    handleVisibilityReturn();
  });

  scheduleIdleLock();
  scheduleTouchTimer();
  broadcastPinState('unlocked');
  touchServer(true);
})();
