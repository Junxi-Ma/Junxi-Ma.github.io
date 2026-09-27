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
