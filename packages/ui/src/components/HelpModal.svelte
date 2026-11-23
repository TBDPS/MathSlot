<script lang="ts">
  interface Props {
    configDir?: string;
    onOpenConfigDir?: () => void;
    onClose: () => void;
  }

  let { configDir = '', onOpenConfigDir, onClose }: Props = $props();

  type HelpTab = 'quickstart' | 'shortcuts' | 'matrix' | 'latex' | 'config';
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
      <div class="head-title">
        <span>MathSlot 使用手册</span>
        <span class="ver-badge">v2.1</span>
      </div>
      <button type="button" class="close-btn" onclick={onClose} aria-label="关闭">✕</button>
    </div>

    <div class="tabs-bar">
      <button type="button" class="tab-btn" class:active={tab === 'quickstart'} onclick={() => (tab = 'quickstart')}>
        快速上手
      </button>
      <button type="button" class="tab-btn" class:active={tab === 'shortcuts'} onclick={() => (tab = 'shortcuts')}>
        快捷键速查
      </button>
      <button type="button" class="tab-btn" class:active={tab === 'matrix'} onclick={() => (tab = 'matrix')}>
        矩阵与插件技巧
      </button>
      <button type="button" class="tab-btn" class:active={tab === 'latex'} onclick={() => (tab = 'latex')}>
        LaTeX 与简写
      </button>
      <button type="button" class="tab-btn" class:active={tab === 'config'} onclick={() => (tab = 'config')}>
        自定义公式库
      </button>
    </div>

    <div class="modal-body">
      {#if tab === 'quickstart'}
        <div class="hero-tip">
          <strong>核心理念</strong>：像手写一样流畅录公式 —— 用 <kbd>Tab</kbd> 唤出结构，用 <kbd>Enter</kbd> 或 <kbd>;</kbd> 逐槽推进，彻底告别数括号。
        </div>

        <section class="doc-sec">
          <h4>4 条直觉操作</h4>
          <div class="card-grid">
            <div class="info-card">
              <div class="card-head">1. 自然直输</div>
              <p><kbd>/</kbd> 自动分数、<kbd>^</kbd>/<kbd>_</kbd> 上下标（连打自动合并）、<kbd>() [] &#123;&#125;</kbd> 自动补全并随高度自适应缩放。</p>
            </div>
            <div class="info-card">
              <div class="card-head">2. 逐槽推进</div>
              <p><kbd>Enter</kbd> / <kbd>;</kbd> 跳至下一槽位或精确跳出当前层；<kbd>Shift+Enter</kbd> 回退；顶层 <kbd>Enter</kbd> 换行并自动等号对齐。</p>
            </div>
            <div class="info-card">
              <div class="card-head">3. 智能缺省复用</div>
              <p><kbd>Tab r</kbd> 根号留空根指数即二次根号（按 <kbd>↑</kbd> 可随时补 N 次根）；<kbd>Tab i</kbd> 跳过上下限即不定积分；<kbd>Tab b</kbd> 可省略任一上下标。</p>
            </div>
            <div class="info-card">
              <div class="card-head">4. 二级菜单单键即用</div>
              <p>按 <kbd>Tab m</kbd> 立即渲染默认 2×2 矩阵，直接打字即开始录入；紧接着按第二键（如 <kbd>d</kbd> 分段 / <kbd>j</kbd> 省略行列式）原地无缝变形。</p>
            </div>
          </div>
        </section>

        <section class="doc-sec">
          <h4>界面分区导览</h4>
          <ul>
            <li><strong>画布左侧悬浮栏</strong>：撤销（<kbd>Ctrl+Z</kbd>）、重做（<kbd>Ctrl+Y</kbd>）、分层字母跳转（<kbd>Esc</kbd>）、层级虚线框开关与清空画布。</li>
            <li><strong>画布右下角缩放栏</strong>：点击 <kbd>−</kbd> / <kbd>100%</kbd> / <kbd>+</kbd> 或 <kbd>Ctrl + 滚轮</kbd> 自由缩放，超长公式自动支持横向滚动。</li>
            <li><strong>底部多行 LaTeX 栏</strong>：自动换行并随长公式增高，支持直接改源码（<kbd>Enter</kbd> 应用，<kbd>Shift+Enter</kbd> 换行），右侧一键导出 <strong>Word (MathML)</strong> 与 <strong>3× 高清 PNG</strong>。</li>
          </ul>
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
          <h4>高频全局与导航快捷键</h4>
          <div class="kv-grid wide">
            <div><kbd>Ctrl + Enter</kbd> 复制 / 插入到笔记</div>
            <div><kbd>Ctrl + K</kbd> 搜索命令、89+ 公式库与历史</div>
            <div><kbd>Esc</kbd> / <kbd>Tab j</kbd> 分层字母极速跳转</div>
            <div><kbd>Alt + ↑</kbd> 跳出当前嵌套层</div>
            <div><kbd>Alt + ← / →</kbd> 跳转历史后退 / 前进</div>
            <div><kbd>Ctrl + 滚轮</kbd> 缩放公式视图</div>
          </div>
        </section>
      {:else if tab === 'matrix'}
        <section class="doc-sec">
          <h4>矩阵、行列式与分段函数增删行列</h4>
          <p class="muted">光标位于矩阵 / 行列式 / 分段函数单元格内时，除使用下方悬浮按钮（<code>+行 −行 +列 −列</code>）外，全部支持键盘极速增删：</p>
          <div class="kv-grid wide">
            <div><kbd>Shift + ↑ / ↓</kbd> 在上方 / 下方增加一行</div>
            <div><kbd>Shift + ← / →</kbd> 在左侧 / 右侧增加一列</div>
            <div><kbd>Ctrl + Shift + ↑ / ↓</kbd> 删除当前行（亦支持 <kbd>Alt+Backspace</kbd>）</div>
            <div><kbd>Ctrl + Shift + ← / →</kbd> 删除当前列（亦支持 <kbd>Alt+Shift+Backspace</kbd>）</div>
          </div>
          <div class="recipe">
            <strong>快速输入 n 阶范德蒙德行列式</strong>
            <p>按 <kbd>Tab m j</kbd> 插入预填 <code>⋯ ⋮ ⋱</code> 的 4×4 省略行列式模板（或在 <kbd>Ctrl+K</kbd> 预置公式库中直接搜索「范德蒙德」），单元格内可直接键入 <code>...</code>（⋯）、<code>:::</code>（⋮）、<code>ddots</code>（⋱）。</p>
          </div>
        </section>

        <section class="doc-sec">
          <h4>Obsidian 插件与桌面端实用提示</h4>
          <ul>
            <li><strong>原位编辑公式</strong>：在 Obsidian 中将光标放在行内 <code>$...$</code> 或块级 <code>$$...$$</code> 内唤出 MathSlot，会自动识别并更新原公式。</li>
            <li><strong>引用块 &amp; Callout 兼容</strong>：支持 <code>&gt; $$</code>、嵌套 <code>&gt; &gt; $$</code> 及 <code>&gt; [!note]</code> 内的多行公式，编辑写回时自动保留每行 <code>&gt; </code> 前缀。</li>
            <li><strong>Linux Wayland 窗口置顶说明</strong>：Wayland 协议限制应用自置顶，可右键窗口标题栏选择「保持在最前」，或右键应用图标选择 <strong>X11 兼容模式</strong> 启动以启用内置置顶按钮。</li>
          </ul>
        </section>
      {:else if tab === 'latex'}
        <section class="doc-sec">
          <h4>原生 LaTeX 行内命令兼容</h4>
          <p class="muted">直接在画布中输入反斜杠命令，按 <kbd>Space</kbd>、<kbd>Enter</kbd> 或对应定界符即可实时转为可交互 2D 结构：</p>
          <ul>
            <li><code>\int_</code> / <code>\sum_</code> / <code>\lim_</code> → 立即展开并落入下限；<code>\int^</code> 落入上限</li>
            <li><code>\int Space</code> / <code>\frac Space</code> / <code>\pmatrix Space</code> → 展开并进入首个槽位</li>
            <li><code>\sqrt[</code> → 落入根指数；<code>\sqrt&#123;</code> → 落入被开方式；<code>\frac&#123;</code> → 落入分子</li>
            <li><code>\alpha_1</code>、<code>\pi^2</code>、<code>\vdots Space</code>、<code>\ddots Space</code> → 即时转为数学符号</li>
          </ul>
        </section>

        <section class="doc-sec">
          <h4>独立词与符号简写（智能边界识别，不误伤普通单词）</h4>
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
          <h4>外部可编辑公式库与命令库（免编译热重载）</h4>
          <p class="muted">
            除在 <kbd>Ctrl+K</kbd> 面板中点击「+ 添加 / 编辑」维护外，桌面端会自动在配置目录生成
            <code>presets.json</code> 与 <code>commands.json</code>，外部编辑保存后点击「重载」即可立即生效：
          </p>
          {#if configDir && configDir !== 'localStorage'}
            <div class="path-box">
              <code>{configDir}</code>
              {#if onOpenConfigDir}
                <button type="button" class="open-btn" onclick={onOpenConfigDir}>打开配置目录</button>
              {/if}
            </div>
          {/if}
          <pre class="code-box">{`// presets.json（支持新增分类、覆盖内置 id、或 disabled: true 隐藏）
{
  "presets": [
    {
      "id": "my-parseval",
      "name": "帕塞瓦尔恒等式",
      "category": "考研高数",
      "source": "\\\\frac{1}{\\\\pi}\\\\int_{-\\\\pi}^{\\\\pi} [f(x)]^2\\\\,\\\\mathrm{d}x"
    }
  ]
}

// commands.json（可使用已释放的 u / d / n 等键位）
{
  "commands": [
    {
      "id": "laplace",
      "label": "拉普拉斯变换",
      "category": "calculus",
      "keys": ["c", "z"],
      "slots": ["原函数"],
      "latex": "\\\\mathcal{L}\\\\left\\\\{$1\\\\right\\\\}"
    }
  ]
}`}</pre>
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.36);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 65;
  }

  .modal {
    width: min(680px, 100%);
    max-height: min(92%, 640px);
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
    padding: 12px 16px;
    border-bottom: 1px solid var(--ms-border-subtle);
    font-size: 14px;
    font-weight: 600;
    color: var(--ms-fg);
    flex-shrink: 0;
  }

  .head-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .ver-badge {
    font-family: var(--ms-font-mono);
    font-size: 10.5px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--ms-accent-soft);
    color: var(--ms-accent);
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
    flex-shrink: 0;
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

  .hero-tip {
    padding: 9px 12px;
    border-radius: var(--ms-radius-md);
    background: var(--ms-accent-soft);
    border: 1px solid color-mix(in srgb, var(--ms-accent) 28%, transparent);
    color: var(--ms-fg);
    font-size: 12.5px;
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
    gap: 6px;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .info-card {
    padding: 9px 11px;
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    border: 1px solid var(--ms-border-subtle);
  }

  .card-head {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ms-fg);
    margin-bottom: 4px;
  }

  .info-card p {
    margin: 0;
    font-size: 12px;
    color: var(--ms-fg-muted);
    line-height: 1.55;
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
