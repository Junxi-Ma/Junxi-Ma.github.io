/* ============================================================
   weather.js — 天气组件
   数据源：Open-Meteo（免密钥、支持跨域，浏览器直连）。
   断网 / 请求超时 / 被墙一律降级为占位显示，不报错、不留空。
   城市在 assets/js/site-config.js 的 weather 段改。
   ============================================================ */

import { siteConfig } from './site-config.js';

const card = document.getElementById('weather-card');
const conf = siteConfig.weather;

if (card && conf?.enabled) {
  const el = {
    city: document.getElementById('weather-city'),
    temp: document.getElementById('weather-temp'),
    text: document.getElementById('weather-text'),
    icon: document.getElementById('weather-icon'),
    tag: document.getElementById('weather-tag'),
  };

  /* WMO 天气代码 → 图标 + 中文描述 */
  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.6M12 19.4V22M4.2 4.2l1.9 1.9M17.9 17.9l1.9 1.9M2 12h2.6M19.4 12H22M4.2 19.8l1.9-1.9M17.9 6.1l1.9-1.9"/>',
    cloudSun: '<circle cx="9" cy="9" r="3.4"/><path d="M9 2.6v1.6M3.6 9h-1.6M4.6 4.6 3.5 3.5M13.4 4.6l1.1-1.1"/><path d="M9.5 18h8.2a3.3 3.3 0 0 0 .3-6.6 4.6 4.6 0 0 0-8.7-1A3.8 3.8 0 0 0 9.5 18Z"/>',
    cloud: '<path d="M6.8 18h10.4a3.9 3.9 0 0 0 .3-7.8 5.5 5.5 0 0 0-10.4-1.2A4.5 4.5 0 0 0 6.8 18Z"/>',
    fog: '<path d="M6.8 15h10.4a3.9 3.9 0 0 0 .3-7.8 5.5 5.5 0 0 0-10.4-1.2A4.5 4.5 0 0 0 6.8 15Z"/><path d="M4 19h16M7 22h10"/>',
    drizzle: '<path d="M6.8 15h10.4a3.9 3.9 0 0 0 .3-7.8 5.5 5.5 0 0 0-10.4-1.2A4.5 4.5 0 0 0 6.8 15Z"/><path d="M9 18.5v1.5M12.5 18.5v1.5M16 18.5v1.5"/>',
    rain: '<path d="M6.8 14.5h10.4a3.9 3.9 0 0 0 .3-7.8 5.5 5.5 0 0 0-10.4-1.2A4.5 4.5 0 0 0 6.8 14.5Z"/><path d="M8.5 18l-1 3M12 18l-1 3M15.5 18l-1 3"/>',
    snow: '<path d="M6.8 14.5h10.4a3.9 3.9 0 0 0 .3-7.8 5.5 5.5 0 0 0-10.4-1.2A4.5 4.5 0 0 0 6.8 14.5Z"/><path d="M9 18.4h.01M12.5 20.4h.01M16 18.4h.01M12.5 17.4h.01M9 21.4h.01"/>',
    thunder: '<path d="M6.8 14.5h10.4a3.9 3.9 0 0 0 .3-7.8 5.5 5.5 0 0 0-10.4-1.2A4.5 4.5 0 0 0 6.8 14.5Z"/><path d="m12.6 16.8-2.6 3.4h2.4l-1 3 3.4-4.2h-2.4l1-2.2Z"/>',
  };

  function describe(code) {
    if (code === 0) return ['sun', '晴'];
    if (code === 1) return ['cloudSun', '少云'];
    if (code === 2) return ['cloudSun', '多云'];
    if (code === 3) return ['cloud', '阴'];
    if (code === 45 || code === 48) return ['fog', '雾'];
    if (code >= 51 && code <= 57) return ['drizzle', '毛毛雨'];
    if (code >= 61 && code <= 67) return ['rain', '雨'];
    if (code >= 71 && code <= 77) return ['snow', '雪'];
    if (code >= 80 && code <= 82) return ['rain', '阵雨'];
    if (code === 85 || code === 86) return ['snow', '阵雪'];
    if (code >= 95) return ['thunder', '雷阵雨'];
    return ['cloud', '—'];
  }

  function paint(icon, text, temp, tag) {
    el.city.textContent = conf.city;
    el.temp.textContent = temp;
    el.text.textContent = text;
    el.tag.textContent = tag || 'WEATHER';
    el.icon.innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon] || ICONS.cloud}</svg>`;
    card.hidden = false;
    card.dataset.kind = icon;
  }

  (async () => {
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', conf.latitude);
      url.searchParams.set('longitude', conf.longitude);
      url.searchParams.set('current', 'temperature_2m,weather_code');
      url.searchParams.set('timezone', 'auto');

      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(res.status);

      const data = await res.json();
      const now = data?.current;
      if (typeof now?.temperature_2m !== 'number') throw new Error('bad payload');

      const [icon, text] = describe(now.weather_code);
      paint(icon, text, `${Math.round(now.temperature_2m)}°`, 'WEATHER');
    } catch {
      // 拿不到就退回占位，保持版面完整
      paint('cloud', '暂不可用', '--°', 'OFFLINE');
    }
  })();
}
