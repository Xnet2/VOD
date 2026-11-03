// SHEET_CSV        — קישור "Publish to web" של גיליון ה-Videos בפורמט CSV. האתר קורא ממנו את הסרטונים.
// SERVER           — שרת הלייקים והתגובות ב-PythonAnywhere (הקוד שלו נמצא ב-server/wsgi.py).
//                    אם השרת לא זמין, האתר ממשיך לעבוד עם לייקים מקומיים ובלי תגובות.
// GOOGLE_CLIENT_ID — מזהה ה-OAuth של Google להתחברות לתגובות (חייב להיות זהה לזה שבשרת).
// LOGO_URL         — הלוגו שמופיע על הסרטון. אם הוא לא נטען, יופיע logo.png המקומי.
window.VOD_CONFIG = {
  SHEET_CSV: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRxzkum1yfHWulPcYhpApeP3ZlX3HKkUWMiMkJDB02LstZFBWeYYOw68MleNbNypGeG2Xl_ULhjdhCa/pub?gid=1239361687&single=true&output=csv',
  SERVER: 'https://metailim.pythonanywhere.com/vod',
  GOOGLE_CLIENT_ID: '426523025549-7c50rkn7cun4vmm2r802u0ij6egjehtg.apps.googleusercontent.com',
  LOGO_URL: 'https://res.cloudinary.com/xgh73omp/image/upload/v1793736075/slg6azbpgk3nrngxwzh3.png',
  // ה-Worker ב-Cloudflare שמביא את קובצי הווידאו להורדה עם הלוגו בסוף (הקוד ב-worker/)
  MEDIA_PROXY: 'https://vodos-media.i0527685490.workers.dev',
  // תמונת פרופיל קבועה לכל מקור (אם ריק — משתמשים במה שהתוסף שמר בטבלה)
  SOURCE_AVATARS: {
    hagizra: ''
  }
};
