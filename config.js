// קישור "Publish to web" של גיליון ה-Videos בפורמט CSV — האתר קורא ממנו את הסרטונים.
// LIKES_API — כתובת ה-/exec של ה-Apps Script, לשמירת לייקים משותפים בין המשתמשים.
// (אם ה-Apps Script עדיין לא עודכן עם קוד הלייקים, האתר פשוט יציג "אהבתי" מקומי.)
window.VOD_CONFIG = {
  SHEET_CSV: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRxzkum1yfHWulPcYhpApeP3ZlX3HKkUWMiMkJDB02LstZFBWeYYOw68MleNbNypGeG2Xl_ULhjdhCa/pub?gid=1239361687&single=true&output=csv',
  LIKES_API: 'https://script.google.com/macros/s/AKfycbz9U-HuFA0yk3j0H2vUcugLbcik0P_6GTWYA6fNb-m_rjdrr8j94Gl4I9Aywqm8IQ4-Zw/exec'
};
