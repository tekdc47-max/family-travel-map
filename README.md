# 我们的旅行地图

中文家庭旅行地图框架，已准备好世界地图、拖动缩放、手机布局和旅行详情展示。

网站地址： https://tekdc47-max.github.io/family-travel-map/

## 以后怎样更新

`index.html` 是页面，`world.svg` 是本地地图底图，`content.json` 保存已发布的旅行内容。
更新这些文件并提交到 `main` 后，GitHub Pages 会自动重新发布，同一个网址即可看到新内容。

准备好内容后，可以让 Codex 帮忙导入，并检查实际发布结果。不要把密码、密钥或其他私密资料放进公开仓库。
此网站和仓库是公开的；家庭照片发布前应先确认大家都同意公开。

当前是空白框架，不含个人旅行数据。家庭共同上传、编辑和私密照片保存需要后续接入受权限保护的共享数据服务，GitHub Pages 本身不能提供这些服务。

## 内容格式

`content.json` 的 `places` 是地点列表，每项格式如下（此示例不会显示在空白地图上）：

```json
{
  "name": "地点名称",
  "lat": 30.0,
  "lng": 120.0,
  "date": "2026-10-01",
  "intro": "地区简介",
  "memory": "旅行回忆",
  "photos": ["./photos/example.jpg"]
}
```

底图使用 Natural Earth 公开领域地理数据：https://www.naturalearthdata.com/about/terms-of-use/
