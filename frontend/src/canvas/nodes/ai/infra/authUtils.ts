/** 鉴权请求头（每次请求时读取最新 localStorage token） */
export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 401 统一处理：清除本地凭据并跳转登录 */
export function handleUnauthorized(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (window.location.pathname !== '/login') {
    sessionStorage.setItem(
      'redirectAfterLogin',
      window.location.pathname + window.location.search
    );
    window.location.href = '/login';
  }
}