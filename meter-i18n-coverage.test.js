'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { generateChinesePreloadCode, validateSyntax } = require('./modular-installer');
const { createI18nEngine } = require('./i18n/i18n-runtime');

function makeNode(tagName, opts = {}) {
  const attrs = Object.assign({}, opts.attrs || {});
  const node = {
    nodeType: 1,
    tagName: String(tagName || 'DIV').toUpperCase(),
    id: opts.id || '',
    className: opts.className || '',
    isContentEditable: Boolean(opts.isContentEditable || attrs.contenteditable === 'true'),
    parentElement: null,
    parentNode: null,
    childNodes: [],
    style: {},
    get firstChild() {
      return this.childNodes[0] || null;
    },
    get nextSibling() {
      if (!this.parentElement) return null;
      const list = this.parentElement.childNodes;
      const idx = list.indexOf(this);
      return idx >= 0 ? list[idx + 1] || null : null;
    },
    get previousSibling() {
      if (!this.parentElement) return null;
      const list = this.parentElement.childNodes;
      const idx = list.indexOf(this);
      return idx > 0 ? list[idx - 1] || null : null;
    },
    get textContent() {
      return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
    },
    get innerText() {
      return this.textContent;
    },
    getAttribute(name) {
      if (name === 'id' && this.id) return this.id;
      if (name === 'class' && this.className) return this.className;
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    hasAttribute(name) {
      if (name === 'id' && this.id) return true;
      if (name === 'class' && this.className) return true;
      return Object.prototype.hasOwnProperty.call(attrs, name);
    },
    setAttribute(name, val) {
      attrs[name] = String(val);
    },
    matches(singleSel) {
      const s = String(singleSel || '').trim();
      if (!s) return false;
      if (s === '#context-meter-root') return this.id === 'context-meter-root';
      if (s === '[data-testid="menu-option-label"]') {
        return this.getAttribute('data-testid') === 'menu-option-label';
      }
      if (s === 'button[data-testid="thinking-collapsible-trigger"]') {
        return this.tagName === 'BUTTON' && this.getAttribute('data-testid') === 'thinking-collapsible-trigger';
      }
      if (s === 'code') return this.tagName === 'CODE';
      if (s === 'pre') return this.tagName === 'PRE';
      if (s === 'kbd') return this.tagName === 'KBD';
      if (s === 'svg') return this.tagName === 'SVG';
      if (s === '.monaco-editor') return this.className.split(/\s+/).includes('monaco-editor');
      if (s === 'p') return this.tagName === 'P';
      if (s === 'blockquote') return this.tagName === 'BLOCKQUOTE';
      if (s === '[data-agy-brand-item="true"]') return this.getAttribute('data-agy-brand-item') === 'true';
      if (s === '[data-testid="title-menu-bar-item"]') return this.getAttribute('data-testid') === 'title-menu-bar-item';
      return false;
    },
    closest(selector) {
      const parts = String(selector || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (parts.some((p) => cur.matches(p))) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      if (selector === ':scope > button[data-testid="thinking-collapsible-trigger"]') {
        return this.childNodes.find(
          (c) => c.nodeType === 1 && c.tagName === 'BUTTON' && c.getAttribute('data-testid') === 'thinking-collapsible-trigger'
        ) || null;
      }
      return null;
    },
    contains(target) {
      let cur = target;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode || cur.parentElement;
      }
      return false;
    }
  };

  for (const child of opts.children || []) {
    const childObj = typeof child === 'string'
      ? {
          nodeType: 3,
          nodeValue: child,
          parentElement: node,
          parentNode: node,
          get nextSibling() {
            const list = node.childNodes;
            const idx = list.indexOf(this);
            return idx >= 0 ? list[idx + 1] || null : null;
          },
          get previousSibling() {
            const list = node.childNodes;
            const idx = list.indexOf(this);
            return idx > 0 ? list[idx - 1] || null : null;
          }
        }
      : child;
    childObj.parentElement = node;
    childObj.parentNode = node;
    node.childNodes.push(childObj);
  }

  return node;
}

function loadRuntimeSandbox(dictData) {
  const runtimeCode = fs.readFileSync(path.join(__dirname, 'i18n', 'i18n-runtime.js'), 'utf8');
  const body = makeNode('BODY');
  const sandbox = {
    __AGY_I18N_CONFIG__: { enabled: true, language: 'zh-CN', brandTitle: 'english' },
    __AGY_I18N_DATA__: dictData,
    window: null,
    globalThis: null,
    document: {
      body,
      documentElement: body,
      readyState: 'complete',
      addEventListener: () => {}
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    requestIdleCallback: () => 1
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(runtimeCode, sandbox);
  return sandbox;
}

test('i18n 双目录一致性与 preload 代码语法完整性校验', () => {
  const rootJson = fs.readFileSync(path.join(__dirname, 'i18n', 'zh-CN.json'));
  const srcJson = fs.readFileSync(path.join(__dirname, 'src', 'i18n', 'zh-CN.json'));
  assert.equal(Buffer.compare(rootJson, srcJson), 0, 'i18n/zh-CN.json 与 src/i18n/zh-CN.json 必须完全一致');

  const rootRuntime = fs.readFileSync(path.join(__dirname, 'i18n', 'i18n-runtime.js'));
  const srcRuntime = fs.readFileSync(path.join(__dirname, 'src', 'i18n', 'i18n-runtime.js'));
  assert.equal(Buffer.compare(rootRuntime, srcRuntime), 0, 'i18n/i18n-runtime.js 与 src/i18n/i18n-runtime.js 必须完全一致');

  const dict = JSON.parse(rootJson.toString('utf8'));
  assert.equal(typeof dict.exact, 'object');
  assert.ok(Array.isArray(dict.patterns));
  assert.ok(Object.keys(dict.exact).length >= 5900, '精简合并后的词条规模应保持在 5900 条以上');
  assert.ok(dict.patterns.length >= 350, '合并后的动态正则规模应保持在 350 条以上');

  const runtimeStr = rootRuntime.toString('utf8');
  assert.equal(validateSyntax(runtimeStr, 'i18n/i18n-runtime.js'), true);

  const preloadSnippet = generateChinesePreloadCode(rootJson.toString('utf8'), runtimeStr);
  assert.equal(validateSyntax(preloadSnippet, 'dist/preload.js (chinese)'), true);
});

test('i18n 词库覆盖增量条目并排除高风险误伤词条', () => {
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', 'zh-CN.json'), 'utf8'));
  const engine = createI18nEngine(dict);

  assert.equal(engine.translate('Docs & API Reference'), '文档与 API 参考');
  assert.equal(engine.translate('WSL Environment'), 'WSL 环境');
  assert.equal(engine.translate('Rules'), '规则库');
  assert.equal(engine.translate('Review Changes'), '审查更改');
  assert.equal(engine.translate('Thought for 4s'), '已思考 4 秒');

  const excludedExactTokens = [
    'Tab',
    'walkthrough.md',
    'always-proceed',
    'request-review',
    'agent-decides',
    'asks-for-review',
    'turbo',
    'strict',
    'teamwork',
    'all',
    'name',
    'bot',
    'memo',
    'space',
    'visit',
    'width',
    'run',
    'ran',
    'fork',
    'copy',
    'exit',
    'days',
    'hours',
    'minutes',
    'done',
    'sent',
    'idle',
    'active',
    'control',
    'display',
    'sound',
    'sounds',
    'narrow',
    'palette',
    'typeahead'
  ];

  for (const token of excludedExactTokens) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(dict.exact, token),
      false,
      `高风险或短歧义词条 "${token}" 不应出现在 exact 词典中`
    );
  }
});

test('i18n 运行时 DOM 边界隔离：保护快捷键、斜杠菜单、思考正文与用户输入区，保留思考按钮与白名单项', () => {
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', 'zh-CN.json'), 'utf8'));
  const sandbox = loadRuntimeSandbox(dict);

  // 1. <kbd> / <samp> / <var> 保持原文
  for (const tag of ['KBD', 'SAMP', 'VAR']) {
    const el = makeNode(tag, { children: ['Settings'] });
    sandbox.__AGY_TRANSLATE_EL__(el);
    assert.equal(el.textContent, 'Settings', `<${tag.toLowerCase()}> 不得被翻译`);
  }

  // 2. [data-testid="menu-option-label"] 默认隔离斜杠命令/未知标签，仅放行 @ 分类白名单
  const slashCmdEl = makeNode('SPAN', { attrs: { 'data-testid': 'menu-option-label' }, children: ['Settings'] });
  sandbox.__AGY_TRANSLATE_EL__(slashCmdEl);
  assert.equal(slashCmdEl.textContent, 'Settings', 'menu-option-label 中非白名单文本不得被翻译');

  const slashLiteralEl = makeNode('SPAN', { attrs: { 'data-testid': 'menu-option-label' }, children: ['/review'] });
  sandbox.__AGY_TRANSLATE_EL__(slashLiteralEl);
  assert.equal(slashLiteralEl.textContent, '/review');

  const rulesMentionEl = makeNode('SPAN', { attrs: { 'data-testid': 'menu-option-label' }, children: ['Rules'] });
  sandbox.__AGY_TRANSLATE_EL__(rulesMentionEl);
  assert.equal(rulesMentionEl.textContent, '规则库', '@ 引用分类 "Rules" 应允许翻译');

  const gitDiffMentionEl = makeNode('SPAN', { attrs: { 'data-testid': 'menu-option-label' }, children: ['Git Diff'] });
  sandbox.__AGY_TRANSLATE_EL__(gitDiffMentionEl);
  assert.equal(gitDiffMentionEl.textContent, 'Git 差异', '@ 引用分类 "Git Diff" 应允许翻译');

  // 3. 思考折叠触发按钮允许翻译，但其同级正文与 .thought-content 容器绝对隔离
  const triggerTextSpan = makeNode('SPAN', { children: ['Thought for 4s'] });
  const triggerBtn = makeNode('BUTTON', {
    attrs: { 'data-testid': 'thinking-collapsible-trigger' },
    children: [triggerTextSpan]
  });
  const thinkingBodySpan = makeNode('SPAN', { children: ['Settings'] });
  const thinkingBodyDiv = makeNode('DIV', { children: [thinkingBodySpan] });
  const thinkingContainer = makeNode('DIV', { children: [triggerBtn, thinkingBodyDiv] });

  sandbox.__AGY_TRANSLATE_EL__(thinkingContainer);
  assert.equal(triggerTextSpan.textContent, '已思考 4 秒', 'thinking-collapsible-trigger 标题应正常汉化');
  assert.equal(thinkingBodySpan.textContent, 'Settings', 'thinking 折叠正文兄弟容器不得被翻译');

  for (const cls of ['thought-content', 'thinking-content', 'thought-box']) {
    const innerSpan = makeNode('SPAN', { children: ['Settings'] });
    const wrapper = makeNode('DIV', { className: cls, children: [innerSpan] });
    sandbox.__AGY_TRANSLATE_EL__(wrapper);
    assert.equal(innerSpan.textContent, 'Settings', `.${cls} 内文本不得被翻译`);
  }

  // 4. 用户消息/输入区类名与语义属性隔离
  for (const cls of ['cursor-edit', 'group/user-input-step', 'user-message', 'input-area', 'chat-input']) {
    const innerSpan = makeNode('SPAN', { children: ['Settings'] });
    const wrapper = makeNode('DIV', { className: cls, children: [innerSpan] });
    sandbox.__AGY_TRANSLATE_EL__(wrapper);
    assert.equal(innerSpan.textContent, 'Settings', `.${cls} 内文本不得被翻译`);
  }

  for (const attrs of [
    { role: 'textbox' },
    { contenteditable: 'true' },
    { 'data-lexical-editor': 'true' },
    { 'data-language': 'typescript' }
  ]) {
    const innerSpan = makeNode('SPAN', { children: ['Settings'] });
    const wrapper = makeNode('DIV', { attrs, children: [innerSpan] });
    sandbox.__AGY_TRANSLATE_EL__(wrapper);
    assert.equal(innerSpan.textContent, 'Settings', `受保护属性 ${JSON.stringify(attrs)} 内文本不得被翻译`);
  }

  // 5. #ag-context-meter 插件自身容器及其子节点完全豁免
  const pluginInnerSpan = makeNode('SPAN', { children: ['Settings'] });
  const pluginRoot = makeNode('DIV', { id: 'ag-context-meter', children: [pluginInnerSpan] });
  sandbox.__AGY_TRANSLATE_EL__(pluginRoot);
  assert.equal(pluginInnerSpan.textContent, 'Settings', '#ag-context-meter 自身不得被 i18n-runtime 扫描或翻译');

  // 6. 常规 UI 按钮与 title 属性正常翻译
  const normalBtn = makeNode('BUTTON', {
    attrs: { title: 'Review Changes' },
    children: ['Docs & API Reference']
  });
  sandbox.__AGY_TRANSLATE_EL__(normalBtn);
  assert.equal(normalBtn.textContent, '文档与 API 参考');
  assert.equal(normalBtn.getAttribute('title'), '审查更改');
});

test('i18n 运行时性能护栏：pointerenter 不递归深层/大容器且 2000 节点深树全量扫描零 querySelector 耗时受控', () => {
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', 'zh-CN.json'), 'utf8'));
  const runtimeCode = fs.readFileSync(path.join(__dirname, 'i18n', 'i18n-runtime.js'), 'utf8');

  let querySelectorCalls = 0;
  let pointerEnterHandler = null;

  function makeFastNode(tag, opts = {}) {
    const n = makeNode(tag, opts);
    Object.defineProperty(n, 'firstElementChild', {
      get() {
        return this.childNodes.find((c) => c.nodeType === 1) || null;
      }
    });
    Object.defineProperty(n, 'nextElementSibling', {
      get() {
        if (!this.parentElement) return null;
        const list = this.parentElement.childNodes;
        const idx = list.indexOf(this);
        for (let i = idx + 1; i < list.length; i++) {
          if (list[i].nodeType === 1) return list[i];
        }
        return null;
      }
    });
    Object.defineProperty(n, 'childElementCount', {
      get() {
        return this.childNodes.filter((c) => c.nodeType === 1).length;
      }
    });
    n.querySelector = () => {
      querySelectorCalls++;
      return null;
    };
    return n;
  }

  // 构建 20 层嵌套、共 ~2000 节点的树（含一个 deep #root 容器）
  const leafSpan = makeFastNode('SPAN', { children: ['Settings'] });
  const deepWrapper = makeFastNode('DIV', {
    children: [makeFastNode('DIV', { children: [makeFastNode('DIV', { children: [leafSpan] })] })]
  });
  const branchChildren = [];
  for (let b = 0; b < 100; b++) {
    let cur = makeFastNode('SPAN', { children: [`Item ${b}`] });
    for (let d = 0; d < 18; d++) {
      cur = makeFastNode('DIV', { children: [cur] });
    }
    branchChildren.push(cur);
  }
  const appRoot = makeFastNode('DIV', { id: 'root', children: [deepWrapper, ...branchChildren] });
  const body = makeFastNode('BODY', { children: [appRoot] });

  const sandbox = {
    __AGY_I18N_CONFIG__: { enabled: true, language: 'zh-CN', brandTitle: 'english' },
    __AGY_I18N_DATA__: dict,
    window: null,
    globalThis: null,
    document: {
      body,
      documentElement: body,
      readyState: 'complete',
      addEventListener: (ev, fn) => {
        if (ev === 'pointerenter') pointerEnterHandler = fn;
      },
      querySelectorAll: () => []
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    requestIdleCallback: () => 1
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const t0 = performance.now();
  vm.runInNewContext(runtimeCode, sandbox);
  const scanMs = performance.now() - t0;

  assert.equal(querySelectorCalls, 0, '全树扫描绝不得在祖先循环内调用 querySelector');
  assert.ok(scanMs < 150, `2000 节点深树首次扫描耗时应 < 150ms，实际 ${scanMs.toFixed(2)}ms`);

  // 重置 deepWrapper 内叶子，模拟 pointerenter 触发外层深嵌套容器时不递归扫描
  leafSpan.childNodes[0].nodeValue = 'Settings';
  leafSpan.childNodes[0]._agyOriginal = undefined;
  assert.equal(typeof pointerEnterHandler, 'function');
  pointerEnterHandler({ target: appRoot });
  pointerEnterHandler({ target: deepWrapper });
  assert.equal(leafSpan.textContent, 'Settings', 'pointerenter 命中 #root 或深嵌套结构容器时不得阻塞遍历子孙');
});

