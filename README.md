# 我们的旅行地图

中文家庭旅行地图：在地图上记录地点、日期、回忆和旅行照片。数据保存在当前浏览器，不会自动上传或同步。

网站地址： https://tekdc47-max.github.io/family-travel-map/

## 备份和恢复

1. 打开「旅行足迹」旁的「备份与恢复」，下载 `.travelmap` 文件。
2. 在另一个浏览器打开地图，选择该文件，核对地点和照片数量，再点「确认恢复」。

备份包含已保存的原始照片，不加密。请保存在私密位置，不要把备份或家庭照片提交到公开仓库。
恢复会合并记录：相同版本跳过，冲突版本另存为副本，不覆盖现有内容。

## 更新网站

页面入口是 `index.html`；底图使用随站点发布的 GeoJSON，浏览器记录由 `local-store.js` 管理。
将相关网站文件一并提交到 `main`，GitHub Pages 会在同一个网址重新发布。

底图使用 Natural Earth 公开领域地理数据：https://www.naturalearthdata.com/about/terms-of-use/
