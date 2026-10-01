---
title: 动力气象学 · 球坐标系基本方程组与守恒性质重点笔记
date: 2026-10-01
tags: [动力气象学, 课程笔记, 重点笔记, 球坐标系]
description: 对应课件 1.5-6 节：球坐标系中的基本方程组与局地直角坐标系中的基本方程组。核心结论与物理图像为主线，课件全部推导逐页补全展示但标注"非重点"；薄层近似的两条守恒约束单独拆讲。
---

# 动力气象学 · 球坐标系基本方程组与守恒性质重点笔记

> 对应课件：《动力气象学》第 1 章 1.5-6 节（第 5 节《球坐标系中的基本方程组》共 27 页 + 第 6 节《局地直角坐标系中的基本方程组》共 21 页），承接 1.3-4 节（见上一份推导笔记）。
> 课件自标：<span class="mk-red">重点＝球坐标系基本方程组推导、局地直角坐标系基本方程组；难点＝球坐标系单位矢量的变化、取薄层近似的约束</span>。本课**不要求掌握推导**，各节把核心结论放在前面，完整推导放在「推导 · 非重点」小节。<span class="mk-red">■ 红＝易错点 / 符号陷阱</span>，<span class="mk-blue">■ 蓝＝物理意义 / 直观图像</span>，<span class="mk-green">■ 绿＝关键结论 / 必会方程</span>，<span class="mk-purple">■ 紫＝数学技巧 / 推导说明</span>，<span class="mk-orange">■ 橙＝对应课件页码 / 补充说明</span>。

## 0 · 全局地图：这节课在干什么

上一讲在**局地直角坐标系**里拼出了闭合方程组，但它只能"贴"在地球表面一个小局部。这节课分两步走：

1. **第 5 节**：把方程组搬到**球坐标系** $(\lambda,\varphi,r)$ 里——唯一的麻烦是<span class="mk-blue">单位矢量随位置变化</span>（课件标的难点），由此运动方程多出**曲率项**、连续方程换散度、热力学能量方程原样不动；再读出两条**守恒原理**（绝对角动量、机械能）。
2. **第 6 节**：大气是贴在地球上的一层**薄壳**（$r=a+z\approx a$），把 $r$ 换成 $a$ 得到**薄层近似**——但课件反复强调<span class="mk-red">不能随手替换</span>：必须接受**两条守恒约束**（去掉若干项），最后才落到**局地直角坐标系**基本方程组。

<div class="mk-box mk-box--key">

**考前必会清单（推导都不要求）**

1. 会说**为什么**换球坐标（第 2-3 页：三个参考方向随地而异、全球问题必须用曲线坐标）；
2. 认得**单位矢量变化率三式**，知道它们来自"标架随点变"（难点，第 8-14 页）；
3. 认得三个分量方程，知道**曲率项**是什么、为什么属于"虚拟的力"（第 16-19 页）；
4. 连续方程球面散度的两种等价写法（第 20-21 页）；
5. 两条守恒原理的**守恒量、条件、物理应用**（第 23-25 页）；
6. **薄层近似的两条守恒约束**各去掉哪些项、为什么（难点，第 34-39 页）；
7. 三个层级方程组（严格球坐标 → 薄层球坐标 → 局地直角坐标）的关系与**适用范围**（第 43-47 页）。

</div>

## 1 · 球坐标系基础（第 5-7 页，重点）

### 核心结论

**为什么换**：<span class="mk-blue">大气运动发生在旋转地球上，参考方向"东、北、上"在不同地理位置指向不同（第 2 页）；地球可看作足够圆的正球体，故采用球坐标系研究大气运动（第 2 页）。直角坐标系的标架（三个基本方向）在空间中固定，曲线坐标系的标架随空间点变化——这是两者最主要的差别（第 3 页），也是全讲所有"麻烦"的根源。</span>

**坐标与单位矢量**（第 5 页）：任一点 $P$ 用经度 $\lambda$、纬度 $\varphi$、到地心距离 $r$ 表示；$\vec{i}$ 沿纬线圈指向东、$\vec{j}$ 沿经线圈指向北、$\vec{k}$ 铅直向上，则

$$\vec{V}_3=u\,\vec{i}+v\,\vec{j}+w\,\vec{k}$$

**弧长关系与速度分量**（第 6 页）：沿三个坐标方向走 $d\lambda,d\varphi,dr$ 对应的弧长为

$$\delta x=r\cos\varphi\,\delta\lambda,\qquad \delta y=r\,\delta\varphi,\qquad \delta z=\delta r$$

$$\boxed{\ u=r\cos\varphi\,\frac{d\lambda}{dt},\qquad v=r\,\frac{d\varphi}{dt},\qquad w=\frac{dr}{dt}\ }$$

<span class="mk-blue">记忆锚点只有一个：纬圈的半径是 $r\cos\varphi$——走同样的经度，纬度越高实际走的路越短。</span>

**随体导数的球坐标展开**（第 7 页，绿框）：

$$\boxed{\ \frac{df}{dt}=\frac{\partial f}{\partial t}+\frac{u}{r\cos\varphi}\frac{\partial f}{\partial\lambda}+\frac{v}{r}\frac{\partial f}{\partial\varphi}+w\frac{\partial f}{\partial r}\ }$$

### 推导 · 非重点

<span class="mk-purple">随体导数就是把全导数 $\frac{df}{dt}=\frac{\partial f}{\partial t}+\frac{\partial f}{\partial\lambda}\frac{d\lambda}{dt}+\cdots$ 里的 $\frac{d\lambda}{dt}=\frac{u}{r\cos\varphi}$、$\frac{d\varphi}{dt}=\frac{v}{r}$、$\frac{dr}{dt}=w$ 代入（第 7 页）；而 $\frac{d\lambda}{dt}=\frac{u}{r\cos\varphi}$ 来自 $\delta x=r\cos\varphi\,\delta\lambda$ 两边同除 $\delta t$（第 6 页）。弧长关系的来历：经度差 $\delta\lambda$ 对应纬圈上的一段弧，纬圈半径是 $r\cos\varphi$。</span>

## 2 · 单位矢量的变化率（第 8-14 页，课件难点）

### 核心结论（必认得的三式）

由 $\vec{V}_3=u\vec{i}+v\vec{j}+w\vec{k}$ 求导，除 $\frac{du}{dt}$ 等分量项外还多出 $u\frac{d\vec{i}}{dt}+v\frac{d\vec{j}}{dt}+w\frac{d\vec{k}}{dt}$——**单位矢量随点的位置而改变**（第 8 页红框）。三个变化率是（第 10、13、14 页，小结见第 26 页）：

$$\boxed{\ \frac{d\vec{i}}{dt}=\frac{u\tan\varphi}{r}\vec{j}-\frac{u}{r}\vec{k},\qquad
\frac{d\vec{j}}{dt}=-\frac{u\tan\varphi}{r}\vec{i}-\frac{v}{r}\vec{k},\qquad
\frac{d\vec{k}}{dt}=\frac{u}{r}\vec{i}+\frac{v}{r}\vec{j}\ }$$

<span class="mk-blue">**各自的几何来历一句话**：$\vec{i}$ 只随经度转（沿纬圈走，"东"偏向地轴方向）；$\vec{j}$ 有两处变化——随经度增加，相邻经线向极点辐合使"北"偏向西（$-\vec{i}$ 方向），随纬度增加"北"向下俯（$-\vec{k}$ 方向）；$\vec{k}$ 的变化不用另算，用 $\vec{k}=\vec{i}\times\vec{j}$ 叉乘出来（第 14 页的巧妙一步）。</span>

### 推导 · 非重点

<span class="mk-orange">（第 9-14 页）</span><span class="mk-purple">课件的路径是先回答"随不随 $x,y,z,t$ 变"，再逐个求偏导。对 $\vec{i}$（第 9 页）：$\frac{\partial\vec{i}}{\partial t}=\frac{\partial\vec{i}}{\partial y}=\frac{\partial\vec{i}}{\partial z}=\vec{0}$，只剩 $\frac{d\vec{i}}{dt}=u\frac{\partial\vec{i}}{\partial x}$。</span>

**$\partial\vec{i}/\partial x$**（第 10 页）：沿纬圈走 $\delta x$，单位矢量转角 $\delta\lambda$，$\left|\delta\vec{i}\right|=\left|\vec{i}\right|\delta\lambda=\delta\lambda$，纬圈半径 $R=r\cos\varphi$，故

$$\left|\frac{\partial\vec{i}}{\partial x}\right|=\lim_{\delta x\to0}\frac{\left|\delta\vec{i}\right|}{\left|\delta x\right|}=\lim\frac{\delta\lambda}{R\,\delta\lambda}=\frac{1}{r\cos\varphi}$$

方向指向地轴，分解为向北与铅直分量，该方向单位矢量为 $\vec{j}\sin\varphi-\vec{k}\cos\varphi$，于是

$$\frac{\partial\vec{i}}{\partial x}=\frac{1}{r\cos\varphi}\left(\vec{j}\sin\varphi-\vec{k}\cos\varphi\right)=\frac{\tan\varphi}{r}\vec{j}-\frac{1}{r}\vec{k}
\;\Longrightarrow\;
\frac{d\vec{i}}{dt}=u\frac{\partial\vec{i}}{\partial x}=\frac{u\tan\varphi}{r}\vec{j}-\frac{u}{r}\vec{k}$$

**$\partial\vec{j}/\partial x$**（第 12 页）：由相交于极点的两条经线辐合引起，$\left|\partial\vec{j}/\partial x\right|=\lim\left|\vec{j}\right|\delta\theta/\delta x=\tan\varphi/r$，方向与 $\vec{i}$ 相反：

$$\frac{\partial\vec{j}}{\partial x}=-\frac{\tan\varphi}{r}\vec{i}$$

**$\partial\vec{j}/\partial y$**（第 13 页）：沿经线向北走 $\delta y=r\,\delta\varphi$，$\vec{j}$ 向下俯 $\delta\varphi$，$\left|\partial\vec{j}/\partial y\right|=\lim\left|\vec{j}\right|\delta\varphi/(r\delta\varphi)=1/r$，方向与 $\vec{k}$ 相反：

$$\frac{\partial\vec{j}}{\partial y}=-\frac{1}{r}\vec{k}
\;\Longrightarrow\;
\frac{d\vec{j}}{dt}=u\frac{\partial\vec{j}}{\partial x}+v\frac{\partial\vec{j}}{\partial y}=-\frac{u\tan\varphi}{r}\vec{i}-\frac{v}{r}\vec{k}$$

**$d\vec{k}/dt$**（第 14 页）：利用叉乘性质 $\vec{k}=\vec{i}\times\vec{j}$，$\vec{i}\times\vec{i}=\vec{j}\times\vec{j}=\vec 0$、$\vec{k}\times\vec{j}=-\vec{i}$、$\vec{i}\times\vec{k}=-\vec{j}$：

$$\frac{d\vec{k}}{dt}=\frac{d(\vec{i}\times\vec{j})}{dt}=\frac{d\vec{i}}{dt}\times\vec{j}+\vec{i}\times\frac{d\vec{j}}{dt}
=\left(\frac{u\tan\varphi}{r}\vec{j}-\frac{u}{r}\vec{k}\right)\times\vec{j}+\vec{i}\times\left(-\frac{u\tan\varphi}{r}\vec{i}-\frac{v}{r}\vec{k}\right)
=\frac{u}{r}\vec{i}+\frac{v}{r}\vec{j}$$

<span class="mk-purple">自检：三式两两正交、模长不超过速度本身量级 $V/r$；$\vec{k}$ 对 $r$ 的偏导为零——标架只随"在球面的哪里"变，不随高度变。</span>

## 3 · 球坐标中的运动方程（第 16-19 页，重点）

### 核心结论（必会方程）

从矢量方程 $\dfrac{d\vec{V}_3}{dt}=-\dfrac{1}{\rho}\nabla_3p-2\vec{\Omega}\times\vec{V}_3+\tilde{g}+\vec{F}$（第 16 页）出发，把第 2 节的单位矢量变化率代入，加速度分解为（第 16 页）：

$$\frac{d\vec{V}_3}{dt}=\left(\frac{du}{dt}-\frac{uv\tan\varphi}{r}+\frac{uw}{r}\right)\vec{i}
+\left(\frac{dv}{dt}+\frac{u^{2}\tan\varphi}{r}+\frac{vw}{r}\right)\vec{j}
+\left(\frac{dw}{dt}-\frac{u^{2}+v^{2}}{r}\right)\vec{k}$$

力的投影（第 17-18 页）：

| 力 | 投影 |
| --- | --- |
| 气压梯度力 | $-\dfrac{1}{\rho r\cos\varphi}\dfrac{\partial p}{\partial\lambda}\vec{i}-\dfrac{1}{\rho r}\dfrac{\partial p}{\partial\varphi}\vec{j}-\dfrac{1}{\rho}\dfrac{\partial p}{\partial r}\vec{k}$ |
| 重力 | $\vec{g}=-g\,\vec{k}$（重力指向地心） |
| 摩擦力 | $\vec{F}=F_\lambda\vec{i}+F_\varphi\vec{j}+F_r\vec{k}$ |
| 科氏力 | $(fv-\tilde{f}w)\vec{i}-fu\,\vec{j}+\tilde{f}u\,\vec{k}$ |

其中科氏力的展开要注意<span class="mk-red">$\vec{\Omega}$ 在 $\vec{i}$ 方向没有分量</span>（第 18 页）：$\vec{\Omega}=\Omega(\cos\varphi\,\vec{j}+\sin\varphi\,\vec{k})$。科氏参数（或称地转参数）$f$ 与 $\tilde{f}$ 定义为

$$f\equiv2\Omega\sin\varphi,\qquad \tilde{f}\equiv2\Omega\cos\varphi$$

合并得三个分量方程（第 19 页）：

$$\boxed{\begin{aligned}
\frac{du}{dt}-\frac{uv\tan\varphi}{r}+\frac{uw}{r}&=-\frac{1}{\rho r\cos\varphi}\frac{\partial p}{\partial\lambda}+fv-\tilde{f}w+F_\lambda\\[1ex]
\frac{dv}{dt}+\frac{u^{2}\tan\varphi}{r}+\frac{vw}{r}&=-\frac{1}{\rho r}\frac{\partial p}{\partial\varphi}-fu+F_\varphi\\[1ex]
\frac{dw}{dt}-\frac{u^{2}+v^{2}}{r}&=-\frac{1}{\rho}\frac{\partial p}{\partial r}-g+\tilde{f}u+F_r
\end{aligned}}$$

<div class="mk-box mk-box--why">

**曲率项术语与物理意义**（第 19 页绿框）：方程中含 $r$ 的各项称**曲率项**，由地球球面曲率引起；其负值（移到等号右边后）有时也称"曲率项力"，与科氏力一样是一种**虚拟的力**——不是真实的作用力。<span class="mk-blue">物理图像：沿纬圈匀速向东飞，走的是绕地轴的小圆而非大圆，必须有指向地轴的向心加速度 $u^{2}/(r\cos\varphi)$，它分解到北方向（$u^{2}\tan\varphi/r$）与铅直方向（$u^{2}/r$），正是 $v$、$w$ 两方程新增项的来源；其余曲率项是水平—垂直运动叠加时"标架随位置倾斜"的同类修正。</span>

</div>

<span class="mk-red">**符号陷阱**：曲率项在等号左边是"加速度的修正"，挪到右边才变成"力"；两种写法教材都出现，看清新项在左边还是右边再下结论。另外 $v$ 方程的第三个曲率项是 $\dfrac{vw}{r}$（$v$ 配 $w$），极易误写成 $\dfrac{uw}{r}$。</span>

### 推导 · 非重点

<span class="mk-purple">（第 16 页）把第 2 节三式代入 $d\vec{V}_3/dt=\frac{du}{dt}\vec{i}+\frac{dv}{dt}\vec{j}+\frac{dw}{dt}\vec{k}+u\frac{d\vec{i}}{dt}+v\frac{d\vec{j}}{dt}+w\frac{d\vec{k}}{dt}$，按方向归置即得上面的加速度分解。科氏力投影（第 18 页）：$-2\vec{\Omega}\times\vec{V}_3=-2\Omega(\cos\varphi\,\vec{j}+\sin\varphi\,\vec{k})\times(u\vec{i}+v\vec{j}+w\vec{k})$，逐项叉乘（$\vec{j}\times\vec{i}=-\vec{k}$ 等）即得表中结果。</span>

## 4 · 球坐标中的连续方程（第 20-21 页，重点）

### 核心结论

连续方程形式不变：$\dfrac{d\rho}{dt}+\rho\nabla_3\cdot\vec{V}_3=0$，换的只是散度（第 21 页）：

$$\boxed{\ \nabla_3\cdot\vec{V}_3=\frac{1}{r\cos\varphi}\frac{\partial u}{\partial\lambda}+\frac{1}{r\cos\varphi}\frac{\partial\left(v\cos\varphi\right)}{\partial\varphi}+\frac{1}{r^{2}}\frac{\partial\left(r^{2}w\right)}{\partial r}\ }$$

等价的展开形式（第 21 页）：

$$\nabla_3\cdot\vec{V}_3=\frac{2w}{r}-\frac{v\tan\varphi}{r}+\frac{1}{r\cos\varphi}\left(\frac{\partial u}{\partial\lambda}+\frac{\partial v}{\partial\varphi}\right)+\frac{\partial w}{\partial r}$$

<span class="mk-blue">**两处"球面味"**：$-\dfrac{v\tan\varphi}{r}$——纬圈周长随纬度收缩，向北流的空气管子变细、要散开；$\dfrac{2w}{r}$——球壳面积随高度变大，上升的空气管子变粗、也要散开。散度"体积相对膨胀率"的几何意义与上一讲完全一致。</span>

### 推导 · 非重点

<span class="mk-purple">（第 20-21 页）课件走"体积元膨胀"路线：散度 $=\lim\limits_{\delta\tau\to0}\dfrac{1}{\delta\tau}\dfrac{d(\delta\tau)}{dt}$，球坐标体积元 $\delta\tau=\delta x\,\delta y\,\delta z=r^{2}\cos\varphi\,\delta\lambda\,\delta\varphi\,\delta r$（三边按弧长关系相乘）。对五因子乘积取对数式求导：$r^{2}$ 贡献 $\dfrac{2}{r}\dfrac{dr}{dt}=\dfrac{2w}{r}$，$\cos\varphi$ 贡献 $-\tan\varphi\,\dfrac{d\varphi}{dt}=-\dfrac{v\tan\varphi}{r}$，$\delta\lambda,\delta\varphi,\delta r$ 各贡献一个速度偏导，取极限即得展开形式；再用 $\dfrac{1}{r\cos\varphi}\dfrac{\partial(v\cos\varphi)}{\partial\varphi}=\dfrac{1}{r}\dfrac{\partial v}{\partial\varphi}-\dfrac{v\tan\varphi}{r}$、$\dfrac{1}{r^{2}}\dfrac{\partial(r^{2}w)}{\partial r}=\dfrac{\partial w}{\partial r}+\dfrac{2w}{r}$ 收拢成 boxed 的紧凑形式。</span>

## 5 · 两条守恒原理（第 23-25 页，重点）

### 5.1 绝对角动量守恒（第 23 页）

**守恒量**：绕地轴的**绝对角动量**＝绝对纬向速度 $(u+\Omega r\cos\varphi)$ × 杠杆半径 $r\cos\varphi$：

$$\boxed{\ M=r\cos\varphi\left(u+\Omega r\cos\varphi\right)=r^{2}\cos^{2}\varphi\left(\Omega+\frac{d\lambda}{dt}\right)\ }$$

**课件的处理**（第 23 页）：绝对角动量随时间的变化等于所受的**合外力矩**（纬向合力 × 杠杆半径）：

$$\frac{dM}{dt}=r\cos\varphi\left(-\frac{1}{\rho r\cos\varphi}\frac{\partial p}{\partial\lambda}\right)+r\cos\varphi\,F_\lambda
=-\frac{1}{\rho}\frac{\partial p}{\partial\lambda}+r\cos\varphi\,F_\lambda$$

课件据此指出：球坐标系动量方程与绝对角动量守恒原理**相调一致**。

<div class="mk-box mk-box--why">

**条件与用途**：<span class="mk-green">轴对称（气压不随经度变化，$\partial p/\partial\lambda=0$）且无摩擦力矩时，$dM/dt=0$。</span><span class="mk-blue">物理应用：Hadley 环流上支把低空空气向极输送，空气离地轴越来越近（$r\cos\varphi$ 变小），像花样滑冰运动员收臂，纬向速度必然增大——这就是副热带西风急流的由来；再配上地表摩擦力矩与涡旋输送，构成东西风带维持的完整图像。</span>

</div>

<div class="dg">
<div class="dg__row">
<div class="dg__face">赤道低空<br>$r\cos\varphi$ 最大<br>$u$ 小（东风）</div>
<div class="dg__arrow">⟶</div>
<div class="dg__body">Hadley 环流上支<br>向极流动 $v>0$<br>（无摩擦、轴对称）</div>
<div class="dg__arrow">⟶</div>
<div class="dg__face">副热带高空<br>$r\cos\varphi$ 变小<br>$u$ 必增大</div>
</div>
<p class="dg__cap">$M$ 不变，"杠杆半径" $r\cos\varphi$ 缩短 → 纬向速度被放大 → 副热带西风急流</p>
</div>

<span class="mk-red">**易错点**：$M$ 里有两块——空气相对地球的 $r\cos\varphi\,u$ 和随地球转动的"牵连"部分 $\Omega r^{2}\cos^{2}\varphi$。低纬空气主要是牵连角动量大，向极流动时这块缩小、转化为相对角动量（$u$ 变大），别只盯着 $u$ 写守恒式。</span>

### 5.2 机械能守恒（第 24-25 页）

**课件的处理**（第 24 页）：把三个分量方程分别乘以 $u,v,w$ 再相加——<span class="mk-purple">曲率项两两相消（$u\cdot(-\frac{uv\tan\varphi}{r})+v\cdot\frac{u^{2}\tan\varphi}{r}=0$ 等三对），科氏项也两两相消（$u\,fv+v\cdot(-fu)=0$、$w\,\tilde{f}u+u\cdot(-\tilde{f}w)=0$）</span>——得

$$\frac{d}{dt}\left(\frac{u^{2}+v^{2}+w^{2}}{2}\right)=-\frac{1}{\rho}\left(\frac{u}{r\cos\varphi}\frac{\partial p}{\partial\lambda}+\frac{v}{r}\frac{\partial p}{\partial\varphi}+w\frac{\partial p}{\partial r}\right)-wg+uF_\lambda+vF_\varphi+wF_r$$

**技巧**（第 25 页）：$r=a+z$（$a$ 为地球半径，$z$ 为海拔高度），故 $wg=g\,\dfrac{dz}{dt}$，把它挪到左边：

$$\boxed{\ \frac{d}{dt}\left(\frac{u^{2}+v^{2}+w^{2}}{2}+gz\right)=-\frac{1}{\rho}\left(\frac{u}{r\cos\varphi}\frac{\partial p}{\partial\lambda}+\frac{v}{r}\frac{\partial p}{\partial\varphi}+w\frac{\partial p}{\partial r}\right)+uF_\lambda+vF_\varphi+wF_r\ }$$

<div class="mk-box mk-box--key">

**结论（第 25 页）**：$gz$ 是单位质量空气微团具有的**重力位能**。微团的**机械能（动能＋重力位能）随时间的变化率＝气压梯度力所作的功率与摩擦力功率之和**（摩擦通常做负功、消耗机械能）——球坐标系中动量方程没有违背机械能守恒定律。

</div>

<span class="mk-blue">**能量三角**：太阳辐射先变成内能，靠膨胀做功递给机械能；内能与位能之间靠压缩/膨胀衔接，位能与动能之间靠重力做功 $gw$ 衔接——全程的"转账中介"是气压梯度力（上一讲 2.6 节减账时的老朋友）。守恒律给这条转化链封了顶：无外源时总量不变、此消彼长。</span>

<span class="mk-orange">**延伸（课件未展开，供理解转化链用）**：若再把热力学能量方程 $c_{v}\frac{dT}{dt}=\dot{Q}-p\frac{d\alpha}{dt}$ 加进来，并用连续方程把气压梯度力项改写成通量形式 $-\alpha\nabla_3\cdot(p\vec{V}_3)+p\frac{d\alpha}{dt}$，三项合并得 $\frac{d}{dt}\left(c_{v}T+\frac{V^{2}}{2}+gz\right)=\dot{Q}-\alpha\nabla_3\cdot(p\vec{V}_3)$——绝热无摩擦时单位质量"内能＋动能＋位能"随体守恒，全球积分即总能量守恒。</span>

## 6 · 薄层近似与局地直角坐标系（第 6 节，第 28-48 页，重点＋难点）

### 6.0 先立规矩：取近似的三个元问题（第 40 页）

<div class="mk-box mk-box--why">

课件在动手近似之前先讲了三条方法论：<span class="mk-green">① 目的——简化方程组便于数学处理，能更好突出问题的物理本质；② 基本原则——取近似后所得的简化方程**不能违背原方程所满足的基本物理定律**；③ 范围条件——任何近似都是在一定前提下才成立，简化方程组只适用于一定范围。</span>第 6 节的全部内容就是拿"原则②"当尺子，逐项修剪 $r\to a$ 的替换。

</div>

### 6.1 薄层近似的定义（第 31-34 页）

**大气是一层薄壳**（第 31-32 页）：大气中 90% 以上的质量集中在离地表几十公里内，远比地球平均半径小：

| 高度 (km) | 11 | 30 | 50 |
| --- | --- | --- | --- |
| 气压 (hPa) | 226.4 | 11.97 | 0.8 |
| $m/m_0$ (%) | 77.66 | 98.82 | 99.92 |

故可取 $r=a+z\approx a$（$z$ 为海拔高度），这一近似<span class="mk-orange">被郭晓岚称为**薄层近似**（第 34 页）</span>。替换后弧长与速度变为（第 34 页）：

$$\delta x\approx a\cos\varphi\,\delta\lambda,\quad \delta y\approx a\,\delta\varphi,\quad \delta z=\delta r
\;\Longrightarrow\;
u\approx a\cos\varphi\,\frac{d\lambda}{dt},\quad v\approx a\,\frac{d\varphi}{dt},\quad w=\frac{dz}{dt}$$

<span class="mk-red">课件的设问（第 34 页）：**能否这样直接替换？** 答案是不能随手换——要看替换后的方程还守恒不守恒。</span>

### 6.2 约束一：绝对角动量守恒（第 35 页）

薄层近似后的绝对角动量应为 $a\cos\varphi\,(u+\Omega a\cos\varphi)$，守恒原理要求其变化率只来自纬向外力矩。把 $r\to a$ 直接替换得到的纬向方程若保留含 $w$ 的项，就与这一要求冲突。<span class="mk-green">课件结论（第 35 页绿框）：要使简化方程不违背绝对角动量守恒原理，就必须**去掉 $\vec{i}$ 方向分量方程中含 $w$ 的各项**（即 $\tilde{f}w$ 与曲率项 $\frac{uw}{r}$）。</span>

<span class="mk-blue">**为什么有这条约束**：薄层世界里微团始终贴在 $r=a$ 的球面上，高度变化不再改变杠杆半径 $a\cos\varphi$（$\frac{d(a\cos\varphi)}{dt}$ 里没有 $w$ 的份），所以纬向方程不该再有 $w$ 的贡献。</span>

### 6.3 约束二：机械能守恒（第 36-38 页）

若按第 36 页那样保留铅直方程中的 $\dfrac{u^{2}+v^{2}}{a}$ 与 $\tilde{f}u$，把方程组分别乘 $u,v,w$ 相加时，会多出 $\tilde{f}uw$、$v^{2}w/a$ 这类项（第 37 页红框标出）——相当于<span class="mk-red">科氏力、曲率项在做功，违背机械能守恒定律</span>。<span class="mk-green">课件结论（第 38 页）：$\vec{k}$ 方向分量方程中也要略去 $\dfrac{u^{2}+v^{2}}{r}$ 与 $\tilde{f}u$ 两项，否则不满足机械能守恒定律。</span>

### 6.4 薄层近似后的球坐标方程组（第 38-41 页）

两条约束修剪后（第 38、46 页），再配连续方程与热力学、状态方程，得到**闭合**的薄层球坐标方程组（第 41 页）：

$$\boxed{\begin{aligned}
\frac{du}{dt}-\frac{uv\tan\varphi}{a}&=-\frac{1}{\rho a\cos\varphi}\frac{\partial p}{\partial\lambda}+fv+F_\lambda\\[1ex]
\frac{dv}{dt}+\frac{u^{2}\tan\varphi}{a}+\frac{vw}{a}&=-\frac{1}{\rho a}\frac{\partial p}{\partial\varphi}-fu+F_\varphi\\[1ex]
\frac{dw}{dt}&=-\frac{1}{\rho}\frac{\partial p}{\partial z}-g+F_r\\[1ex]
\frac{d\rho}{dt}+\rho\left(\frac{1}{a\cos\varphi}\frac{\partial u}{\partial\lambda}+\frac{1}{a}\frac{\partial v}{\partial\varphi}-\frac{v\tan\varphi}{a}+\frac{\partial w}{\partial z}\right)&=0\\[1ex]
c_{p}\frac{d\ln\theta}{dt}&=\frac{\dot{Q}}{T},\qquad p=\rho RT
\end{aligned}}$$

其中连续方程（第 39 页）：体积元换为 $\delta\tau=a^{2}\cos\varphi\,\delta\lambda\,\delta\varphi\,\delta z$，散度中的 $\dfrac{2w}{r}$ 变成 $\dfrac{2w}{a}$，<span class="mk-green">由守恒约束，连续方程中也略去了 $\dfrac{2w}{a}$</span>（与动量方程去掉 $w$ 项相呼应——它同样来自"球壳面积随高度变大"的曲率效应）；热力学能量方程取**位温形式** $c_p\frac{d\ln\theta}{dt}=\dot Q/T$。注意水平曲率项 $\frac{uv\tan\varphi}{a}$、$\frac{u^{2}\tan\varphi}{a}$、$\frac{vw}{a}$ **保留**在薄层球坐标方程组里。

<span class="mk-red">**易错点**：薄层近似 ≠ 把 $r$ 换成 $a$ 了事。它同时动了三处——$\vec{i}$ 方程去 $w$ 项（角动量约束）、$\vec{k}$ 方程去曲率项与 $\tilde{f}u$（机械能约束）、连续方程去 $2w/a$；保留的只是水平方向的 $\tan\varphi/a$ 型曲率项。</span>

### 6.5 局地直角坐标系中的基本方程组（第 43-46 页，重点）

**定义**（第 43 页）：坐标原点 $O$ 取在地球表面某一点，$z$ 轴与地面垂直指向天顶为正，$x$ 轴向东为正、$y$ 轴向北为正，组成正交右手系，且随地球自转运动；$\delta x=a\cos\varphi\,\delta\lambda,\ \delta y=a\,\delta\varphi,\ \delta z=\delta r$。

**关键一步**（第 44 页）：不考虑单位矢量的空间变化，即 $\dfrac{d\vec{i}}{dt}=\dfrac{d\vec{j}}{dt}=\dfrac{d\vec{k}}{dt}=\vec 0$——相当于把球面看成平面（或把地球的曲率半径看成 $r\to\infty$），<span class="mk-green">曲率项在运动方程中不再出现</span>。于是略去薄层球坐标方程组中的曲率项，得（第 45-46 页；绝热无摩擦形式）：

$$\boxed{\begin{aligned}
\frac{du}{dt}&=-\frac{1}{\rho}\frac{\partial p}{\partial x}+fv\\[1ex]
\frac{dv}{dt}&=-\frac{1}{\rho}\frac{\partial p}{\partial y}-fu\\[1ex]
\frac{dw}{dt}&=-\frac{1}{\rho}\frac{\partial p}{\partial z}-g
\end{aligned}\qquad
\frac{d\rho}{dt}+\rho\left(\frac{\partial u}{\partial x}+\frac{\partial v}{\partial y}+\frac{\partial w}{\partial z}\right)=0,\qquad
\frac{d\ln\theta}{dt}=0,\quad p=\rho RT}$$

<span class="mk-orange">课件评注（第 46 页绿框）：局地直角坐标系是球坐标系的简化形式，它保持了球坐标系的标架，但忽略了球面曲率的影响。</span>

### 6.6 适用范围（第 47 页）

对连续可微的场变量，在局地直角坐标系中求混合微商时，**交换次序结果不等**：

$$\frac{\partial^{2}f}{\partial x\,\partial y}=\frac{1}{a^{2}\cos\varphi}\frac{\partial^{2}f}{\partial\lambda\,\partial\varphi},\qquad
\frac{\partial^{2}f}{\partial y\,\partial x}=\frac{1}{a^{2}\cos\varphi}\frac{\partial^{2}f}{\partial\lambda\,\partial\varphi}+\frac{\tan\varphi}{a^{2}\cos\varphi}\frac{\partial f}{\partial\lambda}$$

两者的差与保留项之比约为 $\tan\varphi\cdot\dfrac{L}{a}$（$L$ 为运动水平尺度）。<span class="mk-blue">一般在中低纬度这一差值可略去不计，即 $x$ 和 $y$ 可视为独立自变量；**靠近极区这一差值很大，不宜采用局地直角坐标系**——这就是"局地"二字的准确含义：中低纬、水平范围远小于地球半径的问题。课件由此引出思考：除全球问题必须用球坐标外，包含极地但水平范围不大的问题怎么办（第 41 页）——这是后续投影/区域模式的话题。</span>

## 7 · 一页速记（考前版）

**流程链**：局地直角坐标只能贴局部 → 全球问题建球坐标 $(\lambda,\varphi,r)$ → 单位矢量随位置变（难点）→ 运动方程加曲率项、连续方程换散度、热力方程不动 → 两条守恒原理（角动量、机械能）→ 薄层近似 $r\to a$ 但须受两条守恒约束 → 局地直角坐标方程组 → 中低纬适用、极区不行。

**单位矢量变化率**（难点，认得即可）：$\dfrac{d\vec{i}}{dt}=\dfrac{u\tan\varphi}{r}\vec{j}-\dfrac{u}{r}\vec{k}$，$\dfrac{d\vec{j}}{dt}=-\dfrac{u\tan\varphi}{r}\vec{i}-\dfrac{v}{r}\vec{k}$，$\dfrac{d\vec{k}}{dt}=\dfrac{u}{r}\vec{i}+\dfrac{v}{r}\vec{j}$。

**三个层级方程组**（本讲的主干结构）：

| 层级 | 动量方程特征 | 依据 |
| --- | --- | --- |
| 严格球坐标（$r$） | 全部曲率项＋$\tilde{f}w$ 都在 | 第 5 节第 19 页 |
| 薄层球坐标（$r\to a$） | 去 $\vec{i}$ 方程的 $w$ 项、$\vec{k}$ 方程的 $\frac{u^{2}+v^{2}}{a}$ 与 $\tilde{f}u$、连续方程去 $\frac{2w}{a}$；保留水平 $\tan\varphi/a$ 型曲率项 | 两条守恒约束（第 35-39 页） |
| 局地直角坐标（$x,y,z$） | 曲率项全部消失，$f$ 仍随纬度变 | 标架不再转动（第 44 页） |

**两条守恒原理**：

| 名称 | 守恒量 | 条件 | 物理应用 |
| --- | --- | --- | --- |
| 绝对角动量守恒 | $r\cos\varphi\,(u+\Omega r\cos\varphi)$ | 轴对称（$\partial p/\partial\lambda=0$）、无摩擦力矩 | Hadley 环流 → 副热带西风急流 |
| 机械能守恒 | $\dfrac{u^{2}+v^{2}+w^{2}}{2}+gz$（动能＋重力位能） | 动量方程乘 $u,v,w$ 相加后曲率项、科氏项不做功 | 能量转化链的"总账" |

**与上一讲拼图**：运动方程（3）＋连续方程（1）＋状态方程（1）＋热力学能量方程（1）＝ 6 未知数 6 方程的闭合组；本讲给出它的球坐标版与薄层/局地直角坐标版，下一站通常是把垂直坐标换成气压（$p$ 坐标系）。

## 8 · 常见疑问速查

**Q1：运动方程、连续方程都改了形式，为什么热力学能量方程不用改？**
它只含标量（$T,p,\alpha,\theta,\dot{Q}$）的随体导数，不含矢量求导与散度；标量没有方向，坐标架怎么弯都碰不到它，只需把 $d/dt$ 换成球坐标版（第 41 页直接取位温形式）。

**Q2：曲率项是不是一种新的力？**
不是真实作用力。课件口径（第 19 页）：曲率项由球面曲率引起，其负值有时称"曲率项力"，与科氏力一样是**虚拟的力**。检验：把三个分量方程分别乘 $u,v,w$ 相加，曲率项与科氏项的贡献全部相消——力做功不为零，而它们不做功（第 24 页）。

**Q3：薄层近似为什么不能直接把 $r$ 换成 $a$？**
按课件第 40 页的基本原则：简化方程不能违背原方程满足的基本物理定律。直接替换会违背绝对角动量守恒（$\vec{i}$ 方程残留 $w$ 项，第 35 页）和机械能守恒（$\vec{k}$ 方程残留 $\frac{u^{2}+v^{2}}{a}$、$\tilde{f}u$，算出曲率项与科氏力做功，第 37 页），所以必须同时去掉这些项。

**Q4：为什么连续方程也要去掉 $2w/a$？**
它同样来自球面曲率（球壳面积随 $r$ 增大），与动量方程中被去掉的 $w$ 项同族；课件按同一守恒约束口径处理（第 39 页绿框）。

**Q5：绝对角动量里的 $\Omega r^{2}\cos^{2}\varphi$ 是什么？**
"牵连"角动量——空气随地球一起转的那部分。两种写法等价：$u=r\cos\varphi\,d\lambda/dt$ 代入即得 $M=r^{2}\cos^{2}\varphi(\Omega+d\lambda/dt)$。向极流动时主要是这一块转化为相对角动量。

**Q6：机械能守恒里为什么没有内能？**
课件第 24-25 页只从动量方程收账，得到的是动能＋重力位能的**机械能**守恒（变化率＝气压梯度力功率＋摩擦功率）；内能的账在热力学能量方程里。两本账合并成"总能量守恒"见第 5.2 节的延伸框。

**Q7：极区为什么不能用局地直角坐标？**
混合偏导交换次序的差值约为 $\tan\varphi\cdot L/a$ 量级（第 47 页）：中低纬且 $L\ll a$ 时可忽略，靠近极区 $\tan\varphi$ 发散、差值很大，$x,y$ 不再近似独立。

---

*笔记对应国防科技大学《动力气象学》课件 1.5-6 节（杨明浩，共 49 页）；页码引用随文标注，跳步补全与多色批注、"推导 · 非重点"分层为个人理解，如有出入以课堂讲授为准。*
