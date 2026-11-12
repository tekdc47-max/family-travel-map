export async function mountAccountAdmin(client) {
  const permission = await client.rpc('family_map_can_manage_accounts');
  if (permission.error || permission.data !== true) return;

  const byId = id => document.getElementById(id);
  const open = byId('accountAdminOpen');
  const dialog = byId('accountAdminDialog');
  const target = byId('accountAdminTarget');
  const list = byId('accountAdminList');
  const form = byId('accountAdminForm');
  const status = dialog.querySelector('[role=status]');
  const roleGroup = form.querySelector('[data-account-role]');
  const credentialsGroup = form.querySelector('[data-account-credentials]');
  const {role, username, password} = form.elements;
  const buttons = [...form.querySelectorAll('button')];
  const domain = '@family-map.example.com';
  const loginName = account => account.email?.replace(/@family-map\.example\.com$/i, '') || '无邮箱';
  let accounts = [];
  let busy = false;

  const selectedAccount = () => accounts.find(account => account.id === target.value);
  function updateForm() {
    const account = selectedAccount();
    const editable = !account?.account_admin;
    const passwordLogin = !account || account.email?.toLowerCase().endsWith(domain);
    roleGroup.hidden = !editable;
    credentialsGroup.hidden = !editable || !passwordLogin;
    role.value = account?.role || 'viewer';
    username.value = account && passwordLogin ? loginName(account) : '';
    password.value = '';
    for (const row of list.querySelectorAll('button')) row.setAttribute('aria-pressed', String(row.dataset.accountId === target.value));
    for (const button of buttons) {
      button.hidden = !editable || (button.value === 'create' ? !!account :
        !account || (button.value === 'credentials' && !passwordLogin));
    }
    status.textContent = account?.account_admin ? '此账号可管理成员，由项目所有者维护。' :
      account && !passwordLogin ? '此成员使用邮箱链接登录。' : '';
  }

  async function invoke(body) {
    const {data, error} = await client.functions.invoke('family-map-accounts', {body});
    if (!error) return data;
    const details = await error.context?.json?.().catch(() => null);
    throw new Error(details?.message || '账号管理暂不可用，请稍后重试。');
  }

  async function refresh(selected) {
    const data = await invoke({action:'list'});
    accounts = data.accounts;
    byId('accountAdminCount').textContent = `共 ${accounts.length} 个共享账号`;
    list.replaceChildren(...accounts.map(account => {
      const row = document.createElement('button');
      row.type = 'button';
      row.dataset.accountId = account.id;
      const name = document.createElement('strong');
      name.textContent = loginName(account);
      const access = document.createElement('small');
      access.textContent = account.account_admin ? '管理员' : account.role === 'editor' ? '可编辑' : '仅观看';
      row.append(name, access);
      row.onclick = () => { if (!busy) { target.value = account.id; updateForm(); } };
      return row;
    }));
    target.replaceChildren(new Option('＋ 新建成员', ''), ...accounts.map(account => {
      const access = account.role === 'editor' ? '可编辑' : '仅观看';
      return new Option(loginName(account) + ' · ' + (account.account_admin ? '账号管理员' : access), account.id);
    }));
    target.value = accounts.some(account => account.id === selected) ? selected : '';
    updateForm();
    form.hidden = false;
  }

  function setBusy(value) {
    busy = value;
    for (const control of [target, role, username, password, ...buttons, ...list.querySelectorAll('button')]) control.disabled = value;
    byId('accountAdminClose').disabled = value;
  }

  target.onchange = updateForm;
  open.onclick = async () => {
    form.hidden = true;
    list.replaceChildren();
    byId('accountAdminCount').textContent = '正在读取账号…';
    status.textContent = '正在读取共享成员…';
    dialog.showModal();
    setBusy(true);
    try { await refresh(''); }
    catch (error) { status.textContent = error.message; }
    finally { setBusy(false); }
  };
  byId('accountAdminClose').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    accounts = [];
    list.replaceChildren();
    byId('accountAdminCount').textContent = '';
    target.replaceChildren();
    form.reset();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !event.submitter || event.submitter.hidden) return;
    const action = event.submitter.value;
    const account = selectedAccount();
    const payload = {action};
    if (account) payload.id = account.id;
    if (action === 'create' || action === 'role') payload.role = role.value;
    if (action === 'create' || action === 'credentials') {
      const nextName = username.value.trim().toLowerCase();
      if (action === 'create' || nextName !== loginName(account)) payload.username = nextName;
      if (action === 'create' || password.value) payload.password = password.value;
    }
    if (action === 'remove' && !confirm('撤销 ' + loginName(account) + ' 对家庭地图的访问？旅行记录和照片会保留。')) return;
    if (action === 'delete' && !confirm('永久删除登录账号 ' + loginName(account) + '？此操作无法撤销，该账号将无法再登录。家庭旅行记录和照片会保留。')) return;
    setBusy(true);
    status.textContent = '正在保存…';
    try {
      await invoke(payload);
      try {
        await refresh(account?.id);
        status.textContent = action === 'delete' ? '已删除登录账号。' : action === 'remove' ? '已撤销地图访问。' : '已保存。';
      } catch {
        form.hidden = true;
        status.textContent = '已保存。重新打开账号管理即可刷新名单。';
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      password.value = '';
      setBusy(false);
    }
  });
  open.hidden = false;
}
