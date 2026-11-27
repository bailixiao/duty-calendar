// 🎤 語音助理的後台動作（2026/11/27，後台才載入）：新增勤務、停課、放到首頁、補登出席、複製通知。
// 都是按了確認才做，用登入的帳號、走原本的 API（權限、操作紀錄照舊）。
(function () {
  if (!window.Voice) return;
  const esc = (s) => Fmt.esc(s);
  const when = (p) => `${esc(p.dutyName || '')}　${esc(Fmt.shortDate(p.date))}`;
  const refresh = () => { try { if (window.DutyAdminPage && DutyAdminPage.reload) DutyAdminPage.reload(); } catch (e) { /* 不在勤務管理頁 */ } };

  Voice.register({
    create: {
      title: '➕ 新增勤務',
      confirm: '打開新增畫面',
      detail: (p) => `<p class="hint">會打開新增的草稿畫面（${esc(p.duty.name)}${p.duty.start ? '・' + esc(Fmt.shortDate(p.duty.start)) : ''}），每一欄都可以再改，按「確認新增」才會新增。</p>`,
      run: (p, ui) => {
        ui.close();
        const go = () => DutyAdminPage.openDraftWith([p.duty]);
        if (/^#\/admin\/duties/.test(location.hash) && window.DutyAdminPage) go();
        else { location.hash = '#/admin/duties'; setTimeout(go, 1200); }
      }
    },
    cancel: {
      title: '🚫 停課／取消',
      confirm: '確定',
      detail: (p) => `<p class="voice-what">${when(p)}　→　<b>${p.on ? '標成停課' : '恢復上課'}</b>${p.on && p.reason ? `（原因：${esc(p.reason)}）` : ''}</p>`,
      run: async (p) => {
        const ed = await Api.admin('adminDutyForEdit', { id: p.dutyId });
        const input = ed.duty || ed;
        await Api.admin('adminUpdateDuty', { id: p.dutyId, duty: Object.assign({}, input, { cancelled: !!p.on, cancelReason: p.on ? p.reason || '' : '' }) });
        refresh();
        return p.on ? `已經把「${p.dutyName}」${Fmt.shortDate(p.date)} 標成停課` : `「${p.dutyName}」${Fmt.shortDate(p.date)} 已經恢復上課`;
      }
    },
    pin: {
      title: '📌 放到首頁',
      confirm: '確定',
      detail: (p) => `<p class="voice-what">${when(p)}　→　<b>${p.on ? '放到首頁' : '從首頁拿掉'}</b></p>`,
      run: async (p) => {
        await Api.admin('adminSetPinned', { id: p.dutyId, pinned: !!p.on });
        refresh();
        return p.on ? `「${p.dutyName}」已經放到首頁` : `「${p.dutyName}」已經從首頁拿掉`;
      }
    },
    attend: {
      title: '✅ 補登出席',
      confirm: '補登這幾位',
      detail: (p) => `<p class="voice-what">${when(p)}</p><p class="hint">名字照成員名單；名單上沒有的會加到成員的「待確認」。已經在名單上的會跳過。</p>`,
      run: async (p) => {
        const r = await Api.admin('adminImportAttendance', { sessions: [{ dutyId: p.dutyId, date: p.date, entries: p.names.map((name) => ({ name })) }] });
        const one = (r.results || [])[0] || { added: 0, skipped: [] };
        refresh();
        return `補登好了：新加 ${one.added} 位${one.skipped && one.skipped.length ? `，${one.skipped.length} 位本來就在名單上` : ''}`;
      }
    },
    notice: {
      title: '📋 複製通知',
      confirm: '複製',
      detail: (p) => `<p class="voice-what">${when(p)}</p><p class="hint">複製好可以貼到 LINE 群組。</p>`,
      run: async (p) => {
        const ev = await Api.getEvents(p.date, p.date);
        const duty = ev.duties.find((x) => x.id === p.dutyId);
        if (!duty) throw new Error('找不到這個勤務，請再試一次');
        const ok = await Share.copyText(await Share.inviteTextFull([{ duty, date: p.date }]));
        if (!ok) throw new Error('複製失敗，請到勤務管理按「📋 複製通知」');
        return '已經複製好了，可以貼到 LINE 群組';
      }
    }
  });
})();
