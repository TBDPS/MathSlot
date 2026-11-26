import { PluginSettingTab, Setting, type App } from 'obsidian';
import type { SlotOrderPreset } from '@mathslot/core';
import type MathSlotPlugin from './main';

export interface ObsidianInlinePrefs {
  enabled: boolean;
  leaderKey: 'Tab' | '`';
  naturalFraction: boolean;
  naturalScripts: boolean;
  punctShorthands: boolean;
  wordShorthands: boolean;
}

export const DEFAULT_OBSIDIAN_INLINE_PREFS: ObsidianInlinePrefs = {
  enabled: true,
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

    new Setting(containerEl).setName('原位无感流式输入（推荐）').setHeading();

    new Setting(containerEl)
      .setName('启用原位流式模式')
      .setDesc(
        '在笔记原生 $...$ 与 $$...$$ 中按引导键在光标正上方浮现单行紧凑胶囊（零遮挡下方实时预览），按 ; 跳槽并自动清理空可选括号，连敲 \\\\ 进入原生 TeX 透传区间。',
      )
      .addToggle((toggle) =>
        toggle.setValue(prefs.enabled).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ enabled: value });
        }),
      );

    new Setting(containerEl)
      .setName('原位引导键（Leader Key）')
      .setDesc('在公式内部呼出上方横向结构胶囊的触发键；在胶囊内按 w 可一键升维至 2D 画布工作台。')
      .addDropdown((dd) =>
        dd
          .addOption('Tab', 'Tab（默认，推荐）')
          .addOption('`', '反引号 `（避免与其它 Tab 插件冲突）')
          .setValue(prefs.leaderKey)
          .onChange(async (value) => {
            await this.plugin.updateInlinePrefs({
              leaderKey: value === '`' ? '`' : 'Tab',
            });
          }),
      );

    new Setting(containerEl).setName('原位语法糖细粒度开关').setHeading();

    new Setting(containerEl)
      .setName('自然分式（/ 自动包分母）')
      .setDesc('在公式内输入 a/b 自动展开为 \\frac{a}{b}，按 ; 跳出分母（在 \\\\ 原生透传区间内自动静默）。')
      .addToggle((toggle) =>
        toggle.setValue(prefs.naturalFraction).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ naturalFraction: value });
        }),
      );

    new Setting(containerEl)
      .setName('自然上下标（^ 与 _ 自动花括号）')
      .setDesc('在公式内输入 x^2; 自动写入 x^{2} 并支持按 ; 跳出上下标。')
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
      .setDesc(
        '自动将独立英文词 pi (\\pi)、oo (\\infty)、dx (\\mathrm{d}x)、alpha (\\alpha)、sin (\\sin) 等展开为标准 TeX 宏，绝不误伤 spin 等连续单词或 \\pi 等原生宏。',
      )
      .addToggle((toggle) =>
        toggle.setValue(prefs.wordShorthands).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ wordShorthands: value });
        }),
      );

    new Setting(containerEl).setName('槽位顺序与 2D 工作台').setHeading();

    new Setting(containerEl)
      .setName('槽位填充顺序预设')
      .setDesc('同时作用于原位流式模式与 2D 画布工作台（如定积分、求和的上下限跳转顺序）。')
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
