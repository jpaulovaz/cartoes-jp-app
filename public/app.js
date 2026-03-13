(function () {
  function copyAlloc(btn) {
    // 1. Encontra o "container" pai (o widget cinza que criamos)
    const container = btn.closest('.bg-slate-50\\/50');

    // 2. Pega todos os IDs dos checkboxes marcados dentro desse container
    const selected = Array.from(container.querySelectorAll('input[name="person_ids"]:checked'))
      .map(cb => cb.value);

    if (selected.length === 0) {
      alert("Selecione pelo menos uma pessoa para copiar!");
      return;
    }

    // 3. Salva na memória global do navegador (LocalStorage)
    localStorage.setItem('copiedAlloc', JSON.stringify(selected));

    // Feedback visual rápido no botão
    const originalText = btn.innerText;
    btn.innerText = "✅ Copiado!";
    btn.classList.add('text-green-600');
    setTimeout(() => {
      btn.innerText = originalText;
      btn.classList.remove('text-green-600');
    }, 1000);
  }
  function pasteAlloc(btn) {
    const data = localStorage.getItem('copiedAlloc');
    if (!data) {
      alert("Nada para colar! Copie uma distribuição primeiro.");
      return;
    }

    const ids = JSON.parse(data);
    const container = btn.closest('.bg-slate-50\\/50');

    // 1. Desmarca todos primeiro
    container.querySelectorAll('input[name="person_ids"]').forEach(cb => cb.checked = false);

    // 2. Marca apenas os que estavam na memória
    ids.forEach(id => {
      const cb = container.querySelector(`input[name="person_ids"][value="${id}"]`);
      if (cb) cb.checked = true;
    });

    // Feedback visual
    btn.innerText = "✅ Colado!";
    setTimeout(() => { btn.innerText = "Colar"; }, 1000);
  }

  window.copyAlloc = copyAlloc;
  window.pasteAlloc = pasteAlloc;
})();
