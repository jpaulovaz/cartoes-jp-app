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
