# 用 World Labs Marble 產生 Hallstatt 高斯世界

這個資料夾放 Marble 匯出的檔案。放好之後，打開 `http://localhost:5173/splat.html` 就能在高斯世界裡走動。

## 1. 挑照片

把你拍的 Hallstatt 照片放進專案的 `photos/` 資料夾，再挑一張最適合的。挑選原則：

- **橫幅、廣角**：畫面裡有湖、房子、教堂尖塔和山，Marble 才有足夠資訊往四周延伸。
- **經典取景點**：從小鎮北邊的路上往南拍（湖在左邊、湖畔有新教教堂的尖塔），效果通常最好。
- **清楚、白天、少人群**：避免夜景、強烈逆光、大量行人或車輛。
- 如果 Marble 支援多張照片或全景輸入，可以多放幾張同一地點、不同角度的照片。

## 2. 在 Marble 生成世界

1. 用你自己的帳號登入 <https://marble.worldlabs.ai>。
2. 建立新世界，上傳選好的照片。
3. 如果可以加文字提示，可以用這段：

   > Hallstatt, Austria: a lakeside alpine village of pastel and dark-wood houses with steep gabled roofs, a slender white church spire at the water's edge, a calm mirror-like lake, steep forested mountains, soft morning light.

4. 生成完成後先在 Marble 裡逛一圈，不滿意可以重新生成。

## 3. 匯出（需要付費方案）

> 免費方案只能生成、不能匯出。匯出 SPZ 和碰撞網格需要 Standard 以上方案；商用授權需要 Pro。

從下載選單匯出兩個檔案，**照下面的檔名**存進這個 `marble/` 資料夾：

| 匯出項目 | 存成 |
|---|---|
| Splats（SPZ 格式） | `marble/hallstatt.spz` |
| Collider Mesh（GLB） | `marble/hallstatt-collider.glb` |

如果有較小的高斯版本可以選，建議先用小的：這台電腦的顯示卡（MX330／Iris Xe）跑幾百萬個高斯點會比較吃力。

## 4. 進入世界、校正方向

開啟 `http://localhost:5173/splat.html`：

- **F**：翻轉高斯世界（如果上下顛倒）
- **C**：顯示／隱藏碰撞網格（綠色線框），檢查有沒有和畫面對齊
- **G**：切換步行（有碰撞）和飛行（穿牆）

校正好之後，把 `world.example.json` 複製成 `world.json` 並修改數值，下次載入就會直接套用：

| 欄位 | 說明 |
|---|---|
| `splatFlip` | 高斯是否繞 X 軸翻轉 180°（Spark 文件建議 OpenCV 座標要翻轉） |
| `colliderFlip` | 碰撞網格是否翻轉 |
| `scale` | 整體縮放 |
| `spawn` | 出生點 `[x, y, z]` |
| `yaw` | 出生時面向的角度（弧度） |
