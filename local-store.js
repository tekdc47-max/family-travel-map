// GitHub Pages stores family records only on this browser; no cloud credentials.
const localStoreReady = new Promise((resolve, reject) => {
  const request = indexedDB.open('family-travel-map-v2', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('records', {keyPath:'id'});
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const photoUrls = new Map();
async function recordTransaction(action, write = false) {
  const database = await localStoreReady;
  return new Promise((resolve, reject) => {
    const tx = database.transaction('records', write ? 'readwrite' : 'readonly');
    const request = action(tx.objectStore('records'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存未完成'));
  });
}
const centersReady = fetch('./region-centers.json').then(r => {if(!r.ok) throw Error('地区索引不可用');return r.json()});
async function localApi(path, options = {}) {
  const method = options.method || 'GET';
  const parts = path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[1] === 'regions') {
    const response = await fetch(`./china-${parts[2]}.geojson`);
    if (!response.ok) throw Error('这个地区暂未提供细分地图');
    return response.json();
  }
  if(parts[1] === 'places' && method === 'GET') {
    const records = await recordTransaction(store => store.getAll());
    const centers = await centersReady.catch(() => ({}));
    return records.map(record => {
      const center = centers[record.id];
      const located = record.lat != null && record.lng != null && Number.isFinite(+record.lat) && Number.isFinite(+record.lng);
      return {...record, lat:located ? +record.lat : center?.[1], lng:located ? +record.lng : center?.[0], photos:(record.photos || []).map((photo,index) => {
        if(typeof photo === 'string') return photo;
        const id = photo.id || `existing-${index}`;
        const key = `${record.id}/${id}`;
        if(photo.blob && !photoUrls.has(key)) photoUrls.set(key,URL.createObjectURL(photo.blob));
        return {...photo,id,url:photo.blob ? photoUrls.get(key) : photo.url};
      })};
    });
  }
  if(parts[1] === 'places' && method === 'PUT') {
    const incoming = JSON.parse(options.body);
    const existing = await recordTransaction(store => store.get(incoming.id));
    await recordTransaction(store => store.put({...existing,...incoming,photos:existing?.photos || []}),true);
    return incoming;
  }
  if(parts[1] === 'places' && method === 'DELETE') {
    await recordTransaction(store => store.delete(parts[2]),true);
    for(const [key,url] of photoUrls) if(key.startsWith(parts[2]+'/')) {URL.revokeObjectURL(url);photoUrls.delete(key)}
    return null;
  }
  if(parts[1] === 'photos') {
    const record = await recordTransaction(store => store.get(parts[2]));
    if(!record) throw Error('地点不存在，请先保存地点');
    record.photos ||= [];
    if(method === 'POST') {
      const file = options.body.get('file');
      if(!(file instanceof Blob)) throw Error('请选择照片');
      const id = new URLSearchParams(path.split('?')[1]).get('photoId') || crypto.randomUUID();
      if(!record.photos.some(photo => photo.id === id)) record.photos.push({id,name:file.name,type:file.type,blob:file});
    } else if(method === 'DELETE') {
      record.photos = record.photos.filter((photo,index) => (photo.id || `existing-${index}`) !== parts[3]);
      const key = `${parts[2]}/${parts[3]}`;
      if(photoUrls.has(key)) {URL.revokeObjectURL(photoUrls.get(key));photoUrls.delete(key)}
    } else throw Error('不支持的照片操作');
    await recordTransaction(store => store.put(record),true);
    return null;
  }
  throw Error('不支持的数据操作');
}
