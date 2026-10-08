// 缺人通知：把近期缺人的勤務整理成一段文字（附報名連結），可複製或直接分享到 LINE 群組。
// 內容只有勤務名稱、日期、時間、地點、缺幾人，都是行事曆上公開的資料（沒有名字、電話）。
(function () {
  'use strict';

  /** 網站網址；加上 openExternalBrowser=1，從 LINE 點連結會直接用手機的瀏覽器開啟（LINE 內建瀏覽器收不到提醒） */
  function siteUrl() {
    return location.origin + location.pathname + '?openExternalBrowser=1';
  }

  /** 依勤務名稱配一個小圖示，讓通知比較生動 */
  function dutyEmoji(duty) {
    const n = duty.name || '';
    if (/打掃|掃除|打蠟|洗/.test(n)) return '🧹';
    if (/烹飪|廚|蔬食/.test(n)) return '🍳';
    if (/捐血/.test(n)) return '🩸';
    if (/值夜/.test(n)) return '🌙';
    if (/拜香/.test(n)) return '🙏'; // 表情符號沒有「香」，用合十代替
    if (/敬老|重陽|長青/.test(n)) return '👴';
    if (/志工/.test(n)) return '🙌';
    if (/班/.test(n)) return '📖';
    if (duty.nature === '活動') return '🎉';
    return '✨';
  }

  /**
   * rows：[{ duty, date, state }]，只取缺人（state.kind === 'short'）的，依日期排好。
   * 回傳通知文字；沒有缺人回傳空字串。
   */
  function shortageText(rows) {
    const short = rows.filter((r) => r.state.kind === 'short')
      .slice().sort((a, b) => a.date.localeCompare(b.date) || (a.duty.startTime || '').localeCompare(b.duty.startTime || ''));
    if (!short.length) return '';
    const lines = [window.SITE.shortageTitle, '以下勤務還缺人，歡迎發心了愿報名 💪', '點連結就能報名 👇'];
    let lastDate = '';
    short.forEach(({ duty, date, state }) => {
      if (date !== lastDate) {
        lines.push('', `📅 ${Fmt.shortDate(date)}`);
        lastDate = date;
      }
      const meta = [Fmt.cardTime(duty, date), duty.location].filter(Boolean).join('・');
      lines.push(`${dutyEmoji(duty)} ${duty.name}　🙋 ${state.label}${meta ? `（📍${meta}）` : ''}`);
      lines.push(`👉 ${siteUrl()}#/duty/${encodeURIComponent(duty.id)}?date=${date}&go=signup`);
    });
    lines.push('', `🗓️ 行事曆：${siteUrl()}`, '', '感謝大家歡喜了愿，感謝慈悲 🙏😊');
    return lines.join('\n');
  }

  /** 需要人數：勤務寫還缺幾位（共需幾位）；道務、教育寫名額還有幾位，不限名額寫歡迎參加 */
  function needText(duty, day) {
    const d = day || { total: 0, counts: {}, full: false };
    const counts = d.counts || {};
    if (d.full) return '已額滿，感恩大家 🙏';
    if (duty.category === '道務' || duty.category === '教育') {
      if (duty.positions.some((p) => p.max === null)) return '不限名額，歡迎參加';
      const left = duty.positions.reduce((sum, p) => sum + Math.max(p.max - (counts[p.id] || 0), 0), 0);
      return `名額還有 ${left} 位`;
    }
    if (duty.totalNeed) {
      const people = d.people !== undefined ? d.people : d.total;
      const left = Math.max(duty.totalNeed - people, 0);
      return left ? `還缺 ${left} 位（共需 ${duty.totalNeed} 位，已報 ${people} 位）` : `已有 ${people} 位（共需 ${duty.totalNeed} 位），人數足了，還可以報名`;
    }
    const need = duty.positions.reduce((sum, p) => sum + Fmt.effectiveMin(p), 0);
    const short = duty.positions.reduce((sum, p) => sum + Math.max(Fmt.effectiveMin(p) - (counts[p.id] || 0), 0), 0);
    if (short > 0) return `還缺 ${short} 位（共需 ${need} 位）`;
    return need ? `已有 ${d.total} 位（共需 ${need} 位），還可以報名` : `已報 ${d.total} 位，歡迎參加`;
  }

  /**
   * 邀請通知（後台近期勤務「複製通知」）：rows = [{ duty, date }]，一筆或好幾筆合成一則。
   * 只有名稱、日期、時段、地點、需要人數、報名連結（公開資料）。
   */
  function inviteText(rows) {
    const list = rows.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.duty.startTime || '').localeCompare(b.duty.startTime || ''));
    const block = ({ duty, date, signups }) => {
      const out = [`【${duty.name}】`, `📅 日期：${Fmt.rocDate(date)}`];
      const time = Fmt.cardTime(duty, date);
      if (time) out.push(`⏰ 時段：${time}`);
      if (duty.location) out.push(`📍 地點：${duty.location}`);
      out.push(`🙋 需要人數：${needText(duty, (duty.days || {})[date])}`);
      if (duty.leaderTitle && signups) {
        const ls = [...new Set(signups.filter((s) => s.date === date && s.leader).map((s) => s.name))];
        out.push(`★ ${duty.leaderTitle}：${ls.length ? ls.join('、') : '還需要一位'}`);
      }
      const roster = rosterLines(duty, date, signups);
      if (roster.length) out.push('📋 目前報名：', ...roster);
      out.push(`👉 報名：${siteUrl()}#/duty/${encodeURIComponent(duty.id)}?date=${date}&go=signup`);
      return out.join('\n');
    };
    if (list.length === 1) return block(list[0]) + '\n\n歡迎家人們踴躍成全 🙏';
    return [window.SITE.inviteTitle, '', list.map(block).join('\n\n'), '', '歡迎家人們踴躍成全，感謝慈悲 🙏😊'].join('\n');
  }

  /** 每個了愿項目一行：「・項目（已報／名額）：名字、名字」；signups 沒給（沒讀到名單）就不列 */
  function rosterLines(duty, date, signups) {
    if (!signups || duty.mode === '公告型' || !duty.positions || !duty.positions.length) return [];
    return duty.positions.map((p) => {
      const names = signups.filter((s) => s.date === date && s.positionId === p.id && !s.accompany).map((s) => s.name);
      const cap = p.max !== null && p.max !== undefined ? p.max : Fmt.effectiveMin(p);
      const full = p.max !== null && p.max !== undefined && names.length >= p.max;
      return `・${p.name}（${names.length}${cap ? '／' + cap : ''}）${full ? '✅' : ''}：${names.length ? names.join('、') : '還沒有人'}`;
    });
  }

  /** 讀每個勤務的報名名單（詳情）再產生邀請通知；讀不到的那筆就不列名單 */
  async function inviteTextFull(rows) {
    const ids = [...new Set(rows.map((r) => r.duty.id))];
    const details = {};
    await Promise.all(ids.map((id) => Api.getDuty(id).then((d) => { details[id] = d; }, () => {})));
    return inviteText(rows.map((r) => {
      const d = details[r.duty.id];
      return d ? { duty: Object.assign({}, r.duty, { days: d.days || r.duty.days, totalNeed: d.totalNeed || r.duty.totalNeed || 0, leaderTitle: d.leaderTitle || '' }), date: r.date, signups: d.signups || [] } : r;
    }));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /** 缺人提醒框裡的兩個按鈕（複製、傳到 LINE） */
  function buttonsHtml() {
    return `
      <div class="share-actions">
        <button type="button" class="btn" data-share-copy>複製缺人通知</button>
        <button type="button" class="btn btn-line" data-share-line>傳到 LINE</button>
      </div>`;
  }

  /** 在 container 裡的按鈕綁上動作；getText() 在按下時才產生文字（資料可能已更新） */
  function bind(container, getText) {
    const copyBtn = container.querySelector('[data-share-copy]');
    const lineBtn = container.querySelector('[data-share-line]');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const ok = await copyText(getText());
        copyBtn.textContent = ok ? '已複製 ✓' : '複製失敗，請改按「傳到 LINE」';
        setTimeout(() => { copyBtn.textContent = '複製缺人通知'; }, 3000);
      });
    }
    if (lineBtn) {
      lineBtn.addEventListener('click', () => {
        // LINE 官方的分享網址：開啟 LINE 選擇要傳給哪個群組或好友
        window.open('https://line.me/R/msg/text/?' + encodeURIComponent(getText()), '_blank', 'noopener');
      });
    }
  }

  window.Share = { shortageText, inviteText, inviteTextFull, rosterLines, needText, copyText, buttonsHtml, bind };
})();
