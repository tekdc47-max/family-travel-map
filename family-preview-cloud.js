// This adapter is only loaded by the separate cloud preview, never by the local map.
export async function connectFamilyMap(client, login) {
  const unwrap = ({data, error}) => { if (error) throw error; return data; };
  const form = login.querySelector('form');
  const status = login.querySelector('[role=status]');
  const button = form.querySelector('button');
  const email = form.elements.email;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    status.textContent = '正在发送登录邮件…';
    try {
      const emailRedirectTo = location.origin + location.pathname;
      unwrap(await client.auth.signInWithOtp({email:email.value.trim(), options:{shouldCreateUser:false, emailRedirectTo}}));
      status.textContent = '请到邮箱打开登录链接，回到这个页面。';
    } catch {
      status.textContent = '登录邮件未能发送。请确认已接受邀请，或稍后再试。';
    } finally { button.disabled = false; }
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
  }
  const canEdit = role === 'editor';
  const photos = client.storage.from('family-map-photos');
  const table = () => client.from('family_map_places');
  async function api(path, options = {}) {
    const [ , , resource, placeId, photoId] = path.split('?')[0].split('/').map(decodeURIComponent);
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
      const grouped = new Map();
      for (let i = 0; i < objects.length; i += 100) {
        const paths = objects.slice(i,i+100).map(row => row.path);
        for (const image of unwrap(await photos.createSignedUrls(paths, 180))) {
          if (!image.signedUrl || image.error) continue;
          const [id, photo] = image.path.split('/');
          if (!grouped.has(id)) grouped.set(id, []);
          grouped.get(id).push({id:photo, url:image.signedUrl});
        }
      }
      return rows.map(row => ({...row, date:row.date || '', createdAt:row.created_at, photos:grouped.get(row.id) || []}));
    }
    if (!canEdit) throw Error('此账号只能查看');
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
      return unwrap(await photos.upload(`${placeId}/${crypto.randomUUID()}`,file,{contentType:file.type}));
    }
    if (resource === 'photos' && method === 'DELETE')
      return unwrap(await photos.remove([`${placeId}/${photoId}`]));
    throw Error('不支持的数据操作');
  }
  return {canEdit, api, async signOut(){unwrap(await client.auth.signOut({scope:'local'})); location.reload();}};
}
