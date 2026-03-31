# AcademicTycoon 題目庫擴充指南

本專案儲存了《AcademicTycoon》遊戲的題目數據。透過修改這些 JSON 檔案，您可以輕鬆新增題目或建立新的題目包。

## 目錄結構

- `config.json`: 全域設定檔，定義了哪些題目庫會被載入。
- `question_jsons/`: 具體的題目包檔案，按類別切分：
  - `mock_exams/`: 統測模擬考題目。
  - `tck_past_exams/`: 統測歷屆試題。
  - `textbook_exercises/`: 課本與鍛鍊本練習題。
- `content_jsons/`: 課文章節內容檔，按課目 / 章節切分：
  - `textbooks/`: 課本內容 JSON。
- `assets/`: 題目圖片與課文頁面圖片：
  - `question_images/`: 從 PDF 裁切出的題目圖。
  - `content_pages/`: 課文頁面圖。

---

## 如何擴充題目

### 1. 修改現有題目包
如果您想在現有的題目包中新增題目，請在 `questions` 陣列中添加新的物件：

```json
{
  "id": "HS02",
  "subject": "高中數學",
  "unit": "第一章：代數基礎",
  "q": "題目內容？",
  "image_url": "",
  "options": ["選項1", "選項2", "選項3", "選項4"],
  "a": 0,
  "reward": 10,
  "explanation": "解析說明"
}
```

**欄位說明：**
- `id`: 唯一識別碼（不可重複）。
- `subject`: 學科名稱。
- `unit`: 單元名稱，用於題目分類（新增欄位）。
- `q`: 題目的文本內容。
- `image_url`: 題目圖片的連結（可留空 `""`）。
- `options`: 四個選項的陣列。
- `a`: 正確答案的索引（0 到 3）。
- `reward`: 答對後可獲得的遊戲幣獎勵。
- `explanation`: 答題後的解析。

### 2. 新增題目包
如果您想新增一個全新的學科（例如「英文」）：

1.  **建立檔案**：在 `question_jsons/custom/` 下建立 `english.json`。
2.  **檔案內容**：參考以下格式：
    ```json
    {
      "bundle_id": "ENG_V1",
      "questions": [
        { ... 題目1 ... },
        { ... 題目2 ... }
      ]
    }
    ```
3.  **註冊題目包**：在 `config.json` 的 `bundles` 陣列中註冊它：
    ```json
    {
      "id": "ENG_V1",
      "name": "基礎英文",
      "file_name": "question_jsons/custom/english.json",
      "url": "https://raw.githubusercontent.com/thumb2086/AcademicTycoon_data/main/question_jsons/custom/english.json",
      "updated_at": "2026-03-31"
    }
    ```

---

## 課文內容 JSON 規格

課文資料與題目資料分開儲存。`config.json` 中：

- `bundles`: 題目包
- `content_bundles`: 課文章節內容

每一份 `content_*.json` 對應一個課目章節，結構如下：

```json
{
  "content_id": "CONTENT_MECH_MFG_CH01",
  "subject": "機械製造",
  "chapter": {
    "code": "CH01",
    "title": "第一章 緒論"
  },
  "title": "機械製造 第一章 緒論",
  "source_pdf": "機械製造/CH1PDF.pdf",
  "question_bundle_id": "TEXT_MECH_MFG_CH01",
  "pages": [
    {
      "page": 1,
      "blocks": [
        { "type": "heading", "text": "第一章 緒論" },
        { "type": "paragraph", "text": "課文內容..." }
      ],
      "page_image_url": "https://raw.githubusercontent.com/.../assets/content_pages/content_mech_mfg_ch01/p001.jpg"
    }
  ]
}
```

欄位說明：
- `content_id`: 課文章節唯一識別碼。
- `subject`: 課目名稱。
- `chapter`: 章節代碼與章名。
- `title`: 顯示用標題。
- `source_pdf`: 對應來源 PDF。
- `question_bundle_id`: 若該章後方有練習題，對應到題目包 ID；沒有則可為 `null`。
- `pages`: 按頁儲存的課文內容。
- `blocks`: 該頁文字區塊，`type` 目前分為 `heading` / `paragraph`。
- `page_image_url`: 該頁若含圖表或需保留版面時，對應的頁面圖片。

---

## 圖片格式支援

### 圖片 URL 格式
題目支援圖片，只需在 `image_url` 欄位填入圖片的網址（建議使用 HTTPS）：

```json
{
  "id": "q101",
  "subject": "物理",
  "unit": "第一單元：電路基礎",
  "q": "下圖中的電路，其等效電阻為何？",
  "image_url": "https://example.com/circuit_diagram.png", 
  "options": ["5 Ω", "10 Ω", "15 Ω", "20 Ω"],
  "a": 1,
  "reward": 15,
  "explanation": "根據串並聯公式計算..."
}
```

### 支援的圖片格式
- **推薦格式**：PNG、JPG、JPEG
- **檔案大小**：建議不超過 2MB
- **解析度**：建議寬度不超過 800px，高度不超過 600px
- **URL 要求**：必須為有效的 HTTPS 網址

### GitHub 圖片連結
如果圖片儲存在 GitHub，請使用 `raw.githubusercontent.com` 的原始連結格式：
```
https://raw.githubusercontent.com/[用戶名]/[倉庫名]/[分支]/[圖片路徑]
```

---

## 更新與同步 (Hot Update)

當您完成修改並推送到 GitHub 後，請務必更新 `config.json`：

1.  **版本號更新**：將 `config.json` 中的 `"data_version"` 數值加 1。這會觸發遊戲客戶端下載更新。
2.  **日期更新**：更新對應題目包的 `"updated_at"`。

---

## 注意事項

- **JSON 格式**：請確保語法正確（推薦使用 JSON 驗證工具）。
- **圖片連結**：如果使用 GitHub 上的圖片，請使用 `raw.githubusercontent.com` 的原始連結。
- **獎勵數值**：建議 `reward` 設定在 10 ~ 30 之間以維持平衡。
- **單元分類**：新增的 `unit` 欄位用於題目分類，App 會透過 `SELECT DISTINCT unit` 抓取單元選單。
- **資料庫版本**：新增 `unit` 欄位後，記得更新 Android App 的 Room 資料庫版本號。
