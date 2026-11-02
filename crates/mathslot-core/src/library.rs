/// 用户可扩展数学格式与公式复用片段库（零外部依赖 JSON 持久化，桌面端与 Obsidian 插件同源共享）

/// 自定义格式的布局种类（层级一声明式 schema：免改源码支持矩阵式结构与槽间自动拼接）
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LayoutKind {
    /// 默认：线性槽位模板，输出完全由 `latex_template` 的 `$1..$N` 决定
    Linear,
    /// 矩阵式环境：槽位按 `cols` 列逐行排列，渲染为
    /// `\begin{env} s1 & s2 \\ s3 & s4 \end{env}`（`latex_template` 不参与渲染）
    Env { env: String, cols: usize },
}

impl Default for LayoutKind {
    fn default() -> Self {
        LayoutKind::Linear
    }
}

/// 槽间自动拼接（层级一）：条件槽内容非空时，把 `macro_tex` 与其拼接在基槽内容之后。
/// 典型用途：`趋近变量 ; 趋近目标 ; 主体` 三槽 + `{base:0, cond:1, macro:"\\to"}`
/// 可在目标槽为空时自动省略 `\to`（模板只需引用基槽 `$1`，无需手写 `\to`）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AutoJoin {
    /// 基槽下标（0-based）：拼接结果落在该槽
    pub base_slot: usize,
    /// 条件槽下标（0-based）：内容为空则不拼接（其自身也不输出）
    pub cond_slot: usize,
    /// 拼接宏（如 `\\to`、`\\iff`）
    pub macro_tex: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CustomFormat {
    /// 触发子键 `'a'..='z'`，对应流指令 `▸k<item_key>`（如 `▸ka`）
    pub item_key: char,
    /// 中文/短名称（如 `"组合数"`）
    pub label: String,
    /// 菜单缩略提示（如 `"C(n,k)"`）
    pub glyph_hint: String,
    /// 各槽位角色说明（为空表示 0 槽位符号；有 N 项则解析 N 个以 `;` 分隔的槽位，对应模板中的 `$1`..`$N`）
    pub slot_roles: Vec<String>,
    /// LaTeX 输出模板，使用 `$1`, `$2`, ... 作为槽位占位符（如 `"\\binom{$1}{$2}"`；`Env` 布局下不参与渲染）
    pub latex_template: String,
    /// 方案 A 展开函数名（如 `"binom"` -> `binom(n, k)`）
    pub scheme_a_name: String,
    /// 布局种类（默认线性；`Env` 为矩阵式环境）
    pub layout: LayoutKind,
    /// 槽间自动拼接（可选）
    pub auto_join: Option<AutoJoin>,
}

impl CustomFormat {
    pub fn arity(&self) -> usize {
        self.slot_roles.len()
    }

    pub fn code(&self) -> String {
        format!("k{}", self.item_key)
    }

    /// 将渲染后的各槽位字符串代入 `latex_template` 中的 `$1`..`$9`（支持 `{$1}` 安全包裹）
    pub fn expand_latex(&self, rendered_slots: &[String]) -> String {
        expand_numbered_placeholders(&self.latex_template, rendered_slots)
    }

    pub fn expand_scheme_a(&self, rendered_slots: &[String]) -> String {
        let head = if self.scheme_a_name.trim().is_empty() {
            &self.label
        } else {
            self.scheme_a_name.trim()
        };
        if rendered_slots.is_empty() {
            head.to_owned()
        } else {
            format!("{head}({})", rendered_slots.join(", "))
        }
    }

    /// 应用 autoJoin：cond 槽内容非空时将 `macro + cond` 拼接到 base 槽后，cond 槽自身置空。
    pub fn prepare_joined_slots(&self, rendered_slots: &[String]) -> Vec<String> {
        let mut slots: Vec<String> = rendered_slots.to_vec();
        if let Some(j) = &self.auto_join
            && j.base_slot < slots.len()
            && j.cond_slot < slots.len()
            && j.cond_slot != j.base_slot
        {
            let cond = slots[j.cond_slot].trim().to_owned();
            if cond.is_empty() {
                slots[j.cond_slot] = String::new();
            } else {
                let base = slots[j.base_slot].trim().to_owned();
                slots[j.base_slot] = if base.is_empty() {
                    format!("{} {}", j.macro_tex.trim(), cond)
                } else {
                    format!("{base} {} {}", j.macro_tex.trim(), cond)
                };
                slots[j.cond_slot] = String::new();
            }
        }
        slots
    }

    /// 统一 LaTeX 渲染入口：Linear 走模板展开，Env 生成矩阵式环境（autoJoin 均生效）
    pub fn render_latex(&self, rendered_slots: &[String]) -> String {
        let slots = self.prepare_joined_slots(rendered_slots);
        match &self.layout {
            LayoutKind::Linear => self.expand_latex(&slots),
            LayoutKind::Env { env, cols } => {
                let cols = (*cols).max(1);
                let mut out = format!("\\begin{{{env}}}");
                for (idx, slot) in slots.iter().enumerate() {
                    if idx > 0 {
                        if idx % cols == 0 {
                            out.push_str(" \\\\ ");
                        } else {
                            out.push_str(" & ");
                        }
                    }
                    out.push_str(slot);
                }
                out.push_str(&format!("\\end{{{env}}}"));
                out
            }
        }
    }

    /// 统一方案 A 渲染入口：Linear 走函数展开，Env 用 `name[a, b; c, d]` 行分号标记
    pub fn render_scheme_a(&self, rendered_slots: &[String]) -> String {
        let slots = self.prepare_joined_slots(rendered_slots);
        let head = if self.scheme_a_name.trim().is_empty() {
            self.label.trim()
        } else {
            self.scheme_a_name.trim()
        };
        match &self.layout {
            LayoutKind::Linear => self.expand_scheme_a(&slots),
            LayoutKind::Env { .. } => {
                let cols = match &self.layout {
                    LayoutKind::Env { cols, .. } => (*cols).max(1),
                    _ => unreachable!(),
                };
                let mut rows: Vec<String> = Vec::new();
                for row in slots.chunks(cols) {
                    rows.push(row.join(", "));
                }
                format!("{head}[{}]", rows.join("; "))
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FormulaSnippet {
    /// 触发子键 `'a'..='z'`，对应流指令 `▸t<item_key>`（如 `▸ta`，输入后立即内联展开并定位到首个待填槽或末尾）
    pub item_key: char,
    /// 片段名称（如 `"判别式 Δ"`、`"高斯积分模板"`）
    pub label: String,
    /// MathSlot 简码流源码（可为完整复杂子式如 `"▸rb^2 - 4ac;"`，也可含待填空槽如 `"▸i-oo;oo;;dx"`）
    pub stream_source: String,
}

impl FormulaSnippet {
    pub fn code(&self) -> String {
        format!("t{}", self.item_key)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserLibrary {
    pub custom_formats: Vec<CustomFormat>,
    pub snippets: Vec<FormulaSnippet>,
}

impl Default for UserLibrary {
    fn default() -> Self {
        Self::default_seeded()
    }
}

impl UserLibrary {
    pub fn default_seeded() -> Self {
        Self {
            custom_formats: vec![
                CustomFormat {
                    item_key: 'a',
                    label: "组合数".to_owned(),
                    glyph_hint: "C(n,k)".to_owned(),
                    slot_roles: vec!["上标n".to_owned(), "下标k".to_owned()],
                    latex_template: "\\binom{$1}{$2}".to_owned(),
                    scheme_a_name: "binom".to_owned(),
layout: LayoutKind::Linear, auto_join: None,
                },
                CustomFormat {
                    item_key: 'b',
                    label: "双线范数".to_owned(),
                    glyph_hint: "‖x‖".to_owned(),
                    slot_roles: vec!["向量".to_owned()],
                    latex_template: "\\left\\Vert $1 \\right\\Vert".to_owned(),
                    scheme_a_name: "norm".to_owned(),
layout: LayoutKind::Linear, auto_join: None,
                },
                CustomFormat {
                    item_key: 'c',
                    label: "条件长箭头".to_owned(),
                    glyph_hint: "─→".to_owned(),
                    slot_roles: vec!["下方条件".to_owned(), "上方标注".to_owned()],
                    latex_template: "\\xrightarrow[$1]{$2}".to_owned(),
                    scheme_a_name: "xto".to_owned(),
layout: LayoutKind::Linear, auto_join: None,
                },
                CustomFormat {
                    item_key: 'd',
                    label: "内积尖括号".to_owned(),
                    glyph_hint: "⟨u,v⟩".to_owned(),
                    slot_roles: vec!["左项".to_owned(), "右项".to_owned()],
                    latex_template: "\\left\\langle $1, $2 \\right\\rangle".to_owned(),
                    scheme_a_name: "inner".to_owned(),
layout: LayoutKind::Linear, auto_join: None,
                },
                CustomFormat {
                    item_key: 'e',
                    label: "黑板粗体".to_owned(),
                    glyph_hint: "ℝ/𝔼".to_owned(),
                    slot_roles: vec!["大写字母".to_owned()],
                    latex_template: "\\mathbb{$1}".to_owned(),
                    scheme_a_name: "bb".to_owned(),
layout: LayoutKind::Linear, auto_join: None,
                },
                CustomFormat {
                    item_key: 'f',
                    label: "花体字母".to_owned(),
                    glyph_hint: "ℒ/ℱ".to_owned(),
                    slot_roles: vec!["大写字母".to_owned()],
                    latex_template: "\\mathcal{$1}".to_owned(),
                    scheme_a_name: "cal".to_owned(),
layout: LayoutKind::Linear, auto_join: None,
                },
            ],
            snippets: vec![
                FormulaSnippet {
                    item_key: 'a',
                    label: "判别式 √(b²-4ac)".to_owned(),
                    stream_source: "▸rb^2 - 4ac;".to_owned(),
                },
                FormulaSnippet {
                    item_key: 'b',
                    label: "反常积分 ∫(-∞→∞)".to_owned(),
                    stream_source: "▸i-oo;oo;;dx".to_owned(),
                },
                FormulaSnippet {
                    item_key: 'c',
                    label: "偏导算子 ∂□/∂x".to_owned(),
                    stream_source: "▸f▸oc ;▸oc x;".to_owned(),
                },
            ],
        }
    }

    pub fn lookup_custom(&self, item_key: char) -> Option<&CustomFormat> {
        let k = item_key.to_ascii_lowercase();
        self.custom_formats.iter().find(|f| f.item_key == k)
    }

    pub fn default_custom(&self) -> Option<&CustomFormat> {
        self.lookup_custom('a')
            .or_else(|| self.custom_formats.first())
    }

    pub fn lookup_snippet(&self, item_key: char) -> Option<&FormulaSnippet> {
        let k = item_key.to_ascii_lowercase();
        self.snippets.iter().find(|s| s.item_key == k)
    }

    pub fn default_snippet(&self) -> Option<&FormulaSnippet> {
        self.lookup_snippet('a').or_else(|| self.snippets.first())
    }

    pub fn next_free_custom_key(&self) -> Option<char> {
        ('a'..='z').find(|&c| self.lookup_custom(c).is_none())
    }

    pub fn next_free_snippet_key(&self) -> Option<char> {
        ('a'..='z').find(|&c| self.lookup_snippet(c).is_none())
    }

    pub fn upsert_custom(&mut self, mut fmt: CustomFormat) -> Result<char, String> {
        let key = fmt.item_key.to_ascii_lowercase();
        if !key.is_ascii_lowercase() {
            return Err("按键必须是 a-z 小写字母。".to_owned());
        }
        if fmt.label.trim().is_empty() {
            return Err("格式名称不能为空。".to_owned());
        }
        if fmt.latex_template.trim().is_empty() {
            if matches!(fmt.layout, LayoutKind::Linear) {
                return Err("LaTeX 模板不能为空（如 \\binom{$1}{$2}）。".to_owned());
            }
            // Env 布局不使用模板，缺省补一个无害占位
            fmt.latex_template = "$1".to_owned();
        }
        // 层级一 schema 校验：布局与 autoJoin 必须与 roles 自洽，错误提前到保存时暴露
        match &fmt.layout {
            LayoutKind::Linear => {}
            LayoutKind::Env { env, cols } => {
                let env = env.trim().to_owned();
                if env.is_empty() || !env.chars().all(|c| c.is_ascii_alphabetic()) {
                    return Err("env 环境名必须为非空 ASCII 字母（如 pmatrix）。".to_owned());
                }
                if *cols == 0 || fmt.slot_roles.is_empty() || fmt.slot_roles.len() % cols != 0 {
                    return Err(
                        "env 布局要求槽位数量为列数的整数倍（roles = 行数 × cols）。".to_owned()
                    );
                }
                fmt.layout = LayoutKind::Env { env, cols: *cols };
            }
        }
        if let Some(j) = &fmt.auto_join {
            if j.base_slot >= fmt.slot_roles.len() || j.cond_slot >= fmt.slot_roles.len() {
                return Err("autoJoin 的槽位下标超出 roles 范围（下标从 0 开始）。".to_owned());
            }
            if j.base_slot == j.cond_slot {
                return Err("autoJoin 的 base 与 cond 不能是同一槽位。".to_owned());
            }
            if j.macro_tex.trim().is_empty() {
                return Err("autoJoin 的 macro 不能为空（如 \\\\to）。".to_owned());
            }
        }
        fmt.item_key = key;
        fmt.label = fmt.label.trim().to_owned();
        if fmt.glyph_hint.trim().is_empty() {
            fmt.glyph_hint = format!("${}槽", fmt.slot_roles.len());
        }
        if fmt.scheme_a_name.trim().is_empty() {
            fmt.scheme_a_name = format!("k_{key}");
        }
        if let Some(existing) = self.custom_formats.iter_mut().find(|f| f.item_key == key) {
            *existing = fmt;
        } else {
            self.custom_formats.push(fmt);
            self.custom_formats.sort_by_key(|f| f.item_key);
        }
        Ok(key)
    }

    pub fn remove_custom(&mut self, key: char) -> bool {
        let k = key.to_ascii_lowercase();
        let before = self.custom_formats.len();
        self.custom_formats.retain(|f| f.item_key != k);
        self.custom_formats.len() < before
    }

    pub fn upsert_snippet(&mut self, mut snippet: FormulaSnippet) -> Result<char, String> {
        let key = snippet.item_key.to_ascii_lowercase();
        if !key.is_ascii_lowercase() {
            return Err("片段按键必须是 a-z 小写字母。".to_owned());
        }
        if snippet.stream_source.trim().is_empty() {
            return Err("要保存的公式片段内容不能为空。".to_owned());
        }
        snippet.item_key = key;
        if snippet.label.trim().is_empty() {
            snippet.label = format!("片段 {key}");
        } else {
            snippet.label = snippet.label.trim().to_owned();
        }
        if let Some(existing) = self.snippets.iter_mut().find(|s| s.item_key == key) {
            *existing = snippet;
        } else {
            self.snippets.push(snippet);
            self.snippets.sort_by_key(|s| s.item_key);
        }
        Ok(key)
    }

    pub fn add_snippet_auto(&mut self, label: String, stream_source: String) -> Result<char, String> {
        let Some(key) = self.next_free_snippet_key() else {
            return Err("片段库 a-z (26 个槽位) 已满，请先删除不再使用的旧片段。".to_owned());
        };
        self.upsert_snippet(FormulaSnippet {
            item_key: key,
            label,
            stream_source,
        })
    }

    pub fn remove_snippet(&mut self, key: char) -> bool {
        let k = key.to_ascii_lowercase();
        let before = self.snippets.len();
        self.snippets.retain(|s| s.item_key != k);
        self.snippets.len() < before
    }

    pub fn to_json_pretty(&self) -> String {
        let mut out = String::from("{\n  \"customFormats\": [\n");
        for (idx, f) in self.custom_formats.iter().enumerate() {
            if idx > 0 {
                out.push_str(",\n");
            }
            let roles_json: Vec<String> = f.slot_roles.iter().map(|r| escape_json_str(r)).collect();
            // 层级一扩展字段：仅非默认值时写出，保持旧配置文件格式不变
            let mut extra = String::new();
            if let LayoutKind::Env { env, cols } = &f.layout {
                extra.push_str(&format!(
                    ", \"kind\": \"env\", \"env\": {}, \"cols\": {}",
                    escape_json_str(env),
                    cols
                ));
            }
            if let Some(j) = &f.auto_join {
                extra.push_str(&format!(
                    ", \"autoJoin\": {{\"base\": {}, \"cond\": {}, \"macro\": {}}}",
                    j.base_slot,
                    j.cond_slot,
                    escape_json_str(&j.macro_tex)
                ));
            }
            out.push_str(&format!(
                "    {{\"key\": {}, \"label\": {}, \"glyph\": {}, \"roles\": [{}], \"latex\": {}, \"schemeA\": {}{extra}}}",
                escape_json_str(&f.item_key.to_string()),
                escape_json_str(&f.label),
                escape_json_str(&f.glyph_hint),
                roles_json.join(", "),
                escape_json_str(&f.latex_template),
                escape_json_str(&f.scheme_a_name),
            ));
        }
        out.push_str("\n  ],\n  \"snippets\": [\n");
        for (idx, s) in self.snippets.iter().enumerate() {
            if idx > 0 {
                out.push_str(",\n");
            }
            out.push_str(&format!(
                "    {{\"key\": {}, \"label\": {}, \"source\": {}}}",
                escape_json_str(&s.item_key.to_string()),
                escape_json_str(&s.label),
                escape_json_str(&s.stream_source),
            ));
        }
        out.push_str("\n  ]\n}\n");
        out
    }

    pub fn from_json(json: &str) -> Result<Self, String> {
        let val = JsonParser::parse_str(json)?;
        let JsonVal::Obj(entries) = val else {
            return Err("顶层配置必须是 JSON 对象".to_owned());
        };

        let mut custom_formats = Vec::new();
        let mut snippets = Vec::new();

        let custom_arr = find_field(&entries, "customFormats")
            .or_else(|| find_field(&entries, "custom_formats"));
        if let Some(JsonVal::Arr(arr)) = custom_arr {
            for item in arr {
                if let JsonVal::Obj(obj) = item {
                    let Some(key_s) = get_str(obj, "key").or_else(|| get_str(obj, "item_key"))
                    else {
                        continue;
                    };
                    let Some(ch) = key_s.chars().next().filter(|c| c.is_ascii_lowercase()) else {
                        continue;
                    };
                    let label = get_str(obj, "label")
                        .or_else(|| get_str(obj, "name"))
                        .unwrap_or("自定义")
                        .to_owned();
                    let glyph_hint = get_str(obj, "glyph")
                        .or_else(|| get_str(obj, "glyph_hint"))
                        .unwrap_or("")
                        .to_owned();
                    let latex_template = get_str(obj, "latex")
                        .or_else(|| get_str(obj, "latex_template"))
                        .unwrap_or("$1")
                        .to_owned();
                    let scheme_a_name = get_str(obj, "schemeA")
                        .or_else(|| get_str(obj, "scheme_a_name"))
                        .unwrap_or("custom")
                        .to_owned();
                    let mut slot_roles = Vec::new();
                    let roles_val =
                        find_field(obj, "roles").or_else(|| find_field(obj, "slot_roles"));
                    if let Some(JsonVal::Arr(r_arr)) = roles_val {
                        for r in r_arr {
                            if let JsonVal::Str(s) = r {
                                slot_roles.push(s.clone());
                            }
                        }
                    }
                    // 层级一扩展字段（可选，缺省 = 线性布局、无 autoJoin）
                    let layout = if get_str(obj, "kind") == Some("env") {
                        let env = get_str(obj, "env").unwrap_or("pmatrix").to_owned();
                        let cols = match find_field(obj, "cols") {
                            Some(JsonVal::Num(n)) => *n as usize,
                            _ => 2,
                        };
                        LayoutKind::Env { env, cols }
                    } else {
                        LayoutKind::Linear
                    };
                    let auto_join = find_field(obj, "autoJoin").and_then(|v| {
                        if let JsonVal::Obj(fields) = v {
                            let base = match find_field(fields, "base") {
                                Some(JsonVal::Num(n)) => *n as usize,
                                _ => return None,
                            };
                            let cond = match find_field(fields, "cond") {
                                Some(JsonVal::Num(n)) => *n as usize,
                                _ => return None,
                            };
                            let macro_tex = get_str(fields, "macro")?.to_owned();
                            Some(AutoJoin {
                                base_slot: base,
                                cond_slot: cond,
                                macro_tex,
                            })
                        } else {
                            None
                        }
                    });
                    custom_formats.push(CustomFormat {
                        item_key: ch,
                        label,
                        glyph_hint,
                        slot_roles,
                        latex_template,
                        scheme_a_name,
                        layout,
                        auto_join,
                    });
                }
            }
        }

        if let Some(JsonVal::Arr(arr)) = find_field(&entries, "snippets") {
            for item in arr {
                if let JsonVal::Obj(obj) = item {
                    let Some(key_s) = get_str(obj, "key").or_else(|| get_str(obj, "item_key"))
                    else {
                        continue;
                    };
                    let Some(ch) = key_s.chars().next().filter(|c| c.is_ascii_lowercase()) else {
                        continue;
                    };
                    let label = get_str(obj, "label")
                        .or_else(|| get_str(obj, "name"))
                        .unwrap_or("片段")
                        .to_owned();
                    let stream_source = get_str(obj, "source")
                        .or_else(|| get_str(obj, "stream_source"))
                        .unwrap_or("")
                        .to_owned();
                    if !stream_source.is_empty() {
                        snippets.push(FormulaSnippet {
                            item_key: ch,
                            label,
                            stream_source,
                        });
                    }
                }
            }
        }

        custom_formats.sort_by_key(|f| f.item_key);
        snippets.sort_by_key(|s| s.item_key);
        Ok(Self {
            custom_formats,
            snippets,
        })
    }
}

pub fn expand_numbered_placeholders(template: &str, slots: &[String]) -> String {
    let chars: Vec<char> = template.chars().collect();
    let mut out = String::with_capacity(template.len() + 16);
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '$' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit() {
            let mut j = i + 1;
            let mut num: usize = 0;
            while j < chars.len() && chars[j].is_ascii_digit() {
                num = num.saturating_mul(10) + (chars[j] as usize - '0' as usize);
                j += 1;
            }
            if num >= 1 {
                if let Some(val) = slots.get(num - 1) {
                    out.push_str(val);
                    i = j;
                    continue;
                }
                // 越界占位符（模板引用了不存在的槽位）：替换为空槽占位符，
                // 避免把 "$3" 原样漏进最终 LaTeX
                out.push_str(crate::scheme_a::EMPTY_PLACEHOLDER);
                i = j;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

pub fn escape_json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

// ===========================================================================
// 极简零依赖安全 JSON 解析器（专供加载用户配置与模板库）
// ===========================================================================

enum JsonVal {
    Null,
    Bool,
    Num(u64),
    Str(String),
    Arr(Vec<JsonVal>),
    Obj(Vec<(String, JsonVal)>),
}

fn find_field<'a>(entries: &'a [(String, JsonVal)], key: &str) -> Option<&'a JsonVal> {
    entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

fn get_str<'a>(entries: &'a [(String, JsonVal)], key: &str) -> Option<&'a str> {
    match find_field(entries, key) {
        Some(JsonVal::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

struct JsonParser {
    chars: Vec<char>,
    pos: usize,
    depth: usize,
}

/// JSON 嵌套递归深度上限：防止数千层 `[[[[` 输入打爆调用栈
const MAX_JSON_DEPTH: usize = 128;

impl JsonParser {
    fn parse_str(input: &str) -> Result<JsonVal, String> {
        let mut p = Self {
            chars: input.chars().collect(),
            pos: 0,
            depth: 0,
        };
        p.skip_ws();
        let val = p.parse_val()?;
        p.skip_ws();
        Ok(val)
    }

    fn skip_ws(&mut self) {
        while self.pos < self.chars.len() && self.chars[self.pos].is_whitespace() {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn parse_hex4(&mut self) -> Result<u32, String> {
        if self.pos + 4 > self.chars.len() {
            return Err("JSON \\u 转义不完整".to_owned());
        }
        let hex: String = self.chars[self.pos..self.pos + 4].iter().collect();
        self.pos += 4;
        u32::from_str_radix(&hex, 16).map_err(|_| format!("JSON \\u 十六进制非法: {hex}"))
    }

    fn parse_val(&mut self) -> Result<JsonVal, String> {
        self.skip_ws();
        let Some(c) = self.peek() else {
            return Err("JSON 意外结束".to_owned());
        };
        if matches!(c, '{' | '[') {
            if self.depth >= MAX_JSON_DEPTH {
                return Err("JSON 嵌套深度超出上限".to_owned());
            }
            self.depth += 1;
            let r = if c == '{' {
                self.parse_obj()
            } else {
                self.parse_arr()
            };
            self.depth -= 1;
            return r;
        }
        match c {
            '"' => Ok(JsonVal::Str(self.parse_string()?)),
            't' | 'f' => {
                while self.pos < self.chars.len() && self.chars[self.pos].is_ascii_alphabetic() {
                    self.pos += 1;
                }
                Ok(JsonVal::Bool)
            }
            'n' => {
                while self.pos < self.chars.len() && self.chars[self.pos].is_ascii_alphabetic() {
                    self.pos += 1;
                }
                Ok(JsonVal::Null)
            }
            '-' | '0'..='9' => {
                let num_start = self.pos;
                while self.pos < self.chars.len()
                    && matches!(
                        self.chars[self.pos],
                        '-' | '+' | '.' | 'e' | 'E' | '0'..='9'
                    )
                {
                    self.pos += 1;
                }
                let num_str: String = self.chars[num_start..self.pos].iter().collect();
                Ok(JsonVal::Num(
                    num_str
                        .parse::<f64>()
                        .map(|f| f.max(0.0) as u64)
                        .unwrap_or(0),
                ))
            }
            other => Err(format!("非法 JSON 字符 `{other}`")),
        }
    }

    fn parse_obj(&mut self) -> Result<JsonVal, String> {
        self.pos += 1; // '{'
        self.skip_ws();
        let mut out = Vec::new();
        if self.peek() == Some('}') {
            self.pos += 1;
            return Ok(JsonVal::Obj(out));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some('"') {
                return Err("JSON 对象键名必须是字符串".to_owned());
            }
            let key = self.parse_string()?;
            self.skip_ws();
            if self.peek() != Some(':') {
                return Err("JSON 对象缺少 `:`".to_owned());
            }
            self.pos += 1;
            let val = self.parse_val()?;
            out.push((key, val));
            self.skip_ws();
            match self.peek() {
                Some(',') => {
                    self.pos += 1;
                }
                Some('}') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err("JSON 对象未正常闭合".to_owned()),
            }
        }
        Ok(JsonVal::Obj(out))
    }

    fn parse_arr(&mut self) -> Result<JsonVal, String> {
        self.pos += 1; // '['
        self.skip_ws();
        let mut out = Vec::new();
        if self.peek() == Some(']') {
            self.pos += 1;
            return Ok(JsonVal::Arr(out));
        }
        loop {
            let val = self.parse_val()?;
            out.push(val);
            self.skip_ws();
            match self.peek() {
                Some(',') => {
                    self.pos += 1;
                }
                Some(']') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err("JSON 数组未正常闭合".to_owned()),
            }
        }
        Ok(JsonVal::Arr(out))
    }

    fn parse_string(&mut self) -> Result<String, String> {
        self.pos += 1; // '"'
        let mut out = String::new();
        while self.pos < self.chars.len() {
            let ch = self.chars[self.pos];
            self.pos += 1;
            match ch {
                '"' => return Ok(out),
                '\\' => {
                    let Some(esc) = self.peek() else {
                        return Err("字符串转义未完成".to_owned());
                    };
                    self.pos += 1;
                    match esc {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'b' => out.push('\u{0008}'),
                        'f' => out.push('\u{000c}'),
                        'u' => {
                            let code = self.parse_hex4()?;
                            // 代理对：高代理后必须紧跟 \uDC00-\uDFFF 才能合并为真实字符
                            if (0xD800..=0xDBFF).contains(&code) {
                                if self.pos + 1 < self.chars.len()
                                    && self.chars[self.pos] == '\\'
                                    && self.chars[self.pos + 1] == 'u'
                                {
                                    self.pos += 2;
                                    let low = self.parse_hex4()?;
                                    if !(0xDC00..=0xDFFF).contains(&low) {
                                        return Err("JSON 代理对低半区非法".to_owned());
                                    }
                                    let combined = 0x10000
                                        + ((code - 0xD800) << 10)
                                        + (low - 0xDC00);
                                    out.push(
                                        char::from_u32(combined)
                                            .ok_or("JSON 代理对合并后码点非法")?,
                                    );
                                } else {
                                    return Err("JSON 高代理缺少低半区".to_owned());
                                }
                            } else if (0xDC00..=0xDFFF).contains(&code) {
                                return Err("JSON 出现孤立低代理".to_owned());
                            } else {
                                out.push(char::from_u32(code).ok_or("JSON \\u 码点非法")?);
                            }
                        }
                        other => out.push(other),
                    }
                }
                other => out.push(other),
            }
        }
        Err("JSON 字符串缺少闭合引号".to_owned())
    }
}
