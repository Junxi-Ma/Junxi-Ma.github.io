/* ============================================================
   site-config.js — 全站控制中心
   身份信息、氛围特效开关、天气组件、预留栏目，全在这一个文件里。
   改这里不用碰任何页面代码。
   ============================================================ */

export const siteConfig = {
  /* ---------- 身份 ---------- */
  name: 'Michael',
  avatar: 'assets/img/avatar.svg',   // 换成自己的照片：丢进 assets/img/ 再改这个路径
  bio: '热爱构建的开发者。把遇到的问题写成小工具，把新学到的东西沉淀成笔记。',
  social: {
    email: 'michael@example.com',
    github: 'https://github.com/',
  },

  /* ---------- 氛围特效 ----------
     每一项都可以单独关掉；全部关掉时页面零额外开销。 */
  effects: {
    click: true,        // 点击涟漪
    dark: 'fireflies',  // 暗色下的背景氛围：fireflies | sakura | snow | none
    light: 'sakura',    // 亮色下的背景氛围：fireflies | sakura | snow | none
    danmaku: false,     // 弹幕（文字横穿屏幕）
    grass: false,       // 页面底部的风动草丛
  },

  // 弹幕文案池（effects.danmaku 打开后随机取用）
  danmakuList: [
    '构建小工具，记录学习与思考',
    '纯静态站点，零构建步骤',
    'Markdown 写笔记，push 即上线',
  ],

  /* ---------- 天气组件 ----------
     用 Open-Meteo 免密钥接口（浏览器直连，无需任何后端）。
     只改经纬度即可换城市。断网 / 被墙时自动降级为占位显示。 */
  weather: {
    enabled: true,
    city: '北京',
    latitude: 39.9042,
    longitude: 116.4074,
  },

  /* ---------- 预留栏目 ----------
     置为 true 并用起来之后，导航会自动出现对应入口；
     数据为空时不显示，避免空页面挂在菜单上。 */
  reserved: {
    photos: false,
    timeline: false,
    moments: false,
  },
};

export default siteConfig;
