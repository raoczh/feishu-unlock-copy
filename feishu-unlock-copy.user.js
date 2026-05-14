// ==UserScript==
// @name         一键复制飞书文档全部内容
// @name:zh-CN   一键复制飞书文档全部内容
// @namespace    https://github.com/raoczh
// @version      1.5.2
// @description  一键复制飞书云文档（Wiki/Docs/Docx）禁止复制、禁止选中、禁止右键的限制内容，点击即可复制全部内容
// @description:zh-CN  一键复制飞书云文档（Wiki/Docs/Docx）禁止复制、禁止选中、禁止右键的限制内容，点击即可复制全部内容
// @author       raoczh (https://github.com/raoczh)
// @homepageURL  https://github.com/raoczh
// @supportURL   https://github.com/raoczh
// @match        *://*.feishu.cn/*
// @match        *://*.larksuite.com/*
// @match        *://*.feishu.net/*
// @match        *://feishu.cn/*
// @match        *://larksuite.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  // 1. 注入 CSS：强制开启文本选择，移除所有 user-select 限制
  // ============================================================
  const injectStyle = () => {
    const css = `
            *, *::before, *::after {
                -webkit-user-select: text !important;
                -moz-user-select: text !important;
                -ms-user-select: text !important;
                user-select: text !important;
                -webkit-touch-callout: default !important;
            }
            /* 飞书文档主体内容容器 */
            .docx-content, .docx-doc, .suite-docx, .wiki,
            .page-block, .docs-reader, .doc-render,
            [class*="docx"], [class*="docs"], [class*="wiki"] {
                -webkit-user-select: text !important;
                user-select: text !important;
            }
            /* 取消选中时的禁止图标遮罩 */
            ::selection {
                background: rgba(80, 160, 255, 0.35) !important;
                color: inherit !important;
            }
        `;
    const style = document.createElement("style");
    style.setAttribute("data-unlock-copy", "true");
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  };
  injectStyle();
  // 文档结构变化后再注入一次，避免被覆盖
  document.addEventListener("DOMContentLoaded", injectStyle);

  // ============================================================
  // 2. 拦截事件阻止：让 copy / cut / contextmenu / selectstart / dragstart / mousedown 等事件
  //    无法再被 preventDefault / stopPropagation 屏蔽
  // ============================================================
  const blockedEvents = [
    "copy",
    "cut",
    "paste",
    "contextmenu",
    "selectstart",
    "dragstart",
    "beforecopy",
    "beforecut",
  ];

  // 重写 EventTarget.prototype.addEventListener，拦截对这些事件的注册
  const rawAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (blockedEvents.includes(type)) {
      // 包装监听器：如果原监听器调用了 preventDefault，把它撤销
      const wrapped = function (e) {
        const origPreventDefault = e.preventDefault;
        const origStopPropagation = e.stopPropagation;
        const origStopImmediatePropagation = e.stopImmediatePropagation;
        e.preventDefault = function () {};
        e.stopPropagation = function () {};
        e.stopImmediatePropagation = function () {};
        try {
          if (typeof listener === "function") {
            return listener.call(this, e);
          } else if (listener && typeof listener.handleEvent === "function") {
            return listener.handleEvent.call(listener, e);
          }
        } finally {
          e.preventDefault = origPreventDefault;
          e.stopPropagation = origStopPropagation;
          e.stopImmediatePropagation = origStopImmediatePropagation;
        }
      };
      return rawAddEventListener.call(this, type, wrapped, options);
    }
    return rawAddEventListener.call(this, type, listener, options);
  };

  // ============================================================
  // 3. 在捕获阶段直接阻止那些会调用 preventDefault 的事件传播链路
  // ============================================================
  const allow = (e) => {
    e.stopImmediatePropagation();
    // 不再向下传递，让浏览器默认行为执行
  };
  blockedEvents.forEach((evt) => {
    window.addEventListener(evt, allow, true);
    document.addEventListener(evt, allow, true);
  });

  // ============================================================
  // 4. 清理 inline 属性：oncopy="return false" / oncontextmenu="return false" 之类
  // ============================================================
  const stripInlineHandlers = (root) => {
    const targets = root.querySelectorAll
      ? root.querySelectorAll(
          "[oncopy],[oncut],[onpaste],[oncontextmenu],[onselectstart],[ondragstart],[onmousedown]",
        )
      : [];
    targets.forEach((el) => {
      [
        "oncopy",
        "oncut",
        "onpaste",
        "oncontextmenu",
        "onselectstart",
        "ondragstart",
        "onmousedown",
      ].forEach((attr) => {
        if (el.hasAttribute(attr)) el.removeAttribute(attr);
        if (el[attr]) el[attr] = null;
      });
    });
    // 同时清理 body/html 上的
    [
      "oncopy",
      "oncut",
      "onpaste",
      "oncontextmenu",
      "onselectstart",
      "ondragstart",
      "onmousedown",
    ].forEach((attr) => {
      if (document.body && document.body[attr]) document.body[attr] = null;
      if (document.documentElement && document.documentElement[attr])
        document.documentElement[attr] = null;
    });
  };
  document.addEventListener("DOMContentLoaded", () =>
    stripInlineHandlers(document),
  );

  // 监听 DOM 变化，避免脚本动态注入禁用属性
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) stripInlineHandlers(node);
      }
    }
  });
  document.addEventListener("DOMContentLoaded", () => {
    mo.observe(document.documentElement, { childList: true, subtree: true });
  });

  // ============================================================
  // 5. 飞书 block-based 编辑器修复：跨段复制只能拿到首尾两段的问题
  //    飞书每个段落/标题/列表项都是独立 contenteditable 容器，浏览器原生
  //    Selection 跨容器时 toString() 会丢失中间块。用 TreeWalker 手动遍历
  //    DOM 节点，按 block 顺序收集文本。
  // ============================================================
  const BLOCK_TAGS = new Set([
    "DIV",
    "P",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "TR",
    "BLOCKQUOTE",
    "PRE",
    "TABLE",
    "SECTION",
    "ARTICLE",
    "BR",
    "HR",
    "TD",
    "TH",
  ]);

  const findBlockAncestor = (node, root) => {
    let p = node.nodeType === 1 ? node : node.parentElement;
    while (p && p !== root && !BLOCK_TAGS.has(p.tagName)) p = p.parentElement;
    return p || root;
  };

  // 用 TreeWalker 遍历 range 内所有文本节点，按 block 切换插入换行
  const extractFullTextByWalker = (range) => {
    if (!range || range.collapsed) return "";
    const root = range.commonAncestorContainer;
    const rootEl = root.nodeType === 1 ? root : root.parentElement;
    if (!rootEl) return "";

    const walker = document.createTreeWalker(
      rootEl,
      NodeFilter.SHOW_TEXT,
      null,
    );
    const parts = [];
    let collecting = false;
    let lastBlock = null;
    let node;

    while ((node = walker.nextNode())) {
      // 还没到起点
      if (!collecting) {
        const isStart =
          node === range.startContainer ||
          (range.startContainer.nodeType === 1 &&
            range.startContainer.contains(node));
        if (!isStart) continue;
        collecting = true;
        lastBlock = findBlockAncestor(node, rootEl);
        let text = node.textContent;
        if (
          node === range.startContainer &&
          range.startContainer.nodeType === 3
        ) {
          text = text.substring(range.startOffset);
        }
        // 起点和终点是同一个文本节点
        if (node === range.endContainer && range.endContainer.nodeType === 3) {
          const off =
            node === range.startContainer
              ? range.endOffset - range.startOffset
              : range.endOffset;
          return text.substring(0, off);
        }
        parts.push(text);
        continue;
      }

      // block 切换则插入换行
      const block = findBlockAncestor(node, rootEl);
      if (block !== lastBlock) {
        if (parts.length && !parts[parts.length - 1].endsWith("\n"))
          parts.push("\n");
        lastBlock = block;
      }

      // 到达终点
      const isEnd =
        node === range.endContainer ||
        (range.endContainer.nodeType === 1 &&
          range.endContainer.contains(node));
      if (isEnd) {
        let text = node.textContent;
        if (node === range.endContainer && range.endContainer.nodeType === 3) {
          text = text.substring(0, range.endOffset);
        }
        parts.push(text);
        break;
      }

      parts.push(node.textContent);
    }

    return parts.join("");
  };

  document.addEventListener(
    "copy",
    (e) => {
      const sel = window.getSelection && window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      // 候选 1：原生 toString()
      let text = sel.toString();
      let html = "";

      try {
        const range = sel.getRangeAt(0);

        // 候选 2：cloneContents().innerText（处理跨节点选区时通常优于 toString）
        const wrapper = document.createElement("div");
        wrapper.appendChild(range.cloneContents());
        const cloned = wrapper.innerText || wrapper.textContent || "";
        if (cloned.length > text.length) text = cloned;
        html = wrapper.innerHTML;

        // 候选 3：TreeWalker 手动遍历（针对飞书 block 编辑器跨段丢失问题）
        const walked = extractFullTextByWalker(range);
        if (walked.length > text.length) text = walked;
      } catch (_) {}

      if (text && e.clipboardData) {
        try {
          e.clipboardData.setData("text/plain", text);
          e.clipboardData.setData("text/html", html || text);
          e.preventDefault();
          e.stopImmediatePropagation();
        } catch (_) {}
      }
    },
    true,
  );

  // ============================================================
  // 6. 顶部提示：让用户知道脚本已生效
  // ============================================================
  const showToast = () => {
    if (document.querySelector("#__unlock_copy_toast__")) return;
    const tip = document.createElement("div");
    tip.id = "__unlock_copy_toast__";
    tip.textContent = "已解除复制限制 ✓";
    tip.style.cssText = `
            position: fixed; z-index: 999999; right: 16px; bottom: 16px;
            padding: 8px 14px; border-radius: 6px;
            background: rgba(20, 130, 240, 0.92); color: #fff;
            font-size: 12px; font-family: -apple-system, system-ui, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.18);
            opacity: 0; transition: opacity .3s ease;
            pointer-events: none;
        `;
    document.body.appendChild(tip);
    requestAnimationFrame(() => {
      tip.style.opacity = "1";
    });
    setTimeout(() => {
      tip.style.opacity = "0";
      setTimeout(() => tip.remove(), 400);
    }, 2200);
  };
  document.addEventListener("DOMContentLoaded", () =>
    setTimeout(showToast, 800),
  );

  // ============================================================
  // 7. "复制全部"浮动按钮：通过滚动触发虚拟列表渲染、收集全文
  //    解决飞书 [data-virtual-list-placeholder] 占位导致 700+ 行不在 DOM 的问题
  // ============================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 把一个内容节点（.ace-line 或独立图片块）转成文本。
  // 图片用 ![alt](src) 形式嵌入，既是纯文本，粘到 Markdown 编辑器又能被渲染成图片。
  // 注意：飞书图片是独立的 [data-block-type="image"] 块，并不在 .ace-line 内，需要单独处理。
  // 图片链接是带鉴权的临时 URL，需要登录态才能访问。
  const nodeToTextWithImages = (node) => {
    try {
      // 独立图片块：直接取内部 <img> 的 src
      if (
        node.getAttribute &&
        node.getAttribute("data-block-type") === "image"
      ) {
        const img = node.querySelector("img");
        if (!img) return "";
        const src =
          img.getAttribute("data-src") ||
          img.getAttribute("src") ||
          img.src ||
          "";
        const alt = img.alt || "图片";
        return src ? `![${alt}](${src})` : "";
      }

      // .ace-line：遍历 DOM，遇到 img 转 ![alt](src)，br 转换行，其他保留文本
      let out = "";
      const walk = (n) => {
        if (n.nodeType === Node.TEXT_NODE) {
          out += n.textContent;
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          if (n.tagName === "IMG") {
            const src =
              n.getAttribute("data-src") ||
              n.getAttribute("src") ||
              n.src ||
              "";
            const alt = n.alt || "图片";
            if (src) out += `![${alt}](${src})`;
          } else if (n.tagName === "BR") {
            out += "\n";
          } else {
            for (const c of n.childNodes) walk(c);
          }
        }
      };
      walk(node);
      return out;
    } catch (_) {
      return node.innerText || node.textContent || "";
    }
  };

  // 找出主滚动容器：测试所有候选（窗口 + .ace-line 的 scrollable 祖先），
  // 选择 scrollHeight - clientHeight 最大的那个。
  // 一次只能用一个容器 —— 多容器并发滚动会让 Y 坐标体系不一致，无法统一排序。
  const findScrollContainer = () => {
    const candidates = new Set();
    const win = document.scrollingElement || document.documentElement;
    if (win) candidates.add(win);

    const lines = document.querySelectorAll(".ace-line");
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      let p = lines[i].parentElement;
      while (p && p !== document.body) {
        const oy = getComputedStyle(p).overflowY;
        if (oy === "auto" || oy === "scroll") candidates.add(p);
        p = p.parentElement;
      }
    }

    let best = null;
    let maxScroll = 0;
    for (const c of candidates) {
      const scroll = c.scrollHeight - c.clientHeight;
      if (scroll > maxScroll && scroll > 10) {
        maxScroll = scroll;
        best = c;
      }
    }
    return best || win;
  };

  // 把当前 DOM 里所有 .ace-line 收集到 map，并维护一个跨多次扫描合并的全局 block 顺序
  // 关键思路：absY 排序对多栏布局/嵌入块会失效（同 Y 不同 X 的元素互相交错），
  // 改用"DOM 先序合并"——每次扫描记录当前 DOM 中 block 的先序，逐步合并到全局有序数组。
  // DOM 先序天然反映"先左栏后右栏、先上后下"的真实视觉顺序，且对虚拟滚动稳定。
  // map value: { blockKey, lineNum, lineIdx, y, text }
  // 同时收集 .ace-line 和 [data-block-type="image"] 块。图片块自身就是 block 节点，
  // 不在 .ace-line 内，所以查询里必须显式带上，否则纯文本里永远拿不到图片链接。
  const harvestVisibleLines = (map, container, blockOrder, blockOrderSet) => {
    const isWindow =
      container === document.scrollingElement ||
      container === document.documentElement ||
      container === document.body;
    const cScrollTop = isWindow
      ? window.scrollY || window.pageYOffset || 0
      : container.scrollTop;
    const cRectTop = isWindow ? 0 : container.getBoundingClientRect().top;

    const nodes = document.querySelectorAll(
      ".ace-line, [data-block-type='image']",
    );

    // 把 block 标识统一为字符串 key —— 优先 record-id（最稳），其次 block-id 加前缀避免冲突
    const blockKeyOf = (block) => {
      if (!block) return null;
      const r = block.getAttribute("data-record-id");
      if (r) return r;
      const b = block.getAttribute("data-block-id");
      if (b) return "b-" + b;
      return null;
    };

    // 图片块自身就是 block 节点；.ace-line 需要向上找 block 容器
    const blockOf = (node) => {
      if (
        node.getAttribute &&
        node.getAttribute("data-block-type") === "image"
      ) {
        return node;
      }
      return node.closest("[data-record-id], [data-block-id]");
    };

    // 步骤1：按 DOM 先序拿到当前可见 block 的 key 序列（每个 block 只记一次）
    const visibleSeq = [];
    const visibleSeen = new Set();
    nodes.forEach((node) => {
      const key = blockKeyOf(blockOf(node));
      if (key && !visibleSeen.has(key)) {
        visibleSeen.add(key);
        visibleSeq.push(key);
      }
    });

    // 步骤2：把 visibleSeq 合并到 blockOrder 全局有序数组
    // 算法：对 visibleSeq 中每个新 key，插入到"它前面最近的已知 key 之后、后面最近的已知 key 之前"
    let lastIdx = -1;
    for (let i = 0; i < visibleSeq.length; i++) {
      const key = visibleSeq[i];
      if (blockOrderSet.has(key)) {
        lastIdx = blockOrder.indexOf(key);
        continue;
      }
      // 在 visibleSeq 后面找第一个已知 key 的全局位置作为上界
      let nextIdx = blockOrder.length;
      for (let j = i + 1; j < visibleSeq.length; j++) {
        if (blockOrderSet.has(visibleSeq[j])) {
          nextIdx = blockOrder.indexOf(visibleSeq[j]);
          break;
        }
      }
      const insertIdx = Math.min(lastIdx + 1, nextIdx);
      blockOrder.splice(insertIdx, 0, key);
      blockOrderSet.add(key);
      lastIdx = insertIdx;
    }

    // 步骤3：收集每个节点（.ace-line 或图片块）的文本
    nodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
      const absY = rect.top - cRectTop + cScrollTop;

      const isImg =
        node.getAttribute && node.getAttribute("data-block-type") === "image";
      const block = isImg
        ? node
        : node.closest("[data-record-id], [data-block-id]");
      const blockKey = blockKeyOf(block) || "r";

      let lineNum = 0;
      let lineIdx = 0;
      if (!isImg) {
        const numWrap = node.querySelector("[data-line-num]");
        lineNum = numWrap
          ? parseInt(numWrap.getAttribute("data-line-num"), 10) || 0
          : 0;
        if (!lineNum && block) {
          const ls = block.querySelectorAll(".ace-line");
          lineIdx = Array.prototype.indexOf.call(ls, node);
        }
      }
      const uniqueKey = `${blockKey}#${lineNum}#${lineIdx}`;

      const existing = map.get(uniqueKey);

      // first-wins：已存在且非空时不再覆盖
      // 防止虚拟列表 re-render 时用可能不完整的二次结果覆盖第一次的完整结果
      if (existing && existing.text) {
        if (absY < existing.y) existing.y = absY;
        return;
      }

      const text = nodeToTextWithImages(node);

      if (!existing) {
        map.set(uniqueKey, { blockKey, lineNum, lineIdx, y: absY, text });
      } else {
        if (absY < existing.y) existing.y = absY;
        existing.text = text;
      }
    });
  };

  const writeToClipboard = async (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_) {}
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("execCommand copy 失败");
  };

  let progressEl = null;
  const setProgress = (msg) => {
    if (!progressEl) {
      progressEl = document.createElement("div");
      progressEl.id = "__unlock_copy_progress__";
      progressEl.style.cssText = `
                position: fixed; z-index: 999999; left: 50%; top: 16px;
                transform: translateX(-50%); padding: 10px 18px;
                border-radius: 8px; background: rgba(20,20,28,.92); color: #fff;
                font-size: 13px; font-family: -apple-system, system-ui, sans-serif;
                box-shadow: 0 6px 24px rgba(0,0,0,.3); pointer-events: none;
            `;
      document.body.appendChild(progressEl);
    }
    progressEl.textContent = msg;
  };
  const closeProgress = (delay = 2200) => {
    if (!progressEl) return;
    const el = progressEl;
    progressEl = null;
    setTimeout(() => el.remove(), delay);
  };

  // 运行锁：滚动收集要好几秒，期间禁用按钮防止用户重复触发
  const btnElements = {};
  let isRunning = false;

  const lockButton = () => {
    isRunning = true;
    Object.values(btnElements).forEach((btn) => {
      btn.disabled = true;
      btn.style.opacity = "0.6";
      btn.dataset.original = btn.innerHTML;
      btn.innerHTML = "⏳ 滚动中…";
    });
  };

  const unlockButton = () => {
    Object.values(btnElements).forEach((btn) => {
      btn.disabled = false;
      btn.style.opacity = "1";
      if (btn.dataset.original) btn.innerHTML = btn.dataset.original;
    });
    isRunning = false;
  };

  const startCopyAll = async () => {
    if (isRunning) return;
    lockButton();

    const container = findScrollContainer();
    if (!container) {
      setProgress("未找到文档滚动容器");
      closeProgress(1800);
      unlockButton();
      return;
    }
    const originalScrollTop = container.scrollTop;
    const map = new Map();
    // 跨多次扫描合并的全局 block 先序数组（保证多栏布局/虚拟滚动下的顺序正确）
    const blockOrder = [];
    const blockOrderSet = new Set();

    try {
      container.scrollTop = 0;
      await sleep(450);

      const step = Math.max(200, container.clientHeight * 0.7);
      let lastTop = -1;
      let stable = 0;
      let safety = 0;

      while (stable < 3 && safety < 2000) {
        harvestVisibleLines(map, container, blockOrder, blockOrderSet);
        const max = Math.max(
          1,
          container.scrollHeight - container.clientHeight,
        );
        const pct = Math.min(
          100,
          Math.round((container.scrollTop / max) * 100),
        );
        setProgress(`滚动收集中… ${pct}%   已收集 ${map.size} 行`);

        container.scrollTop = container.scrollTop + step;
        await sleep(380);

        if (Math.abs(container.scrollTop - lastTop) < 5) stable++;
        else stable = 0;
        lastTop = container.scrollTop;
        safety++;
      }
      container.scrollTop = container.scrollHeight;
      await sleep(450);
      harvestVisibleLines(map, container, blockOrder, blockOrderSet);

      // 用 blockOrder 给每个 block 一个稳定索引
      const blockIdx = new Map();
      blockOrder.forEach((k, i) => blockIdx.set(k, i));

      const sortedItems = Array.from(map.values()).sort((a, b) => {
        const aIdx = blockIdx.has(a.blockKey)
          ? blockIdx.get(a.blockKey)
          : Number.MAX_SAFE_INTEGER;
        const bIdx = blockIdx.has(b.blockKey)
          ? blockIdx.get(b.blockKey)
          : Number.MAX_SAFE_INTEGER;
        if (aIdx !== bIdx) return aIdx - bIdx;
        if (a.lineNum !== b.lineNum) return a.lineNum - b.lineNum;
        if (a.lineIdx !== b.lineIdx) return a.lineIdx - b.lineIdx;
        return a.y - b.y;
      });

      const outputText = sortedItems
        .map((it) => it.text)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n");

      if (!outputText.trim()) {
        setProgress("没有收集到任何内容");
        closeProgress(2000);
        return;
      }

      await writeToClipboard(outputText);
      setProgress(
        `✓ 已复制：${sortedItems.length} 行 / ${outputText.length} 字`,
      );
      closeProgress(2800);
    } catch (err) {
      console.error("[unlock-copy] copyAll 失败", err);
      setProgress(`❌ 失败：${(err && err.message) || err}`);
      closeProgress(3000);
    } finally {
      container.scrollTop = originalScrollTop;
      unlockButton();
    }
  };

  const COPY_BTN_ID = "__unlock_copy_btn__";

  const ensureCopyAllButton = () => {
    if (!document.body) return;
    const hasContent = document.querySelector(
      ".ace-line, [data-line-num], [data-block-type='image']",
    );

    if (!btnElements[COPY_BTN_ID]) {
      const btn = document.createElement("button");
      btn.id = COPY_BTN_ID;
      btn.innerHTML = "📋 复制全部";
      btn.title =
        "滚动整个文档并复制为纯文本，图片以 ![alt](url) 形式插入。\n注意：图片链接需登录态才能访问。";
      const baseShadow = "0 4px 12px rgba(51,112,255,.35)";
      const hoverShadow = "0 6px 18px rgba(51,112,255,.5)";
      btn.style.cssText =
        "position: fixed; z-index: 999998; right: 16px; bottom: 20px;" +
        "background: #3370ff; box-shadow: " +
        baseShadow +
        ";" +
        "padding: 9px 16px; border-radius: 22px; border: none;" +
        "color: #fff; font-size: 13px; font-weight: 500;" +
        "font-family: -apple-system, system-ui, sans-serif;" +
        "cursor: pointer; user-select: none;" +
        "transition: transform .15s ease, box-shadow .15s ease;";
      btn.addEventListener("mouseenter", () => {
        if (btn.disabled) return;
        btn.style.transform = "translateY(-2px)";
        btn.style.boxShadow = hoverShadow;
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.transform = "";
        btn.style.boxShadow = baseShadow;
      });
      btn.addEventListener("click", startCopyAll);
      document.body.appendChild(btn);
      btnElements[COPY_BTN_ID] = btn;
    }
    btnElements[COPY_BTN_ID].style.display = hasContent ? "" : "none";
  };

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(ensureCopyAllButton, 1500);
    setInterval(ensureCopyAllButton, 3000);
  });
})();
