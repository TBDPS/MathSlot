<script lang="ts">
  interface Props {
    configDir?: string;
    onOpenConfigDir?: () => void;
    onClose: () => void;
  }

  let { configDir = '', onOpenConfigDir, onClose }: Props = $props();

  type HelpTab = 'quickstart' | 'shortcuts' | 'latex' | 'config';
  let tab = $state<HelpTab>('quickstart');
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label="使用文档与快速开始">
    <div class="modal-head">
      <span>MathSlot v2.0 使用文档</span>
      <button type="button" class="close-btn" onclick={onClose} aria-label="关闭">✕</button>
    </div>

    <div class="tabs-bar">
      <button type="button" class="tab-btn" class:active={tab === 'quickstart'} onclick={() => (tab = 'quickstart')}>
        快速开始
      </button>
      <button type="button" class="tab-btn" class:active={tab === 'shortcuts'} onclick={() => (tab = 'shortcuts')}>
        快捷键速查
      </button>
      <button type="button" class="tab-btn" class:active={tab === 'latex'} onclick={() => (tab = 'latex')}>
        LaTeX 兼容与简写
      </button>
      <button type="button" class="tab-btn" class:active={tab === 'config'} onclick={() => (tab = 'config')}>
        外部配置文件
      </button>
    </div>

    <div class="modal-body">
      {#if tab === 'quickstart'}
        <section class="doc-sec">
          <h4>4 条直觉规则</h4>
          <ul>
            <li><strong>自然直输</strong>：<code>/</code> 自动分数、<code>^</code>/<code>_</code> 上下标（连打自动合并）、<code>() [] &#123;&#125;</code> 自动补全并按高度自适应 <code>\left...\right</code>。</li>
            <li><strong>Enter / ; 推进一步</strong>：跳至下一槽位或精确跳出当前这一层；<code>Shift+Enter</code> 回退；顶层 <code>Enter</code> 换行并自动生成等号对齐公式。</li>
            <li><strong>智能缺省复用</strong>：<code>Tab r</code> 根号留空根指数即二次根号，按 <code>↑</code> 可随时补 N 次根；<code>Tab i</code> 积分跳过上下限即不定积分，<code>Tab b</code> 上下标可省略任一项。</li>
            <li><strong>二级菜单单键即用</strong>：按 <code>Tab m</code> 立即渲染 2×2 矩阵，直接打 <code>1 Enter 2…</code> 自动录入；若紧接着按 <code>d</code>（分段函数）或 <code>j</code>（省略行列式）则原地无缝变形。</li>
          </ul>
        </section>

        <section class="doc-sec">
          <h4>3 个高频实战</h4>
          <div class="recipe">
            <strong>1. 二次根号 / 立方根 / 不定积分</strong>
            <p>二次根号：<code>Tab r</code> → <code>x+1</code> → <code>→</code>；事后改立方根：光标进内按 <code>↑</code> 打 <code>3</code>。不定积分：<code>Tab i</code> → <code>Enter</code> <code>Enter</code> → <code>f(x) dx</code> → <code>Enter</code>。</p>
          </div>
          <div class="recipe">
            <strong>2. n 阶范德蒙德行列式</strong>
            <p>按 <code>Tab m j</code> 插入预填 <code>⋯ ⋮ ⋱</code> 的 4×4 省略行列式，矩阵内按 <code>Shift + ↓ / ↑ / → / ←</code> 四方向随时加行加列；单元格内可用 <code>...</code>、<code>:::</code>、<code>ddots</code> 输入省略号。</p>
          </div>
          <div class="recipe">
            <strong>3. 导出与缩放</strong>
            <p>画布右下角或 <code>Ctrl + 滚轮</code> 可缩放长公式；<code>Ctrl+Enter</code> 复制 LaTeX，底部按钮可一键复制 <strong>Word 公式 (MathML)</strong> 或 <strong>3× 高清 PNG</strong>。</p>
          </div>
        </section>
      {:else if tab === 'shortcuts'}
        <section class="doc-sec">
          <h4>一级结构键（Tab + 单字母）</h4>
          <div class="kv-grid">
            <div><kbd>Tab f</kbd> 分数</div>
            <div><kbd>Tab r</kbd> 根号（二次/N次）</div>
            <div><kbd>Tab b</kbd> 上下标（可缺省）</div>
            <div><kbd>Tab p</kbd> 自适应圆括号</div>
            <div><kbd>Tab v</kbd> 绝对值</div>
            <div><kbd>Tab i</kbd> 积分（定/不定）</div>
            <div><kbd>Tab s</kbd> 求和</div>
            <div><kbd>Tab l</kbd> 极限</div>
            <div><kbd>Tab e</kbd> 二项式</div>
          </div>
        </section>

        <section class="doc-sec">
          <h4>二级菜单（单键即渲染默认项，再按第二键变形）</h4>
          <div class="kv-grid wide">
            <div><kbd>Tab g</kbd> 希腊字母（默认 α）</div>
            <div><kbd>Tab c</kbd> 微积分（默认偏导 ∂/∂）</div>
            <div><kbd>Tab m</kbd> 矩阵分段（默认 2×2，<code>i</code>/<code>j</code> 省略阵）</div>
            <div><kbd>Tab a</kbd> 装饰定界（默认 x̂，<code>c</code> 向量）</div>
            <div><kbd>Tab o</kbd> 运算符（默认 ±，<code>r/s/t</code> 省略号）</div>
            <div><kbd>Tab x</kbd> 关系符（默认 ≈）</div>
            <div><kbd>Tab q</kbd> 集合逻辑（默认 ∪）</div>
            <div><kbd>Tab k / t</kbd> 自定义结构 / 复用片段</div>
          </div>
        </section>

        <section class="doc-sec">
          <h4>导航与矩阵快捷键</h4>
          <div class="kv-grid wide">
            <div><kbd>Esc</kbd> / <kbd>Tab j</kbd> 分层字母跳转</div>
            <div><kbd>Alt + ← / →</kbd> 跳转历史回退/前进</div>
            <div><kbd>Alt + ↑</kbd> 直接跳出一层</div>
            <div><kbd>Shift + ↑↓←→</kbd> 矩阵四方向增行列</div>
            <div><kbd>Ctrl + K</kbd> 搜索命令与公式库</div>
            <div><kbd>Ctrl + 滚轮</kbd> 缩放公式视图</div>
          </div>
        </section>
      {:else if tab === 'latex'}
        <section class="doc-sec">
          <h4>原生 LaTeX 行内命令兼容</h4>
          <p class="muted">直接输入反斜杠命令，按 <code>Space</code>、<code>Enter</code> 或对应定界符即可实时转为可交互 2D 结构：</p>
          <ul>
            <li><code>\int_</code> / <code>\sum_</code> / <code>\lim_</code> → 直接展开并落入下限；<code>\int^</code> 落入上限</li>
            <li><code>\int Space</code> / <code>\frac Space</code> / <code>\pmatrix Space</code> → 展开并进入首槽</li>
            <li><code>\sqrt[</code> → 落入根指数；<code>\sqrt&#123;</code> → 落入被开方式；<code>\frac&#123;</code> → 落入分子</li>
            <li><code>\alpha_1</code>、<code>\pi^2</code>、<code>\vdots Space</code>、<code>\ddots Space</code> → 即时转为符号</li>
          </ul>
        </section>

        <section class="doc-sec">
          <h4>独立词与符号简写（不误伤 spin / spi / foo）</h4>
          <div class="kv-grid wide">
            <div><code>pi</code> / <code>alpha</code> / <code>theta</code> → π / α / θ</div>
            <div><code>oo</code> → ∞ · <code>dx</code> → \,\mathrm&#123;d&#125;x</div>
            <div><code>-&gt;</code> → → · <code>=&gt;</code> → ⇒ · <code>&lt;=&gt;</code> → ⇔</div>
            <div><code>&lt;=</code> / <code>&gt;=</code> / <code>!=</code> → ≤ / ≥ / ≠</div>
            <div><code>+-</code> → ± · <code>~~</code> → ≈ · <code>==</code> → ≡</div>
            <div><code>...</code> → ⋯ · <code>:::</code> / <code>vdots</code> → ⋮ · <code>ddots</code> → ⋱</div>
          </div>
        </section>
      {:else}
        <section class="doc-sec">
          <h4>外部可编辑公式库与命令库（无需重新编译）</h4>
          <p class="muted">
            除在 <code>Ctrl+K</code> 面板内点击「+ 添加 / 编辑」直接维护外，桌面端还会自动在配置目录生成
            <code>presets.json</code> 与 <code>commands.json</code>，支持任意编辑器修改后点击「重载」热生效：
          </p>
          {#if configDir && configDir !== 'localStorage'}
            <div class="path-box">
              <code>{configDir}</code>
              {#if onOpenConfigDir}
                <button type="button" class="open-btn" onclick={onOpenConfigDir}>打开配置目录</button>
              {/if}
            </div>
          {/if}
          <pre class="code-box">{`// presets.json 示例（支持新增分类、覆盖内置 id、disabled: true 隐藏）
[
  {
    "id": "my-parseval",
    "name": "帕塞瓦尔恒等式",
    "category": "考研高数",
    "source": "\\\\frac{1}{\\\\pi}\\\\int_{-\\\\pi}^{\\\\pi} [f(x)]^2\\\\,\\\\mathrm{d}x"
  }
]

// commands.json 示例（可使用已释放的 u / d / n 等键位）
[
  {
    "id": "laplace",
    "label": "拉普拉斯变换",
    "category": "calculus",
    "keys": ["c", "z"],
    "slots": ["原函数"],
    "latex": "\\\\mathcal{L}\\\\left\\\\{$1\\\\right\\\\}"
  }
]`}</pre>
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.36);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 65;
  }

  .modal {
    width: min(640px, calc(100% - 28px));
    max-height: min(84vh, 620px);
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-lg);
    box-shadow: var(--ms-shadow-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 13px 16px;
    border-bottom: 1px solid var(--ms-border-subtle);
    font-size: 14px;
    font-weight: 600;
    color: var(--ms-fg);
  }

  .close-btn {
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ms-fg-muted);
    cursor: pointer;
    padding: 0;
  }

  .close-btn:hover {
    background: var(--ms-surface-muted);
    color: var(--ms-fg);
  }

  .tabs-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 14px;
    background: var(--ms-chrome);
    border-bottom: 1px solid var(--ms-border-subtle);
    flex-wrap: wrap;
  }

  .tab-btn {
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: var(--ms-fg-muted);
    padding: 5px 10px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .tab-btn.active {
    background: var(--ms-surface);
    border-color: var(--ms-border);
    color: var(--ms-accent);
  }

  .modal-body {
    padding: 14px 18px 18px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--ms-fg);
  }

  .doc-sec {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .doc-sec h4 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--ms-fg);
  }

  .doc-sec ul {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .muted {
    margin: 0;
    color: var(--ms-fg-muted);
  }

  .recipe {
    padding: 9px 11px;
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    border: 1px solid var(--ms-border-subtle);
  }

  .recipe p {
    margin: 4px 0 0;
    color: var(--ms-fg-muted);
  }

  .kv-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px 10px;
    padding: 10px 12px;
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    border: 1px solid var(--ms-border-subtle);
  }

  .kv-grid.wide {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  code,
  kbd {
    font-family: var(--ms-font-mono);
    font-size: 11px;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--ms-keycap-bg);
    border: 1px solid var(--ms-keycap-border);
    color: var(--ms-keycap-fg);
  }

  .path-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    border: 1px solid var(--ms-border-subtle);
    flex-wrap: wrap;
  }

  .open-btn {
    border: 1px solid var(--ms-accent);
    border-radius: 6px;
    background: var(--ms-accent-soft);
    color: var(--ms-accent);
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .code-box {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    border: 1px solid var(--ms-border-subtle);
    font-family: var(--ms-font-mono);
    font-size: 11px;
    line-height: 1.5;
    overflow-x: auto;
    color: var(--ms-fg);
  }
</style>
