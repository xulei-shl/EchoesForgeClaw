const tabs = document.querySelector('[data-favorite-tabs]');
const grid = document.querySelector('[data-favorites-grid]');
const count = document.querySelector('[data-favorites-count]');
const clearButton = document.querySelector('[data-favorites-clear]');
const toast = document.querySelector('[data-toast]');
const themeToggle = document.querySelector('[data-theme-toggle]');
const themeIcon = document.querySelector('[data-theme-icon]');
const themeLabel = document.querySelector('[data-theme-label]');
const themeColorMeta = document.querySelector('[data-theme-color]');
const siteHeader = document.querySelector('.site-header');
const siteNav = document.querySelector('#site-nav');
const navToggle = document.querySelector('[data-nav-toggle]');
const footerColorButtons = document.querySelectorAll('[data-footer-color]');
const footerCopyStatus = document.querySelector('[data-footer-copy-status]');

const TYPES = [
  { key: 'all', label: '全部' },
  { key: 'color', label: '色卡' },
  { key: 'palette', label: '配色' },
  { key: 'use', label: '用途' },
  { key: 'generator', label: '生成' },
  { key: 'style', label: '试色' },
];

let currentType = 'all';
let toastTimer = 0;
let navResizeFrame = 0;
let footerCopyTimer = 0;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function typeLabel(type) {
  return TYPES.find((item) => item.key === type)?.label || type;
}

function items() {
  const all = window.ZH_FAVORITES?.read() || [];
  return currentType === 'all' ? all : all.filter((item) => item.type === currentType);
}

function colorStrip(colors = []) {
  return colors.length
    ? `<div class="favorite-strip">${colors.map((color) => `<span style="--favorite-color:${escapeHtml(color.hex || color)}"></span>`).join('')}</div>`
    : '';
}

function itemMarkup(item) {
  const colors = Array.isArray(item.colors) ? item.colors : [];
  const href = item.href || '#';
  return `
    <article class="favorite-card" data-favorite-id="${escapeHtml(item.id)}">
      ${colorStrip(colors)}
      <div class="favorite-card-body">
        <span>${escapeHtml(typeLabel(item.type))}</span>
        <h2>${escapeHtml(item.title || '未命名收藏')}</h2>
        <p>${escapeHtml(item.subtitle || '')}</p>
      </div>
      <footer>
        <a href="${escapeHtml(href)}">打开</a>
        <button type="button" data-favorite-copy="${escapeHtml(item.id)}">
          <iconify-icon icon="lucide:copy" aria-hidden="true"></iconify-icon>
          复制
        </button>
        <button type="button" data-favorite-remove="${escapeHtml(item.id)}">
          <iconify-icon icon="lucide:x" aria-hidden="true"></iconify-icon>
          移除
        </button>
      </footer>
    </article>
  `;
}

function renderTabs() {
  if (!tabs) return;
  const all = window.ZH_FAVORITES?.read() || [];
  tabs.innerHTML = TYPES.map((type) => {
    const total = type.key === 'all' ? all.length : all.filter((item) => item.type === type.key).length;
    return `
      <button type="button" data-favorite-type="${escapeHtml(type.key)}" aria-pressed="${type.key === currentType ? 'true' : 'false'}">
        ${escapeHtml(type.label)}
        <span>${total}</span>
      </button>
    `;
  }).join('');
}

function render() {
  const visible = items();
  renderTabs();
  if (count) count.textContent = `${visible.length.toLocaleString('zh-CN')} 个收藏`;
  if (clearButton) clearButton.disabled = visible.length === 0;
  if (!grid) return;
  grid.innerHTML = visible.length
    ? visible.map(itemMarkup).join('')
    : '<div class="empty-state"><strong>还没有收藏</strong><span>在色卡、配色、用途、生成器或试色页面点击心形收藏。</span></div>';
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    const input = document.createElement('textarea');
    input.value = text;
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
}

function showToast(message) {
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.visible = 'true';
  toastTimer = window.setTimeout(() => {
    toast.dataset.visible = 'false';
  }, 1500);
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function setTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  try {
    localStorage.setItem('theme', nextTheme);
  } catch (error) {
    document.documentElement.dataset.theme = nextTheme;
  }
  themeToggle?.setAttribute('aria-pressed', String(nextTheme === 'dark'));
  themeToggle?.setAttribute('aria-label', nextTheme === 'dark' ? '切换到亮色模式' : '切换到暗色模式');
  themeIcon?.setAttribute('icon', nextTheme === 'dark' ? 'lucide:sun' : 'lucide:moon');
  if (themeLabel) themeLabel.textContent = nextTheme === 'dark' ? '亮色' : '暗色';
  themeColorMeta?.setAttribute('content', nextTheme === 'dark' ? '#11100e' : '#f7f7f4');
}

function setMobileNavOpen(open) {
  if (!siteHeader || !navToggle) return;
  siteHeader.dataset.navOpen = String(open);
  navToggle.setAttribute('aria-expanded', String(open));
}

function closeMobileNav() {
  setMobileNavOpen(false);
}

function queueMobileNavState() {
  window.cancelAnimationFrame(navResizeFrame);
  navResizeFrame = window.requestAnimationFrame(() => {
    if (window.matchMedia('(min-width: 721px)').matches) closeMobileNav();
  });
}

function buildFooterSpectrum() {
  const colors = ['#F9F4DC', '#F8DF72', '#F07C82', '#ED5126', '#2BAE85', '#12AA9C', '#1781B5', '#1661AB', '#8B2671', '#5C2223', '#806332', '#F7F4ED'];
  footerColorButtons.forEach((button, index) => {
    const hex = colors[index % colors.length];
    const copyText = `中国传统色 ${hex}`;
    button.style.setProperty('--footer-color', hex);
    button.dataset.footerCopyValue = copyText;
    button.title = `复制 ${copyText}`;
  });
}

tabs?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-favorite-type]');
  if (!button) return;
  currentType = button.dataset.favoriteType || 'all';
  render();
});

grid?.addEventListener('click', async (event) => {
  const copyButton = event.target.closest('[data-favorite-copy]');
  if (copyButton) {
    const item = (window.ZH_FAVORITES?.read() || []).find((entry) => entry.id === copyButton.dataset.favoriteCopy);
    if (item) {
      await writeClipboard(item.text || `${item.title}\n${item.subtitle || ''}`);
      showToast('已复制收藏内容');
    }
    return;
  }

  const removeButton = event.target.closest('[data-favorite-remove]');
  if (removeButton) {
    window.ZH_FAVORITES?.remove(removeButton.dataset.favoriteRemove);
    showToast('已移除收藏');
    render();
  }
});

clearButton?.addEventListener('click', () => {
  const all = window.ZH_FAVORITES?.read() || [];
  const next = currentType === 'all' ? [] : all.filter((item) => item.type !== currentType);
  window.ZH_FAVORITES?.write(next);
  showToast(currentType === 'all' ? '已清空收藏' : `已清空${typeLabel(currentType)}收藏`);
  render();
});

themeToggle?.addEventListener('click', () => {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
});
navToggle?.addEventListener('click', () => {
  const open = siteHeader?.dataset.navOpen === 'true';
  setMobileNavOpen(!open);
});
siteNav?.addEventListener('click', (event) => {
  if (event.target.closest('a, button')) closeMobileNav();
});
window.addEventListener('resize', queueMobileNavState);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMobileNav();
});
footerColorButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const copyText = button.dataset.footerCopyValue;
    if (!copyText) return;
    await writeClipboard(copyText);
    if (footerCopyStatus) {
      clearTimeout(footerCopyTimer);
      footerCopyStatus.textContent = `已复制：${copyText}`;
      footerCopyStatus.dataset.visible = 'true';
      footerCopyTimer = window.setTimeout(() => {
        footerCopyStatus.dataset.visible = 'false';
      }, 1500);
    }
  });
});

window.addEventListener('zh-favorites-change', render);
setTheme(currentTheme());
buildFooterSpectrum();
render();
