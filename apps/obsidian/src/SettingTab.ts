import { PluginSettingTab, Setting, type App } from 'obsidian';
import type { SlotOrderPreset } from '@mathslot/core';
import type MathSlotPlugin from './main';

export interface ObsidianInlinePrefs {
  enabled: boolean;
  autoActivateOnClick: boolean;
  leaderKey: 'Tab' | '`';
  naturalFraction: boolean;
  naturalScripts: boolean;
  punctShorthands: boolean;
  wordShorthands: boolean;
}

export const DEFAULT_OBSIDIAN_INLINE_PREFS: ObsidianInlinePrefs = {
  enabled: true,
  autoActivateOnClick: false,
  leaderKey: 'Tab',
  naturalFraction: true,
  naturalScripts: true,
  punctShorthands: true,
  wordShorthands: true,
};

export class MathSlotSettingTab extends PluginSettingTab {
  private readonly plugin: MathSlotPlugin;

  constructor(app: App, plugin: MathSlotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const prefs = this.plugin.getInlinePrefs();
    const slotPreset = this.plugin.getSlotOrderPreset();

    new Setting(containerEl).setName('快捷键呼出双栏流式模式').setHeading();

    new Setting(containerEl)
      .setName('启用原位双栏专注模式')
      .setDesc(
        '默认按 Alt+M 呼出（可在 Obsidian「快捷键」搜索 MathSlot 自定义）：不在公式内自动包裹 $...$（再按一次升级为 $$...$$），行上方常驻 KaTeX 实时预览，行下方常驻呼吸提示栏；最外层按 Enter / Esc / ; 自动跳到 $ 右侧收起。',
      )
      .addToggle((toggle) =>
        toggle.setValue(prefs.enabled).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ enabled: value });
        }),
      );

    new Setting(containerEl)
      .setName('光标进入已有公式时自动弹出双栏')
      .setDesc('默认关闭（推荐仅由快捷键显式呼出，彻底零打扰）；开启后鼠标点入已有 $...$ 也会自动唤起上下双栏。')
      .addToggle((toggle) =>
        toggle.setValue(prefs.autoActivateOnClick).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ autoActivateOnClick: value });
        }),
      );

    new Setting(containerEl)
      .setName('结构菜单触发键（Leader Key）')
      .setDesc('在公式专注态中展开下方结构键位条的按键；按 w 可一键升维至 2D 画布工作台。')
      .addDropdown((dd) =>
        dd
          .addOption('Tab', 'Tab（默认，推荐）')
          .addOption('`', '反引号 `')
          .setValue(prefs.leaderKey)
          .onChange(async (value) => {
            await this.plugin.updateInlinePrefs({
              leaderKey: value === '`' ? '`' : 'Tab',
            });
          }),
      );

    new Setting(containerEl).setName('语法糖细粒度开关').setHeading();

    new Setting(containerEl)
      .setName('自然分式（/ 自动包分母）')
      .setDesc('输入 a/b 自动展开为 \\frac{a}{b}，按 ; 跳出分母（在 \\\\ 原生透传区间内自动静默）。')
      .addToggle((toggle) =>
        toggle.setValue(prefs.naturalFraction).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ naturalFraction: value });
        }),
      );

    new Setting(containerEl)
      .setName('自然上下标（^ 与 _ 自动花括号）')
      .setDesc('输入 x^2; 自动写入 x^{2} 并支持按 ; 跳出上下标。')
      .addToggle((toggle) =>
        toggle.setValue(prefs.naturalScripts).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ naturalScripts: value });
        }),
      );

    new Setting(containerEl)
      .setName('符号与箭头简写')
      .setDesc('自动展开 -> (\\to)、!= (\\neq)、<= (\\le)、<=> (\\Leftrightarrow)、+- (\\pm) 等标点简写。')
      .addToggle((toggle) =>
        toggle.setValue(prefs.punctShorthands).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ punctShorthands: value });
        }),
      );

    new Setting(containerEl)
      .setName('英文词边界简写')
      .setDesc('自动识别独立词 pi (\\pi)、oo (\\infty)、dx (\\mathrm{d}x)、alpha (\\alpha)、sin (\\sin) 等。')
      .addToggle((toggle) =>
        toggle.setValue(prefs.wordShorthands).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ wordShorthands: value });
        }),
      );

    new Setting(containerEl).setName('槽位顺序与 2D 工作台').setHeading();

    new Setting(containerEl)
      .setName('槽位填充顺序预设')
      .setDesc('同时作用于原位专注模式与 2D 画布工作台。')
      .addDropdown((dd) =>
        dd
          .addOption('standard', '标准顺序（先下限、后上限、再被积式）')
          .addOption('writing_cn', '中文书写顺序（先上限或主体，契合手写直觉）')
          .setValue(slotPreset)
          .onChange(async (value) => {
            const preset: SlotOrderPreset = value === 'writing_cn' ? 'writing_cn' : 'standard';
            await this.plugin.updateSlotOrderPreset(preset);
          }),
      );

    new Setting(containerEl)
      .setName('打开 2D 画布工作台')
      .setDesc('用于复杂矩阵增删行列、浏览 114 条学科公式库、自定义结构或导出 Word MathML / 3× 高清 PNG。')
      .addButton((btn) =>
        btn
          .setButtonText('打开 MathSlot 工作台')
          .setCta()
          .onClick(() => {
            const editor = this.app.workspace.activeEditor?.editor;
            this.plugin.openWorkbenchFromSettings(editor);
          }),
      );
  }
}
