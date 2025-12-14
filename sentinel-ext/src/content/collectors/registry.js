// src/content/collectors/registry.js
(() => {
  const list = [];

  function register(entry) {
    // entry: { id, hosts: [], priority, attach(ctx) }
    if (!entry || !entry.id || typeof entry.attach !== "function") return;
    list.push({
      priority: 0,
      hosts: [],
      ...entry,
    });
    // priority 높은 순으로 정렬
    list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  function pick(hostname) {
    const host = String(hostname || "").toLowerCase();
    for (const c of list) {
      const hosts = (c.hosts || []).map((h) => String(h).toLowerCase());
      if (hosts.includes(host)) return c;
    }
    // 정확매칭 없으면 "generic" 있으면 그걸로
    return list.find((c) => c.id === "generic") || null;
  }

  window.__SENTINEL_COLLECTORS = { register, pick, list: () => list.slice() };
})();
