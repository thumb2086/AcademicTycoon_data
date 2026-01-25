# AcademicTycoon 題目庫擴充指南

本專案儲存了《AcademicTycoon》遊戲的題目數據。透過修改這些 JSON 檔案，您可以輕鬆新增題目或建立新的題目包。

## 目錄結構

- `config.json`: 全域設定檔，定義了哪些題目包會被載入。
- `*.json`: 具體的題目包檔案（如 `highschool.json`, `mechanical.json`）。

---

## 如何擴充題目

### 1. 修改現有題目包
如果您想在現有的題目包（例如 `highschool.json`）中新增題目，請在 `questions` 陣列中添加新的物件：

```json
{
  "id": "HS02",
  "subject": "高中數學",
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
- `q`: 題目的文本內容。
- `image_url`: 題目圖片的連結（可留空 `""`）。
- `options`: 四個選項的陣列。
- `a`: 正確答案的索引（0 到 3）。
- `reward`: 答對後可獲得的遊戲幣獎勵。
- `explanation`: 答題後的解析。

### 2. 新增題目包
如果您想新增一個全新的學科（例如「英文」）：

1.  **建立檔案**：建立 `english.json`。
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
      "file_name": "english.json",
      "url": "https://raw.githubusercontent.com/您的帳號/AcademicTycoon-Data/main/english.json",
      "updated_at": "2026-01-25"
    }
    ```

---

## 更新與同步 (Hot Update)

當您完成修改並推送到 GitHub 後，請務必更新 `config.json`：

1.  **版本號更新**：將 `config.json` 中的 `"data_version"` 數值加 1（例如從 `1` 改為 `2`）。這會觸發遊戲客戶端下載更新。
2.  **日期更新**：更新對應題目包的 `"updated_at"`。

---

## 注意事項

- **JSON 格式**：請確保語法正確（推薦使用 JSON 驗證工具）。
- **圖片連結**：如果使用 GitHub 上的圖片，請使用 `raw.githubusercontent.com` 的原始連結。
- **獎勵數值**：建議 `reward` 設定在 10 ~ 30 之間以維持平衡。
