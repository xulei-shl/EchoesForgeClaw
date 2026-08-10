import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    // 401：token 缺失/失效，清除本地登录态并跳转登录页
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        // 记录来源页，登录成功后跳回
        sessionStorage.setItem(
          'redirectAfterLogin',
          window.location.pathname + window.location.search
        );
        window.location.href = '/login';
      }
    }
    // 统一错误结构：保证 message 与 detail 同时存在，方便各页面展示
    const data = error.response?.data || { message: 'Network error' };
    // 保留底层错误码与 HTTP 状态码，供调用方区分失败类型
    // （如 ECONNABORTED 超时 / ERR_CANCELED 主动取消 / 404 记录不存在）
    const meta = {
      code: error.code,
      isTimeout: error.code === 'ECONNABORTED',
      status: error.response?.status,
    };
    if (typeof data === 'string') {
      return Promise.reject({ message: data, detail: data, ...meta });
    }
    if (data && typeof data === 'object' && !data.message && data.detail) {
      data.message = data.detail;
    }
    return Promise.reject({ ...data, ...meta });
  }
);

export default api;
