"""
HTML转图片转换器模块
负责将HTML卡片转换为PNG图片
"""

import os
import time
import threading
from typing import Dict, Tuple, Optional
from playwright.sync_api import sync_playwright, Page, TimeoutError as PlaywrightTimeoutError
from src.utils.logger import get_logger

logger = get_logger(__name__)

EXPLICIT_ROOT_SELECTORS = (
    '[data-export-root]',
    '[data-card-root]',
    '[data-screenshot-root]',
)

LEGACY_ROOT_SELECTORS = (
    '.layout-wrapper',
    '.archive-wrapper',
    '.library-card',
    '.book-card',
    '.container',
    '.card',
    '[class*="max-w"]',
    'main',
    'body > div:first-child',
)


class HTMLToImageConverter:
    """HTML转图片转换器类"""

    def __init__(self, config: Dict, thread_safe: bool = False):
        """
        初始化转换器

        Args:
            config: 配置字典
            thread_safe: 是否启用线程安全模式（为每个线程创建独立的浏览器实例）
        """
        self.config = config.get('html_to_image', {})
        self.headless = self.config.get('headless', True)
        self.viewport_width = self.config.get('viewport_width', 1200)
        self.viewport_height = self.config.get('viewport_height', 800)
        self.device_scale_factor = self.config.get('device_scale_factor', 2)
        self.image_format = self.config.get('image_format', 'png')
        self.quality = self.config.get('quality', 90)
        self.full_page = self.config.get('full_page', False)
        self.clip_element = self.config.get('clip_element', True)
        self.border_radius = self.config.get('border_radius', 8)
        self.clip_padding = self.config.get('clip_padding', 8)
        self.timeout = self.config.get('timeout', 60000)
        self.wait_time = self.config.get('wait_time', 2000)
        # 浏览器启动超时时间(毫秒)
        self.browser_startup_timeout = self.config.get('browser_startup_timeout', 180000)
        
        # 线程安全模式
        self.thread_safe = thread_safe
        
        if thread_safe:
            # 线程安全模式：使用线程本地存储，每个线程有独立的浏览器实例
            self._thread_local = threading.local()
        else:
            # 传统模式：共享浏览器实例
            self.playwright = None
            self.browser = None
            # 线程锁，用于同步多线程访问browser.new_page()
            self._page_creation_lock = threading.Lock()

    def start_browser(self) -> bool:
        """
        启动浏览器实例
        
        Returns:
            bool: 启动成功返回True,否则返回False
        """
        if self.thread_safe:
            # 线程安全模式：为当前线程创建独立的浏览器实例
            if hasattr(self._thread_local, 'browser') and self._thread_local.browser is not None:
                logger.debug(f"线程 {threading.current_thread().name} 的浏览器实例已存在")
                return True
            
            try:
                self._thread_local.playwright = sync_playwright().start()
                self._thread_local.browser = self._thread_local.playwright.chromium.launch(
                    headless=self.headless,
                    timeout=self.browser_startup_timeout
                )
                logger.info(f"线程 {threading.current_thread().name} 的浏览器实例已启动")
                return True
            except Exception as e:
                logger.error(f"线程 {threading.current_thread().name} 启动浏览器失败：{e}")
                return False
        else:
            # 传统模式：共享浏览器实例
            if self.browser is not None:
                logger.debug("浏览器实例已存在,无需重复启动")
                return True
            
            try:
                self.playwright = sync_playwright().start()
                self.browser = self.playwright.chromium.launch(
                    headless=self.headless,
                    timeout=self.browser_startup_timeout
                )
                logger.info("浏览器实例已启动(复用模式)")
                return True
            except Exception as e:
                logger.error(f"启动浏览器失败：{e}")
                return False
    
    def stop_browser(self) -> None:
        """
        关闭浏览器实例
        """
        if self.thread_safe:
            # 线程安全模式：关闭当前线程的浏览器实例
            if hasattr(self._thread_local, 'browser') and self._thread_local.browser:
                try:
                    self._thread_local.browser.close()
                    self._thread_local.browser = None
                    logger.info(f"线程 {threading.current_thread().name} 的浏览器实例已关闭")
                except Exception as e:
                    logger.warning(f"关闭线程 {threading.current_thread().name} 的浏览器时发生错误：{e}")
            
            if hasattr(self._thread_local, 'playwright') and self._thread_local.playwright:
                try:
                    self._thread_local.playwright.stop()
                    self._thread_local.playwright = None
                except Exception as e:
                    logger.warning(f"关闭线程 {threading.current_thread().name} 的Playwright时发生错误：{e}")
        else:
            # 传统模式：关闭共享浏览器实例
            if self.browser:
                try:
                    self.browser.close()
                    self.browser = None
                    logger.info("浏览器实例已关闭")
                except Exception as e:
                    logger.warning(f"关闭浏览器时发生错误：{e}")
            
            if self.playwright:
                try:
                    self.playwright.stop()
                    self.playwright = None
                except Exception as e:
                    logger.warning(f"关闭Playwright时发生错误：{e}")
    
    def convert_html_to_image(
        self, html_path: str, output_path: str
    ) -> Tuple[bool, str]:
        """
        转换HTML为图片

        Args:
            html_path: HTML文件路径
            output_path: 输出图片路径

        Returns:
            Tuple[bool, str]: (是否成功, 输出路径)
        """
        if not os.path.exists(html_path):
            logger.error(f"HTML文件不存在：{html_path}")
            return False, ""

        page = None
        try:
            # 确保浏览器已启动
            if self.thread_safe:
                # 线程安全模式：使用当前线程的浏览器实例
                if not hasattr(self._thread_local, 'browser') or self._thread_local.browser is None:
                    if not self.start_browser():
                        return False, ""

                # 先创建临时页面用于检测元素实际尺寸
                temp_page = self._thread_local.browser.new_page()
                actual_size = self._detect_element_size(temp_page, html_path)
                temp_page.close()

                # 根据检测到的实际尺寸设置viewport
                viewport_width = actual_size['width'] if actual_size else self.viewport_width
                viewport_height = actual_size['height'] if actual_size else self.viewport_height

                page = self._thread_local.browser.new_page(
                    viewport={
                        'width': viewport_width,
                        'height': viewport_height
                    },
                    device_scale_factor=self.device_scale_factor
                )
            else:
                # 传统模式：使用共享浏览器实例
                if self.browser is None:
                    if not self.start_browser():
                        return False, ""

                # 先创建临时页面用于检测元素实际尺寸
                temp_page = self.browser.new_page()
                actual_size = self._detect_element_size(temp_page, html_path)
                temp_page.close()

                # 根据检测到的实际尺寸设置viewport
                viewport_width = actual_size['width'] if actual_size else self.viewport_width
                viewport_height = actual_size['height'] if actual_size else self.viewport_height

                # 使用线程锁保护页面创建，防止多线程并发调用导致协议错误
                with self._page_creation_lock:
                    page = self.browser.new_page(
                        viewport={
                            'width': viewport_width,
                            'height': viewport_height
                        },
                        device_scale_factor=self.device_scale_factor
                    )

            # 加载HTML页面
            if not self.load_html_page(page, html_path):
                return False, ""

            # 等待渲染完成
            self.wait_for_rendering(page)

            # 应用圆角效果（如果需要）
            if self.border_radius > 0:
                self.apply_border_radius(page)

            # 截图
            if self.take_screenshot(page, output_path):
                logger.debug(f"HTML转图片成功：{output_path}")
                return True, output_path
            else:
                return False, ""

        except Exception as e:
            logger.error(f"HTML转图片失败：{html_path}，错误：{e}")
            return False, ""

        finally:
            # 只关闭页面,不关闭浏览器
            if page:
                try:
                    page.close()
                except Exception as e:
                    logger.warning(f"关闭页面时发生错误：{e}")

    def _detect_element_size(self, page: Page, html_path: str) -> Optional[dict]:
        """
        检测HTML中目标元素的实际尺寸

        Args:
            page: Playwright页面对象
            html_path: HTML文件路径

        Returns:
            dict: 包含 width 和 height 的字典，如果检测失败返回 None
        """
        try:
            file_url = self._build_file_url(html_path)

            # 加载页面
            page.goto(file_url, timeout=self.timeout, wait_until='networkidle')

            # 等待页面稳定
            self.wait_for_rendering(page)

            capture_region = self._resolve_capture_region(page)
            if capture_region:
                viewport_size = self._calculate_viewport_size(capture_region['clip'])
                logger.info(
                    "检测到截图区域，策略=%s，尺寸=%sx%s",
                    capture_region.get('strategy', 'unknown'),
                    viewport_size['width'],
                    viewport_size['height']
                )
                return viewport_size

            logger.warning("未能检测到有效截图区域，将使用默认配置")
            return None

        except Exception as e:
            logger.warning(f"检测元素尺寸时发生错误: {e}")
            return None

    def _build_file_url(self, html_path: str) -> str:
        """
        构建本地HTML文件的file URL

        Args:
            html_path: HTML文件路径

        Returns:
            str: file协议URL
        """
        if os.path.isabs(html_path):
            return f"file:///{html_path.replace(os.sep, '/')}"

        abs_path = os.path.abspath(html_path)
        return f"file:///{abs_path.replace(os.sep, '/')}"

    def _resolve_capture_region(self, page: Page) -> Optional[Dict]:
        """
        解析页面中最适合截图的内容区域

        Args:
            page: Playwright页面对象

        Returns:
            Optional[Dict]: 截图区域信息，失败时返回None
        """
        try:
            metadata = page.evaluate(
                """
                ({ explicitSelectors, fallbackSelectors, basePadding }) => {
                    const transparentValues = new Set(['rgba(0, 0, 0, 0)', 'transparent']);
                    const maxNodes = 500;

                    const toNumber = (value) => {
                        const parsed = Number.parseFloat(value);
                        return Number.isFinite(parsed) ? parsed : 0;
                    };

                    const getDocumentSize = () => ({
                        width: Math.max(
                            document.documentElement.scrollWidth,
                            document.body.scrollWidth,
                            window.innerWidth
                        ),
                        height: Math.max(
                            document.documentElement.scrollHeight,
                            document.body.scrollHeight,
                            window.innerHeight
                        ),
                    });

                    const isVisibleElement = (element, style) => {
                        if (!element || !style) {
                            return false;
                        }

                        if (style.display === 'none' || style.visibility === 'hidden') {
                            return false;
                        }

                        if (Number.parseFloat(style.opacity || '1') === 0) {
                            return false;
                        }

                        const rect = element.getBoundingClientRect();
                        return rect.width > 1 && rect.height > 1;
                    };

                    const extractShadowPadding = (value) => {
                        if (!value || value === 'none') {
                            return 0;
                        }

                        const matches = value.match(/-?\\d+(?:\\.\\d+)?px/g) || [];
                        if (!matches.length) {
                            return 0;
                        }

                        return Math.max(...matches.map(item => Math.abs(toNumber(item))));
                    };

                    const extractFilterPadding = (value) => {
                        if (!value || value === 'none') {
                            return 0;
                        }

                        const shadows = value.match(/drop-shadow\\([^\\)]+\\)/g) || [];
                        const values = [];

                        shadows.forEach(shadow => {
                            const matches = shadow.match(/-?\\d+(?:\\.\\d+)?px/g) || [];
                            matches.forEach(item => values.push(Math.abs(toNumber(item))));
                        });

                        return values.length ? Math.max(...values) : 0;
                    };

                    const hasVisibleBackground = (style) => {
                        return style.backgroundImage !== 'none' || !transparentValues.has(style.backgroundColor);
                    };

                    const createClip = (rect, style, extraPadding = 0) => {
                        const documentSize = getDocumentSize();
                        const safePadding = Math.ceil(Math.max(
                            basePadding,
                            extraPadding,
                            toNumber(style.outlineWidth),
                            extractShadowPadding(style.boxShadow),
                            extractFilterPadding(style.filter)
                        ));

                        const left = Math.max(0, Math.floor(rect.left - safePadding));
                        const top = Math.max(0, Math.floor(rect.top - safePadding));
                        const right = Math.min(documentSize.width, Math.ceil(rect.right + safePadding));
                        const bottom = Math.min(documentSize.height, Math.ceil(rect.bottom + safePadding));

                        if (right <= left || bottom <= top) {
                            return null;
                        }

                        return {
                            x: left,
                            y: top,
                            width: right - left,
                            height: bottom - top,
                        };
                    };

                    const buildCandidate = (element, strategy, scoreBonus = 0, selector = null) => {
                        if (!element || element === document.body || element === document.documentElement) {
                            return null;
                        }

                        const style = window.getComputedStyle(element);
                        if (!isVisibleElement(element, style)) {
                            return null;
                        }

                        const rect = element.getBoundingClientRect();
                        if (rect.width < 60 || rect.height < 60) {
                            return null;
                        }

                        const area = rect.width * rect.height;
                        const hasMedia = element.querySelector('img, svg, canvas, picture, video') !== null;
                        const textLength = (element.innerText || '').replace(/\\s+/g, '').length;
                        const borderVisible = [
                            style.borderTopWidth,
                            style.borderRightWidth,
                            style.borderBottomWidth,
                            style.borderLeftWidth,
                        ].some(value => toNumber(value) > 0);
                        const shadowVisible = style.boxShadow !== 'none' || style.filter.includes('drop-shadow');
                        const layoutVisible = ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(style.display);
                        const directChild = element.parentElement === document.body;
                        const firstChild = document.body.firstElementChild === element;
                        const hasStructuredChildren = element.children.length >= 2;
                        const bodySizedPenalty = (
                            rect.width >= window.innerWidth * 0.98 &&
                            rect.height >= window.innerHeight * 0.98
                        ) ? 180 : 0;

                        const score = (
                            scoreBonus +
                            Math.min(area / 2500, 700) +
                            (hasVisibleBackground(style) ? 120 : 0) +
                            (borderVisible ? 80 : 0) +
                            (shadowVisible ? 90 : 0) +
                            (layoutVisible ? 60 : 0) +
                            (directChild ? 160 : 0) +
                            (firstChild ? 120 : 0) +
                            (hasMedia ? 120 : 0) +
                            Math.min(textLength, 260) +
                            (hasStructuredChildren ? 40 : 0) -
                            bodySizedPenalty
                        );

                        const clip = createClip(rect, style, 0);
                        if (!clip) {
                            return null;
                        }

                        return {
                            strategy,
                            selector,
                            score,
                            clip,
                            document: getDocumentSize(),
                        };
                    };

                    const findBySelectors = (selectors, strategy, scoreBonus) => {
                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            const candidate = buildCandidate(element, strategy, scoreBonus, selector);
                            if (candidate) {
                                return candidate;
                            }
                        }
                        return null;
                    };

                    const explicitCandidate = findBySelectors(explicitSelectors, 'explicit', 100000);
                    if (explicitCandidate) {
                        return explicitCandidate;
                    }

                    const fallbackCandidate = findBySelectors(fallbackSelectors, 'selector', 50000);
                    if (fallbackCandidate) {
                        return fallbackCandidate;
                    }

                    const allNodes = Array.from(document.body.querySelectorAll('*')).slice(0, maxNodes);
                    const autoCandidates = [];

                    if (document.body.firstElementChild) {
                        allNodes.unshift(document.body.firstElementChild);
                    }

                    allNodes.forEach(node => {
                        const candidate = buildCandidate(node, 'auto', 0, null);
                        if (candidate) {
                            autoCandidates.push(candidate);
                        }
                    });

                    autoCandidates.sort((left, right) => right.score - left.score);
                    if (autoCandidates.length) {
                        return autoCandidates[0];
                    }

                    const unionRects = [];
                    Array.from(document.body.querySelectorAll('*')).slice(0, maxNodes).forEach(node => {
                        if (['SCRIPT', 'STYLE', 'LINK', 'META'].includes(node.tagName)) {
                            return;
                        }

                        const style = window.getComputedStyle(node);
                        if (!isVisibleElement(node, style)) {
                            return;
                        }

                        const rect = node.getBoundingClientRect();
                        if (rect.width < 4 || rect.height < 4) {
                            return;
                        }

                        unionRects.push(rect);
                    });

                    if (!unionRects.length) {
                        return null;
                    }

                    const left = Math.max(0, Math.floor(Math.min(...unionRects.map(rect => rect.left)) - basePadding));
                    const top = Math.max(0, Math.floor(Math.min(...unionRects.map(rect => rect.top)) - basePadding));
                    const documentSize = getDocumentSize();
                    const right = Math.min(
                        documentSize.width,
                        Math.ceil(Math.max(...unionRects.map(rect => rect.right)) + basePadding)
                    );
                    const bottom = Math.min(
                        documentSize.height,
                        Math.ceil(Math.max(...unionRects.map(rect => rect.bottom)) + basePadding)
                    );

                    if (right <= left || bottom <= top) {
                        return null;
                    }

                    return {
                        strategy: 'union',
                        selector: null,
                        score: 0,
                        clip: {
                            x: left,
                            y: top,
                            width: right - left,
                            height: bottom - top,
                        },
                        document: documentSize,
                    };
                }
                """,
                {
                    'explicitSelectors': list(EXPLICIT_ROOT_SELECTORS),
                    'fallbackSelectors': list(LEGACY_ROOT_SELECTORS),
                    'basePadding': self.clip_padding,
                }
            )
        except Exception as e:
            logger.warning(f"解析截图区域失败：{e}")
            return None

        clip = self._normalize_clip(metadata.get('clip') if metadata else None, metadata.get('document') if metadata else None)
        if not clip:
            return None

        return {
            'clip': clip,
            'strategy': metadata.get('strategy', 'unknown'),
            'selector': metadata.get('selector'),
        }

    def _normalize_clip(self, clip: Optional[Dict], document_size: Optional[Dict]) -> Optional[Dict]:
        """
        归一化截图区域，避免越界或负值

        Args:
            clip: 原始截图区域
            document_size: 页面文档尺寸

        Returns:
            Optional[Dict]: 合法截图区域，失败时返回None
        """
        if not clip:
            return None

        x = max(0, int(round(clip.get('x', 0))))
        y = max(0, int(round(clip.get('y', 0))))
        width = int(round(clip.get('width', 0)))
        height = int(round(clip.get('height', 0)))

        if width <= 0 or height <= 0:
            return None

        if document_size:
            max_width = max(int(round(document_size.get('width', 0))), 1)
            max_height = max(int(round(document_size.get('height', 0))), 1)
            width = min(width, max_width - x)
            height = min(height, max_height - y)

        if width <= 0 or height <= 0:
            return None

        return {
            'x': x,
            'y': y,
            'width': width,
            'height': height,
        }

    def _calculate_viewport_size(self, clip: Dict) -> Dict:
        """
        根据截图区域计算所需视口尺寸

        Args:
            clip: 截图区域

        Returns:
            Dict: 视口尺寸
        """
        return {
            'width': max(1, int(clip['x'] + clip['width'])),
            'height': max(1, int(clip['y'] + clip['height'])),
        }

    def load_html_page(self, page: Page, html_path: str) -> bool:
        """
        加载HTML页面

        Args:
            page: Playwright页面对象
            html_path: HTML文件路径

        Returns:
            bool: 加载成功返回True，否则返回False
        """
        try:
            file_url = self._build_file_url(html_path)

            logger.debug(f"加载HTML页面：{file_url}")

            # 加载页面
            page.goto(file_url, timeout=self.timeout, wait_until='networkidle')

            return True

        except PlaywrightTimeoutError:
            logger.error(f"加载HTML页面超时：{html_path}")
            return False

        except Exception as e:
            logger.error(f"加载HTML页面失败：{html_path}，错误：{e}")
            return False

    def wait_for_rendering(self, page: Page) -> None:
        """
        等待页面渲染完成，包括所有图片加载

        Args:
            page: Playwright页面对象
        """
        try:
            # 先等待网络空闲(本地HTML文件通常很快)
            page.wait_for_load_state('networkidle', timeout=self.timeout)

            # 等待所有图片加载完成（包括img标签和CSS背景图）
            try:
                page.evaluate("""
                    async () => {
                        // 1. 等待所有 <img> 标签加载完成
                        const imgPromises = Array.from(document.querySelectorAll('img'))
                            .filter(img => !img.complete)
                            .map(img => new Promise((resolve, reject) => {
                                img.onload = resolve;
                                img.onerror = resolve;  // 即使加载失败也继续
                                // 设置超时，防止无限等待
                                setTimeout(resolve, 5000);
                            }));

                        // 2. 等待所有CSS背景图加载完成
                        const bgPromises = Array.from(document.querySelectorAll('*'))
                            .map(el => {
                                const style = window.getComputedStyle(el);
                                const bgImage = style.backgroundImage;
                                if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
                                    // 提取URL
                                    const urlMatch = bgImage.match(/url\\(['"]?([^'"\\)]+)['"]?\\)/);
                                    if (urlMatch && urlMatch[1]) {
                                        const url = urlMatch[1];
                                        // 跳过data: URL和已缓存的图片
                                        if (!url.startsWith('data:')) {
                                            return new Promise((resolve) => {
                                                const img = new Image();
                                                img.onload = resolve;
                                                img.onerror = resolve;
                                                img.src = url;
                                                // 设置超时
                                                setTimeout(resolve, 5000);
                                            });
                                        }
                                    }
                                }
                                return Promise.resolve();
                            });

                        await Promise.all([...imgPromises, ...bgPromises]);

                        // 3. 额外等待一帧，确保渲染完成
                        await new Promise(resolve => requestAnimationFrame(resolve));
                    }
                """)
                logger.debug("所有图片加载完成")
            except Exception as e:
                logger.warning(f"等待图片加载时发生警告: {e}")

            # 只在配置了额外等待时间时才等待(性能优化)
            if self.wait_time > 0:
                time.sleep(self.wait_time / 1000.0)

        except Exception as e:
            logger.warning(f"等待页面渲染时发生警告:{e}")

    def take_screenshot(self, page: Page, output_path: str) -> bool:
        """
        截图并保存

        Args:
            page: Playwright页面对象
            output_path: 输出路径

        Returns:
            bool: 截图成功返回True，否则返回False
        """
        try:
            # 确保输出目录存在
            output_dir = os.path.dirname(output_path)
            if output_dir and not os.path.exists(output_dir):
                os.makedirs(output_dir, exist_ok=True)

            # 截图选项
            screenshot_options = {
                'path': output_path,
                'type': self.image_format,
                'full_page': self.full_page,
            }

            # 如果是jpg格式，添加质量参数
            if self.image_format == 'jpeg':
                screenshot_options['quality'] = self.quality

            # 如果需要裁剪元素
            if self.clip_element:
                capture_region = self._resolve_capture_region(page)
                if capture_region:
                    screenshot_options['clip'] = capture_region['clip']
                    screenshot_options['full_page'] = False
                    logger.debug(
                        "使用截图区域进行截图，策略=%s，选择器=%s",
                        capture_region.get('strategy', 'unknown'),
                        capture_region.get('selector') or 'auto'
                    )
                else:
                    logger.warning("未找到任何可用的截图区域，使用全页截图")

            # 执行截图
            page.screenshot(**screenshot_options)

            return True

        except Exception as e:
            logger.error(f"截图失败：{output_path}，错误：{e}")
            return False

    def apply_border_radius(self, page: Page) -> bool:
        """
        应用圆角效果

        Args:
            page: Playwright页面对象

        Returns:
            bool: 应用成功返回True，否则返回False
        """
        try:
            result = page.evaluate(
                """
                ({ explicitSelectors, fallbackSelectors, borderRadius }) => {
                    const selectors = [...explicitSelectors, ...fallbackSelectors];

                    const applyStyle = (element, selector = null, strategy = 'auto') => {
                        if (!element) {
                            return null;
                        }

                        const style = window.getComputedStyle(element);
                        const rect = element.getBoundingClientRect();
                        if (
                            style.display === 'none' ||
                            style.visibility === 'hidden' ||
                            Number.parseFloat(style.opacity || '1') === 0 ||
                            rect.width <= 1 ||
                            rect.height <= 1
                        ) {
                            return null;
                        }

                        element.style.borderRadius = `${borderRadius}px`;
                        element.style.overflow = 'hidden';
                        return { selector, strategy };
                    };

                    for (const selector of selectors) {
                        const element = document.querySelector(selector);
                        const applied = applyStyle(element, selector, 'selector');
                        if (applied) {
                            return applied;
                        }
                    }

                    const candidates = Array.from(document.body.querySelectorAll('*')).slice(0, 500)
                        .filter(element => element !== document.body && element !== document.documentElement)
                        .map(element => {
                            const style = window.getComputedStyle(element);
                            const rect = element.getBoundingClientRect();
                            if (
                                style.display === 'none' ||
                                style.visibility === 'hidden' ||
                                Number.parseFloat(style.opacity || '1') === 0 ||
                                rect.width < 60 ||
                                rect.height < 60
                            ) {
                                return null;
                            }

                            const score =
                                rect.width * rect.height +
                                (element.parentElement === document.body ? 50000 : 0) +
                                (element.querySelector('img, svg, canvas, picture, video') ? 15000 : 0) +
                                (['flex', 'inline-flex', 'grid', 'inline-grid'].includes(style.display) ? 8000 : 0);

                            return { element, score };
                        })
                        .filter(Boolean)
                        .sort((left, right) => right.score - left.score);

                    if (!candidates.length) {
                        return null;
                    }

                    return applyStyle(candidates[0].element, null, 'auto');
                }
                """,
                {
                    'explicitSelectors': list(EXPLICIT_ROOT_SELECTORS),
                    'fallbackSelectors': list(LEGACY_ROOT_SELECTORS),
                    'borderRadius': self.border_radius,
                }
            )

            if result:
                logger.debug(
                    "已应用圆角，策略=%s，选择器=%s",
                    result.get('strategy', 'unknown'),
                    result.get('selector') or 'auto'
                )
                return True

            logger.warning("未找到任何可用的卡片元素应用圆角")
            return False

        except Exception as e:
            logger.warning(f"应用圆角效果失败：{e}")
            return False
