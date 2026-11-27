import { PluginSettingTab, Setting, type App } from 'obsidian';
import type { LeaderKey, SlotOrderPreset } from '@mathslot/core';
import type MathSlotPlugin from './main';

export interface ObsidianDockPrefs {
  enabled: boolean;
  autoShowOnFormulaCursor: boolean;
  semicolonExitsAtRoot: boolean;
}

export const DEFAULT_OBSIDIAN_DOCK_PREFS: ObsidianDockPrefs = {
  enabled: true,
  autoShowOnFormulaCursor: true,
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

    const prefs = this.plugin.getDockPrefs();
    const appSettings = this.plugin.getWorkbenchSettings();

    new Setting(containerEl).setName('底部停靠数学工作栏（CM6 原生分屏）').setHeading();

    new Setting(containerEl)
      .setName('启用底部公式工作栏')
      .setDesc(
        '采用 CodeMirror 6 原生底部 Panel 停靠在笔记窗格下方（与查找框同等机制，100% 占满栏宽且绝不遮挡正文上下文），默认快捷键 Alt+M 可立即插入 $...$ 或切换块级 $$...$$。',
      )
      .addToggle((toggle) =>
        toggle.setValue(prefs.enabled).onChange(async (value) => {
          await this.plugin.updateDockPrefs({ enabled: value });
        }),
      );

    new Setting(containerEl)
      .setName('光标进入已有公式时自动弹出实时预览')
      .setDesc(
        '默认开启：鼠标点入或键盘移入文档内任意已有 $...$ / $$...$$ 公式时，底部工作栏自动展开并随文档修改实时更新 2D 预览；点击底部画布或按 Tab 即刻接管编辑，移出公式外侧自动收起。',
      )
      .addToggle((toggle) =>
        toggle.setValue(prefs.autoShowOnFormulaCursor).onChange(async (value) => {
          await this.plugin.updateDockPrefs({ autoShowOnFormulaCursor: value });
        }),
      );

    new Setting(containerEl)
      .setName('最外层按 ; 自动完成并跳出 $ 外侧')
      .setDesc(
        '在底部 2D 画布中填完所有槽位回到最外层时，按 Enter 或 ; 自动将光标移至右侧 $ 外面并收起工作栏；关闭此项则只有 Enter / Ctrl+Enter 跳出，; 保留输入普通分号。',
      )
      .addToggle((toggle) =>
        toggle.setValue(prefs.semicolonExitsAtRoot).onChange(async (value) => {
          await this.plugin.updateDockPrefs({ semicolonExitsAtRoot: value });
        }),
      );

    new Setting(containerEl).setName('与完整工作台共享的核心输入设置').setHeading();

    new Setting(containerEl)
      .setName('结构引导键（Leader Key）')
      .setDesc('在 2D 画布或文档公式中呼出单键/二级分类命令的按键；在面板内按 w 可无缝打开全屏弹窗工作台。')
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
      .setName('自然分式（/ 自动抓分子）')
      .setDesc('在 2D 画布中输入 a/b 自动生成 \\frac{a}{b}（在 \\\\ 原生 TeX 透传槽内自动静默）。')
      .addToggle((toggle) =>
        toggle.setValue(appSettings.naturalFraction).onChange(async (value) => {
          await this.plugin.updateWorkbenchSettings({ naturalFraction: value });
        }),
      );

    new Setting(containerEl)
      .setName('自然上下标（^ 与 _）')
      .setDesc('输入 ^ 与 _ 自动进入上下标槽位并支持自动合并为复合上下标。')
      .addToggle((toggle) =>
        toggle.setValue(appSettings.naturalScripts).onChange(async (value) => {
          await this.plugin.updateWorkbenchSettings({ naturalScripts: value });
        }),
      );

    new Setting(containerEl)
      .setName('自动简写识别（->、<=、pi、oo、dx 等）')
      .setDesc('自动识别标点符号简写与独立词边界简写，绝不误伤普通连续英文单词。')
      .addToggle((toggle) =>
        toggle.setValue(appSettings.autoShorthands).onChange(async (value) => {
          await this.plugin.updateWorkbenchSettings({ autoShorthands: value });
        }),
      );

    new Setting(containerEl)
      .setName('默认显示 2D 嵌套层级虚线框')
      .setDesc('在完整公式工作台中标示分式、根号、积分与矩阵的嵌套层级边界。')
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
      .setName('打开全屏弹窗工作台')
      .setDesc('用于浏览检索 114 条学科预置公式库、管理自定义结构/复用片段，或导出 Word MathML / 3× 高清 PNG。')
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
