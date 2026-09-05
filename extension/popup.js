(() => {
  // src/popup.js
  var api = globalThis.browser ?? globalThis.chrome;
  var $ = (id) => document.getElementById(id);
  async function send(msg) {
    try {
      return await api.runtime.sendMessage(msg) || { ok: false, error: "No response" };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }
  var format = "epub";
  function setFormat(f) {
    format = f;
    for (const label of document.querySelectorAll("#fmt label")) {
      label.classList.toggle("active", label.dataset.fmt === f);
      const input = label.querySelector("input");
      if (input) input.checked = label.dataset.fmt === f;
    }
    api.storage.local.set({ format: f });
  }
  async function init() {
    const st = await send({ action: "status" });
    if (st.connected) {
      $("main").classList.remove("hidden");
      $("pair").classList.add("hidden");
      const { format: saved } = await api.storage.local.get("format") || {};
      setFormat(saved === "pdf" ? "pdf" : "epub");
    } else {
      $("pair").classList.remove("hidden");
      $("main").classList.add("hidden");
      $("code").focus();
    }
  }
  document.querySelectorAll("#fmt label").forEach((label) => {
    label.addEventListener("click", (e) => {
      e.preventDefault();
      setFormat(label.dataset.fmt);
    });
  });
  $("send").addEventListener("click", async () => {
    const btn = $("send");
    const msg = $("msg");
    btn.disabled = true;
    msg.className = "msg";
    msg.innerHTML = `<span class="spinner"></span>Sending ${format.toUpperCase()}\u2026`;
    const res = await send({ action: "send", format });
    btn.disabled = false;
    if (res.ok) {
      msg.className = "msg ok";
      msg.textContent = `\u2713 Sent \u201C${res.name}\u201D \u2014 check your reMarkable.`;
    } else {
      msg.className = "msg err";
      msg.textContent = res.error || "Something went wrong.";
    }
  });
  $("disconnect").addEventListener("click", async () => {
    await send({ action: "disconnect" });
    init();
  });
  $("connect").addEventListener("click", async () => {
    const btn = $("connect");
    const code = $("code").value.trim();
    const pm = $("pairMsg");
    pm.className = "msg";
    if (code.replace(/\s+/g, "").length !== 8) {
      pm.className = "msg err";
      pm.textContent = "Enter the full 8-character code.";
      return;
    }
    btn.disabled = true;
    pm.innerHTML = `<span class="spinner"></span>Pairing\u2026`;
    const res = await send({ action: "pair", code });
    btn.disabled = false;
    if (res.ok) {
      pm.className = "msg ok";
      pm.textContent = "\u2713 Connected!";
      setTimeout(init, 500);
    } else {
      pm.className = "msg err";
      pm.textContent = res.error || "Pairing failed. Try a fresh code.";
    }
  });
  $("code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("connect").click();
  });
  init();
})();
