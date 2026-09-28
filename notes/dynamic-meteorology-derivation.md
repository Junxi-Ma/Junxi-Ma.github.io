---
title: 动力气象学 · 连续方程与热力学能量方程推导详解
date: 2026-09-28
tags: [动力气象学, 课程笔记, 推导详解]
description: 把课件 1.3-4 节两大核心推导逐行拆开补全：连续方程的拉格朗日与欧拉两种推导、热力学能量方程从第一定律到位温形式的全部跳步，多色批注标注易错点、物理意义与数学技巧。
---

# 动力气象学 · 连续方程与热力学能量方程推导详解

> 对应课件：《动力气象学》第 1 章 1.3-4 节《大气运动基本方程组及其守恒性质》第 4 节（连续方程、状态方程、热力学能量方程、水汽方程）。
> 课件把两大推导的关键中间步骤压缩得很厉害，本笔记按课件原有逻辑逐行补全跳步。**多色批注约定**：<span class="mk-red">■ 红＝易错点 / 符号陷阱</span>，<span class="mk-blue">■ 蓝＝物理意义 / 直观图像</span>，<span class="mk-green">■ 绿＝关键结论 / 最终方程</span>，<span class="mk-purple">■ 紫＝数学技巧 / 操作说明</span>，<span class="mk-orange">■ 橙＝对应课件 / 补充说明</span>。

## 0 · 为什么要补这两个方程

课件第 27 页给出了不计摩擦的矢量运动方程：

$$\frac{d\vec{V}_3}{dt}=-\frac{1}{\rho}\nabla_3 p-2\vec{\Omega}\times\vec{V}_3+\tilde{g}+\vec{F}$$

在笛卡尔坐标系里展开成标量形式，是 3 个方程；但未知数有 $u,\ v,\ w,\ p,\ \rho$ 共 5 个——**方程组不闭合**，解不出来。

<div class="mk-box mk-box--why">

**缺口的本质**：运动方程只约束"动量"（牛顿第二定律）。对一块空气，我们还欠两条守恒律——**质量守恒**与**能量守恒**：前者给出**连续方程**，后者给出**热力学能量方程**；再配上联系 $p,\rho,T$ 的**状态方程**，未知数与方程数才配平（见 2.8 节拼回方程组）。

</div>

## 1 · 连续方程：质量守恒的两种「翻译」

同一条质量守恒定律，站在两个观察立场上，会得到两个"长得不一样"的方程：

| 观察立场 | 盯着谁看 | 不变的量 | 变的量 | 得到的形式 |
| --- | --- | --- | --- | --- |
| **拉格朗日** | 跟着一块空气跑 | 质量 $\delta m$ | 体积 $\delta\tau$、密度 $\rho$ | $\frac{1}{\rho}\frac{d\rho}{dt}+\nabla_3\cdot\vec{V}_3=0$ |
| **欧拉** | 盯着一块固定空间 | 体积 $\delta x\,\delta y\,\delta z$ | 体积内的质量、密度 | $\frac{\partial\rho}{\partial t}+\nabla_3\cdot(\rho\vec{V}_3)=0$ |

### 1.1 方法一：拉格朗日法——跟着微团跑

<span class="mk-orange">（课件第 29–31 页）</span>

**出发点**：取一个具有固定质量 $\delta m$ 的**物质体积元**（空气微团），三条边长 $\delta x,\delta y,\delta z$，体积 $\delta\tau=\delta x\,\delta y\,\delta z$，则

$$\delta m=\rho\,\delta\tau=\rho\,\delta x\,\delta y\,\delta z$$

<div class="mk-box mk-box--warn">

**符号陷阱**：这里的 $\delta$ **不是微分、也不是变分**，只是"物质体积元"的记号——$\delta x$ 是贴在微团上的一条**物质边**，随微团一起平移、转动、变形，所以它是时间 $t$ 的函数；$\delta\tau$ 是这块空气的体积，同样随流变化。于是 $d(\delta\tau)/dt$ 读作"**这块**物质体积元的体积随时间的变化率"，是一个完全正常的随体导数。

</div>

**第 1 步 · 写下质量守恒**：微团在运动中质量不变（课件："由于物质体积元在运动中守恒"）：

$$\frac{d(\delta m)}{dt}=0$$

**第 2 步 · 乘积法则展开**：$\delta m=\rho\,\delta\tau$ 中，$\rho$ 与 $\delta\tau$ **都在变**，乘积求导：

$$\frac{d(\rho\,\delta\tau)}{dt}=\rho\frac{d(\delta\tau)}{dt}+\delta\tau\frac{d\rho}{dt}=0$$

两边同除以 $\rho\,\delta\tau$（课件第 29 页直接给出结果）：

$$\frac{1}{\rho}\frac{d\rho}{dt}+\frac{1}{\delta\tau}\frac{d(\delta\tau)}{dt}=0 \tag{1}$$

**第 3 步 · 体积变化率分解**（课件"又"）：$\delta\tau=\delta x\,\delta y\,\delta z$ 是三条边长的乘积，再 用一次乘积法则并除以自身（等价于取对数求导）：

$$\frac{1}{\delta\tau}\frac{d(\delta\tau)}{dt}=\frac{1}{\delta x}\frac{d(\delta x)}{dt}+\frac{1}{\delta y}\frac{d(\delta y)}{dt}+\frac{1}{\delta z}\frac{d(\delta z)}{dt} \tag{2}$$

<span class="mk-purple">**数学技巧**：这就是 $(abc)'=a'bc+ab'c+abc'$ 两边除以 $abc$ 的结果——**总体积的相对膨胀率 ＝ 三个方向边长相对变化率之和**。</span>

**第 4 步 · 核心跳步：$d(\delta x)/dt$ 到底是什么？**<span class="mk-orange">（课件第 30 页只说了一句"交换 $d$ 和 $\delta$ 的运算顺序"）</span>

<div class="mk-box mk-box--tip">

**"交换 d 与 δ"在说什么**：$\dfrac{d(\delta x)}{dt}$ 是微团 $x$ 方向**边长的变化率**。边长由两个端面（物质面）的位置决定，两个端面各按**所在位置的速度**移动，所以

$$\frac{d(\delta x)}{dt}=\delta\!\left(\frac{dx}{dt}\right)=\delta u$$

即"**边长变化率 ＝ 两端面速度之差**"。这就是"交换运算顺序"的严格含义：$d/dt$（跟随物质点求导）与 $\delta$（两点取差）都是线性运算，可以交换先后——先各自求随体导数再作差，等于先作差再求导。

</div>

微团内部速度沿 $x$ 连续变化，两端面的速度用中心处速度 $u$ 的一阶泰勒展开表示：

<div class="dg">
<div class="dg__row">
<div class="dg__face">A 面（后端）<br>$u-\dfrac{\partial u}{\partial x}\dfrac{\delta x}{2}$</div>
<div class="dg__arrow">⟶</div>
<div class="dg__body">空气微团<br>厚度 $\delta x$</div>
<div class="dg__arrow">⟶</div>
<div class="dg__face">B 面（前端）<br>$u+\dfrac{\partial u}{\partial x}\dfrac{\delta x}{2}$</div>
</div>
<p class="dg__cap">两端速度不同 → 边长被拉伸或压缩：$d(\delta x)/dt = u_B - u_A$</p>
</div>

**第 5 步 · 取极限**：把两端速度差写成导数形式：

$$\frac{d(\delta x)}{dt}=\delta u=\left(u+\frac{\partial u}{\partial x}\frac{\delta x}{2}\right)-\left(u-\frac{\partial u}{\partial x}\frac{\delta x}{2}\right)=\frac{\partial u}{\partial x}\,\delta x$$

于是（课件第 30 页的极限式）：

$$\lim_{\delta x\to 0}\frac{1}{\delta x}\frac{d(\delta x)}{dt}=\frac{\partial u}{\partial x}$$

$y$、$z$ 方向完全同理（$\dfrac{d(\delta y)}{dt}=\dfrac{\partial v}{\partial y}\delta y$，$\dfrac{d(\delta z)}{dt}=\dfrac{\partial w}{\partial z}\delta z$）。代回 (1)(2)：

$$\frac{1}{\rho}\frac{d\rho}{dt}+\frac{\partial u}{\partial x}+\frac{\partial v}{\partial y}+\frac{\partial w}{\partial z}=0$$

<div class="mk-box mk-box--key">

**结论（连续方程 · 拉格朗日形式）**

$$\boxed{\ \frac{1}{\rho}\frac{d\rho}{dt}+\nabla_3\cdot\vec{V}_3=0\ }\qquad\Longleftrightarrow\qquad \frac{d\rho}{dt}+\rho\,\nabla_3\cdot\vec{V}_3=0$$

</div>

**物理意义**（课件第 31 页）：把上式与 (1) 对比读出

$$\nabla_3\cdot\vec{V}_3=\frac{1}{\delta\tau}\frac{d(\delta\tau)}{dt}=-\frac{1}{\rho}\frac{d\rho}{dt}$$

<span class="mk-blue">**速度散度 ＝ 体积的相对膨胀率 ＝ 密度的相对减少率**——这是散度最深刻的几何解读：</span>

| 速度散度 | 名称 | 体积怎么变 | 密度怎么变 |
| --- | --- | --- | --- |
| $\nabla_3\cdot\vec{V}_3>0$ | 辐散 | 膨胀 | 减小 |
| $\nabla_3\cdot\vec{V}_3<0$ | 辐合 | 缩小 | 增大 |
| $\nabla_3\cdot\vec{V}_3=0$ | 无辐散 | 不变 | 不变 |

### 1.2 方法二：欧拉法——守着固定空间看流量

<span class="mk-orange">（课件第 32–34 页）</span>

**出发点**：在空间中划一个**固定不动**的长方体体积元 $\delta x\,\delta y\,\delta z$，中心在 $O(x,y,z)$。质量守恒这回翻译成"收支平衡"：

<div class="mk-box mk-box--why">

**体积元内的质量变化率 ＝ 质量净流入率（流入 − 流出）**

观察立场变了：这次盯的是**同一块空间**——体积 $\delta x\,\delta y\,\delta z$ 是常量，变的只有里面充满的空气的密度 $\rho$。所以左边对时间的导数是**偏导** $\partial\rho/\partial t$（固定点的局地变化率），而拉格朗日法里用的是**随体导数** $d\rho/dt$。

</div>

**x 方向收支**：先定义 $x$ 方向的**质量通量** $\rho u$——单位时间自左向右穿过单位面积的质量（＝密度 × 速度；乘上面积才是真正的流量）。

- **A 面**（位于 $x-\frac{\delta x}{2}$）：流入率 ＝ 面上通量 × 面积 $=\left[\rho u-\frac{\partial(\rho u)}{\partial x}\frac{\delta x}{2}\right]\delta y\,\delta z$
- **B 面**（位于 $x+\frac{\delta x}{2}$）：流出率 $=\left[\rho u+\frac{\partial(\rho u)}{\partial x}\frac{\delta x}{2}\right]\delta y\,\delta z$

（两处都把面上的值用以中心 $O$ 点的 $\rho u$ 作一阶泰勒展开。）

<div class="dg">
<div class="dg__row">
<div class="dg__face dg__face--in">A 面流入<br>$\left[\rho u-\dfrac{\partial(\rho u)}{\partial x}\dfrac{\delta x}{2}\right]\delta y\,\delta z$</div>
<div class="dg__arrow">⟶</div>
<div class="dg__body">固定体积元<br>$\delta x\,\delta y\,\delta z$<br>（位置不动）</div>
<div class="dg__arrow">⟶</div>
<div class="dg__face dg__face--out">B 面流出<br>$\left[\rho u+\dfrac{\partial(\rho u)}{\partial x}\dfrac{\delta x}{2}\right]\delta y\,\delta z$</div>
</div>
<p class="dg__cap">净流入率 ＝ 流入 − 流出 ＝ $-\dfrac{\partial(\rho u)}{\partial x}\,\delta x\,\delta y\,\delta z$</p>
</div>

<div class="mk-box mk-box--tip">

**为什么敢只展开到一阶**：体积元是"微元"，$(\delta x)^2$ 及更高阶是小量中的小量；两个面相减时，两边**相同的零阶项 $\rho u$ 直接抵消**，恰好留下含一阶导数的项——泰勒展开取到一阶刚刚好，少了不准、多了浪费。

</div>

x 方向净流入率：

$$\left[\rho u-\frac{\partial(\rho u)}{\partial x}\frac{\delta x}{2}\right]\delta y\,\delta z-\left[\rho u+\frac{\partial(\rho u)}{\partial x}\frac{\delta x}{2}\right]\delta y\,\delta z=-\frac{\partial(\rho u)}{\partial x}\,\delta x\,\delta y\,\delta z$$

$y$、$z$ 方向完全同理。三个方向求和（课件第 33 页）：

$$\frac{\partial(\rho\,\delta x\,\delta y\,\delta z)}{\partial t}=-\left[\frac{\partial(\rho u)}{\partial x}+\frac{\partial(\rho v)}{\partial y}+\frac{\partial(\rho w)}{\partial z}\right]\delta x\,\delta y\,\delta z$$

体积固定，$\delta x\,\delta y\,\delta z$ 可约去：

<div class="mk-box mk-box--key">

**结论（连续方程 · 欧拉形式 / 通量形式）**

$$\boxed{\ \frac{\partial\rho}{\partial t}=-\nabla_3\cdot(\rho\,\vec{V}_3)\ }\qquad\Longleftrightarrow\qquad \frac{\partial\rho}{\partial t}+\nabla_3\cdot(\rho\,\vec{V}_3)=0$$

</div>

**物理意义**（课件第 34 页）：固定体积元处，有净质量流入（$-\nabla_3\cdot(\rho\vec{V}_3)>0$）则 $\partial\rho/\partial t>0$，密度增大；净流出则减小。<span class="mk-blue">散度在这里是"质量通量的净流出强度"，在拉格朗日形式里是"体积膨胀率"——同一个算子的两副面孔。</span>

### 1.3 殊途同归：两种形式等价

把欧拉形式的 $\nabla_3\cdot(\rho\vec{V}_3)$ 用乘积法则展开：

$$\frac{\partial\rho}{\partial t}+\nabla_3\cdot(\rho\,\vec{V}_3)=\underbrace{\frac{\partial\rho}{\partial t}+\vec{V}_3\cdot\nabla_3\rho}_{=\ d\rho/dt}+\rho\,\nabla_3\cdot\vec{V}_3=0$$

与拉格朗日形式**一字不差**。<span class="mk-orange">课件没有点破这一步：两式不是"两个方程"，是同一个方程的两种写法，桥梁正是随体导数公式 $d/dt=\partial/\partial t+\vec{V}_3\cdot\nabla_3$。</span>

### 1.4 顺路备料：状态方程

<span class="mk-orange">（课件第 36 页；推导热力学能量方程的"定压形式"要用）</span>

$$p=\rho RT,\qquad R=287\ \mathrm{J/(K\cdot kg)}$$

考虑水汽时用虚温修正：$T_v=(1+0.61q)T$，$p=\rho RT_v$，其中 $q$ 为比湿。

## 2 · 热力学能量方程：能量守恒的大气版

### 2.1 出发点：第一定律的「动力气象版」

<span class="mk-orange">（课件第 38 页）</span>

教科书式的热力学第一定律：封闭系统内能的变化 ＝ 获得的热量 − 对外做的功。但课件事先泼了一盆冷水：

<div class="mk-box mk-box--warn">

**大气微团不是热力平衡系统**：它时刻在运动之中，第一定律**不能不加说明地直接套用**。解决办法是把第一定律理解为普遍的**能量守恒与转化定律**，把微团的瞬时能量写成"内能 ＋ 宏观动能"，重新表述为：

**物质体积元中总的热力学能量（内能与动能）随时间的变化率 ＝ 外源加热率 ＋ 外界对它做功的功率之和。**

</div>

### 2.2 左边：微团的能量变化率

用 $I$ 表示单位质量空气的内能（后面会看到，理想气体时 $I=c_vT$），单位质量动能为 $\vec{V}_3\cdot\vec{V}_3/2$。密度 $\rho$、体积 $\delta\tau$ 的空气微团，总能量为

$$\left(I+\frac{\vec{V}_3\cdot\vec{V}_3}{2}\right)\rho\,\delta\tau$$

<span class="mk-purple">**数学技巧（课件第 41 页一笔带过，却是全篇最关键的一步）**：刚推好的连续方程说 $d(\rho\,\delta\tau)/dt=0$——微团质量不变。于是 $d/dt$ 可以"穿过" $\rho\,\delta\tau$，直接作用在**单位质量**的能量上。质量守恒在这里第二次登场：</span>

$$\frac{d}{dt}\left[\left(I+\frac{\vec{V}_3\cdot\vec{V}_3}{2}\right)\rho\,\delta\tau\right]=\rho\,\delta\tau\,\frac{d}{dt}\left(I+\frac{\vec{V}_3\cdot\vec{V}_3}{2}\right)$$

### 2.3 右边①：压力做功（最详细的支出项）

<span class="mk-orange">（课件第 39–40 页）</span>

压强垂直于表面，做功功率 ＝ 压力 × 面速度。看 $x$ 方向的一对面（$yz$ 平面，面积 $\delta y\,\delta z$）：

- **A 面**（$x-\frac{\delta x}{2}$）：外界空气以力 $p\,\delta y\,\delta z$ **推**微团（沿 $+x$），面速度为 $u$ → 对微团做功功率 $+(pu)_A\,\delta y\,\delta z$
- **B 面**（$x+\frac{\delta x}{2}$）：微团向前推挤外界（受反作用力沿 $-x$）→ 对微团做功功率 $-(pu)_B\,\delta y\,\delta z$

以中心 $O$ 处的 $pu$ 为基准作一阶泰勒展开（<span class="mk-orange">课件第 39 页以 A 面为基准展开，两者等价</span>）：

$$(pu)_A=(pu)-\frac{\partial(pu)}{\partial x}\frac{\delta x}{2},\qquad (pu)_B=(pu)+\frac{\partial(pu)}{\partial x}\frac{\delta x}{2}$$

$x$ 方向净功率：

$$(pu)_A\,\delta y\,\delta z-(pu)_B\,\delta y\,\delta z=-\frac{\partial(pu)}{\partial x}\,\delta x\,\delta y\,\delta z$$

<div class="mk-box mk-box--warn">

**符号陷阱**：这里的 $pu$ 是**压强 × 速度**的做功通量（W/m²），别与 1.2 节连续方程里的**质量**通量 $\rho u$ 混淆——课件板书里两者都写作"pu"，全靠上下文区分。

</div>

$y$、$z$ 方向完全类似，三对面的功率相加，压力做功总功率为 $-\nabla_3\cdot(p\vec{V}_3)\,\delta\tau$。

<div class="mk-box mk-box--warn">

**最易混淆的一对符号**：$-\nabla_3\cdot(p\vec{V}_3)$ 是压力对**总能量**的做功率（通量形式）；而气压梯度力对**动能**的功率是 $-\frac{1}{\rho}\vec{V}_3\cdot\nabla_3 p$。两者相差

$$-\nabla_3\cdot(p\vec{V}_3)+\vec{V}_3\cdot\nabla_3 p=-p\,\nabla_3\cdot\vec{V}_3$$

这一项 $-p\,\nabla_3\cdot\vec{V}_3$ 正是**压缩/膨胀功**——它改变内能而不改变动能，是 2.6 节"减账"的主角。

</div>

### 2.4 右边②③④⑤：重力、科氏力、黏性、加热

- **重力**：做功功率 $\vec{V}_3\cdot\tilde{g}\,\rho\,\delta\tau$。<span class="mk-blue">上升时 $\vec{V}_3\cdot\tilde{g}<0$，重力做负功（摘走动能）。</span>
- **科氏力**：$\vec{V}_3\cdot(-2\vec{\Omega}\times\vec{V}_3)\rho\,\delta\tau=0$，因为科氏力恒垂直于速度。<span class="mk-blue">科氏力只拐弯、不做功——它改变风向但绝不改变风速大小，这就是它作为"虚拟力"的动力学含义。</span>
- **分子黏性应力**：<span class="mk-orange">大气是低黏流体，课件宣布"一般都将其略去"，本推导同样略去。</span>
- **加热**：$\dot{Q}$ 为外界对单位质量空气的加热率（辐射、传导、潜热释放等），总加热 $\dot{Q}\,\rho\,\delta\tau$。

### 2.5 合账：总能量方程

<span class="mk-orange">（课件第 40–41 页）</span>把 2.2 的左边与 2.3–2.4 的右边合起来（能量守恒）：

$$\frac{d}{dt}\left[\left(I+\frac{\vec{V}_3\cdot\vec{V}_3}{2}\right)\rho\,\delta\tau\right]=-\nabla_3\cdot(p\vec{V}_3)\,\delta\tau+\vec{V}_3\cdot\tilde{g}\,\rho\,\delta\tau+\dot{Q}\,\rho\,\delta\tau$$

用 2.2 的技巧除以质量 $\rho\,\delta\tau$，得**单位质量**的总能量方程：

$$\frac{d}{dt}\left(I+\frac{\vec{V}_3\cdot\vec{V}_3}{2}\right)=-\frac{1}{\rho}\nabla_3\cdot(p\vec{V}_3)+\vec{V}_3\cdot\tilde{g}+\dot{Q} \tag{3}$$

### 2.6 减账：请出动能方程

动能怎么单独算？回到第 0 节的运动方程（不计摩擦 $\vec{F}$）：

$$\frac{d\vec{V}_3}{dt}=-\frac{1}{\rho}\nabla_3 p-2\vec{\Omega}\times\vec{V}_3+\tilde{g}$$

<span class="mk-purple">**点乘技巧**（课件第 41 页）：两边同点乘 $\vec{V}_3$。左边 $\vec{V}_3\cdot d\vec{V}_3/dt=d(\vec{V}_3\cdot\vec{V}_3/2)/dt$；科氏项 $\vec{V}_3\cdot(\vec{\Omega}\times\vec{V}_3)=0$（三个向量中有两个相同，混合积必为零）。</span>得**动能方程**：

$$\frac{d}{dt}\left(\frac{\vec{V}_3\cdot\vec{V}_3}{2}\right)=-\frac{1}{\rho}\vec{V}_3\cdot\nabla_3 p+\vec{V}_3\cdot\tilde{g} \tag{4}$$

<div class="mk-box mk-box--key">

**动能账本**：动能变化 ＝ 气压梯度力做功 ＋ 重力做功。科氏力缺席（不做功）。

</div>

**(3) − (4)**：左边的动能项抵消，右边的重力项抵消（其中 $-\nabla_3\cdot(p\vec{V}_3)$ 已按乘积法则拆成两项）：

$$\begin{aligned}
\frac{dI}{dt}&=\left[-\frac{1}{\rho}\vec{V}_3\cdot\nabla_3 p-\frac{p}{\rho}\nabla_3\cdot\vec{V}_3+\vec{V}_3\cdot\tilde{g}+\dot{Q}\right]-\left[-\frac{1}{\rho}\vec{V}_3\cdot\nabla_3 p+\vec{V}_3\cdot\tilde{g}\right]\\
&=-\frac{p}{\rho}\nabla_3\cdot\vec{V}_3+\dot{Q}
\end{aligned}$$

<span class="mk-blue">**重力项为什么消失**：重力做的功全部体现在机械能（动能与位能）的涨落上，不直接改变内能——"晒太阳"与"爬山"在能量账本上是两本账。</span>

最后用连续方程收尾（课件第 42 页跳步）。引入**比容** $\alpha\equiv 1/\rho$，由连续方程 $\frac{1}{\rho}\frac{d\rho}{dt}=-\nabla_3\cdot\vec{V}_3$：

$$\frac{d\alpha}{dt}=\frac{d}{dt}\left(\frac{1}{\rho}\right)=-\frac{1}{\rho^{2}}\frac{d\rho}{dt}=-\frac{1}{\rho}\underbrace{\left(\frac{1}{\rho}\frac{d\rho}{dt}\right)}_{=-\,\nabla_3\cdot\vec{V}_3}=\frac{1}{\rho}\nabla_3\cdot\vec{V}_3$$

代回，$\frac{p}{\rho}\nabla_3\cdot\vec{V}_3=p\,\frac{d\alpha}{dt}$：

<div class="mk-box mk-box--key">

**结论（热力学能量方程 · 定容比热形式）**——理想气体 $I=c_vT$，$c_v=717\ \mathrm{J/(kg\cdot K)}$：

$$\boxed{\ c_v\frac{dT}{dt}+p\frac{d\alpha}{dt}=\dot{Q}\ }$$

</div>

<div class="mk-box mk-box--why">

**物理意义**：$d\alpha/dt>0$（膨胀）时，即使 $\dot{Q}=0$ 气温也要下降——膨胀对外做功、吃掉内能，这就是**绝热上升冷却**的微分表达。$c_v$ 的名字由此而来：定容（$d\alpha/dt=0$）时 $\dot{Q}=c_v\,dT/dt$，热量全部用于升温。<span class="mk-orange">课件备注：第二项 $p\,d\alpha/dt$ 表示压缩功率，反映内能与机械能之间的转换，能将太阳辐射转化为驱动大气运动的能量。</span>

</div>

### 2.7 换算：三种常用等价形式

<span class="mk-orange">（课件第 42–43 页）</span>

**① 定压比热形式**。比容 $\alpha$ 不好观测，用状态方程把 $\alpha$ 的导数换成 $p$ 的导数：对 $\alpha=RT/p$ 求全导数，

$$p\frac{d\alpha}{dt}=p\left(\frac{R}{p}\frac{dT}{dt}-\frac{RT}{p^{2}}\frac{dp}{dt}\right)=R\frac{dT}{dt}-\alpha\frac{dp}{dt}$$

代回定容形式，并用迈耶公式 $c_p=c_v+R$ 合并同类项：

$$\boxed{\ c_p\frac{dT}{dt}-\alpha\frac{dp}{dt}=\dot{Q}\ }$$

**② 位温形式**。上式两端同除以 $T$：

$$c_p\frac{d\ln T}{dt}-R\frac{d\ln p}{dt}=\frac{\dot{Q}}{T}$$

引入**位温**（把气块干绝热地运到标准气压 $p_0=1000\ \mathrm{hPa}$ 处应具有的温度）：

$$\theta=T\left(\frac{p_0}{p}\right)^{R/c_p}$$

取对数再求全导数（<span class="mk-purple">先取 $\ln$ 再求导：乘积变加法、幂变系数</span>）：

$$\frac{d\ln\theta}{dt}=\frac{d\ln T}{dt}-\frac{R}{c_p}\frac{d\ln p}{dt}$$

两边乘 $c_p$，左端恰好就是除以 $T$ 之后的方程左端——<span class="mk-purple">"凑"合成功</span>：

$$\boxed{\ c_p\frac{d\ln\theta}{dt}=\frac{\dot{Q}}{T}\ }$$

**③ 熵形式**。令 $s=c_p\ln\theta$，则

$$\boxed{\ \frac{ds}{dt}=\frac{\dot{Q}}{T}\ }$$

**特例 · 干绝热过程**（$\dot{Q}=0$）：

$$\frac{d\ln\theta}{dt}=0$$

<span class="mk-green">**位温在干绝热过程中随体守恒——这正是它能当"空气块身份证"用的原因。**</span>

### 2.8 拼回方程组：闭合了

<span class="mk-orange">（课件第 47 页）</span>

| 方程 | 个数 | 管什么 |
| --- | --- | --- |
| 三个标量运动方程 | 3 | 动量守恒：$u,v,w$ 怎么变 |
| 连续方程 | 1 | 质量守恒：$\rho$ 怎么变 |
| 状态方程 $p=\rho RT$ | 1 | 热力状态约束 |
| 热力学能量方程 | 1 | 能量守恒：$T$ 怎么变 |

6 个未知数 $u,v,w,p,\rho,T$，恰好 6 个方程——**方程组闭合**：

$$\left\{\begin{array}{l}
\dfrac{du}{dt}=-\dfrac{1}{\rho}\dfrac{\partial p}{\partial x}+fv,\qquad
\dfrac{dv}{dt}=-\dfrac{1}{\rho}\dfrac{\partial p}{\partial y}-fu,\qquad
\dfrac{dw}{dt}=-\dfrac{1}{\rho}\dfrac{\partial p}{\partial z}-g\\[2ex]
\dfrac{d\rho}{dt}+\rho\,\nabla_3\cdot\vec{V}_3=0,\qquad
p=\rho RT,\qquad
c_p\dfrac{dT}{dt}-\alpha\dfrac{dp}{dt}=\dot{Q}
\end{array}\right.$$

其中 $f=2\Omega\sin\varphi$ 为科氏参数。若要考虑水汽相变与潜热，再加入水汽方程（课件第 45–46 页），7 个未知数 7 个方程，方程组同样闭合。

## 3 · 常见疑问速查

**Q1：$d/dt$ 与 $\partial/\partial t$ 什么时候用哪个？**
跟着微团走用 $d/dt$（拉格朗日立场，1.1 节）；守着固定点看用 $\partial/\partial t$（欧拉立场，1.2 节）。桥梁是 $d/dt=\partial/\partial t+\vec{V}_3\cdot\nabla_3$。

**Q2：$\delta\tau$ 的 $\delta$ 到底是什么？为什么它还能求导？**
只是"物质体积元"的标记，不是变分。$\delta x,\delta y,\delta z$ 贴在微团上随流变化，所以 $d(\delta\tau)/dt$ 有意义且一般不为零；而质量 $\delta m=\rho\,\delta\tau$ 恒定，$d(\delta m)/dt=0$——这一对"一个变、一个不变"正是连续方程的全部内容。

**Q3：科氏力不做功，为什么还要保留在运动方程里？**
不做功 ≠ 不影响运动。它改变速度的**方向**（北半球运动右偏），不改变**大小**——风绕台风中心旋转就是它干的。

**Q4：2.6 节相减时，重力项去哪了？**
重力做功同时出现在总能量方程 (3) 与动能方程 (4) 中，相减抵消。重力改变的是机械能，不直接加热空气。

**Q5：连续方程的两种形式，实际中怎么选？**
研究气块本身（气块法、轨迹分析）用拉格朗日形式 $\frac{1}{\rho}\frac{d\rho}{dt}+\nabla_3\cdot\vec{V}_3=0$；数值模式在固定网格上积分，用欧拉形式 $\frac{\partial\rho}{\partial t}+\nabla_3\cdot(\rho\vec{V}_3)=0$。

---

*笔记对应国防科技大学《动力气象学》课件 1.3-4 节（杨明浩）；跳步补全与多色批注为个人理解，如有出入以课堂讲授为准。*
