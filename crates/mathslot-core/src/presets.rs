//! MathSlot 经典公式库 (Preset Formula Corpus)
//!
//! 涵盖微积分、线性代数、概率统计、大学物理、复变函数、离散数学 6 大核心学科，
//! 收录 60+ 项经典权威公式，每个公式均经过流式简码严格校验与渲染等价性测试。

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PresetFormula {
    pub category: &'static str,
    pub name: &'static str,
    pub source: &'static str,
    pub desc: &'static str,
}

pub const PRESET_LIBRARY: &[PresetFormula] = &[
    // ==========================================
    // 1. 微积分与高等数学 (Calculus & Analysis)
    // ==========================================
    PresetFormula {
        category: "微积分/高等数学",
        name: "欧拉恒等式",
        source: "▸ue;i▸gp;; + 1 = 0",
        desc: "复分析中最著名的恒等式，连接五大数学常数 e, i, π, 1, 0",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "高斯积分",
        source: "▸i-oo;oo;e^-x^2 dx;= ▸r▸gp;;",
        desc: "欧拉-泊松全空间高斯核积分，概率论与场论基石",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "微积分基本定理",
        source: "▸ia;b;f'(x) dx = ▸kgf(x);a;b; = f(b) - f(a)",
        desc: "牛顿-莱布尼茨公式，定积分与原函数的根本桥梁",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "重要极限一 (Sinc 函数)",
        source: "▸lx;0;▸fsin x;x;; = 1",
        desc: "第一重要极限，三角函数求导与信号采样基准",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "重要极限二 (自然底数 e)",
        source: "▸lx;oo;▸p1 + ▸f1;x;;;^x = e",
        desc: "第二重要极限，自然对数底 e 的极限定义式",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "泰勒级数展开式",
        source: "f(x) = ▸s0;n;▸ff^(k)(x_0);k!;(x - x_0)^k; + R_n(x)",
        desc: "光滑函数在定点局部的多项式逼近与拉格朗日余项",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "多元全微分公式",
        source: "dz = ▸cgz;x; dx + ▸cgz;y; dy",
        desc: "二元可微函数的全增量与偏导数线性组合关系",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "格林公式 (平面闭曲线)",
        source: "▸cdL;P dx + Q dy; = ▸ccD;▸p▸cgQ;x; - ▸cgP;y;;; dx dy;",
        desc: "平面闭区域二重积分与边界逆时针曲线积分的互换定理",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "斯托克斯旋度定理",
        source: "▸cdC;▸acF; * d▸acr; = ▸ccS;▸p▸od xx ▸acF;; * d▸acS;",
        desc: "三维向量场沿闭合曲线环量与曲面旋度通量的严格等价性",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "高斯散度定理",
        source: "▸ccS;▸acF; * d▸acS; = ▸ce▸gO;▸p▸od * ▸acF;; dV;",
        desc: "封闭曲面外法向通量与包围体散度体积分的转化定理",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "伽马函数欧拉积分",
        source: "▸gC(z) = ▸i0;oo;t^(z-1) e^-t dt;",
        desc: "将阶乘概念延拓至全体复数的亚纯函数积分定义",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "贝塔与伽马函数关系",
        source: "B(p, q) = ▸f▸gC(p) ▸gC(q);▸gC(p + q);",
        desc: "第一类欧拉积分与第二类欧拉积分的严格对应恒等式",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "柯西中值定理",
        source: "▸ff(b) - f(a);g(b) - g(a); = ▸ff'(▸gc);g'(▸gc);",
        desc: "拉格朗日中值定理推广形式，洛必达法则的证明基石",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "洛必达法则",
        source: "▸lx;a;▸ff(x);g(x);; = ▸lx;a;▸ff'(x);g'(x);;",
        desc: "0/0 与 ∞/∞ 不定型极限的微商转化求值法则",
    },
    PresetFormula {
        category: "微积分/高等数学",
        name: "平面曲线弧长积分",
        source: "s = ▸ia;b;▸r1 + [f'(x)]^2;; dx;",
        desc: "直角坐标系下单值连续可微曲线段的几何弧长积分",
    },

    // ==========================================
    // 2. 线性代数与矩阵分析 (Linear Algebra)
    // ==========================================
    PresetFormula {
        category: "线性代数",
        name: "一元二次方程求根公式",
        source: "x = ▸f-b +- ▸rb^2 - 4ac;;2a;",
        desc: "二次代数方程经典求根公式，根的判别式分析",
    },
    PresetFormula {
        category: "线性代数",
        name: "柯西-施瓦茨不等式",
        source: "▸p▸s1;n;a_k b_k;;^2 <= ▸p▸s1;n;a_k^2;; ▸p▸s1;n;b_k^2;;",
        desc: "内积空间核心不等式，确立向量空间夹角余弦的合法性",
    },
    PresetFormula {
        category: "线性代数",
        name: "二阶特征多项式行列式",
        source: "▸mc▸gl - a;-b;-c;▸gl - d; = 0",
        desc: "2×2 方阵特征方程，其根即为线性变换的特征值",
    },
    PresetFormula {
        category: "线性代数",
        name: "特征值与特征向量方程",
        source: "A ▸acx; = ▸gl ▸acx;",
        desc: "线性变换本征方程，刻画方向不变的伸缩线性基",
    },
    PresetFormula {
        category: "线性代数",
        name: "伴随矩阵求逆公式",
        source: "A^-1 = ▸f1;det(A); A^*",
        desc: "可逆方阵的标准代数余子式解析求逆公式",
    },
    PresetFormula {
        category: "线性代数",
        name: "矩阵奇异值分解 (SVD)",
        source: "A = U ▸gS V^T",
        desc: "任意矩阵的正交对角化分解，数据降维与伪逆求解利器",
    },
    PresetFormula {
        category: "线性代数",
        name: "3×3 单位阵",
        source: "▸mg1;0;0;0;1;0;0;0;1;",
        desc: "三维欧氏空间线性映射的恒等变换算子矩阵",
    },
    PresetFormula {
        category: "线性代数",
        name: "平面二维刚体旋转矩阵",
        source: "R(▸gt) = ▸ma cos ▸gt; -sin ▸gt; sin ▸gt; cos ▸gt;",
        desc: "笛卡尔坐标系下逆时针旋转 θ 角的正交变换矩阵",
    },
    PresetFormula {
        category: "线性代数",
        name: "向量点积与几何夹角",
        source: "▸acu; * ▸acv; = ▸af▸acu;; ▸af▸acv;; cos ▸gt",
        desc: "欧几里得空间两向量内积与几何投影模长等价式",
    },
    PresetFormula {
        category: "线性代数",
        name: "向量叉积几何模长",
        source: "▸af▸acu; xx ▸acv;; = ▸af▸acu;; ▸af▸acv;; sin ▸gt",
        desc: "三维向量外积生成平行四边形有向面积模长",
    },
    PresetFormula {
        category: "线性代数",
        name: "格拉姆-施密特正交化",
        source: "▸acb;_k = ▸aca;_k - ▸s1;k-1;▸f▸aca;_k * ▸acb;_j;▸af▸acb;_j;^2; ▸acb;_j;",
        desc: "将任意线性无关向量组构造为等价正交基的递归投影算法",
    },
    PresetFormula {
        category: "线性代数",
        name: "矩阵迹与特征值之和",
        source: "tr(A) = ▸s1;n;▸gl_i; = ▸s1;n;a_ii;",
        desc: "方阵对角线元素之和等于全体特征值之和的相似不变量",
    },

    // ==========================================
    // 3. 概率论与数理统计 (Probability & Statistics)
    // ==========================================
    PresetFormula {
        category: "概率统计",
        name: "贝叶斯后验概率公式",
        source: "P(A|B) = ▸fP(B|A) P(A);P(B);",
        desc: "贝叶斯统计推断核心，基于先验与似然更新后验概率",
    },
    PresetFormula {
        category: "概率统计",
        name: "一维高斯正态分布密度",
        source: "f(x) = ▸f1;▸r2▸gp;; ▸gs; e^-▸f(x - ▸gm)^2;2▸gs^2;;",
        desc: "经典钟形概率分布密度曲线，中心极限定理极限形式",
    },
    PresetFormula {
        category: "概率统计",
        name: "多元正态分布概率密度",
        source: "f(▸acx;) = ▸f1;(2▸gp)^(k/2) |▸gS|^(1/2); exp▸p-▸f1;2; (▸acx; - ▸ac▸gm;)^T ▸gS^-1 (▸acx; - ▸ac▸gm;);",
        desc: "k 维联合高斯概率分布，协方差矩阵与马氏距离二次型",
    },
    PresetFormula {
        category: "概率统计",
        name: "泊松分布概率分布律",
        source: "P(X = k) = ▸f▸gl^k e^-▸gl;k!;",
        desc: "单位时间或空间内小概率稀有事件发生次数的离散模型",
    },
    PresetFormula {
        category: "概率统计",
        name: "二项分布概率质量函数",
        source: "P(X = k) = ▸en;k; p^k (1 - p)^(n - k)",
        desc: "n 重独立伯努利试验中恰好成功 k 次的离散概率分布",
    },
    PresetFormula {
        category: "概率统计",
        name: "切比雪夫不等式",
        source: "P(|X - ▸gm| >= ▸ge) <= ▸f▸gs^2;▸ge^2;",
        desc: "大数定律证明基石，任意分布偏离均值概率的上界估计",
    },
    PresetFormula {
        category: "概率统计",
        name: "随机变量方差计算公式",
        source: "D(X) = E(X^2) - [E(X)]^2",
        desc: "随机变量二阶中心矩与二阶原点矩的代数化简式",
    },
    PresetFormula {
        category: "概率统计",
        name: "连续型随机变量数学期望",
        source: "E(X) = ▸i-oo;oo;x f(x) dx;",
        desc: "连续型随机变量概率加权一阶原点矩积分定义",
    },
    PresetFormula {
        category: "概率统计",
        name: "中心极限定理标准化变量",
        source: "Z_n = ▸f▸abX; - ▸gm;▸f▸gs;▸rn;;;;",
        desc: "样本均值渐近收敛于标准正态分布 N(0, 1) 的标准化构造",
    },

    // ==========================================
    // 4. 大学物理与场论 (Physics & Field Theory)
    // ==========================================
    PresetFormula {
        category: "大学物理",
        name: "麦克斯韦第一方程 (高斯电场)",
        source: "▸od * E = ▸f▸gr;▸ge_0;",
        desc: "静电场是有源场，电位移散度正比于自由电荷体密度",
    },
    PresetFormula {
        category: "大学物理",
        name: "麦克斯韦第二方程 (高斯磁场)",
        source: "▸od * B = 0",
        desc: "磁场是无源旋度场，磁力线必闭合，不存在孤立磁单极子",
    },
    PresetFormula {
        category: "大学物理",
        name: "麦克斯韦第三方程 (法拉第感应)",
        source: "▸od xx E = -▸cgB;t;",
        desc: "随时间变化的磁场激发产生涡旋电场",
    },
    PresetFormula {
        category: "大学物理",
        name: "麦克斯韦第四方程 (安培-麦克斯韦)",
        source: "▸od xx B = ▸gm_0 J + ▸gm_0 ▸ge_0 ▸cgE;t;",
        desc: "传导电流与位移电流共同激发涡旋磁场",
    },
    PresetFormula {
        category: "大学物理",
        name: "薛定谔时间依赖波动方程",
        source: "i▸ol ▸cg▸gy;t; = ▸aaH; ▸gy",
        desc: "非相对论量子力学态矢量随时间演化的动力学核心微分方程",
    },
    PresetFormula {
        category: "大学物理",
        name: "爱因斯坦质能等价公式",
        source: "E = m c^2",
        desc: "狭义相对论核心结论，静止质量与内禀静止能量严格等价",
    },
    PresetFormula {
        category: "大学物理",
        name: "相对论质能动量关系",
        source: "E^2 = (p c)^2 + (m_0 c^2)^2",
        desc: "自由相对论粒子的总能量、三维动量与静止质量的不变四维关系",
    },
    PresetFormula {
        category: "大学物理",
        name: "简谐阻尼振动微分方程",
        source: "m ▸ahx; + ▸gg ▸aex; + k x = 0",
        desc: "质点在弹性回复力与黏性阻尼力共同作用下的运动学方程",
    },
    PresetFormula {
        category: "大学物理",
        name: "热力学第一定律微分形式",
        source: "dU = T dS - P dV",
        desc: "系统内能增量、热力学温度熵增与外界做功的微分守恒形式",
    },
    PresetFormula {
        category: "大学物理",
        name: "普朗克黑体辐射能量谱",
        source: "B(▸gn, T) = ▸f2 h ▸gn^3;c^2; ▸f1;e^(▸fh ▸gn;k_B T;) - 1;",
        desc: "克服紫外灾难的量子化黑体辐射能量密度分布定律",
    },
    PresetFormula {
        category: "大学物理",
        name: "牛顿万有引力向量式",
        source: "▸acF; = -G ▸fm_1 m_2;r^2; ▸acr;_0",
        desc: "两质点间经典引力反平方定律的向量微分表达式",
    },
    PresetFormula {
        category: "大学物理",
        name: "德布罗意物质波波长",
        source: "▸gl = ▸fh;p; = ▸fh;m v;",
        desc: "微观粒子的波粒二象性假说，波长由动量唯一确定",
    },

    // ==========================================
    // 5. 复变函数与积分变换 (Complex Analysis)
    // ==========================================
    PresetFormula {
        category: "复变函数",
        name: "柯西-黎曼微分方程组",
        source: "▸cgu;x; = ▸cgv;y;, ▸cgu;y; = -▸cgv;x;",
        desc: "复变函数实部与虚部在一点处解析可微的充要条件",
    },
    PresetFormula {
        category: "复变函数",
        name: "柯西复变积分公式",
        source: "f(z_0) = ▸f1;2▸gp i; ▸cdC;▸ff(z);z - z_0; dz;",
        desc: "全纯函数内部任一点的值完全由闭合边界围道积分决定",
    },
    PresetFormula {
        category: "复变函数",
        name: "柯西留数定理",
        source: "▸cdC;f(z) dz = 2▸gp i ▸s1;n;Res(f, z_k);",
        desc: "利用孤立奇点留数之和快速计算复平面闭合围道积分",
    },
    PresetFormula {
        category: "复变函数",
        name: "连续傅里叶正变换",
        source: "F(▸go) = ▸i-oo;oo;f(t) e^(-i ▸go t) dt;",
        desc: "连续非周期时域信号向角频域复频谱的傅里叶分析分解",
    },
    PresetFormula {
        category: "复变函数",
        name: "连续傅里叶逆变换",
        source: "f(t) = ▸f1;2▸gp; ▸i-oo;oo;F(▸go) e^(i ▸go t) d▸go;",
        desc: "由频域连续频谱反演重构连续时域波形信号的综合公式",
    },
    PresetFormula {
        category: "复变函数",
        name: "单边拉普拉斯变换",
        source: "F(s) = ▸i0;oo;f(t) e^(-s t) dt;",
        desc: "控制理论与常微分方程初值问题的经典积分变换",
    },
    PresetFormula {
        category: "复变函数",
        name: "欧拉公式极坐标展开",
        source: "e^(i ▸gt) = cos ▸gt + i sin ▸gt",
        desc: "复指数函数与三角函数在复平面单位圆上的基本几何联系",
    },
    PresetFormula {
        category: "复变函数",
        name: "莫比乌斯分式变换",
        source: "w = ▸faz + b;cz + d;",
        desc: "扩充复平面保圆性与保角性的双射共形映射",
    },

    // ==========================================
    // 6. 离散数学、信息论与算法 (Discrete Math & CS)
    // ==========================================
    PresetFormula {
        category: "离散数学",
        name: "香农信息熵",
        source: "H(X) = -▸s1;n;P(x_i) log_2 P(x_i);",
        desc: "信息论基石，量化信源随机变量平均不确定度的核心度量",
    },
    PresetFormula {
        category: "离散数学",
        name: "二项式展开定理",
        source: "(x + y)^n = ▸s0;n;▸en;k; x^(n-k) y^k;",
        desc: "代数多项式高次展开定理，组合数作为二项式展开系数",
    },
    PresetFormula {
        category: "离散数学",
        name: "斯特林阶乘近似公式",
        source: "n! ~= ▸r2▸gp n;; ▸p▸fn;e;;;^n",
        desc: "大数阶乘渐近估计，统计物理与算法复杂度评估利器",
    },
    PresetFormula {
        category: "离散数学",
        name: "斐波那契通项比奈公式",
        source: "F_n = ▸f1;▸r5;;; ▸p▸p▸f1 + ▸r5;;2;;;^n - ▸p▸f1 - ▸r5;;2;;;^n;",
        desc: "二阶常系数线性递推差分方程的黄金分割比闭式解析解",
    },
    PresetFormula {
        category: "离散数学",
        name: "容斥原理三集合形式",
        source: "|A cup B cup C| = |A| + |B| + |C| - |A cap B| - |B cap C| - |A cap C| + |A cap B cap C|",
        desc: "离散组合计数中避免重叠计量的集合并基数定理",
    },
    PresetFormula {
        category: "离散数学",
        name: "分治法主定理复杂度递推式",
        source: "T(n) = a T▸p▸fn;b;;; + f(n)",
        desc: "评估分治递归算法时间复杂度的通用递推关系模型",
    },
];

/// 获取所有学科分类名称（不重复）
pub fn preset_categories() -> &'static [&'static str] {
    &[
        "全部",
        "微积分/高等数学",
        "线性代数",
        "概率统计",
        "大学物理",
        "复变函数",
        "离散数学",
    ]
}
