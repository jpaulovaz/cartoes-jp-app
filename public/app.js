(function() {
  function copyAlloc(txnId) {
    const form = document.querySelector(`[data-alloc-form="${txnId}"]`);
    if (!form) return;
    const checked = Array.from(form.querySelectorAll('input[name="person_ids"]:checked')).map(x => x.value);
    localStorage.setItem("allocClipboard", JSON.stringify(checked));
    const msg = document.getElementById("allocMsg");
    if (msg) {
      msg.textContent = `Copiado: ${checked.length} pessoa(s)`;
      setTimeout(() => msg.textContent = "", 1500);
    }
  }

  function pasteAlloc(txnId) {
    const raw = localStorage.getItem("allocClipboard");
    if (!raw) return;
    let ids = [];
    try { ids = JSON.parse(raw) || []; } catch(e) { ids = []; }
    const form = document.querySelector(`[data-alloc-form="${txnId}"]`);
    if (!form) return;
    Array.from(form.querySelectorAll('input[name="person_ids"]')).forEach(inp => {
      inp.checked = ids.includes(inp.value);
    });
  }

  window.copyAlloc = copyAlloc;
  window.pasteAlloc = pasteAlloc;
})();
