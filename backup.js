// FTMAP001: magic + uint32 manifest length (little endian) + UTF-8 JSON + original photo bytes.
// Blob slices avoid loading the whole archive (or base64 copies of photos) into memory.
const magic = "FTMAP001";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", {fatal:true});
const headerSize = 12, maxManifest = 32 * 1024 * 1024;
const bad = () => new Error("备份格式不正确、版本不支持，或文件不完整。");
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
function string(value, limit, required = false) {
  if (typeof value !== "string" || value.length > limit || (required && !value.trim())) throw bad();
  return value;
}
async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
function placeFields(p) {
  if (!isObject(p)) throw bad();
  const lat = p.lat ?? null, lng = p.lng ?? null;
  if ((lat !== null || lng !== null) &&
      (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) throw bad();
  const date = string(p.date ?? "", 10);
  if (date) {
    const time = new Date(date + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+time) || time.toISOString().slice(0,10) !== date) throw bad();
  }
  return {
    id:string(p.id,256,true), name:string(p.name ?? "",1024), date, lat, lng,
    intro:string(p.intro ?? "",100000), memory:string(p.memory ?? "",100000),
    createdAt:string(p.createdAt ?? "",80)
  };
}
function photoFields(p) {
  if (!isObject(p) || !Number.isSafeInteger(p.bytes) || p.bytes < 1 ||
      typeof p.hash !== "string" || !/^[0-9a-f]{64}$/.test(p.hash)) throw bad();
  const type = string(p.type,120);
  if (type && !/^image\/[a-z0-9.+-]+$/i.test(type)) throw bad();
  return {id:string(p.id,256,true),name:string(p.name,1024,true),type,bytes:p.bytes,hash:p.hash};
}
function assertUnique(values) {
  if (new Set(values).size !== values.length) throw bad();
}
async function describePlace(record, blobs) {
  const place = placeFields({...record, lat:record.lat == null ? null : Number(record.lat),
    lng:record.lng == null ? null : Number(record.lng)});
  place.photos = [];
  if (record.photos != null && !Array.isArray(record.photos)) throw bad();
  for (const [index, photo] of (record.photos || []).entries()) {
    let blob = photo?.blob;
    if (!(blob instanceof Blob)) {
      const url = typeof photo === "string" ? photo : photo?.url;
      if (typeof url !== "string" || !/^data:image\/[a-z0-9.+-]+[;,]/i.test(url)) {
        throw new Error(`「${place.name || "未命名地点"}」有照片不在本机，无法创建完整备份。`);
      }
      blob = await (await fetch(url)).blob();
    }
    place.photos.push(photoFields({
      id:photo?.id || `existing-${index}`, name:photo?.name || `旅行照片-${index+1}`,
      type:blob.type || photo?.type || "", bytes:blob.size, hash:await sha256(await blob.arrayBuffer())
    }));
    blobs?.push(blob);
  }
  assertUnique(place.photos.map(p=>p.id));
  return place;
}
export async function makeBackup(records) {
  const places = [], blobs = [];
  for (const record of records) places.push(await describePlace(record, blobs));
  assertUnique(places.map(p=>p.id));
  const manifest = encoder.encode(JSON.stringify({version:1,places}));
  if (manifest.length > maxManifest) throw new Error("备份清单过大，无法生成文件。");
  const header = new Uint8Array(headerSize);
  header.set(encoder.encode(magic));
  new DataView(header.buffer).setUint32(8,manifest.length,true);
  return new Blob([header,manifest,...blobs], {type:"application/octet-stream"});
}
export async function readBackup(file) {
  if (!(file instanceof Blob) || file.size < headerSize) throw bad();
  const header = await file.slice(0,headerSize).arrayBuffer();
  if (decoder.decode(new Uint8Array(header,0,8)) !== magic) throw bad();
  const length = new DataView(header).getUint32(8,true);
  if (!length || length > maxManifest || headerSize + length > file.size) throw bad();
  let manifest;
  try { manifest = JSON.parse(decoder.decode(await file.slice(headerSize,headerSize+length).arrayBuffer())); }
  catch { throw bad(); }
  if (manifest?.version !== 1 || !Array.isArray(manifest.places)) throw bad();
  const places = [];
  let offset = headerSize + length, photoCount = 0;
  for (const row of manifest.places) {
    const place = placeFields(row);
    if (!Array.isArray(row.photos)) throw bad();
    place.photos = [];
    for (const photo of row.photos) {
      const {bytes, hash, ...info} = photoFields(photo);
      if (bytes > file.size - offset) throw bad();
      const blob = file.slice(offset,offset+bytes,info.type);
      if (await sha256(await blob.arrayBuffer()) !== hash) throw new Error("备份内有照片损坏，未恢复任何记录。");
      offset += bytes;
      place.photos.push({...info,blob});
      photoCount++;
    }
    assertUnique(place.photos.map(p=>p.id));
    places.push(place);
  }
  assertUnique(places.map(p=>p.id));
  if (offset !== file.size) throw bad();
  return {places,photoCount};
}
export async function planRestore(incoming, current) {
  const existing = new Map(current.map(row=>[row.id,row]));
  const occupied = new Set([...existing.keys(), ...incoming.map(row=>row.id)]);
  const additions = [];
  let skipped = 0;
  for (const row of incoming) {
    const old = existing.get(row.id);
    if (!old) { additions.push({row, copy:false}); continue; }
    const content = JSON.stringify(await describePlace(row));
    const previous = await describePlace(old).catch(() => null);
    if (previous && JSON.stringify(previous) === content) { skipped++; continue; }
    // Stable ID makes reimporting the same conflicting version idempotent.
    const id = "restored-" + await sha256(encoder.encode(content));
    if (occupied.has(id)) { skipped++; continue; }
    occupied.add(id);
    additions.push({row:{...row,id},copy:true});
  }
  return {additions,skipped};
}
