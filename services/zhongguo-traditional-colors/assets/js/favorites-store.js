(() => {
  const STORAGE_KEY = 'zhongguoUnifiedFavorites';

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value.filter((item) => item?.id && item?.type) : [];
    } catch (error) {
      return [];
    }
  }

  function write(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('zh-favorites-change', { detail: { items } }));
  }

  function has(id) {
    return read().some((item) => item.id === id);
  }

  function upsert(item) {
    if (!item?.id || !item?.type) return read();
    const items = read();
    const createdAt = item.createdAt || new Date().toISOString();
    const nextItem = { ...item, createdAt };
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index >= 0) {
      items[index] = { ...items[index], ...nextItem };
    } else {
      items.unshift(nextItem);
    }
    write(items);
    return items;
  }

  function remove(id) {
    const items = read().filter((item) => item.id !== id);
    write(items);
    return items;
  }

  function toggle(item) {
    if (!item?.id) return { active: false, items: read() };
    if (has(item.id)) {
      return { active: false, items: remove(item.id) };
    }
    return { active: true, items: upsert(item) };
  }

  window.ZH_FAVORITES = {
    key: STORAGE_KEY,
    read,
    write,
    has,
    upsert,
    remove,
    toggle,
  };
})();
