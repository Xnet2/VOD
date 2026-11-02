# העלאת הסקריפט עם clasp (בלי להדביק קוד בעורך)

clasp דוחף את הקבצים ישר לפרויקט ה-Apps Script דרך ה-API. העורך לא מעורב, אז התוסף בדפדפן אף פעם לא רואה את הקוד, והסקריפט רץ רגיל.

## הכנה חד-פעמית

1. הפעל את ה-Apps Script API בחשבון שלך (פעם אחת):
   https://script.google.com/home/usersettings  → Google Apps Script API → **On**

2. התקן את clasp והתחבר (ייפתח דפדפן להתחברות עם חשבון Google):
   ```bash
   npm install -g @google/clasp
   clasp login
   ```

## מציאת ה-Script ID

פתח את הגיליון ← Extensions ← Apps Script ← גלגל שיניים (Project Settings) ← העתק את **Script ID**.
(זה עמוד הגדרות — לא מדביקים שם קוד, התוסף לא מפריע.)

## חיבור והעלאה

1. ערוך את `Code.gs` **מקומית** (בעורך הרגיל שלך, לא ב-Apps Script) ושים את המפתח הסודי שלך ב-`API_KEY`.
2. צור קובץ `.clasp.json` (העתק מ-`.clasp.json.example`) והדבק את ה-Script ID שלך.
3. מהתיקייה הזו (`apps-script`), דחוף את הקוד:
   ```bash
   clasp push -f
   ```

## פריסה (שמירה על אותה כתובת /exec)

```bash
clasp deployments
```
העתק את מזהה הפריסה הקיימת (`- AKfyc... @N`), ואז עדכן אותה לקוד החדש — אותה כתובת תישמר:
```bash
clasp deploy -i <DEPLOYMENT_ID> -d "update"
```

## הפעלת השאיבה האוטומטית

הרץ פעם אחת את `installTrigger` (לחיצת Run בעורך — גם זה בלי הדבקה), או:
```bash
clasp run installTrigger
```
(`clasp run` דורש הגדרת פרויקט GCP; לחיצת Run בעורך פשוטה יותר.)
