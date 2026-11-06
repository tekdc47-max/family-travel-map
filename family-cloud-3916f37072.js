// This adapter is only loaded by the separate cloud preview, never by the local map.
const usernameDomain = 'family-map.example.com';
const photoUploadLimit = 300_000;
const photoTargetSize = 240_000;

async function isStillPhoto(file) {
  if (file.type === 'image/jpeg') return true;
  if (file.type === 'image/webp') {
    const header = new DataView(await file.slice(0,21).arrayBuffer());
    if (header.byteLength < 21) return false;
    const chunk = header.getUint32(12);
    return chunk === 0x56503820 || chunk === 0x5650384c ||
      (chunk === 0x56503858 && !(header.getUint8(20) & 2));
  }
  if (file.type !== 'image/png') return false;
  const header = new DataView(await file.slice(0,65536).arrayBuffer());
  for (let offset = 8; offset + 8 <= header.byteLength; offset += 12 + header.getUint32(offset)) {
    const chunk = header.getUint32(offset + 4);
    if (chunk === 0x6163544c) return false; // APNG animation control
    if (chunk === 0x49444154) return true;  // PNG image data
  }
  return false;
}

async function optimizePhoto(file) {
  let best = file;
  if (file.size <= 250 * 1024 || !await isStillPhoto(file)) return best;
  let bitmap, canvas;
  try {
    bitmap = await createImageBitmap(file);
    canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const longest = Math.max(bitmap.width,bitmap.height);
    let format = 'image/webp';
    const encode = (type,quality) => new Promise(resolve => canvas.toBlob(resolve,type,quality));
    for (const edge of new Set([Math.min(longest,1600),1280,1024,800,640,480,320])) {
      if (edge > longest) continue;
      const scale = edge / longest;
      canvas.width = Math.max(1,Math.round(bitmap.width * scale));
      canvas.height = Math.max(1,Math.round(bitmap.height * scale));
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      for (const quality of [.82,.68]) {
        let candidate = await encode(format,quality);
        if (format === 'image/webp' && candidate?.type !== format) {
          format = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
          if (candidate?.type !== format) candidate = await encode(format,quality);
        }
        if (candidate?.size > 0 && candidate.size < best.size) best = candidate;
        if (best.size <= photoTargetSize) return best;
        if (!candidate || candidate.type === 'image/png') break;
      }
      if (best.size <= photoUploadLimit) break;
    }
  } catch {
    // An already-small original still works if this browser cannot re-encode it.
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
  return best;
}

export function familyLoginEmail(username) {
  const normalized = username.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(normalized) ? `${normalized}@${usernameDomain}` : null;
}

export async function connectFamilyMap(client, login) {
  const unwrap = ({data, error}) => { if (error) throw error; return data; };
  const status = login.querySelector('[role=status]');
  const passwordForm = login.querySelector('#familyPasswordLogin');
  const emailForm = login.querySelector('#familyEmailLogin');
  const buttons = [passwordForm, emailForm].map(form => form.querySelector('button'));
  let busy = true;
  function setBusy(value) {
    busy = value;
    for (const button of buttons) button.disabled = value;
  }
  function onSubmit(form, submit) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      try {
        await submit();
      } finally {
        setBusy(false);
      }
    });
  }
  onSubmit(passwordForm, async () => {
    const {username, password} = passwordForm.elements;
    const email = familyLoginEmail(username.value);
    if (!email) {
      status.textContent = '请输入管理员发给你的用户名（3–32 位英文字母、数字、下划线或连字符，首位为字母或数字）。';
      username.focus();
      return;
    }
    status.textContent = '正在登录…';
    try {
      unwrap(await client.auth.signInWithPassword({email, password:password.value}));
      location.reload();
    } catch {
      status.textContent = '登录失败，请核对用户名和密码，或联系管理员。';
    } finally {
      password.value = '';
    }
  });
  onSubmit(emailForm, async () => {
    const email = emailForm.elements.email.value.trim();
    if (email.toLowerCase().endsWith('@' + usernameDomain)) {
      status.textContent = '此账号请使用用户名和密码登录。';
      return;
    }
    status.textContent = '正在发送登录邮件…';
    try {
      const emailRedirectTo = location.origin + location.pathname;
      unwrap(await client.auth.signInWithOtp({email, options:{shouldCreateUser:false, emailRedirectTo}}));
      status.textContent = '请到邮箱打开登录链接，回到这个页面。';
    } catch {
      status.textContent = '登录邮件未能发送。请确认已接受邀请，或稍后再试。';
    }
  });
  let role;
  try {
    const {session} = unwrap(await client.auth.getSession());
    if (!session) return null;
    role = unwrap(await client.rpc('family_map_role'));
    if (!['viewer','editor'].includes(role)) {
      await client.auth.signOut({scope:'local'});
      status.textContent = '这个账号还没有家庭地图访问权限。';
      return null;
    }
  } catch {
    status.textContent = '暂时无法验证登录，请稍后刷新。';
    return null;
  } finally {
    setBusy(false);
  }
  const canEdit = role === 'editor';
  const photos = client.storage.from('family-map-photos');
  const table = () => client.from('family_map_places');
  const signed = new Map();
  let pendingWrites = 0, writeVersion = 0;
  async function request(path, options) {
    const [pathname, query] = path.split('?');
    const [ , , resource, placeId, photoId] = pathname.split('/').map(decodeURIComponent);
    const method = options.method || 'GET';
    if (resource === 'regions' && /^\d{6}$/.test(placeId)) {
      const r = await fetch(`./china-${placeId}.geojson`);
      if (!r.ok) throw Error('这个地区暂未提供细分地图');
      return r.json();
    }
    if (resource === 'places' && method === 'GET') {
      const [rows, objects] = (await Promise.all([
        table().select('id,name,date,lat,lng,intro,memory,created_at'),
        client.rpc('family_map_photo_paths')
      ])).map(unwrap);
      const focus = new URLSearchParams(query).get('focus');
      const knownPaths = new Set(objects.map(row => row.path));
      const now = Date.now();
      for (const [path, entry] of signed) {
        if (entry.expires <= now || !knownPaths.has(path)) signed.delete(path);
      }
      const missing = objects.map(row => row.path).filter(path => focus && path.startsWith(focus + '/') && !signed.has(path));
      for (let i = 0; i < missing.length; i += 100) {
        try {
          for (const image of unwrap(await photos.createSignedUrls(missing.slice(i,i+100),180))) {
            if (image.signedUrl && !image.error) signed.set(image.path,{url:image.signedUrl,expires:now + 140000});
          }
        } catch {
          // Place and photo metadata can still synchronize while image signing is retried.
        }
      }
      const grouped = new Map();
      for (const {path} of objects) {
        const [id, photo] = path.split('/');
        if (!grouped.has(id)) grouped.set(id,[]);
        grouped.get(id).push({id:photo,url:signed.get(path)?.url});
      }
      return rows.map(row => ({...row, date:row.date || '', createdAt:row.created_at, photos:grouped.get(row.id) || []}));
    }
    if (!canEdit) throw Error('此账号只能查看');
    if (resource === 'places' && method === 'PATCH') {
      const {values, base} = JSON.parse(options.body);
      const editable = ['name','date','intro','memory'];
      const changed = editable.filter(key => values[key] !== base[key]);
      if (!changed.length) return {id:placeId};
      const normalize = (key, value) => key === 'date' ? value || null : value;
      const updates = Object.fromEntries(changed.map(key => [key,normalize(key,values[key])]));
      let update = table().update(updates).eq('id',placeId);
      for (const key of changed) {
        const expected = normalize(key,base[key]);
        update = expected === null ? update.is(key,null) : update.eq(key,expected);
      }
      const saved = unwrap(await update.select('id').maybeSingle());
      if (!saved) throw Object.assign(Error('同一字段已在其他设备上修改，当前输入已保留。请核对最新内容后再编辑。'),{code:'FAMILY_MAP_CONFLICT'});
      return saved;
    }
    if (resource === 'places' && method === 'PUT') {
      const {id, name, lat, lng, date, intro, memory} = JSON.parse(options.body);
      return unwrap(await table().upsert({id,name,lat,lng,date:date || null,intro:intro || '',memory:memory || ''}).select('id').single());
    }
    if (resource === 'places' && method === 'DELETE') {
      const objects = unwrap(await client.rpc('family_map_photo_paths'));
      const paths = objects.map(o => o.path).filter(p => p.startsWith(placeId+'/'));
      if (paths.length) unwrap(await photos.remove(paths));
      return unwrap(await table().delete().eq('id',placeId).select('id').single());
    }
    if (resource === 'photos' && method === 'POST') {
      const file = options.body.get('file');
      if (!file || !/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type) || file.size > 10485760)
        throw Error('请选择 10 MB 以内的 JPG、PNG、WebP、GIF 或 AVIF 图片。');
      const upload = await optimizePhoto(file);
      if (upload.size > photoUploadLimit) throw Error('这张图片超过 300 KB，请缩小后再上传。');
      return unwrap(await photos.upload(`${placeId}/${crypto.randomUUID()}`,upload,{contentType:upload.type}));
    }
    if (resource === 'photos' && method === 'DELETE')
      return unwrap(await photos.remove([`${placeId}/${photoId}`]));
    throw Error('不支持的数据操作');
  }
  async function api(path, options = {}) {
    if (!options.method || options.method === 'GET') return request(path,options);
    pendingWrites++;
    writeVersion++;
    try { return await request(path,options); }
    finally { pendingWrites--; writeVersion++; }
  }
  function watch(onChange) {
    if (typeof client.channel !== 'function') return;
    client.channel('family-map-places')
      .on('postgres_changes',{event:'*',schema:'public',table:'family_map_places'},onChange)
      .subscribe(status => { if (status === 'SUBSCRIBED') onChange(); });
  }
  return {
    canEdit,api,watch,
    get pendingWrites(){return pendingWrites;},
    get writeVersion(){return writeVersion;},
    async signOut(){unwrap(await client.auth.signOut({scope:'local'}));location.reload();}
  };
}
