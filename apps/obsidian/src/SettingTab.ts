import { PluginSettingTab, Setting, type App } from 'obsidian';
import type { LeaderKey, SlotOrderPreset } from '@mathslot/core';
import type MathSlotPlugin from './main';

export interface ObsidianInlinePrefs {
  enabled: boolean;
  autoActivateOnClick: boolean;
  semicolonExitsAtRoot: boolean;
}

export const DEFAULT_OBSIDIAN_INLINE_PREFS: ObsidianInlinePrefs = {
  enabled: true,
  autoActivateOnClick: true,
  semicolonExitsAtRoot: true,
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
    const appSettings = this.plugin.getWorkbenchSettings();

    new Setting(containerEl).setName('原位分体工作台模式（上 2D 画布 + 中文档行 + 下命令栏）').setHeading();

    new Setting(containerEl)
      .setName('启用原位分体工作台')
      .setDesc(
        '将完整 MathSlot 工作台拆分为上下两栏嵌入文档当前行两侧（按页面正文列等宽对齐），中间直接使用 Obsidian 实时 $...$ 公式行。默认快捷键 Alt+M 可在正文中新建 $...$（再按升级 $$...$$）。',
      )
      .addToggle((toggle) =>
        toggle.setValue(prefs.enabled).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ enabled: value });
        }),
      );

    new Setting(containerEl)
      .setName('点击已有公式时自动展开上下双栏预览')
      .setDesc('开启后（默认开启），鼠标点入或移入文档内任意已有 $...$ / $$...$$ 公式时立即显示上方 2D 交互预览与下方命令栏。')
      .addToggle((toggle) =>
        toggle.setValue(prefs.autoActivateOnClick).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ autoActivateOnClick: value });
        }),
      );

    new Setting(containerEl)
      .setName('最外层按 ; 自动完成并跳出 $ 外侧')
      .setDesc('在 2D 画布中填完所有槽位回到最外层后，按 Enter 或 ; 直接将光标移到右侧 $ 外面并自动收起双栏。')
      .addToggle((toggle) =>
        toggle.setValue(prefs.semicolonExitsAtRoot).onChange(async (value) => {
          await this.plugin.updateInlinePrefs({ semicolonExitsAtRoot: value });
        }),
      );

    new Setting(containerEl).setName('与工作台共享的输入与语法糖设置').setHeading();

    new Setting(containerEl)
      .setName('结构引导键（Leader Key）')
      .setDesc('在 2D 画布或文档公式行中呼出二级结构分类菜单的按键。')
      .addDropdown((dd) =>
        dd
          .addOption('Tab', 'Tab（默认，推荐）')
          .addOption('/', '斜杠 /')
          .setValue(appSettings.leaderKey === '/' ? '/' : 'Tab')
          .onChange(async (value) => {
            const lk: LeaderKey = value === '/' ? '/' : 'Tab';
            await this.plugin.updateWorkbenchSettings({ leaderKey: lk });
          }),
      );

    new Setting(containerEl)
      .setName('自然分式（/ 自动转分数）')
      .setDesc('输入 a/b 自动创建 2D 分式（连敲 \\\\ 进入原生 TeX 透传槽时自动静默）。')
      .addToggle((toggle) =>
        toggle.setValue(appSettings.naturalFraction).onChange(async (value) => {
          await this.plugin.updateWorkbenchSettings({ naturalFraction: value });
        }),
      );

    new Setting(containerEl)
      .setName('自然上下标（^ 与 _）')
      .setDesc('输入 ^ 与 _ 自动进入上下标槽位并支持自动合并。')
      .addToggle((toggle) =>
        toggle.setValue(appSettings.naturalScripts).onChange(async (value) => {
          await this.plugin.updateWorkbenchSettings({ naturalScripts: value });
        }),
      );

    new Setting(containerEl)
      .setName('自动简写识别（->、<=、pi、oo、dx 等）')
      .setDesc('自动识别箭头关系简写与独立词边界简写，绝不误伤普通连续英文单词。')
      .addToggle((toggle) =>
        toggle.setValue(appSettings.autoShorthands).onChange(async (value) => {
          await this.plugin.updateWorkbenchSettings({ autoShorthands: value });
        }),
      );

    new Setting(containerEl)
      .setName('显示 2D 嵌套层级虚线框')
      .setDesc('在上方 2D 画布中清晰标示分式、根号、积分、矩阵的嵌套层级边界。')
      .addToggle((toggle) =>
        toggle.setValue(appSettings.showHierarchyBoxes).onChange(async (value) => {
          await this.plugin.updateWorkbenchSettings({ showHierarchyBoxes: value });
        }),
      );

    new Setting(containerEl)
      .setName('槽位填充顺序预设')
      .setDesc('控制定积分、求和、根号等结构的槽位跳转顺序。')
      .addDropdown((dd) =>
        dd
          .addOption('standard', '标准顺序（先下限、后上限、再被积式）')
          .addOption('writing_cn', '中文书写顺序（契合手写习惯）')
          .setValue(appSettings.slotOrderPreset)
          .onChange(async (value) => {
            const preset: SlotOrderPreset = value === 'writing_cn' ? 'writing_cn' : 'standard';
            await this.plugin.updateWorkbenchSettings({ slotOrderPreset: preset });
          }),
      );

    new Setting(containerEl)
      .setName('打开独立弹窗工作台')
      .setDesc('用于检索 114 条学科预置公式库、管理自定义结构/复用片段，或导出 Word MathML / 3× 高清 PNG。')
      .addButton((btn) =>
        btn
          .setButtonText('打开完整工作台')
          .setCta()
          .onClick(() => {
            const editor = this.app.workspace.activeEditor?.editor;
            this.plugin.openWorkbenchFromSettings(editor);
          }),
      );
  }
}
