# VOD חרדי

פיד וידאו אנכי בסגנון טיקטוק — סרטונים מ-JDN ומהמחדש, נשאבים אוטומטית לגיליון Google Sheets.

## התקנה

1. פתח את הגיליון → Extensions → Apps Script, והחלף את הקוד בתוכן `apps-script/Code.gs`.
   **שים את המפתח הסודי שלך ב-`API_KEY`** (בעותק בגיטהאב יש `CHANGE_ME`).
2. בעורך, בחר את הפונקציה `installTrigger` ולחץ Run (אשר הרשאות). מעכשיו השאיבה רצה כל 30 דקות.
3. Deploy → Manage deployments → ערוך → Version: New version → Deploy.
4. הדבק את כתובת ה-`/exec` ב-`config.js` → `API_URL`.

## API

- `GET ?mode=latest&limit=15&offset=0&source=jdn|hm` — החדשים ביותר
- `GET ?mode=random&limit=30` — מדגם אקראי
- `GET ?action=scrape&key=...` — הרצת שאיבה ידנית
- `POST ?key=...` עם `{ "videos": [...] }` — הוספה ידנית
