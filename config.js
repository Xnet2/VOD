// SHEET_CSV — קישור "Publish to web" של גיליון ה-Videos בפורמט CSV. האתר קורא ממנו את הסרטונים.
// SERVER    — שרת הלייקים והתגובות ב-PythonAnywhere (הקוד שלו נמצא ב-server/wsgi.py).
//             אם השרת לא זמין, האתר ממשיך לעבוד עם לייקים מקומיים ובלי תגובות.
window.VOD_CONFIG = {
  SHEET_CSV: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRxzkum1yfHWulPcYhpApeP3ZlX3HKkUWMiMkJDB02LstZFBWeYYOw68MleNbNypGeG2Xl_ULhjdhCa/pub?gid=1239361687&single=true&output=csv',
  SERVER: 'https://metailim.pythonanywhere.com/vod'
};
