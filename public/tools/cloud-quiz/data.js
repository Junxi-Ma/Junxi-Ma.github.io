/* ============================================================
 * data.js — 云的分类数据（大气探测学）
 * 三族十属二十九类。来源：课堂《云的分类表》。
 * 课堂件中 Cumulonimbus calvas / Cirrus denssus 为拼写笔误，
 * 此处按标准拉丁学名写为 calvus / densus。
 * ============================================================ */
'use strict';

const CLOUD_FAMILIES = [
  { id: 'high', name: '高云', hint: '云底通常在 5000m 以上，卷字辈' },
  { id: 'mid',  name: '中云', hint: '云底通常在 2500–5000m，高字辈' },
  { id: 'low',  name: '低云', hint: '云底通常在 2500m 以下' },
];

/* 云属：family + 中文名 + 英文简写 + 形态（积/层/波） */
const CLOUD_GENERA = [
  { id: 'Ci', cn: '卷云',   abbr: 'Ci', family: 'high', morph: '积' },
  { id: 'Cc', cn: '卷积云', abbr: 'Cc', family: 'high', morph: '波' },
  { id: 'Cs', cn: '卷层云', abbr: 'Cs', family: 'high', morph: '层' },
  { id: 'Ac', cn: '高积云', abbr: 'Ac', family: 'mid',  morph: '波' },
  { id: 'As', cn: '高层云', abbr: 'As', family: 'mid',  morph: '层' },
  { id: 'Ns', cn: '雨层云', abbr: 'Ns', family: 'low',  morph: '层' },
  { id: 'Sc', cn: '层积云', abbr: 'Sc', family: 'low',  morph: '波' },
  { id: 'St', cn: '层云',   abbr: 'St', family: 'low',  morph: '层' },
  { id: 'Cu', cn: '积云',   abbr: 'Cu', family: 'low',  morph: '积' },
  { id: 'Cb', cn: '积雨云', abbr: 'Cb', family: 'low',  morph: '积' },
];

/* 云类：genus + 中文名 + 简写 + 拉丁文学名 */
const CLOUD_SPECIES = [
  // 低云
  { id: 'cu-hum',  genus: 'Cu', cn: '淡积云',     abbr: 'Cu hum', latin: 'Cumulus humilis' },
  { id: 'fc',      genus: 'Cu', cn: '碎积云',     abbr: 'Fc',     latin: 'Fractocumulus' },
  { id: 'cu-cong', genus: 'Cu', cn: '浓积云',     abbr: 'Cu cong', latin: 'Cumulus congestus' },
  { id: 'cb-calv', genus: 'Cb', cn: '秃积雨云',   abbr: 'Cb calv', latin: 'Cumulonimbus calvus' },
  { id: 'cb-cap',  genus: 'Cb', cn: '鬃积雨云',   abbr: 'Cb cap',  latin: 'Cumulonimbus capillatus' },
  { id: 'sc-tra',  genus: 'Sc', cn: '透光层积云', abbr: 'Sc tra',  latin: 'Stratocumulus translucidus' },
  { id: 'sc-op',   genus: 'Sc', cn: '蔽光层积云', abbr: 'Sc op',   latin: 'Stratocumulus opacus' },
  { id: 'sc-cug',  genus: 'Sc', cn: '积云性层积云', abbr: 'Sc cug', latin: 'Stratocumulus cumulogenitus' },
  { id: 'sc-cast', genus: 'Sc', cn: '堡状层积云', abbr: 'Sc cast', latin: 'Stratocumulus castellanus' },
  { id: 'sc-lent', genus: 'Sc', cn: '荚状层积云', abbr: 'Sc lent', latin: 'Stratocumulus lenticularis' },
  { id: 'st',      genus: 'St', cn: '层云',       abbr: 'St',      latin: 'Stratus' },
  { id: 'fs',      genus: 'St', cn: '碎层云',     abbr: 'Fs',      latin: 'Fractostratus' },
  { id: 'ns',      genus: 'Ns', cn: '雨层云',     abbr: 'Ns',      latin: 'Nimbostratus' },
  { id: 'fn',      genus: 'Ns', cn: '碎雨云',     abbr: 'Fn',      latin: 'Fractonimbus' },
  // 中云
  { id: 'as-tra',  genus: 'As', cn: '透光高层云', abbr: 'As tra',  latin: 'Altostratus translucidus' },
  { id: 'as-op',   genus: 'As', cn: '蔽光高层云', abbr: 'As op',   latin: 'Altostratus opacus' },
  { id: 'ac-tra',  genus: 'Ac', cn: '透光高积云', abbr: 'Ac tra',  latin: 'Altocumulus translucidus' },
  { id: 'ac-op',   genus: 'Ac', cn: '蔽光高积云', abbr: 'Ac op',   latin: 'Altocumulus opacus' },
  { id: 'ac-lent', genus: 'Ac', cn: '荚状高积云', abbr: 'Ac lent', latin: 'Altocumulus lenticularis' },
  { id: 'ac-cug',  genus: 'Ac', cn: '积云性高积云', abbr: 'Ac cug', latin: 'Altocumulus cumulogenitus' },
  { id: 'ac-flo',  genus: 'Ac', cn: '絮状高积云', abbr: 'Ac flo',  latin: 'Altocumulus floccus' },
  { id: 'ac-cast', genus: 'Ac', cn: '堡状高积云', abbr: 'Ac cast', latin: 'Altocumulus castellanus' },
  // 高云
  { id: 'ci-fil',  genus: 'Ci', cn: '毛卷云',     abbr: 'Ci fil',  latin: 'Cirrus filosus' },
  { id: 'ci-dens', genus: 'Ci', cn: '密卷云',     abbr: 'Ci dens', latin: 'Cirrus densus' },
  { id: 'ci-not',  genus: 'Ci', cn: '伪卷云',     abbr: 'Ci not',  latin: 'Cirrus nothus' },
  { id: 'ci-unc',  genus: 'Ci', cn: '钩卷云',     abbr: 'Ci unc',  latin: 'Cirrus uncinus' },
  { id: 'cs-fil',  genus: 'Cs', cn: '毛卷层云',   abbr: 'Cs fil',  latin: 'Cirrostratus filosus' },
  { id: 'cs-nebu', genus: 'Cs', cn: '匀卷层云',   abbr: 'Cs nebu', latin: 'Cirrostratus nebulosus' },
  { id: 'cc',      genus: 'Cc', cn: '卷积云',     abbr: 'Cc',      latin: 'Cirrocumulus' },
];

/* 拉丁词根速查（笔记与速记页共用） */
const CLOUD_SUFFIX_MEANING = {
  hum: '淡', cong: '浓', calv: '秃', cap: '鬃',
  tra: '透光', op: '蔽光', cug: '积云性', cast: '堡状', lent: '荚状', flo: '絮状',
  fil: '毛', dens: '密', not: '伪', unc: '钩', nebu: '匀(薄雾状)',
};

const CLOUD_MORPH_COLOR = { 积: 'ji', 波: 'bo', 层: 'ceng' };

/* ============================================================
 * 外貌特征（课堂件各云属页），速记卡与解释共用
 * ============================================================ */
const GENUS_TRAITS = {
  Ci: '丝缕状结构、柔丝般光泽，分离散乱；日出前/日落后常染黄橙色',
  Cc: '白色细鳞片（小圆块）成行成群，像微风拂过水面的涟漪；视张角 <1°、无暗影',
  Cs: '薄幕状均匀云幕，丝缕结构隐约可辨；日月有晕，有晕才能证明它在',
  Ac: '块状片状球状，成群成行、形似田垄或波浪；视张角一般 1°~5°',
  As: '均匀的幕状、常有条纹结构；灰白浅蓝，隔云看日月轮廓朦胧',
  Ns: '厚而暗灰、遮蔽全部天空，看不清日月位置；常降连续性雨雪',
  Sc: '团状片状条状，云块较大（视张角大多 >5°）成行成群；可降间歇性雨雪',
  St: '均匀幕状，云底很低，常笼罩山头或较高建筑物',
  Cu: '底平顶凸（弧形或花椰菜形），个体明显互不相连；向阳面白亮、云底灰暗',
  Cb: '垂直发展极盛、远望如耸立高山；顶部纤维结构（马鬃/铁砧），云底混乱铅黑，常伴雷暴大风',
};

/* 波状家族三兄弟靠视张角大小区分（课堂件明确数字） */
const CLOUD_ANGLE = { Cc: '<1°', Ac: '1°~5°', Sc: '大多数 >5°' };

/* ============================================================
 * 谚语库：课程谚语清单（老师给的对应关系）＋ 随堂考过的江猪过河
 * ============================================================ */
const CQ_PROVERBS = [
  { id: 'pv-mantou', p: '馒头云，天气晴', cn: '淡积云', abbr: 'Cu hum',
    ds: ['浓积云', '碎积云', '层积云'],
    why: '馒头状小云块＝淡积云：对流弱、云体小而薄，主晴。' },
  { id: 'pv-tiezhen', p: '天上铁砧云，很快大雨淋', cn: '鬃积雨云', abbr: 'Cb cap',
    ds: ['秃积雨云', '浓积云', '雨层云'],
    why: '铁砧状云顶＝积雨云顶部冰晶化水平铺展（鬃/砧），成熟积雨云压境，很快下大雨。' },
  { id: 'pv-huibu', p: '天上灰布悬，雨丝定绵绵', cn: '雨层云', abbr: 'Ns',
    ds: ['蔽光高层云', '层云', '积雨云'],
    why: '暗灰色厚幕遮天＝雨层云，带来连续性降水（绵绵细雨）；积雨云下的是阵性大雨。' },
  { id: 'pv-yulinban', p: '天上鱼鳞斑，明日晒谷不用翻', cn: '透光高积云', abbr: 'Ac tra',
    ds: ['卷积云', '絮状高积云', '蔽光层积云'],
    why: '鱼鳞斑＝透光高积云，形成于逆温层下的稳定层结，云层平静主晴。注意与"鱼鳞天（卷积云）"区分：斑大而疏、鳞细而密。' },
  { id: 'pv-paotai', p: '炮台云，雨淋淋', cn: '堡状高积云', abbr: 'Ac cast',
    ds: ['荚状高积云', '絮状高积云', '堡状层积云'],
    why: '云条顶上一排小塔楼＝堡状云，说明中空不稳定；白天升温后对流爆发易成积雨云，故雨淋淋。' },
  { id: 'pv-mianxu', p: '早晨棉絮云，午后必雨淋', cn: '絮状高积云', abbr: 'Ac flo',
    ds: ['透光高积云', '淡积云', '卷积云'],
    why: '破碎棉絮团＝絮状高积云，中空扰动强、层结不稳定，午后易发展成积雨云。' },
  { id: 'pv-saozhou', p: '天上扫帚云，三天雨淋淋', cn: '密卷云', abbr: 'Ci dens',
    ds: ['钩卷云', '毛卷云', '卷层云'],
    why: '扫帚状大片较厚密的卷云＝密卷云，常是积雨云顶部解体的残留，高空锋区过境，几天内转雨。' },
  { id: 'pv-gougou', p: '天上钩钩云，地上雨淋淋', cn: '钩卷云', abbr: 'Ci unc',
    ds: ['密卷云', '毛卷云', '卷积云'],
    why: '末端下弯带钩（逗号状）的云丝＝钩卷云，成群系统侵入天空是锋面临近先兆，一两天内转雨。' },
  { id: 'pv-yulin', p: '鱼鳞天，不雨也风颠', cn: '卷积云', abbr: 'Cc',
    ds: ['透光高积云', '毛卷云', '毛卷层云'],
    why: '满天细小鳞片（视张角<1°）＝卷积云，中高空扰动加强，天气即将转坏。与"鱼鳞斑（透光高积云）"区分：这个更细更密。' },
  { id: 'pv-jiangzhu', p: '江猪过河，大雨滂沱', cn: '碎雨云', abbr: 'Fn',
    ds: ['雨层云', '积雨云', '高层云'],
    why: '"江猪"指雨层云底下快速移动的碎雨云（云属上归雨层云）；看到它说明雨层云水汽充足，连绵大雨将至。' },
];

/* ============================================================
 * 特征说法判断库（多选题素材）：t=说法，ok=对错，why=解析
 * ============================================================ */
const CQ_STATEMENTS = [
  { id: 'st-def', t: '云是悬浮在大气中的小水滴、冰晶或两者混合组成的可见聚合体，其底不接地', ok: true, why: '这就是云的定义；底接地的"云"叫雾。' },
  { id: 'st-item', t: '云的观测项目包括云状、云量、云高、云向和云速', ok: true, why: '课堂件"云的观测项目"原句。' },
  { id: 'st-macro', t: '云既有宏观特征（形状、尺度、结构、高度），也有微观特征', ok: true, why: '宏观看外形，微观看相态、含水量、滴谱等。' },
  { id: 'st-mixcb', t: '积雨云和雨层云多由水滴、过冷水滴、冰晶混合组成', ok: true, why: '两朵"降水大户"都是混合云。' },
  { id: 'st-nsthick', t: '雨层云很厚，呈暗灰色，看不清日月的位置', ok: true, why: '遮蔽全天、暗灰无光是雨层云的招牌特征。' },
  { id: 'st-nsrain', t: '雨层云常降连续性雨雪，有时伴有雨雪幡', ok: true, why: '连续性降水是雨层云区别于积雨云（阵性）的关键。' },
  { id: 'st-ascurtain', t: '高层云云底呈均匀的幕状，常有条纹结构', ok: true, why: '课堂件高层云特征原句。' },
  { id: 'st-ccangle', t: '卷积云云块很小，多数云块视张角小于1°', ok: true, why: '波状家族里最小的就是它。' },
  { id: 'st-acangle', t: '高积云云块视角一般为1°~5°，形似田垄或波浪', ok: true, why: '居中的张角对应中云高积云。' },
  { id: 'st-scangle', t: '层积云云块视角大多数大于5°', ok: true, why: '波状家族里块头最大（张角最大）的是低云层积云。' },
  { id: 'st-cifil', t: '卷云具有丝缕状结构、柔丝般光泽', ok: true, why: '冰晶云的标志性外表。' },
  { id: 'st-cshalo', t: '匀卷层云云幕很薄时几乎看不出结构，只有出现晕才能证明其存在', ok: true, why: '"看晕识卷层云"。' },
  { id: 'st-cushape', t: '积云底部平坦，顶部凸起呈弧形或花椰菜形，个体明显互不相连', ok: true, why: '底平顶凸＝凝结高度处抬升的痕迹。' },
  { id: 'st-cbfiber', t: '积雨云顶部具有纤维结构，有时呈马鬃状或铁砧状，常伴有雷暴和大风', ok: true, why: '顶部冰晶化＋云砧是成熟积雨云的标志。' },
  { id: 'st-sthill', t: '层云云底很低，常笼罩山头或较高的建筑物', ok: true, why: '低而均匀的幕。' },
  { id: 'st-hiice', t: '高云族云由微小的冰晶构成，一般不产生降水', ok: true, why: '冰晶太小落不到地（留痕的叫幡）。' },
  { id: 'st-midmix', t: '中云族云多由过冷水滴与冰晶混合构成', ok: true, why: '中云是水滴与冰晶的过渡地带。' },
  { id: 'st-waveinv', t: '波状云多出现在逆温层附近，云层沿水平方向散布', ok: true, why: '逆温层上下风速切变激发波动。' },
  { id: 'st-lifam', t: '层状云包括卷层云、高层云、雨层云和层云', ok: true, why: '四个"层"字辈＋卷层云。' },
  { id: 'st-bofam', t: '波状云包括卷积云、高积云和层积云', ok: true, why: '三个"积"字辈但都是波状形态。' },
  { id: 'st-satway', t: '空气达到饱和的途径有降温、增湿、降温加增湿，实际大气以空气上升降温为主', ok: true, why: '上升→绝热降温→饱和凝结，是成云的主渠道。' },
  { id: 'st-evolve', t: '积状云的发展演变大致为：淡积云→浓积云→积雨云', ok: true, why: '对流由弱到强的三个阶段（积雨云再分秃、鬃）。' },
  { id: 'st-fcabbr', t: '碎积云的英文简写是 Fc', ok: true, why: '碎字辈单独记：Fc、Fs、Fn。' },
  { id: 'st-actra', t: '透光层积云薄的部分能看出日月轮廓，厚的部分分辨不出日月位置', ok: true, why: '透光/蔽光就靠日月轮廓是否可辨来分。' },

  { id: 'st-acconv', t: '高积云属于积状云', ok: false, why: '高积云是波状云（气流波动形成），积状云是 Cu、Cb。' },
  { id: 'st-ashigh', t: '高层云属于高云族', ok: false, why: '带"高"字但是中云族；高云族只有"卷"字辈。' },
  { id: 'st-lifromwave', t: '层状云是由气流的波动作用形成的', ok: false, why: '层状云由自身冷却或气团沿锋面缓慢抬升形成；波动成的是波状云。' },
  { id: 'st-bofromconv', t: '波状云是由对流上升形成的', ok: false, why: '对流上升成积状云；波状云由气流波动形成。' },
  { id: 'st-jifromfront', t: '积状云是由气团沿锋面缓慢抬升形成的', ok: false, why: '沿锋面缓慢抬升成层状云；积状云由对流上升形成。' },
  { id: 'st-fcfra', t: '碎积云的英文简写是 Cu fra', ok: false, why: '碎积云简写是独立的 Fc，不写 Cu fra。' },
  { id: 'st-hirain', t: '高云族云多由水滴组成，常产生大量降水', ok: false, why: '高云族由冰晶构成，一般不产生降水。' },
  { id: 'st-ccbig', t: '卷积云云块视张角一般大于5°', ok: false, why: '反了：卷积云 <1°，大于5°的是层积云。' },
  { id: 'st-acsflo', t: '高积云与层积云相比，少了一类絮状', ok: false, why: '恰恰相反：高积云多了絮状（Ac flo），层积云没有絮状类。' },
  { id: 'st-opdisc', t: '蔽光层积云薄的部分也能明显看出日月位置', ok: false, why: '蔽光＝云层密蔽，分辨不出日月位置。' },
];

/* ============================================================
 * 成因与演变题库：multi=多选。answers 必全对，ds 为干扰项。
 * ============================================================ */
const CQ_CAUSES = [
  { id: 'ca-layer', multi: true, q: '层状云的形成原因有哪些？',
    answers: ['自身冷却', '气团沿锋面缓慢抬升'],
    ds: ['气流的波动作用', '冷暖平流交汇'],
    why: '课堂件原句：层状云由自身冷却或气团沿锋面缓慢抬升形成。波动作用成的是波状云；"冷暖平流交汇"是干扰说法（沿锋面抬升已单列）。' },
  { id: 'ca-cond', multi: true, q: '云的形成需要哪些条件？',
    answers: ['空气中有凝结核或凝华核', '水汽达到饱和'],
    ds: ['强下沉增温', '高空辐射冷却到零下'],
    why: '凝结/凝华核 + 饱和缺一不可；气温和水汽含量决定能否达到饱和。' },
  { id: 'ca-wave', multi: true, q: '关于波状云，正确的说法有哪些？',
    answers: ['由气流的波动作用形成', '多出现在逆温层附近', '云层沿水平方向散布'],
    ds: ['由对流上升形成', '常降连续性大雨'],
    why: '逆温层附近的波动把湿空气抬过凝结高度，波峰成云波谷散开，故呈水平散布的云条云块。' },
  { id: 'ca-conv', multi: true, q: '关于积状云，正确的说法有哪些？',
    answers: ['由对流上升形成', '凝结高度低于对流上限时才可能有云', '垂直发展明显、底部平坦'],
    ds: ['由气团沿锋面缓慢抬升形成', '云层均匀成幕'],
    why: '对流上限高于凝结高度，空气才能在凝结高度以上继续发展成云；两者差值越大云越厚。' },
  { id: 'ca-chain', multi: false, q: '浓积云继续发展演变，下一步先形成？',
    answers: ['秃积雨云'],
    ds: ['鬃积雨云', '积云性层积云', '雨层云'],
    why: '发展链：淡积云→浓积云→秃积雨云（花椰菜顶开始变平）→鬃积雨云（长出马鬃/铁砧）。' },
  { id: 'ca-stage', multi: false, q: '积状云不同阶段，垂直气流速度怎样变化？',
    answers: ['淡积云弱→浓积云强盛→积雨云顶部受阻铺展'],
    ds: ['一直越来越强，没有上限', '淡积云最强，之后减弱', '各阶段没有明显差别'],
    why: '淡积云对流弱、云体小；浓积云上升气流强盛、垂直猛长；到积雨云顶被对流上限（稳定层）挡住，转为水平铺展成砧。' },
];

/* ============================================================
 * 视张角判别题库（课堂随测考过"3°左右"）
 * ============================================================ */
const CQ_ANGLES = [
  { id: 'ag-3', q: '云块视张角在3°左右，最可能是哪种云？', cn: '高积云', abbr: 'Ac',
    ds: ['层积云', '卷积云', '卷云'],
    why: '波状家族看张角：Cc <1°，Ac 1°~5°，Sc >5°。3° 落在高积云区间，且成行成群似田垄。' },
  { id: 'ag-half', q: '多数云块视张角小于1°，白色细鳞片成行排列，是哪种云？', cn: '卷积云', abbr: 'Cc',
    ds: ['高积云', '层积云', '卷层云'],
    why: '细小鳞片（<1°）是卷积云；注意与丝缕状的卷云区别——卷云是丝缕不是鳞片群。' },
  { id: 'ag-big', q: '云块很大，视张角大多数大于5°，成条状排列，是哪种云？', cn: '层积云', abbr: 'Sc',
    ds: ['高积云', '卷积云', '层云'],
    why: '>5° 的大云块成行成群＝层积云；层云是均匀幕状、没有云块结构。' },
  { id: 'ag-tiny', q: '云块视张角约0.5°，天上有晕，均匀薄幕，是哪种云？', cn: '卷层云', abbr: 'Cs',
    ds: ['卷积云', '高层云', '高积云'],
    why: '有晕＋均匀薄幕＝卷层云（晕是它的身份证）；卷积云是鳞片群不是幕。' },
];

/* ============================================================
 * 看图识云：真实云图（Wikimedia Commons，授权与作者见 credit）
 * img 为主图，svg 为加载失败兜底；答案 cn + 干扰项 ds
 * ============================================================ */
function cqSvg(id, body, ground) {
  return `<svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="云的形态示意图">
    <defs>
      <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0d1a33"/><stop offset="1" stop-color="#1a3a5c"/>
      </linearGradient>
      <linearGradient id="${id}-ns" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#57616e"/><stop offset="1" stop-color="#3f4854"/>
      </linearGradient>
    </defs>
    <rect width="320" height="180" fill="url(#${id}-sky)"/>
    ${body}
    ${ground ? `<path d="M0 156 Q70 146 150 152 T320 150 L320 180 L0 180 Z" fill="#1b3524"/>
    <path d="M0 164 Q90 158 180 162 T320 160 L320 180 L0 180 Z" fill="#122718"/>` : ''}
  </svg>`;
}
/* 积云一朵：底平顶凸，x 为中心，s 为缩放 */
function cqCu(x, y, s, shade) {
  return `<g>
    <ellipse cx="${x}" cy="${y}" rx="${34 * s}" ry="${11 * s}" fill="${shade}"/>
    <circle cx="${x - 20 * s}" cy="${y - 9 * s}" r="${13 * s}" fill="#edf3fa"/>
    <circle cx="${x + 4 * s}" cy="${y - 16 * s}" r="${18 * s}" fill="#edf3fa"/>
    <circle cx="${x + 24 * s}" cy="${y - 7 * s}" r="${13 * s}" fill="#edf3fa"/>
    <ellipse cx="${x}" cy="${y - 5 * s}" rx="${32 * s}" ry="${10 * s}" fill="#edf3fa"/>
  </g>`;
}

const CQ_SCENES = [
  { id: 'sc-cuhum', cn: '淡积云', abbr: 'Cu hum', ground: true,
    ds: ['浓积云', '积雨云', '碎积云'],
    desc: '晴天午后：几朵小云块孤立分散，底部平坦、顶部圆弧凸起',
    svg: () => cqSvg('scuhum', cqCu(95, 118, 0.9, '#b8c6d8') + cqCu(235, 132, 0.55, '#b8c6d8'), true),
    why: '底平顶凸、个体分明、云体小而不厚＝淡积云；浓积云要高大如塔。' },
  { id: 'sc-fc', cn: '碎积云', abbr: 'Fc', ground: true,
    ds: ['淡积云', '碎层云', '碎雨云'],
    desc: '天边零散飘着几小朵形状不完整、大小不一的碎云块',
    svg: () => cqSvg('sfc',
      `<ellipse cx="70" cy="80" rx="16" ry="7" fill="#dfe8f2"/><circle cx="64" cy="75" r="7" fill="#dfe8f2"/>
       <ellipse cx="150" cy="118" rx="13" ry="6" fill="#e9f0f8"/>
       <ellipse cx="225" cy="70" rx="19" ry="8" fill="#d5e1ee"/><circle cx="232" cy="64" r="8" fill="#d5e1ee"/>
       <ellipse cx="275" cy="120" rx="11" ry="5" fill="#e9f0f8"/>`, true),
    why: '零散破碎、个头小、不成完整积云形态＝碎积云 Fc；它常是积云消散或形成中的碎片。' },
  { id: 'sc-cucong', cn: '浓积云', abbr: 'Cu cong', ground: true,
    ds: ['淡积云', '秃积雨云', '层积云'],
    desc: '一座高大的"云塔"：底部平坦，顶部花椰菜状凸起层层叠叠，垂直发展旺盛',
    svg: () => cqSvg('scucong',
      `<ellipse cx="160" cy="138" rx="52" ry="12" fill="#8fa2b8"/>
       <circle cx="128" cy="120" r="18" fill="#c3d0e0"/><circle cx="192" cy="118" r="17" fill="#c3d0e0"/>
       <circle cx="140" cy="98" r="19" fill="#e3ebf5"/><circle cx="178" cy="95" r="20" fill="#e3ebf5"/>
       <circle cx="158" cy="72" r="21" fill="#edf3fa"/><circle cx="140" cy="60" r="15" fill="#edf3fa"/>
       <circle cx="176" cy="62" r="14" fill="#edf3fa"/><circle cx="158" cy="46" r="12" fill="#f2f7fc"/>`, true),
    why: '比淡积云高大得多、花椰菜顶层层堆叠但顶部还没"化"＝浓积云；若顶部变平或出纤维就是积雨云。' },
  { id: 'sc-cbcalv', cn: '秃积雨云', abbr: 'Cb calv', ground: true,
    ds: ['浓积云', '鬃积雨云', '积云性层积云'],
    desc: '飞机上看到的云顶：花椰菜状轮廓已开始变得平坦圆滑，像扣了个光滑的大圆顶',
    svg: () => cqSvg('scbcalv',
      `<ellipse cx="160" cy="140" rx="60" ry="13" fill="#8fa2b8"/>
       <circle cx="120" cy="118" r="22" fill="#c3d0e0"/><circle cx="200" cy="116" r="21" fill="#c3d0e0"/>
       <circle cx="138" cy="90" r="24" fill="#e3ebf5"/><circle cx="184" cy="88" r="23" fill="#e3ebf5"/>
       <circle cx="160" cy="58" r="30" fill="#f2f7fc"/><circle cx="160" cy="52" r="22" fill="#f7fafd"/>`, true),
    why: '浓积云向鬃积雨云的过渡阶段：云顶冰晶化、花椰菜轮廓消失变平＝秃积雨云；长出纤维状马鬃/铁砧才是鬃积雨云。' },
  { id: 'sc-cbcap', cn: '鬃积雨云', abbr: 'Cb cap', ground: true,
    ds: ['秃积雨云', '浓积云', '密卷云'],
    desc: '远望如耸立的高山：云顶铺开成巨大的铁砧，边缘拖着纤维状"马鬃"',
    svg: () => cqSvg('scbcap',
      `<path d="M40 46 L280 46 L262 60 L58 60 Z" fill="#dfe7f0"/>
       <path d="M60 60 L120 58 M140 60 L200 59 M220 60 L258 58" stroke="#c9d6e6" stroke-width="2" fill="none" opacity=".8"/>
       <path d="M262 52 q14 2 22 10 M58 52 q-14 2 -22 10" stroke="#dfe7f0" stroke-width="2" fill="none"/>
       <circle cx="128" cy="112" r="24" fill="#c3d0e0"/><circle cx="196" cy="110" r="23" fill="#c3d0e0"/>
       <circle cx="146" cy="84" r="26" fill="#e3ebf5"/><circle cx="180" cy="82" r="25" fill="#e3ebf5"/>
       <circle cx="162" cy="66" r="20" fill="#edf3fa"/>
       <ellipse cx="160" cy="140" rx="58" ry="12" fill="#8fa2b8"/>`, true),
    why: '顶部纤维结构（马鬃/铁砧）＝成熟期鬃积雨云；秃积雨云的顶是光滑圆顶、没有纤维。' },
  { id: 'sc-sc', cn: '层积云', abbr: 'Sc', ground: true,
    ds: ['高积云', '卷积云', '高层云'],
    desc: '大块的云团排成松散的行列，块头很大，缝隙里能看见蓝天',
    svg: () => cqSvg('ssc',
      [40, 130, 220].map(x => `<ellipse cx="${x}" cy="66" rx="34" ry="15" fill="#dfe8f2"/><circle cx="${x - 8}" cy="56" r="13" fill="#dfe8f2"/><circle cx="${x + 12}" cy="55" r="11" fill="#dfe8f2"/>`).join('') +
      [95, 190, 285].map(x => `<ellipse cx="${x}" cy="108" rx="30" ry="13" fill="#cdd9e6"/><circle cx="${x - 6}" cy="99" r="11" fill="#cdd9e6"/><circle cx="${x + 12}" cy="98" r="10" fill="#cdd9e6"/>`).join(''), true),
    why: '成行成群的"团状/条状"云块、视张角大多 >5°＝层积云；块更小（1°~5°）的是高积云。' },
  { id: 'sc-sccast', cn: '堡状高积云', abbr: 'Ac cast', ground: false,
    ds: ['荚状高积云', '透光高积云', '浓积云'],
    desc: '中空的云层上沿同时鼓起一排小"塔楼"，像锯齿一样排开',
    svg: () => cqSvg('sscast',
      [55, 130, 205, 275].map(x => `<ellipse cx="${x}" cy="110" rx="28" ry="12" fill="#d5e1ee"/>
       <rect x="${x - 9}" y="84" width="18" height="22" rx="3" fill="#e9f0f8"/>
       <rect x="${x - 9}" y="80" width="6" height="7" fill="#e9f0f8"/><rect x="${x + 3}" y="80" width="6" height="7" fill="#e9f0f8"/>`).join('')),
    why: '云条顶部一排向上凸起的小塔＝堡状云（早晨出现预示午后对流爆发、雷雨临）；弧形凸起的是普通高积云。' },
  { id: 'sc-st', cn: '层云', abbr: 'St', ground: true,
    ds: ['雨层云', '高层云', '层积云'],
    desc: '灰白色的云幕低低铺开，没有丝缕也没有云块，正罩住远处的山头',
    svg: () => cqSvg('sst',
      `<path d="M0 92 Q60 84 120 90 T240 88 T320 92 L320 150 L0 150 Z" fill="#aeb9c6"/>
       <path d="M0 104 Q80 98 160 102 T320 102 L320 150 L0 150 Z" fill="#9aa6b4" opacity=".7"/>
       <path d="M60 150 Q130 112 210 150 Z" fill="#22432e"/>`, true),
    why: '低而均匀、无结构的幕＝层云；同样遮天但又厚又暗黑、下着连绵雨的是雨层云。' },
  { id: 'sc-ns', cn: '雨层云', abbr: 'Ns', ground: true,
    ds: ['高层云', '层云', '蔽光层积云'],
    desc: '厚厚的暗灰色云层铺满整个天空，看不见日月，下面正下着连绵的雨',
    svg: () => cqSvg('sns',
      `<path d="M0 0 H320 V118 Q280 126 240 120 T160 122 T80 120 T0 124 Z" fill="url(#sns-ns)"/>
       <path d="M0 118 Q80 112 160 118 T320 114" stroke="#6e7987" stroke-width="3" fill="none"/>
       ${[30, 70, 110, 150, 190, 230, 270, 300].map(x => `<path d="M${x} 122 l-5 22" stroke="#9fb4cc" stroke-width="1.6" opacity=".65"/>`).join('')}`, true),
    why: '遮蔽全天、暗灰色、连续性降水＝雨层云；高层云虽也是幕状但更亮、日月位置还能辨认。' },
  { id: 'sc-fn', cn: '碎雨云', abbr: 'Fn', ground: true,
    ds: ['碎积云', '碎层云', '雨层云'],
    desc: '低空有一层厚厚的雨云幕，其下几朵深灰色破云正快速掠过，像一群"江猪"游过',
    svg: () => cqSvg('sfn',
      `<path d="M0 0 H320 V78 Q240 84 160 80 T0 84 Z" fill="#4a5563"/>
       ${[[55, 106, 24], [130, 122, 18], [200, 100, 22], [262, 120, 16]].map(([x, y, r]) =>
        `<path d="M${x - r} ${y} q${r * .5} ${-r * .8} ${r} 0 q${r * .6} ${-r * .5} ${r * .9} ${r * .2} q${-r * .2} ${r * .7} ${-r} ${r * .5} q${-r} ${r * .3} ${-r * .9} ${-r * .7} Z" fill="#39414d"/>`).join('')}`, true),
    why: '降水云层底下破碎、移动快的低云＝碎雨云 Fn（俗称"江猪"）；它的出现说明上面的雨层云水汽充足。' },
  { id: 'sc-as', cn: '高层云', abbr: 'As', ground: false,
    ds: ['雨层云', '卷层云', '层积云'],
    desc: '灰白的云幕铺满天空，隐约有条纹结构，隔着云能辨认太阳的位置',
    svg: () => cqSvg('sas',
      `<rect width="320" height="180" fill="#77828f" opacity=".92"/>
       <rect width="320" height="180" fill="#8b95a3" opacity=".5"/>
       <circle cx="228" cy="62" r="20" fill="#d9e0ea" opacity=".8"/>
       <path d="M0 44 Q120 40 320 46" stroke="#a7b1bd" stroke-width="2" fill="none" opacity=".7"/>
       <path d="M0 78 Q140 74 320 80" stroke="#a7b1bd" stroke-width="2" fill="none" opacity=".6"/>
       <path d="M0 112 Q160 108 320 114" stroke="#a7b1bd" stroke-width="2" fill="none" opacity=".5"/>`),
    why: '均匀幕状＋条纹结构、日月位置朦胧可辨＝高层云（灰布更暗更厚、日月不可辨的是雨层云）。' },
  { id: 'sc-ac', cn: '高积云', abbr: 'Ac', ground: false,
    ds: ['层积云', '卷积云', '絮状高积云'],
    desc: '中空的云块成行成群、沿水平方向排成波浪状的"田垄"',
    svg: () => cqSvg('sac',
      [[30, 58], [88, 50], [146, 60], [204, 52], [262, 58]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="19" ry="9" fill="#dfe8f2"/><circle cx="${x - 4}" cy="${y - 6}" r="7" fill="#dfe8f2"/>`).join('') +
      [[60, 96], [118, 90], [176, 98], [234, 92], [292, 96]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="17" ry="8" fill="#cdd9e6"/><circle cx="${x + 5}" cy="${y - 5}" r="6" fill="#cdd9e6"/>`).join('') +
      [[30, 130], [88, 124], [146, 132], [204, 126]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="16" ry="7.5" fill="#c3d0e0"/>`).join('')),
    why: '成行成群、形似田垄或波浪、视张角 1°~5°＝高积云；块大 >5° 是层积云，细鳞 <1° 是卷积云。' },
  { id: 'sc-cc', cn: '卷积云', abbr: 'Cc', ground: false,
    ds: ['高积云', '卷云', '毛卷层云'],
    desc: '高高的天上布满细小的白色鳞片，一圈圈排列像微风拂过的水面涟漪',
    svg: () => cqSvg('scc',
      [0, 1, 2, 3].map(r => [0, 1, 2, 3, 4, 5, 6, 7, 8].map(c =>
        `<ellipse cx="${14 + c * 36 + (r % 2) * 18}" cy="${38 + r * 22}" rx="${9}" ry="${5.5}" fill="${r % 2 ? '#d5e1ee' : '#e9f0f8'}"/>`).join('')).join('')),
    why: '视张角 <1° 的细鳞片群＝卷积云；块大一些（1°~5°）就是高积云。' },
  { id: 'sc-cifil', cn: '毛卷云', abbr: 'Ci fil', ground: false,
    ds: ['钩卷云', '密卷云', '卷积云'],
    desc: '淡蓝的天上飘着几缕纤细的白云丝，像羽毛和马尾巴一样散乱舒展',
    svg: () => cqSvg('scifil',
      `<path d="M20 60 Q90 40 150 58 T290 44" stroke="#e8f0fa" stroke-width="2.4" fill="none" opacity=".9"/>
       <path d="M40 100 Q120 80 200 96 T310 86" stroke="#e8f0fa" stroke-width="2" fill="none" opacity=".75"/>
       <path d="M10 132 Q80 120 150 130 T260 124" stroke="#dfe8f2" stroke-width="1.8" fill="none" opacity=".6"/>
       <path d="M120 30 Q170 22 240 30" stroke="#eef4fb" stroke-width="1.6" fill="none" opacity=".7"/>`),
    why: '纤细丝缕、分离散乱、像羽毛马尾＝毛卷云；末端下弯带"钩"的是钩卷云，成片厚密的是密卷云。' },
  { id: 'sc-ciunc', cn: '钩卷云', abbr: 'Ci unc', ground: false,
    ds: ['毛卷云', '密卷云', '卷积云'],
    desc: '几朵小云丝头部略厚、尾部拖着下弯的钩，像一排逗号挂在天上',
    svg: () => cqSvg('sciunc',
      [[70, 60], [150, 46], [230, 66], [270, 40]].map(([x, y]) =>
        `<circle cx="${x}" cy="${y}" r="7" fill="#eef4fb"/><path d="M${x - 3} ${y + 4} q-8 14 -24 18" stroke="#e8f0fa" stroke-width="2.2" fill="none"/><path d="M${x + 3} ${y + 5} q-6 12 -20 15" stroke="#dfe8f2" stroke-width="1.6" fill="none" opacity=".8"/>`).join('')),
    why: '云丝末端呈钩状（逗号状）＝钩卷云；成群系统侵入天空预示天气将转坏。' },
  { id: 'sc-cidens', cn: '密卷云', abbr: 'Ci dens', ground: false,
    ds: ['毛卷云', '钩卷云', '淡积云'],
    desc: '较厚密的白色云团成片布满了小半个天空，边缘仍带着丝缕',
    svg: () => cqSvg('scidens',
      [[80, 62, 1], [180, 50, 1.2], [262, 72, .9], [140, 104, .8]].map(([x, y, s]) =>
        `<circle cx="${x - 18 * s}" cy="${y + 4 * s}" r="${14 * s}" fill="#c9d6e6"/><circle cx="${x + 14 * s}" cy="${y + 6 * s}" r="${13 * s}" fill="#c9d6e6"/>
         <circle cx="${x - 6 * s}" cy="${y - 6 * s}" r="${16 * s}" fill="#eef4fb"/><circle cx="${x + 12 * s}" cy="${y - 2 * s}" r="${14 * s}" fill="#e9f0f8"/>`).join('') +
      `<path d="M20 130 Q70 122 120 128" stroke="#dfe8f2" stroke-width="1.8" fill="none" opacity=".7"/>
       <path d="M200 126 Q250 118 300 124" stroke="#dfe8f2" stroke-width="1.6" fill="none" opacity=".6"/>`),
    why: '成片厚密、常带淡影、占天空较大范围的卷云＝密卷云（也常是积雨云顶部解体残留）；纤细分散的是毛卷云。' },
  { id: 'sc-cs', cn: '卷层云', abbr: 'Cs', ground: false,
    ds: ['高层云', '卷云', '高积云'],
    desc: '乳白色的薄云幕匀匀地罩着天空，太阳周围套着一圈明显的晕',
    svg: () => cqSvg('scs',
      `<rect width="320" height="180" fill="#cfd9e6" opacity=".42"/>
       <circle cx="228" cy="64" r="16" fill="#f5f8fc"/>
       <circle cx="228" cy="64" r="36" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="5 6" opacity=".85"/>
       <circle cx="228" cy="64" r="46" fill="none" stroke="#ffffff" stroke-width="1" stroke-dasharray="3 8" opacity=".5"/>`),
    why: '均匀薄幕＋日月有晕＝卷层云；晕是阳光穿过云中冰晶折射形成的，只有晕才能证明薄幕的存在。' },
];

/* 看图识云的真实云图与署名（Wikimedia Commons）：[路径, 文件名, 作者, 许可] */
const CQ_SCENE_IMG = {
  'sc-cuhum':  ['img/sc-cuhum.jpg',  'Cumulus humilis clouds', 'Toby Hudson', 'CC BY-SA 3.0'],
  'sc-fc':     ['img/sc-fc.jpg',     'Cumulus fractus in Altus, Oklahoma III', 'GerritR', 'CC BY-SA 4.0'],
  'sc-cucong': ['img/sc-cucong.jpg', 'Cumulus congestus cloud', 'Bidgee', 'CC BY-SA 3.0'],
  'sc-cbcalv': ['img/sc-cbcalv.jpg', 'Cumulonimbus calvus a2', 'Janne Naukkarinen', 'Public domain'],
  'sc-cbcap':  ['img/sc-cbcap.jpg',  'Cumulonimbus capillatus incus anvil cloud', 'Couch-scratching-cats', 'CC BY-SA 3.0'],
  'sc-sc':     ['img/sc-sc.jpg',     'Stratocumulus clouds 21072012', 'Joydeep', 'CC BY-SA 3.0'],
  'sc-sccast': ['img/sc-sccast.jpg', 'Altocumulus castellanus unter hohen Wolken', 'GerritR', 'CC BY-SA 4.0'],
  'sc-st':     ['img/sc-st.jpg',     'Stratus-Opacus-Uniformis', 'PiccoloNamek', 'CC BY-SA 3.0'],
  'sc-ns':     ['img/sc-ns.jpg',     'Ns1', '（Wikimedia Commons）', 'CC BY-SA 3.0'],
  'sc-fn':     ['img/sc-fn.jpg',     'Galley Common scud clouds August 22 2021 01', 'Rubbish computer', 'CC BY-SA 4.0'],
  'sc-as':     ['img/sc-as.jpg',     'Altostratus translucidus 1', 'Couch-scratching-cats', 'Public domain'],
  'sc-ac':     ['img/sc-ac.jpg',     'Altocumulus stratiformis 01', '（Wikimedia Commons）', 'Public domain'],
  'sc-cc':     ['img/sc-cc.jpg',     'Cirrocumulus clouds over Bergsfjorden, Senja', 'Ximonic (Simo Räsänen)', 'CC BY-SA 3.0'],
  'sc-cifil':  ['img/sc-cifil.jpg',  'Long Cirrus fibratus', '（Wikimedia Commons）', 'CC BY-SA 3.0'],
  'sc-ciunc':  ['img/sc-ciunc.jpg',  'Cirrus uncinus', '1bumer', 'CC BY-SA 4.0'],
  'sc-cidens': ['img/sc-cidens.jpg', 'Cirrus spissatus cumulonimbogenitus in Oklahoma', 'GerritR', 'CC BY-SA 4.0'],
  'sc-cs':     ['img/sc-cs.jpg',     'Cirrostratus fibratus with 22 degrees halo', 'Eduardo Marquetti', 'CC BY-SA 2.0'],
};
