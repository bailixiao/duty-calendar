// 缺人通知：把近期缺人的勤務整理成一段文字（附報名連結），可複製或直接分享到 LINE 群組。
// 內容只有勤務名稱、日期、時間、地點、缺幾人，都是行事曆上公開的資料（沒有名字、電話）。
(function () {
  'use strict';

  function siteUrl() {
    return location.origin + location.pathname;
  }

  /**
   * rows：[{ duty, date, state }]，只取缺人（state.kind === 'short'）的，依日期排好。
   * 回傳通知文字；沒有缺人回傳空字串。
   */
  function shortageText(rows) {
    const short = rows.filter((r) => r.state.kind === 'short')
      .slice().sort((a, b) => a.date.localeCompare(b.date) || (a.duty.startTime || '').localeCompare(b.duty.startTime || ''));
    if (!short.length) return '';
    const lines = ['【教全區勤務缺人通知】', '以下勤務還缺人，歡迎發心報名，點連結就能報名：'];
    let lastDate = '';
    short.forEach(({ duty, date, state }) => {
      if (date !== lastDate) {
        lines.push('', Fmt.shortDate(date));
        lastDate = date;
      }
      const meta = [Fmt.cardTime(duty, date), duty.location].filter(Boolean).join('・');
      lines.push(`・${duty.name}　${state.label}${meta ? `（${meta}）` : ''}`);
      lines.push(`  ${siteUrl()}#/duty/${encodeURIComponent(duty.id)}?date=${date}`);
    });
    lines.push('', `行事曆：${siteUrl()}`);
    return lines.join('\n');
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

  window.Share = { shortageText, copyText, buttonsHtml, bind };
})();
