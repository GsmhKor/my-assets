# 视觉与素材

沿用用户现有 `my-ledger` 的猫咪图片与奶油色卡片。3.9 使用 CSS 多层渐变绘制固定壁纸背景：浅色模式为冰蓝、淡紫与蜜桃色，深色模式为靛蓝、紫色与青绿色；资产明细保留横线和暖米色名称。1.8.0 按用户要求编辑新安装图标的蓝色背景，其余猫咪画作沿用现有素材。

- `balance-hydrangea.png`：资产卡片背景。
- `add-picnic.png`：右下角圆形记一笔按钮，保留图片，无加号、无额外橙色球或着色遮罩。
- `cat-tab-home.png`、`cat-tab-bills.png`、`cat-tab-stats.png`：首页、资产与历史导航。
- `cat-tab-settings.png`：设置导航的电脑打字猫，直接复制自 `my-ledger/src/assets/`。
- `cat-empty-bills.webp`：资产明细无数据时的趴着猫，复用 `my-ledger` 账单页空状态图片。
- `cat-settings-privacy.webp`：设置页更新按钮的举鲨鱼猫，复用 `my-ledger` 设置页图片。
- 上述三张复用素材的原始来源说明见 `../my-ledger/design/page-icons-source.md`（相对于项目根目录）；本次直接复制成品，不重新生成、缩放或修改图片。
- `design/source/app-icon-1.7.0.png`：用户在 1.7.0 升级请求中提供的 196×196 流泪猫原图，作为原始素材归档，不参与构建。旧版生成图标已清理。
- `design/source/app-icon-1.8.0-original.png`：用户在 1.8.0 升级请求中提供的惊讶猫原图。`design/source/app-icon-1.8.0.png` 为使用内置 imagegen 补齐蓝色背景后的正方形母版，保留手绘风格；编辑提示词见 `design/source/app-icon-1.8.0-prompt.md`。`public/*-v1.8.0.png` 从母版缩放为 192、512、180 像素图标，maskable 图标同样使用满幅蓝色背景；桌面及首页左上角均引用本版本。

不对素材权属作额外声明。调整皮肤颜色应优先修正源图，不对猫咪整体套滤镜。
